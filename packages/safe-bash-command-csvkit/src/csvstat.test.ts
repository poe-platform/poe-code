import { test } from "vitest";
import assert from "node:assert/strict";
import { execute, run, defaultLimits } from "./engine.js";
import { OwnedArguments } from "./argv.js";
import { utf8Codec } from "./codecs/utf8.js";
import type { CsvkitContext } from "./contracts.js";
import { csvstat } from "./commands/csvstat.js";
import reference from "../../../docs/csvkit/csvstat-reference.json" with { type: "json" };
import userReference from "../../../docs/csvkit/csvstat-user-reference.json" with { type: "json" };

async function invokeStat(input: string, argv: readonly string[], overrides: Partial<CsvkitContext> = {}, settings?: Readonly<Record<string, unknown>>) {
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
    // Reference LC_ALL=C has no grouping and uses dot decimal punctuation.
    locale: { profile: "C", timezone: "UTC", formatNumber: (value, locale, format, grouping) => {
      assert.equal(locale, "C");
      const result = (reference.formats as Record<string, string>)[JSON.stringify([format, value, grouping])];
      assert.notEqual(result, undefined, `unmeasured locale formatting ${format} ${value} ${grouping}`);
      return result!;
    } },
    clock: { now: () => 0 }, limits: defaultLimits, signal: new AbortController().signal,
    registerCleanup: cleanup => { cleanups.push(cleanup); }, ...overrides
  };
  try {
    const status = settings ? await run({ command: "csvstat", settings }, context) : await execute("csvstat", context);
    return { stdout, stderr, status };
  } finally { await Promise.all(cleanups.map(cleanup => cleanup())); }
}

test("csvstat original regression computes a scalar sample mean", async () => {
  assert.deepEqual(await invokeStat("x\n2\n4\n", ["-y0", "--mean"], { locale: { profile: "C", timezone: "UTC", formatNumber: () => "3.000" } }), { stdout: "3\n", stderr: "", status: 0 });
});

test("csvstat median preserves failures from all Agate percentile boundaries", async () => {
  assert.deepEqual(await invokeStat("x\n-Infinity\n-Infinity\n-Infinity\nInfinity\nInfinity\n", ["-y0", "--median"]), {
    stdout: "None\n", stderr: "", status: 0
  });
  assert.deepEqual(await invokeStat("x\n-Infinity\n-Infinity\nInfinity\n", ["-y0", "--median"]), {
    stdout: "-Infinity\n", stderr: "", status: 0
  });
});

test("csvstat max precision skips finite Decimals overflowing Agate's float finiteness check", async () => {
  for (const input of ["x\n1e10000\n2e10000\n", "x\n1e309\n-1e309\n"]) {
    assert.deepEqual(await invokeStat(input, ["-y0", "--max-precision"]), { stdout: "0\n", stderr: "", status: 0 });
  }
  assert.deepEqual(await invokeStat("x\n1e309\n0.125\n", ["-y0", "--max-precision"]), { stdout: "3\n", stderr: "", status: 0 });
});

for (const [index, item] of reference.cases.entries()) {
  test(`csvstat frozen original differential ${index}`, async () => {
    assert.deepEqual(await invokeStat(item.stdin, item.argv), { stdout: item.stdout, stderr: item.stderr, status: item.status });
  });
}

for (const [index, item] of userReference.cases.entries()) {
  test(`csvstat user numeric/Unicode/temporal original differential ${index}`, async () => {
    assert.deepEqual(await invokeStat(item.stdin, item.argv), { stdout: item.stdout, stderr: item.stderr, status: item.status });
  });
}

test("csvstat exact source flags are collision free with indent and all operations", () => {
  const expected = "-h --help -d --delimiter -t --tabs -q --quotechar -u --quoting -b --no-doublequote -p --escapechar -z --maxfieldsize -e --encoding -L --locale -S --skipinitialspace --blanks --null-value --date-format --datetime-format --no-leading-zeroes -H --no-header-row -K --skip-lines -v --verbose -l --linenumbers --add-bom --zero -V --version --csv --json -i --indent -n --names -c --columns --type --nulls --non-nulls --unique --min --max --sum --mean --median --stdev --len --max-precision --freq --freq-count --count --decimal-format -G --no-grouping-separator -y --snifflimit -I --no-inference".split(" ").sort();
  const actual = csvstat.actions.flatMap(action => action.optionStrings).sort();
  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, actual.length);
  assert.equal(csvstat.actions.find(action => action.optionStrings.some(flag => flag === "-i"))?.dest, "indent");
});

test("csvstat SDK preserves engine selection, locale profile and grouping injection", async () => {
  const calls: unknown[] = [];
  assert.deepEqual(await invokeStat("x\n2000\n4000\n", [], {
    locale: { profile: "frozen-de", timezone: "UTC", formatNumber: (value, locale, format, grouping) => {
      calls.push([value, locale, format, grouping]); return "3.000,000";
    } }
  }, { mean_only: true, sniff_limit: 0, decimal_format: "%.3f", no_grouping_separator: false }), { stdout: "3.000,\n", stderr: "", status: 0 });
  assert.deepEqual(calls, [["3000", "frozen-de", "%.3f", true]]);
});

test("csvstat preserves formatter error identity even for a calculation-like message", async () => {
  const failure = new Error("mixed datetime offsets");
  await assert.rejects(invokeStat("x\n2\n4\n", ["-y0", "--mean"], {
    locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw failure; } }
  }), error => error === failure);
});
