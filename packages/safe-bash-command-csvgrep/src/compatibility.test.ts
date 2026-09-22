import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandContext, InvocationCleanup } from "safe-bash-contracts/command";
import { csvgrep, type CsvgrepOptions } from "./index.js";
import { CsvBudget } from "safe-bash-csv-engine";
import { createMatcher } from "./match.js";

// Expected bytes are independent controls from the pinned research contract,
// never generated with the candidate parser, selector or writer.
const cells: readonly {
  id: string; input: string; args: string[]; options: CsvgrepOptions;
  output: string; file?: string; status?: number; error?: string;
}[] = [
  { id: "physical-multiline", input: 'x,id\n"a\nb",1\nc,2\na,3\n',
    args: ["-cx", "-ma", "-l"], options: { columns: "x", match: "a", lineNumbers: true },
    output: 'line_numbers,x,id\n2,"a\nb",1\n4,a,3\n' },
  { id: "missing-cell-short-row", input: "x,y\na\na,b\n",
    args: ["-cy", "-r^$"], options: { columns: "y", regex: "^$" }, output: "x,y\na\n" },
  { id: "unicode-digit-negative", input: "x,id\n١,1\n1,2\na,3\n",
    args: ["-cx", "-r(?a)\\d"], options: { columns: "x", regex: "(?a)\\d" }, output: "x,id\n1,2\n" },
  { id: "absolute-end-negative", input: 'x,id\n"abc\n",1\nabc,2\n',
    args: ["-cx", "-r\\Aabc\\Z"], options: { columns: "x", regex: "\\Aabc\\Z" }, output: "x,id\nabc,2\n" },
  { id: "crlf-writer", input: 'x,id\n"a\r\nb",1\n', args: ["-cx", "-ma"],
    options: { columns: "x", match: "a" }, output: 'x,id\n"a\n\nb",1\n' },
  { id: "empty-pattern-any-inverted", input: "x,y\na,b\nb,a\n", args: ["-cx,y", "-m", "", "-ai"],
    options: { columns: "x,y", match: "", any: true, invert: true }, output: "x,y\na,b\nb,a\n" },
  { id: "repeated-fields-inverted", input: "x,y\na,a\na,b\nb,a\nb,b\n", args: ["-cy,x,y", "-ma", "-i"],
    options: { columns: "y,x,y", match: "a", invert: true }, output: "x,y\na,b\nb,a\nb,b\n" },
  { id: "numeric-header-position", input: "2,x\na,b\n", args: ["-c2", "-mb"],
    options: { columns: "2", match: "b" }, output: "2,x\na,b\n" },
  { id: "file-rstrip-precedence", input: "x,id\na,1\na ,2\na\t,3\n,4\n", file: "a \na\t\n\u00a0\n",
    args: ["-cx", "-r", "", "-fF", "-mignored"], options: { columns: "x", regex: "", file: "F", match: "ignored" },
    output: "x,id\na,1\n,4\n" },
  { id: "no-match-success", input: "x\na\n", args: ["-cx", "-mz"], options: { columns: "x", match: "z" }, output: "x\n" },
  { id: "invalid-open-group", input: "x\na\n", args: ["-cx", "-r("], options: { columns: "x", regex: "(" },
    output: "", status: 1, error: "error: missing ), unterminated subpattern at position 0\n" },
  { id: "unsupported-named-reference", input: "x\naa\n", args: ["-cx", "-r(?P<x>a)(?P=x)"],
    options: { columns: "x", regex: "(?P<x>a)(?P=x)" }, output: "", status: 1,
    error: "error: Unsupported Python regex flags or group\n" },
  { id: "unsupported-lookbehind", input: "x\nza\n", args: ["-cx", "-r(?<=z)a"],
    options: { columns: "x", regex: "(?<=z)a" }, output: "", status: 1,
    error: "error: Unsupported Python regex flags or group\n" },
  { id: "unsupported-backtracking", input: "x\naaaaaaaaaaaaaaaa!\n", args: ["-cx", "-r(a+)+$"],
    options: { columns: "x", regex: "(a+)+$" }, output: "", status: 1,
    error: "error: Groups are unsupported by bounded-sequence-v1\n" }
];

for (const cell of cells) test(`independent byte control: ${cell.id}`, async () => {
  const encoder = new TextEncoder();
  const input = encoder.encode(cell.input), file = encoder.encode(cell.file ?? "");
  // Every input-byte split, and one-byte VFS match-file chunks, include UTF-8,
  // physical newlines, quotes and empty pulls without using parser internals.
  for (let split = 0; split <= input.length; split++) for (const sdk of [false, true]) {
    const out: number[] = [], err: number[] = [], paths: string[] = [];
    const cleanups: InvocationCleanup[] = [];
    let closed = 0;
    const signal = new AbortController().signal;
    const context: CommandContext = {
      command: "csvgrep", args: sdk ? [] : cell.args,
      stdin: (async function* () {
        try { yield input.slice(0, split); yield new Uint8Array(); yield input.slice(split); }
        finally { closed++; }
      })(),
      stdout: { async write(bytes) { out.push(...bytes); } },
      stderr: { async write(bytes) { err.push(...bytes); } },
      cwd: "/vfs", env: { PYTHONIOENCODING: "ascii" }, signal,
      fs: { readStream(path: string, options: { signal: AbortSignal }) {
        // Acquisition uses an invocation-owned signal linked to caller abort.
        assert.equal(options.signal.aborted, false);
        paths.push(path);
        return (async function* () { for (const byte of file) yield Uint8Array.of(byte); })();
      } } as unknown as CommandContext["fs"],
      registerCleanup(cleanup) { cleanups.push(cleanup); }
    };
    const result = await csvgrep(context, sdk ? cell.options : undefined);
    assert.equal(result.exitCode, cell.status ?? 0, `${cell.id}/${split}/${sdk}`);
    assert.deepEqual(Uint8Array.from(out), encoder.encode(cell.output));
    assert.deepEqual(Uint8Array.from(err), encoder.encode(cell.error ?? ""));
    assert.deepEqual(paths, cell.file === undefined ? [] : ["/vfs/F"]);
    assert.equal(result.accounting.retainedBytes, 0);
    await Promise.all(cleanups.flatMap((cleanup) => [cleanup(), cleanup()]));
    assert.equal(closed, cell.status === undefined ? 1 : 0);
  }
});

test("regex search stops at a deterministic work bound and does not poison the next invocation", () => {
  // Many failing search starts: bounded work proof, not a timing benchmark.
  const limited = new CsvBudget({ work: 500 }, new AbortController().signal);
  const matcher = createMatcher({ regex: "aaaaab" }, new Set(), limited)!;
  assert.throws(() => matcher("a".repeat(128)), { code: "LIMIT", message: "work limit exceeded" });
  assert.ok(limited.accounting.work <= 500);
  const fresh = new CsvBudget({}, new AbortController().signal);
  assert.equal(createMatcher({ regex: "aaaaab" }, new Set(), fresh)!("aaaaab"), true);
  const canceled = new AbortController();
  const canceledBudget = new CsvBudget({}, canceled.signal);
  const canceledMatcher = createMatcher({ regex: "a" }, new Set(), canceledBudget)!;
  canceled.abort(false);
  assert.throws(() => canceledMatcher("a"), (error) => error === false);
});
