import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, createResourceIO, runCommand, SsconvertError, type Codec, type EngineConfig } from "./index.js";

function fixture() {
  const volume = Volume.fromJSON({ "/in.csv": "1", "/out.csv": "keep" });
  const events: string[] = [];
  const codec: Codec = {
    id: "original", description: "Original lifecycle fixture", extensions: ["csv"],
    probeName: () => true, probeContent: () => true,
    async read() {
      events.push("load");
      return { sheets: [{ id: "s", name: "Sheet", cells: [] }] };
    },
    async exportOptions(options) {
      events.push("options");
      if (options.includes("invalid")) throw new SsconvertError("invalid-request", "original option error");
      return options;
    },
    async write() { events.push("save"); return new TextEncoder().encode("converted"); }
  };
  const config: EngineConfig = {
    codecs: [codec], environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100, outputBytes: 1000, cells: 10, sheets: 10, operations: 30 },
    filesystem: {
      async read(uri) { events.push("read"); return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes) { events.push("publish"); volume.writeFileSync(uri, bytes); }
    }
  };
  return { volume, events, config };
}
const operation = () => ({ signal: new AbortController().signal });
const request = { input: { kind: "resource" as const, uri: "/in.csv" },
  destination: { kind: "resource" as const, uri: "/out.csv" } };

describe("Gnumeric conversion lifecycle source order", () => {
  it.each(["0b10", "0o10"])("rejects JavaScript-only image resolution %s after transforms without output", async (value) => {
    const { config, events, volume } = fixture();
    const errors: string[] = [];
    const engine = createEngine({ ...config, formulas: {
      async recalculate(book) { events.push("recalc"); return book; }
    } });
    const result = await runCommand(["--export-graphs", "--recalc", "-T", "png",
      "-O", `resolution=${value}`, "/in.csv", "/graph.png"], engine, {
      ...operation(), stdout: { async write() {} },
      stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } }
    });
    expect(result).toEqual({ exitCode: 1 });
    expect(errors).toEqual([`ssconvert: Invalid export option "resolution=${value}" for image export\n`]);
    expect(events).toEqual(["read", "load", "recalc", "recalc", "recalc"]);
    expect(volume.toJSON()).toEqual({ "/in.csv": "1", "/out.csv": "keep" });
  });
  it("derives an absent output from the input URI for CLI and SDK", async () => {
    const { config, volume } = fixture();
    volume.writeFileSync("/no suffix", "1");
    const engine = createEngine({ ...config, filesystem: createResourceIO({ cwd: "/",
      filesystem: config.filesystem! }) });
    const errors: string[] = [];
    const result = await runCommand(["-T", "original", "/no suffix"], engine, { ...operation(),
      stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } } });
    expect(result.exitCode).toBe(0);
    expect(result).toMatchObject({ artifacts: [{ uri: "file:///no%20suffixcsv" }] });
    expect(errors).toEqual([]);
    expect(volume.readFileSync("/no suffixcsv", "utf8")).toBe("converted");
    // Native inference is extension replacement/append, never guessed same-format save.
    expect(volume.readFileSync("/no suffix", "utf8")).toBe("1");
    volume.writeFileSync("/sdk.other", "1");
    const sdk = await engine.convert({ input: { kind: "resource", uri: "/sdk.other" }, exportType: "original" }, operation());
    expect(sdk.artifacts).toEqual([{ uri: "file:///sdk.csv", bytes: 9 }]);
    expect(volume.readFileSync("/sdk.other", "utf8")).toBe("1");
  });
  it("loads and rejects --set before checking later solver capabilities", async () => {
    const { config, events, volume } = fixture();
    await expect(createEngine(config).convert({ ...request, updateExpressions: ["bad"], solve: true }, operation()))
      .rejects.toMatchObject({ message: "Failed to set cell bad", exitCode: 1 });
    expect(events).toEqual(["read", "load"]);
    expect(volume.readFileSync("/out.csv", "utf8")).toBe("keep");
  });
  it("keeps resize and tool-test after exporter configuration through the command engine", async () => {
    const { config, events } = fixture();
    const engine = createEngine(config);
    const errors: string[] = [];
    expect(await runCommand(["--resize=128x128", "--tool-test=original", "--recalc", "-O", "invalid",
      "/in.csv", "/out.csv"], engine, { ...operation(), stdout: { async write() {} },
      stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } } })).toEqual({ exitCode: 1 });
    expect(errors).toEqual(["original option error\n"]);
    expect(events).toEqual(["read", "load", "options"]);
  });
  it("resolves graph mode before exporter IDs and forced importer before graph rendering", async () => {
    const { config, volume } = fixture();
    const errors: string[] = [];
    expect(await runCommand(["--export-graphs", "-T", "png", "-I", "bad", "/in.csv", "/graph"],
      createEngine(config), { ...operation(), stdout: { async write() {} },
        stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } } })).toEqual({ exitCode: 1 });
    expect(errors).toEqual(["Unknown importer 'bad'.\nTry --list-importers to see a list of possibilities.\n"]);
    expect(volume.toJSON()).toEqual({ "/in.csv": "1", "/out.csv": "keep" });
  });
  it("validates image export options even when the workbook contains no graphs", async () => {
    const { config, events } = fixture();
    const errors: string[] = [];
    expect(await runCommand(["--export-graphs", "-T", "bad", "-O", "bad=1", "/in.csv", "/graph"],
      createEngine(config), { ...operation(), stdout: { async write() {} },
        stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } } })).toEqual({ exitCode: 1 });
    expect(errors).toEqual(['ssconvert: Invalid export option "bad=1" for image export\n']);
    expect(events).toEqual(["read", "load"]);
  });
  it("rejects an unknown native tool after options and before resize or range", async () => {
    const { config, events } = fixture();
    const errors: string[] = [];
    expect(await runCommand(["--tool-test=unknown", "--resize=1x1", "--export-range=bad", "/in.csv", "/out.csv"],
      createEngine(config), { ...operation(), stdout: { async write() {} },
        stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } } })).toEqual({ exitCode: 1 });
    expect(errors).toEqual(['no test for tool "unknown"\n']);
    expect(events).toEqual(["read", "load", "options"]);
  });
  it("dispatches native goal ranges before solver and tool-test through the shared command engine", async () => {
    const { config, events } = fixture();
    const binding = { ...config, solver: {
      async goalSeekRange(book: import("./workbook.js").Workbook, range: import("./workbook.js").CellRange) {
        expect(range.endColumn).toBe(2); events.push("goal-range"); return book;
      },
      async goalSeek(book: import("./workbook.js").Workbook) { events.push("goal"); return book; },
      async solve(book: import("./workbook.js").Workbook) { events.push("solve"); return book; }
    } };
    await createEngine(binding).convert({ ...request, goalSeekExpressions: ["A1:C1"], solve: true }, operation());
    expect(events).toEqual(["read", "load", "options", "goal-range", "solve", "save", "publish"]);
  });
  it("clipboard applies --set after loading and ignores forced importer and conversion-only flags", async () => {
    const { config, events } = fixture();
    const errors: string[] = [];
    expect(await runCommand(["--clipboard=text/plain", "--export-range=A1", "--set=bad", "-I", "bad",
      "--solve", "/in.csv", "/out.csv"], createEngine(config), { ...operation(), stdout: { async write() {} },
        stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } } })).toEqual({ exitCode: 1 });
    expect(errors).toEqual(["Failed to set cell bad\n"]);
    expect(events).toEqual(["read", "load"]);
  });
  it("applies native cell text through an injected capability and recalculates before export options", async () => {
    const { config, events } = fixture();
    const binding = { ...config,
      cellText: { async setText(book: import("./workbook.js").Workbook, range: import("./workbook.js").CellRange, text: string) {
        events.push(`set:${range.sheet}:${text}`); return book;
      } },
      formulas: { async recalculate(book: import("./workbook.js").Workbook) { events.push("auto"); return book; } }
    };
    await createEngine(binding).convert({ ...request, updateExpressions: ["A1=2", "A1=3"] }, operation());
    expect(events).toEqual(["read", "load", "auto", "set:s:2", "set:s:3", "auto", "options", "auto", "save", "publish"]);
  });
  it("resizes sheets in reverse order after tool-test and before explicit and automatic recalc", async () => {
    const { config, events } = fixture();
    const binding = { ...config, codecs: [{ ...config.codecs[0]!,
      async read() { return { sheets: ["First", "Second"].map((name) => ({ id: name, name, cells: [] })) }; }
    }],
    analysis: { async analyze(book: import("./workbook.js").Workbook, analysis: import("./solver.js").AnalysisRequest) {
      expect(analysis).toEqual({ tool: "moving-average", properties: [{ name: "interval", value: "3" }],
        toolOptions: { sheet: "First", putFormulas: true, outputSheetName: "Moving Average (1)",
          properties: { labels: false, "group-by": 1, interval: 3, "std-error-flag": 0, df: 0,
            offset: 0, "show-graph": false, "ma-type": 0 } } });
      events.push("tool"); return book;
    } },
    resize: { async resizeSheet(book: import("./workbook.js").Workbook, sheet: string, size: { rows: number; columns: number }) {
      expect(size).toEqual({ rows: 128, columns: 128 }); events.push(`resize:${sheet}`); return book;
    } },
    formulas: { async recalculate(book: import("./workbook.js").Workbook) { events.push("recalc"); return book; } }
    };
    const errors: string[] = [];
    expect((await runCommand(["--tool-test=moving-average", "--tool-test=interval:2", "--tool-test=interval:3",
      "--resize=128x128extra", "--recalc", "/in.csv", "/out.csv"], createEngine(binding), {
      ...operation(), stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } }
    })).exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(events).toEqual(["read", "recalc", "options", "tool", "resize:Second", "resize:First", "recalc", "recalc", "save", "publish"]);
  });
  it("selects the range sheet after recalculation without pruning workbook records", async () => {
    const { config, events } = fixture();
    const engine = createEngine({ ...config, codecs: [{ ...config.codecs[0]!, saveScope: "sheet", sheetSelection: true, honorsExportRange: true,
      async read() { return { sheets: ["First", "Second"].map((name) => ({ id: name, name, cells: [] })) }; },
      async write(book, _options, _context, selection) {
        events.push("save");
        expect(book.sheets.map((sheet) => sheet.name)).toEqual(["First", "Second"]);
        expect(selection).toEqual({ sheets: ["Second"], range: { sheet: "Second", startRow: 0, endRow: 1,
          startColumn: 0, endColumn: 1 } });
        return new Uint8Array();
      }
    }], formulas: { async recalculate(book) { events.push("auto"); return book; } } });
    await engine.convert({ ...request, selection: { kind: "ids", ids: ["First"] }, exportRangeExpression: "Second!A1:B2" }, operation());
    expect(events).toEqual(["read", "auto", "options", "auto", "save", "publish"]);
  });
  it("guesses the exporter from the canonical output URI before importer resolution", async () => {
    const { config, events } = fixture();
    await expect(createEngine(config).convert({ ...request, destination: { kind: "resource", uri: "file:///out.csv?query" },
      importType: "bad" }, operation())).rejects.toMatchObject({ message: "Unknown importer 'bad'.\nTry --list-importers to see a list of possibilities." });
    expect(events).toEqual([]);
  });
  it("validates exporter options before checking recalculation capabilities", async () => {
    const { config, events, volume } = fixture();
    await expect(createEngine(config).convert({ ...request, exportOptions: ["invalid"], recalc: true }, operation()))
      .rejects.toMatchObject({ message: "original option error", exitCode: 1 });
    expect(events).toEqual(["read", "load", "options"]);
    expect(volume.readFileSync("/out.csv", "utf8")).toBe("keep");
  });
  it("splits sequentially with native templates, keeps prior files on failure, and stops", async () => {
    const { config, events, volume } = fixture();
    const codec: Codec = { ...config.codecs[0]!, saveScope: "sheet",
      async read() { return { sheets: ["One", "Two", "Three"].map((name) => ({ id: name, name, cells: [] })) }; },
      async write(book) { events.push(book.sheets[0]!.name); return new TextEncoder().encode(book.sheets[0]!.name); }
    };
    const engine = createEngine({ ...config, codecs: [codec], filesystem: createResourceIO({ cwd: "/", filesystem: {
      read: config.filesystem!.read,
      async write(uri, bytes, signal) {
        if (uri === "/split.1") throw Object.assign(new Error("original failure"), { code: "EACCES" });
        await config.filesystem!.write(uri, bytes, signal);
      }
    } }) });
    await expect(engine.convert({ ...request, destination: { kind: "resource", uri: "/split" },
      exportType: "original", perSheet: true }, operation())).rejects.toMatchObject({
      exitCode: 1, message: "E Can't open 'file:///split.1' for writing: Permission denied"
    });
    expect(volume.readFileSync("/split.0", "utf8")).toBe("One");
    expect(volume.existsSync("/split.2")).toBe(false);
    expect(events).toEqual(["read", "options", "One", "publish", "Two"]);
  });
  it("runs the same transforms after merge, ignores --set in merge, and recalculates automatically", async () => {
    const { config, events } = fixture();
    const engine = createEngine({ ...config,
      solver: {
        async goalSeek(book) { events.push("goal"); return book; },
        async solve(book) { events.push("solve"); return book; }
      },
      analysis: { async analyze(book) { events.push("tool"); return book; } },
      formulas: { async recalculate(book) { events.push("recalc"); return book; } }
    });
    const range = { sheet: "s", startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 };
    await engine.merge({ destination: request.destination, inputs: [request.input, request.input],
      updateExpressions: ["bad"], goalSeek: [{ target: range, variable: range, value: 2 }],
      solve: true, analysis: { tool: "original", properties: [] }, recalc: true }, operation());
    expect(events).toEqual(["options", "read", "load", "recalc", "read", "load", "recalc", "goal", "solve", "tool", "recalc", "recalc", "save", "publish"]);
  });
});
