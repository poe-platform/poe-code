import { expect, it } from "vitest";
import { createEngine, runCommand, recalculateWorkbook, perlSampleFunctions, type CapabilityContext, type Codec } from "safe-bash-command-ssconvert";

function calculate(formula: string, epoch: number, timezone: string) {
  const context: CapabilityContext = {
    signal: new AbortController().signal, own() {},
    environment: { env: {}, locale: "C", timezone },
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 10, operations: 100 },
    clock: { now: () => epoch }, runtimeFunctions: perlSampleFunctions
  };
  return recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 0, column: 0, formula, formulaDirty: true, value: { kind: "blank" } }
  ] }] }, context).sheets[0]!.cells[0]!.value;
}

const dates = [
  ["-000001-06-15T12:00:00Z", "-0010615"],
  ["0000-06-15T12:00:00Z", "00000615"],
  ["0001-06-15T12:00:00Z", "00010615"],
  ["0099-06-15T12:00:00Z", "00990615"],
  ["1970-06-15T12:00:00Z", "19700615"],
  ["-001234-06-15T12:00:00Z", "-12340615"]
];
for (const timezone of ["UTC", "Etc/UTC", "America/Los_Angeles", "Europe/Warsaw"]) {
  it.each(dates)(`preserves Perl signed minimum year width for %s in ${timezone}`, (iso, expected) => {
    expect(calculate("=PERL_DATE()", Date.parse(iso!), timezone)).toEqual({ kind: "string", value: expected });
  });
}
for (const formula of ["=NOW()", "=TODAY()", "UNIX2DATE"]) {
  it.each(dates)(`preserves astronomical years across UTC aliases for ${formula} at %s`, iso => {
    const epoch = Date.parse(iso!);
    const expression = formula === "UNIX2DATE" ? `=UNIX2DATE(${epoch / 1000})` : formula;
    expect(calculate(expression, epoch, "Etc/UTC")).toEqual(calculate(expression, epoch, "UTC"));
  });
}
it.each([
  ["2024-03-10T07:30:00Z", "20240309", "2024-03-09T23:30:00Z"],
  ["2024-03-10T10:30:00Z", "20240310", "2024-03-10T03:30:00Z"],
  ["2024-11-03T08:30:00Z", "20241103", "2024-11-03T01:30:00Z"],
  ["2024-11-03T09:30:00Z", "20241103", "2024-11-03T01:30:00Z"]
])("keeps Los Angeles DST controls at %s", (iso, expected, local) => {
  const epoch = Date.parse(iso!);
  expect(calculate("=PERL_DATE()", epoch, "America/Los_Angeles")).toEqual({ kind: "string", value: expected });
  for (const formula of ["=NOW()", "=TODAY()"])
    expect(calculate(formula, epoch, "America/Los_Angeles")).toEqual(calculate(formula, Date.parse(local!), "UTC"));
  expect(calculate(`=UNIX2DATE(${epoch / 1000})`, epoch, "America/Los_Angeles"))
    .toEqual(calculate("=NOW()", Date.parse(local!), "UTC"));
});

it("delivers era-correct dates through SDK conversion and the command with injected capabilities", async () => {
  const codec: Codec = {
    id: "era-fixture", description: "In-memory era fixture", extensions: ["era"],
    probeContent: () => true,
    async read() { return { sheets: [{ id: "s", name: "Sheet", cells: [
      { row: 0, column: 0, formula: "=PERL_DATE()", formulaDirty: true, value: { kind: "blank" } }
    ] }] }; },
    async write(book) {
      expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "-0010615" });
      return new TextEncoder().encode("-0010615");
    }
  };
  const outputs: Uint8Array[] = [];
  const engine = createEngine({ codecs: [codec], runtimeFunctions: perlSampleFunctions,
    environment: { env: {}, locale: "C", timezone: "Etc/UTC" },
    clock: { now: () => -62184456000000 },
    filesystem: { async read() { return [new Uint8Array([1])]; }, async write(_uri, bytes) { outputs.push(bytes); } }
  });
  const signal = new AbortController().signal;
  try {
    const result = await engine.convert({ input: { kind: "stream", source: [new Uint8Array([1])], filename: "input.era" },
      exportType: codec.id, destination: { kind: "stream", sink: { async write(bytes) { outputs.push(bytes); } } } }, { signal });
    expect(result.exitCode).toBe(0);
    expect(await runCommand(["--recalc", "input.era", "output.era"], engine, {
      signal, stdout: { async write() {} }, stderr: { async write() {} }
    })).toMatchObject({ exitCode: 0, diagnostics: [], usage: { outputBytes: 8 } });
    expect(outputs.map(bytes => new TextDecoder().decode(bytes))).toEqual(["-0010615", "-0010615"]);
  } finally { await engine.dispose(); }
});
