import { test } from "vitest";
import assert from "node:assert/strict";
import { execute, run, defaultLimits } from "./engine.js";
import { OwnedArguments } from "./argv.js";
import { utf8Codec } from "./codecs/utf8.js";
import type { CsvkitContext } from "./contracts.js";
import reference from "../../../docs/csvkit/additional-operation-reference.json" with { type: "json" };
import { csvclean } from "./commands/csvclean.js";

async function invoke(input: string, argv: readonly string[], settings?: Readonly<Record<string, unknown>>, retained = defaultLimits.maxRetainedBytes) {
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
    clock: { now: () => 0 }, limits: { ...defaultLimits, maxRetainedBytes: retained }, signal: new AbortController().signal,
    registerCleanup: cleanup => { cleanups.push(cleanup); }
  };
  try {
    const status = settings ? await run({ command: "csvclean", settings }, context) : await execute("csvclean", context);
    return { stdout, stderr, status };
  } finally { await Promise.all(cleanups.map(cleanup => cleanup())); }
}

for (const [index, item] of reference.cases.entries()) {
  if (item.command !== "csvclean") continue;
  test(`csvclean frozen 2.2.0 case ${index}`, async () => {
    assert.deepEqual(await invoke(item.stdin, item.argv), { stdout: item.stdout, stderr: item.stderr, status: item.status });
  });
}

test("csvclean admits retained join candidates even without length checking", async () => {
  const result = await invoke("a,b,c\n" + "x\n".repeat(80), ["--join-short-rows"], undefined, 4096);
  assert.equal(result.status, 78);
  assert.equal(result.stderr, "csvkit: unsupported or unqualified: retained byte budget exceeded\n");
});

test("csvclean exposes only inherited and locally declared executable flags", async () => {
  const expected = ["-h", "--help", "-d", "--delimiter", "-t", "--tabs", "-q", "--quotechar", "-u", "--quoting", "-b", "--no-doublequote", "-p", "--escapechar", "-z", "--maxfieldsize", "-e", "--encoding", "-S", "--skipinitialspace", "-H", "--no-header-row", "-K", "--skip-lines", "-v", "--verbose", "-l", "--linenumbers", "--add-bom", "--zero", "-V", "--version", "--length-mismatch", "--empty-columns", "-a", "--enable-all-checks", "--omit-error-rows", "--label", "--header-normalize-space", "--join-short-rows", "--separator", "--fill-short-rows", "--fillvalue"];
  const actual = csvclean.actions.flatMap(action => action.optionStrings);
  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, actual.length);
  assert.equal(csvclean.actions.find(action => action.optionStrings.some(flag => flag === "-a"))?.dest, "enable_all_checks");
  const rejected = await invoke("a,b\nx\n", ["-n"]);
  assert.deepEqual(rejected, { status: 2, stdout: "", stderr: csvclean.usage + "csvclean: error: unrecognized arguments: -n\n" });
});

test("csvclean CLI and SDK share fill/check and source row-length omission", async () => {
  const expected = { status: 1, stdout: "a,b\nx,\ny,\n", stderr: "label,line_number,msg,a,b\nbatch,1,Empty columns named 'b'! Try: csvcut -C 2,,\n" };
  const input = "a,b\nx\ny,\n";
  assert.deepEqual(await invoke(input, ["-a", "--fill-short-rows", "--fillvalue", "", "--omit-error-rows", "--label", "batch"]), expected);
  assert.deepEqual(await invoke(input, [], { enable_all_checks: true, fill_short_rows: true, fillvalue: "", omit_error_rows: true, label: "batch" }), expected);
});

test("csvclean companion values and omission do not enable checks or fixes", async () => {
  for (const argv of [[], ["--separator", ":"], ["--fillvalue", "X"], ["--omit-error-rows"], ["--label", "batch"]]) {
    assert.deepEqual(await invoke("a,b\nx\n", argv), {
      status: 2, stdout: "", stderr: csvclean.usage + "csvclean: error: No checks or fixes were enabled. See available options with: csvclean --help\n"
    });
  }
});

test("csvclean rejects overridden shared options and historical output mode", async () => {
  for (const flag of ["-L", "--locale", "-I", "--no-inference", "-n", "--dry-run"]) {
    assert.deepEqual(await invoke("a,b\nx\n", ["--length-mismatch", flag]), {
      status: 2, stdout: "", stderr: csvclean.usage + `csvclean: error: unrecognized arguments: ${flag}\n`
    });
  }
});
