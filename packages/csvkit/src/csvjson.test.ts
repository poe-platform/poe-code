import { test } from "vitest";
import assert from "node:assert/strict";
import { execute, run, defaultLimits } from "./engine.js";
import { OwnedArguments } from "./argv.js";
import { utf8Codec } from "./codecs/utf8.js";
import type { CsvkitContext } from "./contracts.js";
import { csvjson } from "./commands/csvjson.js";
import reference from "../../../docs/csvkit/csvjson-reference.json" with { type: "json" };
import geoReference from "../../../docs/csvkit/geojson-reference.json" with { type: "json" };
import geoUserReference from "../../../docs/csvkit/geojson-user-edge-reference.json" with { type: "json" };

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
    columnWarnings: { utilsPath: reference.warningUtilsPath },
    locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unexpected locale"); } },
    clock: { now: () => 0 }, limits: defaultLimits, signal: new AbortController().signal,
    registerCleanup: cleanup => { cleanups.push(cleanup); }
  };
  try {
    const status = settings ? await run({ command: "csvjson", settings }, context) : await execute("csvjson", context);
    return { stdout, stderr, status };
  } finally { for (const cleanup of cleanups) await cleanup(); }
}

for (const [index, item] of reference.cases.entries()) {
  test(`csvjson frozen original differential ${index}`, async () => {
    assert.deepEqual(await invoke(item.stdin, item.argv), { stdout: item.stdout, stderr: item.stderr, status: item.status });
  });
}

for (const [index, item] of geoReference.cases.entries()) {
  test(`csvjson GeoJSON source failures and coordinate recursion ${index}`, async () => {
    assert.deepEqual(await invoke(item.stdin, item.argv), { stdout: item.stdout, stderr: item.stderr, status: item.status });
  });
}

for (const [index, item] of geoUserReference.cases.entries()) {
  test(`csvjson GeoJSON user bbox initialization and comparison ${index}`, async () => {
    assert.deepEqual(await invoke(item.stdin, item.argv), { stdout: item.stdout, stderr: item.stderr, status: item.status });
  });
}

test("csvjson exact source flags have no collisions or omitted inherited options", () => {
  const flags = csvjson.actions.flatMap(action => action.optionStrings).sort();
  assert.deepEqual(flags, "-h --help -d --delimiter -t --tabs -q --quotechar -u --quoting -b --no-doublequote -p --escapechar -z --maxfieldsize -e --encoding -L --locale -S --skipinitialspace --blanks --null-value --date-format --datetime-format --no-leading-zeroes -H --no-header-row -K --skip-lines -v --verbose -l --linenumbers --add-bom --zero -V --version -i --indent -k --key --lat --lon --type --geometry --crs --no-bbox --stream -y --snifflimit -I --no-inference".split(" ").sort());
  assert.equal(new Set(flags).size, flags.length);
  for (const [flag, dest] of [["-i", "indent"], ["-k", "key"], ["-y", "sniff_limit"], ["-I", "no_inference"]]) assert.equal(csvjson.actions.find(action => action.optionStrings.some(value => value === flag))?.dest, dest);
});

test("csvjson SDK uses the same typed engine and retained key columns", async () => {
  assert.deepEqual(await invoke("k,x\n2.50,é\n", [], { sniff_limit: 0, key: "k", indent: 0 }), {
    stdout: '{\n"2.5": {\n"k": 2.5,\n"x": "é"\n}\n}', stderr: "", status: 0
  });
});

for (const text of ["0.1ms", "1.5us", "-2ms", "3 us", "2MS", ".5ms"]) {
  test(`csvjson unrecognized subsecond unit ${text} remains text`, async () => {
    const stdin = `k,x\n${text},é\n${text},z\n`;
    const first = `{"k": ${JSON.stringify(text)}, "x": "é"}`;
    const second = `{"k": ${JSON.stringify(text)}, "x": "z"}`;
    assert.deepEqual(await invoke(stdin, ["-y0"]), { stdout: `[${first}, ${second}]`, stderr: "", status: 0 });
    assert.deepEqual(await invoke(stdin, ["-y0", "--stream"]), { stdout: `${first}\n${second}\n`, stderr: "", status: 0 });
    assert.deepEqual(await invoke(stdin, ["-y0", "-k", "k"]), {
      stdout: "", stderr: `ValueError: Value ${text} is not unique in the key column.\n`, status: 1
    });
  });
}
