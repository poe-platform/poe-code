import { createEngine } from "../engine.js";
import type { Codec } from "../codecs.js";
import { expect, it } from "vitest";
import type { CapabilityContext, Diagnostic } from "../contracts.js";
import { recalculateWorkbook } from "./evaluator.js";
import { createPerlSampleFunctions } from "./optional-providers.js";
import { quoteFormulaString } from "./serialization.js";
import { gnumericGrammar } from "./conventions.js";
const context: CapabilityContext = { own() {}, signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 3, operations: 10000 } };
const legacy = "Variable length lookbehind is experimental";
const positive = "Variable length positive lookbehind with capturing is experimental";
const negative = "Variable length negative lookbehind with capturing is experimental";
function workbook(patterns: readonly string[]) {
  return { sheets: [{ id: "s", name: "S", cells: patterns.map((pattern, row) => ({ row, column: 0,
    formula: "=PERL_SED(" + ["aab", pattern, "X"].map(value => quoteFormulaString(value, '"', gnumericGrammar)).join(",") + ")",
    formulaDirty: true, value: { kind: "blank" as const } })) }] };
}
const cases = [
  ["(?<=(a))b", undefined, undefined],
  ["(?<=a{1,2})b", legacy, undefined],
  ["(?<=(a{1,2}))b", legacy, positive],
  ["(?<!(a{1,2}))b", legacy, negative],
  ["(?<=a{1,2})b(?<!(b{1,2}))", legacy, negative],
  ["(?<=(a{1,2}))b(?<!(b{1,2}))", legacy, positive],
  ["(?<=(?=(a))a{1,2})b", legacy, positive],
  ["(?<=(a){0}b{1,2})c", legacy, positive],
  ["(?:(?<=(a{1,2}))b){0}", legacy, positive],
  ["(?<=(?|a(b)|c(d)e))f", legacy, positive],
  ["(?<=(a(?<=b{1,2})))c", legacy, undefined],
  ["(?<=(?<!(a{1,2}))b{1,2})c", legacy, negative],
  ["(a)(?<=a{1,2})b", legacy, undefined],
  ["(a)?(?<=(?(1)b|cc))d", legacy, undefined]
] as const;
for (const version of ["5.34.1", "5.40.1"] as const) {
  it.each(cases)(`${version} reports native warning conditions for %s`, (pattern, old, modern) => {
    const diagnostics: Diagnostic[] = [];
    recalculateWorkbook(workbook([pattern]), { ...context, runtimeFunctions: createPerlSampleFunctions({ version }) }, true, d => diagnostics.push(d));
    const message = version === "5.34.1" ? old : modern;
    expect(diagnostics).toEqual(message ? [{ code: "perl-regex", severity: "warning", message }] : []);
  });
  it(`${version} warns again after an intervening pattern and in each new calculation`, () => {
    const pattern = "(?<=(a{1,2}))b";
    const configured = { ...context, runtimeFunctions: createPerlSampleFunctions({ version }) };
    const input = workbook([pattern, pattern, "x", pattern, pattern]);
    for (let run = 0; run < 2; run++) {
      const diagnostics: Diagnostic[] = [];
      recalculateWorkbook(input, configured, true, d => diagnostics.push(d));
      expect(diagnostics).toEqual(Array.from({ length: 2 }, () => ({ code: "perl-regex", severity: "warning", message: version === "5.34.1" ? legacy : positive })));
    }
  });
}

for (const version of ["5.34.1", "5.40.1"] as const) it(`${version} shares compilation across conversion stages but isolates operations`, async () => {
  const codec: Codec = {
    id: "perl-warning-fixture", description: "Perl warning fixture", extensions: ["fixture"],
    probeContent: () => true,
    async read() { return workbook(["(?<=(a{1,2}))b"]); },
    async write(book) {
      expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "aaX" });
      return new Uint8Array([1]);
    }
  };
  const engine = createEngine({ codecs: [codec], runtimeFunctions: createPerlSampleFunctions({ version }) });
  try {
    for (let round = 0; round < 2; round++) {
      const results = await Promise.all([0, 1].map(() => engine.convert({
        input: { kind: "stream", filename: "input.fixture", source: [new Uint8Array([1])] },
        recalc: true, exportType: codec.id, destination: { kind: "stream", sink: { async write() {} } }
      }, { signal: context.signal })));
      for (const result of results) {
        expect(result.exitCode).toBe(0);
        expect(result.diagnostics).toEqual([{ code: "perl-regex", severity: "warning", message: version === "5.34.1" ? legacy : positive }]);
      }
    }
  } finally { await engine.dispose(); }
});

it("bounds warning bytes before publishing converted output", async () => {
  const codec: Codec = { id: "warning-budget", description: "Warning budget fixture", extensions: ["fixture"],
    probeContent: () => true, async read() { return workbook(["(?<=(a{1,2}))b"]); },
    async write() { return new Uint8Array([1]); } };
  const engine = createEngine({ codecs: [codec], limits: { outputBytes: 32 },
    runtimeFunctions: createPerlSampleFunctions({ version: "5.40.1" }) });
  const chunks: Uint8Array[] = [];
  try {
    await expect(engine.convert({ input: { kind: "stream", filename: "input.fixture", source: [new Uint8Array([1])] },
      recalc: true, exportType: codec.id, destination: { kind: "stream", sink: { async write(bytes) { chunks.push(bytes); } } }
    }, { signal: context.signal })).rejects.toThrow("diagnostic bytes limit exceeded");
    expect(chunks).toEqual([]);
  } finally { await engine.dispose(); }
});
