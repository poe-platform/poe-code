import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, runCommand, SsconvertError, type Codec, type EngineConfig } from "../index.js";

function fixture() {
  const volume = Volume.fromJSON({ "/input.fixture": "original", "/output.fixture": "keep" });
  const codec: Codec = { id: "fixture", description: "Original protocol fixture", extensions: ["fixture"],
    probeContent: () => true,
    async read() { return { sheets: [{ id: "s", name: "Input", cells: [1, 3, 5, 7].map((value, row) => ({ row, column: 0, value: { kind: "number" as const, value } })) }] }; },
    async write(book) { return new TextEncoder().encode(JSON.stringify(book)); }
  };
  const config: EngineConfig = { codecs: [codec], environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100, outputBytes: 10000, cells: 100, sheets: 10, operations: 100 },
    filesystem: { async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes) { volume.writeFileSync(uri, bytes); } }
  };
  const diagnostics: string[] = [];
  const operation = { signal: new AbortController().signal, stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { diagnostics.push(new TextDecoder().decode(bytes)); } } };
  return { config, volume, operation, diagnostics };
}

describe("hidden analysis tool protocol", () => {
  it("parses unqualified data against the selected sheet's dimensions", async () => {
    const f = fixture();
    const codec: Codec = { ...f.config.codecs![0]!, async read() {
      return { activeSheet: "small", sheets: [
        { id: "small", name: "Small", size: { rows: 65536, columns: 256 }, cells: [] },
        { id: "large", name: "Large", size: { rows: 65536, columns: 512 }, cells: [] }
      ] };
    } };
    let called = false;
    const engine = createEngine({ ...f.config, codecs: [codec], analysis: { async analyze(book, request) {
      called = true;
      expect(request.toolOptions?.data).toEqual({ sheet: "large", startRow: 0, endRow: 1,
        startColumn: 256, endColumn: 256 });
      return book;
    } } });
    await engine.convert({ input: { kind: "resource", uri: "/input.fixture" },
      destination: { kind: "resource", uri: "/output.fixture" },
      toolTest: ["moving-average", "sheet:Large", "data:IW1:IW2"] }, f.operation);
    expect(called).toBe(true);
    await engine.dispose();
  });
  it.each([["Large", '"Column 1"\n11\n17\n'], ["Small", "\n"]])(
    "matches the native selected-sheet boundary control for %s through CLI and SDK", async (sheet, expected) => {
      const f = fixture();
      const xml = '<gnm:Workbook xmlns:gnm="http://www.gnumeric.org/v10.dtd" Version="14"><gnm:SheetNameIndex>' +
        '<gnm:SheetName gnm:Cols="256" gnm:Rows="65536">Small</gnm:SheetName>' +
        '<gnm:SheetName gnm:Cols="512" gnm:Rows="65536">Large</gnm:SheetName></gnm:SheetNameIndex><gnm:Sheets>' +
        '<gnm:Sheet><gnm:Name>Small</gnm:Name><gnm:Cells/></gnm:Sheet><gnm:Sheet><gnm:Name>Large</gnm:Name><gnm:Cells>' +
        '<gnm:Cell Row="0" Col="256" ValueType="40">11</gnm:Cell><gnm:Cell Row="1" Col="256" ValueType="40">17</gnm:Cell>' +
        '</gnm:Cells></gnm:Sheet></gnm:Sheets><gnm:UIData SelectedTab="0"/></gnm:Workbook>';
      f.volume.writeFileSync("/sheets.xml", xml);
      const engine = createEngine({ ...f.config, codecs: [], limits: { ...f.config.limits, inputBytes: 10000 } });
      const toolTest = ["moving-average", `sheet:${sheet}`, "data:IW1:IW2"];
      const cli = await runCommand([...toolTest.map(value => `--tool-test=${value}`), "-T", "Gnumeric_stf:stf_csv",
        "/sheets.xml", "/cli.csv"], engine, f.operation);
      expect(cli.exitCode).toBe(0);
      const sdk = await engine.convert({ input: { kind: "resource", uri: "/sheets.xml" },
        destination: { kind: "resource", uri: "/sdk.csv" }, exportType: "Gnumeric_stf:stf_csv", toolTest }, f.operation);
      expect(sdk.exitCode).toBe(0);
      expect(f.diagnostics).toEqual([]);
      expect(f.volume.readFileSync("/cli.csv", "utf8")).toBe(expected);
      expect(f.volume.readFileSync("/sdk.csv", "utf8")).toBe(expected);
      await engine.dispose();
    });
  it("reports malformed arguments before enum failure and preserves destination", async () => {
    const f = fixture();
    const result = await runCommand(["--tool-test=moving-average", "--tool-test=bad",
      "--tool-test=group-by:COL", "/input.fixture", "/output.fixture"], createEngine(f.config), f.operation);
    expect(result.exitCode).toBe(1);
    expect(f.diagnostics).toEqual(['Ignoring tool test argument "bad"\n',
      'Cannot parse "COL" as value for "group-by"\n', 'Analysis tool failed\n']);
    expect(f.volume.readFileSync("/output.fixture", "utf8")).toBe("keep");
  });

  it("passes native defaults, special ranges and converted canonical properties through the shared engine", async () => {
    const f = fixture();
    const engine = createEngine({ ...f.config, analysis: { async analyze(book, request) {
      expect(request.toolOptions).toEqual({ sheet: "s", putFormulas: false, outputSheetName: "Moving Average (1)",
        data: { sheet: "s", startRow: 0, startColumn: 0, endRow: 3, endColumn: 0 },
        properties: { labels: false, "group-by": 0, interval: 2, "std-error-flag": 0, df: 0,
          offset: 0, "show-graph": true, "ma-type": 0 } });
      return book;
    } } });
    await engine.convert({ input: { kind: "resource", uri: "/input.fixture" },
      destination: { kind: "resource", uri: "/output.fixture" }, toolTest: ["moving-average", "data:A1:A4",
        "interval:9", "interval: +2tail", "group-by:0junk", "show-graph:y", "formulas:TRUE", "unused:x:y",
        "std_error_flag:1"] }, f.operation);
  });

  it.each([true, false])("writes moving averages to a new sheet with formulas=%s", async (formulas) => {
    const f = fixture();
    const result = await runCommand(["--tool-test=moving-average", "--tool-test=data:A1:A4", "--tool-test=interval:2",
      ...(formulas ? [] : ["--tool-test=formulas:no"]), "/input.fixture", "/output.fixture"], createEngine(f.config), f.operation);
    expect(result.exitCode).toBe(0);
    expect(f.diagnostics).toEqual([]);
    const output = JSON.parse(f.volume.readFileSync("/output.fixture", "utf8") as string);
    expect(output.sheets.map((sheet: { name: string }) => sheet.name)).toEqual(["Input", "Moving Average (1)"]);
    expect(output.sheets[1].cells.map((cell: { value: unknown }) => cell.value)).toEqual([
      { kind: "string", value: "Column 1" }, { kind: "error", value: "#N/A" },
      { kind: "number", value: 2 }, { kind: "number", value: 4 }, { kind: "number", value: 6 }]);
    expect(output.sheets[1].cells[2].formula).toBe(formulas ? "=average(offset(Input!$A$1:$A$4,0,0,2,1))" : undefined);
  });

  it("uses a single-cell reference and admits output before allocating cells", async () => {
    const f = fixture();
    await runCommand(["--tool-test=moving-average", "--tool-test=data:A1", "/input.fixture", "/output.fixture"], createEngine(f.config), f.operation);
    const output = JSON.parse(f.volume.readFileSync("/output.fixture", "utf8") as string);
    expect(output.sheets[1].cells[1].formula).toBe("=average(offset(Input!$A$1,0,0,1,1))");
    f.volume.writeFileSync("/output.fixture", "keep");
    const engine = createEngine({ ...f.config, limits: { ...f.config.limits, cells: 5 } });
    expect((await runCommand(["--tool-test=moving-average", "--tool-test=data:A1:A4", "/input.fixture", "/output.fixture"], engine, f.operation)).exitCode).toBe(1);
    expect(f.volume.readFileSync("/output.fixture", "utf8")).toBe("keep");
  });

  it("owns SDK analysis setup through asynchronous input and enforces its property budget", async () => {
    const f = fixture();
    const properties = { interval: 3 };
    const data = { sheet: "s", startRow: 0, startColumn: 0, endRow: 3, endColumn: 0 };
    const toolOptions = { sheet: "s", putFormulas: true, outputSheetName: "Moving Average (1)", properties, data, x: null };
    const engine = createEngine({ ...f.config, analysis: { async analyze(book, request) {
      expect(request.toolOptions?.x).toBeNull();
      expect(request.toolOptions?.properties.interval).toBe(3);
      expect(request.toolOptions?.data?.endRow).toBe(3);
      return book;
    } } });
    const request = { input: { kind: "resource" as const, uri: "/input.fixture" }, destination: { kind: "resource" as const, uri: "/output.fixture" },
      analysis: { tool: "moving-average", properties: [], toolOptions } };
    const pending = engine.convert(request, f.operation);
    properties.interval = 9; data.endRow = 9;
    await pending;
    expect(Object.isFrozen(properties)).toBe(false);
    const bounded = createEngine({ ...f.config, limits: { ...f.config.limits, operations: 1 } });
    await expect(bounded.convert({ ...request, analysis: { ...request.analysis,
      toolOptions: { ...toolOptions, properties: { interval: 1, df: 0 } } } }, f.operation)).rejects.toMatchObject({ code: "resource-limit" });
  });

  it("reports injected analysis failures once and preserves output", async () => {
    const f = fixture();
    const engine = createEngine({ ...f.config, analysis: { async analyze() {
      throw new SsconvertError("invalid-request", "Analysis tool failed");
    } } });
    expect((await runCommand(["--tool-test=correlation", "/input.fixture", "/output.fixture"], engine, f.operation)).exitCode).toBe(1);
    expect(f.diagnostics).toEqual(["Analysis tool failed\n"]);
    expect(f.volume.readFileSync("/output.fixture", "utf8")).toBe("keep");
  });

  it("exports the generated sheet through the real CSV codec", async () => {
    const f = fixture();
    f.volume.writeFileSync("/input.csv", "1,2\n3,4\n5,6\n7,8\n");
    const engine = createEngine({ ...f.config, codecs: [] });
    expect((await runCommand(["--tool-test=moving-average", "--tool-test=data:A1:A4", "--tool-test=interval:2",
      "-T", "Gnumeric_stf:stf_csv", "/input.csv", "/output.csv"], engine, f.operation)).exitCode).toBe(0);
    expect(f.volume.readFileSync("/output.csv", "utf8")).toBe('"Column 1"\n#N/A\n2\n4\n6\n');
  });

  it("dispatches an empty first tool name as unknown", async () => {
    const f = fixture();
    expect((await runCommand(["--tool-test=", "/input.fixture", "/output.fixture"],
      createEngine(f.config), f.operation)).exitCode).toBe(1);
    expect(f.diagnostics).toEqual(['no test for tool ""\n']);
    expect(f.volume.readFileSync("/output.fixture", "utf8")).toBe("keep");
  });
});
