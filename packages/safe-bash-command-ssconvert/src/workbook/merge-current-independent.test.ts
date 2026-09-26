import vm from "node:vm";
import { Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { createEngine, runCommand, type Codec, type Workbook } from "../index.js";
import { mergeWorkbookSheets } from "./merge.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";

const limits = { inputBytes: 20000, outputBytes: 20000, sheets: 30, cells: 100, operations: 100 };
const tab = (id: string, name = id) => ({ id, name, cells: [] });
const context = { limits, signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} };

describe("independent merge stress controls", () => {
  it.each([
    ["Tab(4294967295)", "Tab(0)"],
    ["Tab(4294967296)", "Tab(4294967296)(2)"],
    ["Tab(0004)", "Tab(5)"],
    ["Tab(-2)", "Tab(-2)(2)"],
    ["Tab (2)", "Tab (3)"]
  ])("preserves native numeric suffix boundaries for %s", (name, expected) => {
    const merged = mergeWorkbookSheets({ sheets: [tab("old", name)] }, { sheets: [tab("new", name)] }, limits);
    expect(merged.sheets.map(sheet => sheet.name)).toEqual([name, expected]);
  });

  it("reserves appended names in order while distinguishing sheet IDs from display names", () => {
    const incoming: Workbook = { sheets: [tab("left", "Data"), { ...tab("right", "Data(2)"), cells: [
      { row: 0, column: 0, formula: "=Data!A1+'[external]Data'!A1", value: { kind: "blank" } }
    ] }] };
    const before = JSON.stringify(incoming);
    const merged = mergeWorkbookSheets({ sheets: [tab("left", "DATA")] }, incoming, limits);
    expect(merged.sheets.map(sheet => [sheet.id, sheet.name])).toEqual([
      ["left", "DATA"], ["left(1)", "Data(2)"], ["right", "Data(3)"]
    ]);
    expect(merged.sheets[2]?.cells[0]?.formula).toBe("='Data(2)'!A1+'[external]Data'!A1");
    expect(JSON.stringify(incoming)).toBe(before);
  });

  it("keeps same-spelling local names distinct from workbook and other sheet scopes", () => {
    const target: Workbook = { sheets: [tab("a", "Data")], names: [
      { name: "Value", expression: "=3" }, { name: "Value", sheet: "a", expression: "=7" }
    ] };
    const incoming: Workbook = { sheets: [{ ...tab("a", "Data"), cells: [
      { row: 0, column: 0, formula: "=Value", value: { kind: "blank" } }
    ] }], names: [{ name: "Value", sheet: "a", expression: "=11" }] };
    const merged = mergeWorkbookSheets(target, incoming, limits);
    expect(merged.names?.map(name => [name.name, name.sheet])).toEqual([
      ["Value", undefined], ["Value", "a"], ["Value", "a(1)"]
    ]);
    expect(recalculateWorkbook(merged, context, true).sheets[1]?.cells[0]?.value).toEqual({ kind: "number", value: 11 });
  });

  it("rejects dense ID collisions without changing either input", () => {
    const target = { sheets: Array.from({ length: 12 }, (_, index) => tab(index ? `id(${index})` : "id", `Old${index}`)) };
    const incoming = { sheets: [tab("id", "New")] };
    const before = JSON.stringify([target, incoming]);
    expect(() => mergeWorkbookSheets(target, incoming, { ...limits, workbookWork: 4 })).toThrow("ssconvert workbook work limit exceeded");
    expect(JSON.stringify([target, incoming])).toBe(before);
  });

  it("preserves abort-reason identity before collision processing", () => {
    const controller = new AbortController(), reason = { message: "stop" };
    controller.abort(reason);
    const target = { sheets: [tab("a")] }, incoming = { sheets: [tab("a")] };
    let caught: unknown;
    try { mergeWorkbookSheets(target, incoming, limits, { ...context, signal: controller.signal }); }
    catch (error) { caught = error; }
    expect(caught).toBe(reason);
    expect(target.sheets[0]?.name).toBe("a");
    expect(incoming.sheets[0]?.name).toBe("a");
  });

  it.each([false, true])("checks realm admission and checkpoint/replay namespace effects (foreign realm: %s)", async foreignRealm => {
    const volume = Volume.fromJSON({ "/first": "first", "/second": "second", "/keep": "unchanged" });
    const effects: string[] = [];
    const codec: Codec = { id: "independent", description: "Original independent merge JSON fixture", extensions: ["json"],
      async read(bytes) {
        const text = new TextDecoder().decode(bytes);
        if (text.startsWith("{")) return JSON.parse(text) as Workbook;
        if (foreignRealm) return vm.runInNewContext('({ sheets: [{ id: "id", name: "Tab", cells: [] }] })') as Workbook;
        return { sheets: [{ ...tab("id", "Tab"), cells: [{ row: 0, column: 0, value: { kind: "number", value: 5 } }] }] };
      },
      async write(book) { return new TextEncoder().encode(JSON.stringify(book)); }
    };
    const engine = createEngine({ codecs: [codec], limits, environment: context.environment,
      filesystem: {
        async read(uri, signal) { signal.throwIfAborted(); effects.push(`read:${uri}`); return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
        async write(uri, bytes, signal) { signal.throwIfAborted(); effects.push(`write:${uri}`); volume.writeFileSync(uri, bytes); }
      } });
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const operation = { signal: context.signal, stdout: { async write(bytes: Uint8Array) { stdout.push(new Uint8Array(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr.push(new Uint8Array(bytes)); } } };
    const original = await runCommand(["-I", codec.id, "-T", codec.id, "-M", "/checkpoint", "/first", "/second"], engine, operation);
    if (foreignRealm) {
      expect(original.exitCode).toBe(1);
      expect(effects).toEqual(["read:/first"]);
      expect(stdout).toEqual([]);
      expect(stderr.map(bytes => new TextDecoder().decode(bytes)).join("")).toBe("Unsupported workbook prototype\n");
      expect(volume.toJSON()).toEqual({ "/first": "first", "/second": "second", "/keep": "unchanged" });
      return;
    }
    expect(original.exitCode, stderr.map(bytes => new TextDecoder().decode(bytes)).join("")).toBe(0);
    expect(effects).toEqual(["read:/first", "read:/second", "write:/checkpoint"]);
    expect(stdout).toEqual([]);
    expect(stderr.map(bytes => new TextDecoder().decode(bytes)).join("")).toBe("Adding sheets from file:///first\nAdding sheets from file:///second\n");
    const checkpoint = JSON.parse(String(volume.readFileSync("/checkpoint", "utf8"))) as Workbook;
    expect(checkpoint.sheets.map(sheet => [sheet.id, sheet.name])).toEqual([["id", "Tab"], ["id(1)", "Tab(2)"]]);
    const replay: Uint8Array[] = [];
    await expect(engine.convert({ input: { kind: "resource", uri: "/checkpoint" }, importType: codec.id, exportType: codec.id,
      destination: { kind: "stream", sink: { async write(bytes) { replay.push(new Uint8Array(bytes)); } } } }, { signal: context.signal })).resolves.toMatchObject({ exitCode: 0 });
    expect(JSON.parse(new TextDecoder().decode(replay[0]))).toEqual(checkpoint);
    expect(Object.keys(volume.toJSON()).sort()).toEqual(["/checkpoint", "/first", "/keep", "/second"]);
    expect(volume.readFileSync("/keep", "utf8")).toBe("unchanged");
  });
});
