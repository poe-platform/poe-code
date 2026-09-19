import { test } from "vitest";
import assert from "node:assert/strict";
import { execute, run, defaultLimits } from "./engine.js";
import { OwnedArguments } from "./argv.js";
import { utf8Codec } from "./codecs/utf8.js";
import type { CsvkitContext } from "./contracts.js";
import { csvlook } from "./commands/csvlook.js";
import reference from "../../../docs/csvkit/csvlook-reference.json" with { type: "json" };
import terminalReference from "../../../docs/csvkit/csvlook-terminal-reference.json" with { type: "json" };
import rowLimitReference from "../../../docs/csvkit/csvlook-rowlimit-reference.json" with { type: "json" };
import numericReference from "../../../docs/csvkit/csvlook-user-numeric-reference.json" with { type: "json" };

async function invokeLook(input: string, argv: readonly string[], overrides: Partial<CsvkitContext> = {}, settings?: Readonly<Record<string, unknown>>) {
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
    locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unexpected locale call"); } },
    clock: { now: () => 0 }, limits: defaultLimits, signal: new AbortController().signal,
    registerCleanup: cleanup => { cleanups.push(cleanup); }, ...overrides
  };
  try {
    const status = settings ? await run({ command: "csvlook", settings }, context) : await execute("csvlook", context);
    return { stdout, stderr, status };
  } finally { await Promise.all(cleanups.map(cleanup => cleanup())); }
}

for (const capture of terminalReference.captures) {
  test(`csvlook terminal ${capture.columns} columns does not change table bytes`, async () => {
    assert.deepEqual(await invokeLook(capture.stdin, ["-y0"], {
      terminal: { stdinIsTTY: false, stdoutIsTTY: true, stderrIsTTY: false, columns: capture.columns, lines: capture.lines }
    }), { stdout: capture.stdout.replaceAll("\r\n", "\n"), stderr: capture.stderr, status: capture.status });
  });
}

for (const [index, item] of [...reference.cases, ...rowLimitReference.cases, ...numericReference.cases].entries()) {
  test(`csvlook frozen original differential ${index}`, async () => {
    assert.deepEqual(await invokeLook(item.stdin, item.argv), { stdout: item.stdout, stderr: item.stderr, status: item.status });
  });
}

test("csvlook exact source flags are collision free", () => {
  const actual = csvlook.actions.flatMap(action => action.optionStrings).sort();
  const expected = "-h --help -d --delimiter -t --tabs -q --quotechar -u --quoting -b --no-doublequote -p --escapechar -z --maxfieldsize -e --encoding -L --locale -S --skipinitialspace --blanks --null-value --date-format --datetime-format --no-leading-zeroes -H --no-header-row -K --skip-lines -v --verbose -l --linenumbers --add-bom --zero -V --version --max-rows --max-columns --max-column-width --max-precision --no-number-ellipsis -y --snifflimit -I --no-inference".split(" ").sort();
  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, actual.length);
});

test("csvlook SDK formatting config stays invocation local", async () => {
  const input = "n\n2.12345\n";
  assert.deepEqual(await invokeLook(input, [], {}, { sniff_limit: 0, no_number_ellipsis: true }), { stdout: "|     n |\n| ----- |\n| 2.123 |\n", stderr: "", status: 0 });
  assert.deepEqual(await invokeLook(input, ["-y0"]), { stdout: "|      n |\n| ------ |\n| 2.123… |\n", stderr: "", status: 0 });
});

test("csvlook zero-row named loading probes open without reading and refuses absent capability", async () => {
  let probes = 0;
  const settings = { input_path: "data.csv", sniff_limit: 0, no_header_row: true, max_rows: 0 };
  assert.deepEqual(await invokeLook("", [], {
    probeInputOpen: async (path, options) => {
      probes++;
      assert.equal(path, "data.csv"); assert.equal(options.cwd, "/");
      options.signal.throwIfAborted();
    }
  }, settings), { stdout: "||\n|  |\n", stderr: "", status: 0 });
  assert.equal(probes, 1);
  assert.deepEqual(await invokeLook("", [], {}, settings), {
    stdout: "", stderr: "csvkit: unsupported or unqualified: zero-row named input open capability\n", status: 78
  });
});

for (const value of ["1e309", "-1e309"]) {
  test(`csvlook float-overflow Decimal ${value} retains scientific text`, async () => {
    const cell = value.startsWith("-") ? "-1E+309" : "1E+309";
    assert.deepEqual(await invokeLook(`n\n${value}\n`, ["-y0"]), {
      stdout: `| ${"n".padStart(cell.length)} |\n| ${"-".repeat(cell.length)} |\n| ${cell} |\n`, stderr: "", status: 0
    });
  });
}

for (const value of ["9999999999999999999999999999.5", "123456789012345678901234567890"]) {
  test(`csvlook Decimal quantization error ${value} reports original diagnostic`, async () => {
    assert.deepEqual(await invokeLook(`n\n${value}\n`, ["-y0"]), {
      stdout: "", stderr: "InvalidOperation: [<class 'decimal.InvalidOperation'>]\n", status: 1
    });
  });
}
