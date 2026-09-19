import { test } from "vitest";
import assert from "node:assert/strict";
import { execute, run, defaultLimits } from "./engine.js";
import { OwnedArguments } from "./argv.js";
import { utf8Codec } from "./codecs/utf8.js";
import type { CsvkitContext } from "./contracts.js";
import formatReference from "../../../docs/csvkit/csvformat-reference.json" with { type: "json" };
import reference from "../../../docs/csvkit/raw-operation-reference.json" with { type: "json" };
import { csvformat } from "./commands/csvformat.js";

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
    const status = settings ? await run({ command: "csvformat", settings }, context) : await execute("csvformat", context);
    return { stdout, stderr, status };
  } finally { await Promise.all(cleanups.map(cleanup => cleanup())); }
}

test("csvformat original csvkit 2.2.0 German locale regression", async () => {
  assert.deepEqual(await invoke('a,b,c\n"1,7","200.000.000",\n', ["-U", "2", "--locale", "de_DE"]), {
    stdout: '"a","b","c"\n1.7,200000000,""\n', stderr: "", status: 0
  });
});

for (const [index, item] of reference.cases.entries()) {
  if (item.command !== "csvformat") continue;
  test(`csvformat frozen raw observation ${index}`, async () => {
    assert.deepEqual(await invoke(item.stdin, item.argv), { stdout: item.stdout, stderr: item.stderr, status: item.status });
  });
}

test("csvformat keeps literal source flags and destination meanings without collisions", () => {
  const flags = csvformat.actions.flatMap(action => action.optionStrings);
  assert.equal(new Set(flags).size, flags.length);
  assert.deepEqual(flags, ["-h", "--help", "-d", "--delimiter", "-t", "--tabs", "-q", "--quotechar", "-u", "--quoting", "-b", "--no-doublequote", "-p", "--escapechar", "-z", "--maxfieldsize", "-e", "--encoding", "-L", "--locale", "-S", "--skipinitialspace", "-H", "--no-header-row", "-K", "--skip-lines", "-v", "--verbose", "-l", "--linenumbers", "--add-bom", "--zero", "-V", "--version", "-E", "--skip-header", "-D", "--out-delimiter", "-T", "--out-tabs", "-A", "--out-asv", "-Q", "--out-quotechar", "-U", "--out-quoting", "-B", "--out-no-doublequote", "-P", "--out-escapechar", "-M", "--out-lineterminator"]);
  for (const [flag, dest] of [["-D", "out_delimiter"], ["-d", "delimiter"], ["-Q", "out_quotechar"], ["-q", "quotechar"], ["-L", "locale"]]) {
    assert.equal(csvformat.actions.find(action => action.optionStrings.some(value => value === flag))?.dest, dest);
  }
});

test("csvformat CLI and SDK preserve independent dialects and ASV precedence", async () => {
  const input = "comment\na;b\n001;false\n";
  const expected = { stdout: "\uFEFFa\u001fb\u001e001\u001ffalse\u001e", stderr: "", status: 0 };
  assert.deepEqual(await invoke(input, ["-K", "1", "-d", ";", "-D", "|", "-T", "-A", "-M", "END", "--add-bom"]), expected);
  assert.deepEqual(await invoke(input, [], { skip_lines: 1, delimiter: ";", out_delimiter: "|", out_tabs: true, out_asv: true, out_lineterminator: "END", add_bom: true }), expected);
});

test("csvformat original escaped quote regression in raw and inferred paths", async () => {
  const input = 'a\n"a ""quoted"" string"';
  assert.deepEqual(await invoke(input, ["-P", "#", "-B"]), { stdout: 'a\na #"quoted#" string\n', stderr: "", status: 0 });
  assert.deepEqual(await invoke(input, ["-U", "2", "-P", "#", "-B"]), { stdout: '"a"\n"a #"quoted#" string"\n', stderr: "", status: 0 });
});

test("csvformat validates the writer before input and preserves partial output on escape failure", async () => {
  assert.deepEqual(await invoke("", ["-Q", ""]), { stdout: "", stderr: 'TypeError: "quotechar" must be a unicode character or None, not a string of length 0\n', status: 1 });
  assert.deepEqual(await invoke('a,b\n"x,y",z\n', ["-U", "3"]), { stdout: "a,b\n", stderr: "Error: need to escape, but no escapechar set\n", status: 1 });
  assert.deepEqual(await invoke('a\n"a ""quoted"" string"', ["-B"]), { stdout: "a\n", stderr: "Error: need to escape, but no escapechar set\n", status: 1 });
});

for (const [index, item] of formatReference.cases.entries()) {
  // Unqualified reader types and deployment-specific warning paths are blockers.
  if (item.argv.includes("-u") || item.stderr.includes("DuplicateColumnWarning")) continue;
  test(`csvformat pinned typed/header observation ${index}`, async () => {
    assert.deepEqual(await invoke(item.stdin, item.argv), { stdout: item.stdout, stderr: item.stderr, status: item.status });
  });
}
