import { expect, test } from "vitest";
import { execute, run, defaultLimits } from "../engine.js";
import { OwnedArguments } from "../argv.js";
import { utf8Codec } from "../codecs/utf8.js";
import type { CsvkitContext } from "../contracts.js";
import hypothesisReference from "../../../../docs/csvkit/hypothesis-cast-reference.json" with { type: "json" };

for (const item of hypothesisReference.cases) test(`frozen hypothesis CLI and SDK: ${item.name}`, async () => {
  for (const sdk of [false, true]) {
    const f = fixture(item.stdin, item.argv.slice(1));
    try {
      const status = sdk ? await run({ command: "csvjson", settings: { sniff_limit: 0, no_inference: item.argv.includes("-I") } }, f.context) : await execute("csvjson", f.context);
      expect({ status, ...f.result() }).toEqual({ status: item.status, stdout: item.stdout, stderr: item.stderr });
    } finally { await Promise.all(f.cleanups.map(cleanup => cleanup())); }
  }
});

for (const item of hypothesisReference.numericLocaleCases) test(`numeric locale is independent of temporal hypotheses: ${item.argv[0]}`, async () => {
  for (const sdk of [false, true]) {
    const f = fixture(item.stdin, item.argv.slice(1));
    const command = item.argv[0] as "csvsort" | "csvjson";
    try {
      const status = sdk ? await run({ command, settings: item.settings }, f.context) : await execute(command, f.context);
      expect({ status, ...f.result() }).toEqual({ status: item.status, stdout: item.stdout, stderr: item.stderr });
    } finally { await Promise.all(f.cleanups.map(cleanup => cleanup())); }
  }
});

function fixture(input: string, argv: readonly string[]) {
  let stdout = ""; let stderr = "";
  const cleanups: (() => Promise<void>)[] = [];
  const context: CsvkitContext = {
    argv: new OwnedArguments(argv.map(value => new TextEncoder().encode(value)), defaultLimits), cwd: "/",
    fs: { readFile: async () => { throw new Error("unexpected read"); }, writeFile: async () => { throw new Error("unexpected write"); } },
    stdin: (async function* () { yield new TextEncoder().encode(input); })(), stdinIsDefault: false,
    stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
    stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
    env: {}, codecs: [utf8Codec], compression: [], databases: [],
    locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unexpected format"); } },
    clock: { now: () => 0 }, limits: defaultLimits, signal: new AbortController().signal,
    registerCleanup: cleanup => { cleanups.push(cleanup); }
  };
  return { context, cleanups, result: () => ({ stdout, stderr }) };
}

test("csvformat QUOTE_NONNUMERIC infers entire columns rather than individual cells", async () => {
  const f = fixture("a,b\n001,yes\n2,NA\n", ["-U", "2"]);
  expect({ status: await execute("csvformat", f.context), ...f.result() }).toEqual({
    status: 0, stdout: '"a","b"\n1,"yes"\n2,""\n', stderr: ""
  });
  await Promise.all(f.cleanups.map(cleanup => cleanup()));
});

test("csvformat typed ragged rows pad missing values and reject excess values", async () => {
  for (const [input, status, stdout, stderr] of [
    ["a,b\nx\n", 0, '"a","b"\n"x",""\n', ""],
    ["a\nx,y\n", 1, "", "ValueError: Row 0 has 2 values, but Table only has 1 columns.\n"],
    ["", 0, "\n", ""], ["\n", 0, "\n", ""]
  ] as const) {
    const f = fixture(input, ["-U2"]);
    expect({ status: await execute("csvformat", f.context), ...f.result() }).toEqual({ status, stdout, stderr });
    await Promise.all(f.cleanups.map(cleanup => cleanup()));
  }
});

test("typed Number admission enforces injected decimal budgets before output", async () => {
  for (const [input, limits] of [
    ["a\n1234\n", { maxDecimalDigits: 3 }], ["a\n1e4\n", { maxDecimalExponent: 3 }]
  ] as const) {
    const f = fixture(input, ["-U2"]);
    expect({ status: await execute("csvformat", { ...f.context, limits: { ...defaultLimits, ...limits } }), ...f.result() }).toEqual({
      status: 78, stdout: "", stderr: "csvkit: unsupported or unqualified: Decimal admission budget exceeded\n"
    });
    await Promise.all(f.cleanups.map(cleanup => cleanup()));
  }
});

test("csvsort default inference sorts Numbers and Booleans and writes typed values", async () => {
  for (const [input, argv, stdout] of [
    ["a\n10\n2\nNA\n", ["-y0"], 'a\n2\n10\n""\n'],
    ["a\ntrue\nfalse\n", ["-y0"], "a\nFalse\nTrue\n"],
    ["a\n10\n2\n", ["-y0", "-i"], "a\n2\n10\n"],
    ["a\n10\n2\n", ["-y0", "-I"], "a\n10\n2\n"],
    ["a\n9007199254740995\n9007199254740993\n", ["-y0"], "a\n9007199254740993\n9007199254740995\n"]
  ] as const) {
    const f = fixture(input, argv);
    expect({ status: await execute("csvsort", f.context), ...f.result() }).toEqual({ status: 0, stdout, stderr: "" });
    await Promise.all(f.cleanups.map(cleanup => cleanup()));
  }
});

test("typed JSON uses Agate Boolean and temporal jsonify with original Python spacing", async () => {
  for (const [input, stdout] of [
    ["d\n2024-02-29\n", '[{"d": "2024-02-29"}]'],
    ["d\n2024-01-02T03:04:05Z\n", '[{"d": "2024-01-02T03:04:05+00:00"}]'],
    ["d\n1h\n", '[{"d": "1:00:00"}]'],
    ["d\nyes\nno\n", '[{"d": true}, {"d": false}]'],
    ["d\nhello\n", '[{"d": "hello"}]']
  ] as const) {
    const f = fixture(input, ["-y0"]);
    expect({ status: await execute("csvjson", f.context), ...f.result() }).toEqual({ status: 0, stdout, stderr: "" });
    await Promise.all(f.cleanups.map(cleanup => cleanup()));
  }
});

test("default typed SQL schema uses frozen temporal and Boolean mappings", async () => {
  for (const [input, type] of [["d\n2024-02-29\n", "DATE NOT NULL"], ["d\n2024-01-02T03:04:05Z\n", "TIMESTAMP"], ["d\n1h\n", "DATETIME NOT NULL"], ["d\nyes\nno\n", "BOOLEAN NOT NULL"]] as const) {
    const f = fixture(input, ["-y0"]);
    expect({ status: await execute("csvsql", f.context), ...f.result() }).toEqual({ status: 0, stdout: `CREATE TABLE stdin (\n\td ${type}\n);\n`, stderr: "" });
    await Promise.all(f.cleanups.map(cleanup => cleanup()));
  }
});
