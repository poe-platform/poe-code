import { test } from "vitest";
import assert from "node:assert/strict";
import { execute, run, defaultLimits } from "./engine.js";
import { OwnedArguments } from "./argv.js";
import { utf8Codec } from "./codecs/utf8.js";
import type { CsvkitContext } from "./contracts.js";
import { csvstack } from "./commands/csvstack.js";
import reference from "../../../docs/csvkit/csvstack-reference.json" with { type: "json" };

async function invoke(files: Readonly<Record<string, string>>, argv: readonly string[], input = "", overrides: Partial<CsvkitContext> = {}, settings?: Readonly<Record<string, unknown>>) {
  let stdout = ""; let stderr = "";
  const cleanups: (() => Promise<void>)[] = [];
  const context: CsvkitContext = {
    argv: new OwnedArguments(argv.map(value => new TextEncoder().encode(value)), defaultLimits), cwd: "/",
    fs: { readFile: async path => { assert.ok(path in files); return new TextEncoder().encode(files[path]); }, writeFile: async () => { throw new Error("unexpected write"); } },
    stdin: (async function* () { yield new TextEncoder().encode(input); })(), stdinIsDefault: false,
    stdout: { write: async bytes => { stdout += new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes); } },
    stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
    env: {}, codecs: [utf8Codec], compression: [], databases: [],
    locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unexpected locale call"); } },
    clock: { now: () => 0 }, limits: defaultLimits, signal: new AbortController().signal,
    registerCleanup: cleanup => { cleanups.push(cleanup); }, ...overrides
  };
  try {
    const status = settings ? await run({ command: "csvstack", settings }, context) : await execute("csvstack", context);
    return { stdout, stderr, status };
  } finally { await Promise.all(cleanups.map(cleanup => cleanup())); }
}

for (const [index, item] of reference.cases.entries()) test(`csvstack frozen original differential ${index}`, async () => {
  assert.deepEqual(await invoke(item.files, item.argv, item.stdin), { stdout: item.stdout, stderr: item.stderr, status: item.status });
});

test("csvstack inherits only its source-declared flags without collisions", () => {
  const expected = "-h --help -d --delimiter -t --tabs -q --quotechar -u --quoting -b --no-doublequote -p --escapechar -z --maxfieldsize -e --encoding -S --skipinitialspace -H --no-header-row -K --skip-lines -v --verbose -l --linenumbers --add-bom --zero -V --version -g --groups -n --group-name --filenames".split(" ");
  const actual = csvstack.actions.flatMap(action => action.optionStrings);
  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, actual.length);
});

test("csvstack SDK shares the dictionary writer collision engine", async () => {
  assert.deepEqual(await invoke({}, [], "line_number,a\nold,x\n", {}, { line_numbers: true }), {
    stdout: "line_number,line_number,a\n1,1,x\n", stderr: "", status: 0
  });
});

test("csvstack awaits union-header output before reopening input", async () => {
  const writes: string[] = [];
  let reads = 0;
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const pending = invoke({}, ["a"], "", {
    fs: {
      readFile: async () => { reads++; return new TextEncoder().encode("a\nx\n"); },
      writeFile: async () => { assert.fail("unexpected write"); }
    },
    stdout: { write: async bytes => {
      writes.push(new TextDecoder().decode(bytes));
      if (writes.length === 1) { entered(); await blocked; }
    } }
  });
  await Promise.race([started, pending.then(result => { throw new Error(JSON.stringify(result)); })]);
  assert.equal(reads, 1);
  assert.deepEqual(writes, ["a\n"]);
  release();
  assert.deepEqual(await pending, { stdout: "", stderr: "", status: 0 });
  assert.equal(reads, 2);
  assert.deepEqual(writes, ["a\n", "x\n"]);
});

test("csvstack re-reads changed headers and preserves output before a new dictionary key fails", async () => {
  const reads: string[] = [];
  assert.deepEqual(await invoke({}, ["one.csv", "two.csv"], "", {
    fs: {
      readFile: async path => {
        const reopened = reads.includes(path);
        reads.push(path);
        return new TextEncoder().encode(path === "/one.csv" ? "a,b\nfirst,second\n" : reopened ? "c\nchanged\n" : "b\noriginal\n");
      },
      writeFile: async () => { assert.fail("unexpected write"); }
    }
  }), { stdout: "a,b\nfirst,second\n", stderr: "ValueError: dict contains fields not in fieldnames: 'c'\n", status: 1 });
  assert.deepEqual(reads, ["/one.csv", "/two.csv", "/one.csv", "/two.csv"]);
});

test("csvstack failing union-header sink preserves failure identity without reopening files", async () => {
  const failure = new Error("injected sink failure");
  let reads = 0;
  let writes = 0;
  await assert.rejects(invoke({}, ["a.csv"], "", {
    fs: {
      readFile: async () => { reads++; return new TextEncoder().encode("a\nx\n"); },
      writeFile: async () => { assert.fail("unexpected write"); }
    },
    stdout: { write: async bytes => {
      writes++;
      assert.equal(new TextDecoder().decode(bytes), "a\n");
      throw failure;
    } }
  }), caught => caught === failure);
  assert.equal(reads, 1);
  assert.equal(writes, 1);
});
