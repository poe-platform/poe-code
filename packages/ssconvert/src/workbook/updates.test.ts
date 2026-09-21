import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, runCommand, type Workbook, type EngineConfig } from "../index.js";

const number = (value: number) => ({ kind: "number" as const, value });
function fixture(mode: "automatic" | "manual" = "automatic") {
  const original: Workbook = { calculationMode: mode, activeSheet: "first", names: [
    { name: "Input", expression: "First!$A$1" }
  ], sheets: [{ id: "first", name: "First", cells: [
    { row: 0, column: 0, value: number(1) },
    { row: 1, column: 0, formula: "=Input+1", value: number(2), cachedResult: number(2) },
    { row: 2, column: 0, formula: "=A2+1", value: number(3), cachedResult: number(3) },
    { row: 3, column: 0, formula: "=1+1", value: number(99), cachedResult: number(99) }
  ] }, { id: "second", name: "Second", cells: [] }] };
  let saved: Workbook | undefined;
  const volume = Volume.fromJSON({ "/input.fixture": "fixture" });
  const config: EngineConfig = { environment: { env: {}, locale: "C", timezone: "UTC" },
    filesystem: { async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes) { volume.writeFileSync(uri, bytes); } },
    limits: { cells: 100, sheets: 3, operations: 30, inputBytes: 100, outputBytes: 100 },
    codecs: [{ id: "fixture", description: "Original in-memory workbook", extensions: ["fixture"],
      probeContent: () => true, async read() { return original; },
      async write(book) { saved = book; return new Uint8Array(); } }] };
  const engine = createEngine(config);
  const errors: string[] = [];
  const operation = { signal: new AbortController().signal,
    stdout: { async write() {} }, stderr: { async write(bytes: Uint8Array) { errors.push(new TextDecoder().decode(bytes)); } } };
  return { engine, config, errors, operation, original, saved: () => saved,
    async run(args: string[]) { return runCommand([...args, "-T", "fixture", "/input.fixture", "/output.fixture"], engine, operation); } };
}

describe("native ordered cell updates and calculation", () => {
  it.each(["automatic", "manual"] as const)("shares scoped-name dependent updates through CLI and SDK in %s mode", async mode => {
    const f = fixture(mode);
    const original: Workbook = { calculationMode: mode, activeSheet: "second", names: [
      { name: "Rate", expression: "=Rate", position: { sheet: "second", row: 0, column: 0 } },
      { name: "Rate", sheet: "second", expression: "=A1" }
    ], sheets: [
      { id: "first", name: "First", cells: [{ row: 0, column: 0, formula: "=Rate+1", value: number(3), cachedResult: number(3) }] },
      { id: "second", name: "Second", cells: [{ row: 0, column: 0, value: number(2) }] }
    ] };
    const engine = createEngine({ ...f.config, codecs: [{ ...f.config.codecs[0]!, async read() { return original; } }] });
    try {
      const args = ["--set", "A1=5", "--set", "A1=8", "-T", "fixture", "/input.fixture", "/output.fixture"];
      expect((await runCommand(args, engine, f.operation)).exitCode).toBe(0);
      const cli = f.saved();
      await engine.convert({ input: { kind: "resource", uri: "/input.fixture" },
        destination: { kind: "resource", uri: "/output.fixture" }, exportType: "fixture",
        updateExpressions: ["A1=5", "A1=8"] }, f.operation);
      expect(f.saved()).toEqual(cli);
      expect(cli!.sheets[0]!.cells[0]).toMatchObject({ cachedResult: number(mode === "automatic" ? 9 : 3), formulaDirty: mode === "manual" });
      expect(original.sheets[1]!.cells[0]!.value).toEqual(number(2));
    } finally { await engine.dispose(); }
  });
  it("implements repeatable --set without a host cell-text handler", async () => {
    const f = fixture();
    expect((await f.run(["--set", "A1=5", "--set", "A1=8", "--set", "A11==A10+1", "--set", "A10=20"])).exitCode).toBe(0);
    const cells = f.saved()!.sheets[0]!.cells;
    expect(cells.find(c => c.row === 0)!.value).toEqual(number(8));
    expect(cells.find(c => c.row === 1)!.cachedResult).toEqual(number(9));
    expect(cells.find(c => c.row === 2)!.cachedResult).toEqual(number(10));
    expect(cells.find(c => c.row === 3)!.cachedResult).toEqual(number(99));
    expect(cells.find(c => c.row === 10)!.cachedResult).toEqual(number(21));
    expect(f.original.sheets[0]!.cells[0]!.value).toEqual(number(1));
  });
  it("preserves manual caches while distinguishing dirty formulas", async () => {
    const f = fixture("manual");
    expect((await f.run(["--set", "A1=8"])).exitCode).toBe(0);
    expect(f.saved()!.sheets[0]!.cells[1]).toMatchObject({ cachedResult: number(2), formulaDirty: true });
  });
  it("keeps a newly entered manual formula dirty without fabricating a cache", async () => {
    const f = fixture("manual");
    expect((await f.run(["--set", "A11==A10+1", "--set", "A10=20"])).exitCode).toBe(0);
    const formula = f.saved()!.sheets[0]!.cells.find(cell => cell.row === 10)!;
    expect(formula).toMatchObject({ formula: "=A10+1", formulaDirty: true, value: { kind: "blank" } });
    expect(Object.hasOwn(formula, "cachedResult")).toBe(false);
  });
  it.each([["--recalc", "--set", "A1=8"], ["--set", "A1=8", "--recalc"]])("forces all manual formulas independently of flag order: %j", async (...args) => {
    const f = fixture("manual");
    expect((await f.run(args)).exitCode).toBe(0);
    expect(f.saved()!.sheets[0]!.cells[1]).toMatchObject({ cachedResult: number(9), formulaDirty: false });
    expect(f.saved()!.sheets[0]!.cells[3]!.cachedResult).toEqual(number(2));
  });
  it("accepts ranges, qualified coordinates, empty text, booleans and literal apostrophes", async () => {
    const f = fixture();
    expect((await f.run(["--set", "Second!B1:C2=TRUE", "--set", "D1='123", "--set", "E1=", "--set", "F1=2024-01-02"])).exitCode).toBe(0);
    const cells = f.saved()!.sheets[0]!.cells;
    expect(cells.filter(c => c.column === 1 || c.column === 2).map(c => c.value)).toEqual(Array(4).fill({ kind: "boolean", value: true }));
    expect(cells.find(c => c.column === 3)!.value).toEqual({ kind: "string", value: "123" });
    expect(cells.find(c => c.column === 4)!.value).toEqual({ kind: "blank" });
    expect(cells.find(c => c.column === 5)!.value).toEqual(number(45293));
    expect(f.saved()!.sheets[1]!.cells).toEqual([]);
  });
  it("reports the first malformed reference without saving", async () => {
    const f = fixture();
    expect((await f.run(["--set", "A1=8", "--set", "Input=9", "--set", "broken"])).exitCode).toBe(1);
    expect(f.errors).toEqual(["Failed to set cell Input=9\n"]);
    expect(f.saved()).toBeUndefined();
  });
  it("clipboard applies updates and automatic calculation but skips the later force stage", async () => {
    for (const mode of ["automatic", "manual"] as const) {
      const f = fixture(mode);
      let clipboardBook: Workbook | undefined;
      const engine = createEngine({ ...f.config, clipboard: {
        async serialize(book) { clipboardBook = book; return new Uint8Array(); }
      } });
      await engine.convert({ input: { kind: "resource", uri: "/input.fixture" },
        destination: { kind: "stream", sink: { async write() {} } }, clipboard: "text/html",
        exportRangeExpression: "A1:A3", updateExpressions: ["A1=8"], recalc: true }, f.operation);
      expect(clipboardBook!.sheets[0]!.cells[1]!.cachedResult).toEqual(number(mode === "manual" ? 2 : 9));
      expect(clipboardBook!.sheets[0]!.cells[3]!.cachedResult).toEqual(number(99));
      await engine.dispose();
    }
  });
  it("merge ignores --set including malformed references", async () => {
    const f = fixture();
    const engine = createEngine({ ...f.config, codecs: [{ ...f.config.codecs[0]!, async read() {
      return { sheets: [{ ...f.original.sheets[0]!, cells: [f.original.sheets[0]!.cells[0]!] }] };
    } }] });
    await engine.merge({ inputs: [{ kind: "resource", uri: "/input.fixture" }, { kind: "resource", uri: "/input.fixture" }],
      destination: { kind: "resource", uri: "/output.fixture" }, exportType: "fixture", updateExpressions: ["broken"] }, f.operation);
    expect(f.saved()!.sheets[0]!.cells[0]!.value).toEqual(number(1));
    await engine.dispose();
  });
  it("calculates formula entry through typed SDK updates too", async () => {
    const f = fixture();
    await f.engine.convert({ input: { kind: "resource", uri: "/input.fixture" },
      destination: { kind: "resource", uri: "/output.fixture" }, exportType: "fixture",
      updates: [{ sheet: "first", row: 4, column: 0, formula: "=A1+1", value: { kind: "blank" } }] }, f.operation);
    expect(f.saved()!.sheets[0]!.cells.find(cell => cell.row === 4)!.cachedResult).toEqual(number(2));
  });
  it("distinguishes forced and ordinary stages for injected evaluators", async () => {
    for (const mode of ["automatic", "manual"] as const) {
      const f = fixture(mode), stages: string[] = [];
      const engine = createEngine({ ...f.config, codecs: [{ ...f.config.codecs[0]!,
        async exportOptions() { stages.push("options"); return []; }
      }], resize: { async resizeSheet(book) { stages.push("resize"); return book; } },
      formulas: { async recalculate(book, _context, options) { stages.push(options?.force ? "force" : "dirty"); return book; } } });
      await engine.convert({ input: { kind: "resource", uri: "/input.fixture" },
        destination: { kind: "resource", uri: "/output.fixture" }, exportType: "fixture",
        updateExpressions: ["A1=8"], resize: { rows: 128, columns: 128 }, recalc: true }, f.operation);
      expect(stages).toEqual(mode === "automatic" ? ["dirty", "options", "resize", "resize", "force", "dirty"] : ["options", "resize", "resize", "force"]);
      await engine.dispose();
    }
  });
});
