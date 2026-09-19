import { test } from "vitest";
import assert from "node:assert/strict";
import { execute, run, defaultLimits } from "./engine.js";
import { OwnedArguments } from "./argv.js";
import { utf8Codec } from "./codecs/utf8.js";
import type { CsvkitContext } from "./contracts.js";
import reference from "../../../docs/csvkit/raw-operation-reference.json" with { type: "json" };
import { csvcut } from "./commands/csvcut.js";

async function invoke(input: string, argv: readonly string[], settings?: Readonly<Record<string, unknown>>) {
  let stdout = ""; let stderr = "";
  const cleanups: (() => Promise<void>)[] = [];
  const context: CsvkitContext = {
    argv: new OwnedArguments(argv.map(value => new TextEncoder().encode(value)), defaultLimits), cwd: "/",
    fs: { readFile: async () => { throw new Error("unexpected read"); }, writeFile: async () => { throw new Error("unexpected write"); } },
    stdin: (async function* () { yield new TextEncoder().encode(input); })(), stdinIsDefault: false,
    stdout: { write: async bytes => { stdout += new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes); } },
    stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
    env: {}, codecs: [utf8Codec], compression: [], databases: [],
    locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unexpected inference"); } },
    clock: { now: () => 0 }, limits: defaultLimits, signal: new AbortController().signal,
    registerCleanup: cleanup => { cleanups.push(cleanup); }
  };
  try {
    const status = settings ? await run({ command: "csvcut", settings }, context) : await execute("csvcut", context);
    return { stdout, stderr, status };
  } finally { await Promise.all(cleanups.map(cleanup => cleanup())); }
}

test("csvcut generated singleton headers retain the source tuple error punctuation", async () => {
  assert.deepEqual(await invoke("value\n", ["-H", "-c", "missing"]), {
    stdout: "", status: 1,
    stderr: "ColumnIdentifierError: Column 'missing' is invalid. It is neither an integer nor a column name. Column names are: 'a',\n"
  });
});

for (const [index, item] of reference.cases.entries()) {
  if (item.command !== "csvcut") continue;
  test(`csvcut frozen raw observation ${index}`, async () => {
    assert.deepEqual(await invoke(item.stdin, item.argv), { stdout: item.stdout, stderr: item.stderr, status: item.status });
  });
}

test("csvcut CLI and SDK select raw cells before deleting empty output rows", async () => {
  const input = "a,b,c\n001,false,null\nignored,,surplus,extra\nx\n,\n";
  const expected = { stdout: "line_number,b,a,b\n1,false,001,false\n2,,ignored,\n3,,x,\n", stderr: "", status: 0 };
  assert.deepEqual(await invoke(input, ["-c", "2,1,2", "-x", "-l"]), expected);
  assert.deepEqual(await invoke(input, [], { columns: "2,1,2", delete_empty: true, line_numbers: true }), expected);
});

test("csvcut exposes only its source argument meanings without collisions", () => {
  const flags = csvcut.actions.flatMap(action => action.optionStrings);
  assert.equal(new Set(flags).size, flags.length);
  assert.deepEqual(flags, ["-h", "--help", "-d", "--delimiter", "-t", "--tabs", "-q", "--quotechar", "-u", "--quoting", "-b", "--no-doublequote", "-p", "--escapechar", "-z", "--maxfieldsize", "-e", "--encoding", "-S", "--skipinitialspace", "-H", "--no-header-row", "-K", "--skip-lines", "-v", "--verbose", "-l", "--linenumbers", "--add-bom", "--zero", "-V", "--version", "-n", "--names", "-c", "--columns", "-C", "--not-columns", "-x", "--delete-empty-rows"]);
});

test("csvcut user options preserve raw cells and output already written before reader errors", async () => {
  for (const [argv, input, stdout] of [
    [["-t", "-d", ";", "-S", "-c", "2,1"], "a\tb\n001\t false\n", "b,a\nfalse,001\n"],
    [["-q", "'", "-c", "2"], "a,b\n001,'false,null'\n", 'b\n"false,null"\n'],
    [["-u", "3", "-p", "\\", "-c", "2"], "a,b\n001,false\\,null\n", 'b\n"false,null"\n'],
    [["-K", "-1", "--add-bom", "-l"], "a\n001\n", "\uFEFFline_number,a\n1,001\n"],
    [["-n", "--zero", "-l", "--add-bom"], "a,b\n001,false\n", "\uFEFF  0: a\n  1: b\n"]
  ] as const) assert.deepEqual(await invoke(input, argv), { stdout, stderr: "", status: 0 });
  assert.deepEqual(await invoke("a,b\nx,y\nlong,z\n", ["-z", "1", "-l"]), {
    stdout: "line_number,a,b\n1,x,y\n", status: 1,
    stderr: "FieldSizeLimitError: CSV contains a field longer than the maximum length of 1 characters on line 3. Try raising the maximum with the field_size_limit parameter, or try setting quoting=csv.QUOTE_NONE.\n"
  });
});

test("csvcut original selector edge cases retain header order and range quirks", async () => {
  for (const [argv, input, stdout] of [
    [["-c", "same,3,1"], "same,same,2\nfirst,second,third,extra\n", "same,2,same\nfirst,third,first\n"],
    [["-c", "2"], "2,first\n001,false\n", "first\nfalse\n"],
    [["-C", "2-,missing,42"], "a,b,c,d\n1,2,3,4\n", "a,d\n1,4\n"],
    [["-c", "3:1"], "a,b,c\nx,y,z\n", "\n\n"],
    [["-c", "2-"], "a,b,c\nx,,\nz\n", "b,c\n,\n,\n"],
    [["--zero", "-c", "-2"], "a,b,c\nx,y,z\n", "b,c\ny,z\n"],
    [["-K", "1", "-c", "2,1"], '#skip\na,b\n001,"false\nnull"\n', 'b,a\n"false\nnull",001\n']
  ] as const) {
    assert.deepEqual(await invoke(input, argv), { stdout, stderr: "", status: 0 });
  }
});
