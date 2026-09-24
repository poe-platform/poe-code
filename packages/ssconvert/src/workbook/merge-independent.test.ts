import { describe, expect, it } from "vitest";
import { mergeWorkbookSheets } from "./merge.js";
import type { CapabilityContext } from "../contracts.js";
import type { Sheet, Workbook } from "../workbook.js";
import { hasGraphObjects } from "../rendering.js";
import { dirtyWorkbook, recalculateWorkbook } from "../workbook/updates/recalculation.js";

const limits = { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 20, operations: 100 };
const sheet = (id: string, name = id): Sheet => ({ id, name, cells: [] });
const merge = (target: Workbook, incoming: Workbook) => mergeWorkbookSheets(target, incoming, limits);

describe("independent merge stress", () => {
  it("matches strtoul's accepted empty suffix and unsigned-counter wrap", () => {
    expect(merge({ sheets: [sheet("a", "Data()")] }, { sheets: [sheet("b", "Data()")] }).sheets[1]?.name).toBe("Data(1)");
    expect(merge({ sheets: [sheet("a", "Data(4294967295)"), sheet("c", "Data(0)")] },
      { sheets: [sheet("b", "Data(4294967295)")] }).sheets[2]?.name).toBe("Data(1)");
  });

  it("retains overflowing suffix text and skips every occupied folded candidate", () => {
    expect(merge({ sheets: [sheet("a", "Data(4294967296)")] },
      { sheets: [sheet("b", "Data(4294967296)")] }).sheets[1]?.name).toBe("Data(4294967296)(2)");
    expect(merge({ sheets: [sheet("a", "Straße"), sheet("b", "STRASSE(2)"), sheet("c", "strasse(3)")] },
      { sheets: [sheet("d", "STRASSE")] }).sheets[3]?.name).toBe("STRASSE(4)");
  });

  it("does not confuse stable IDs with spelling or modify external references and strings", () => {
    const incoming: Workbook = { sheets: [{ ...sheet("stable", "Data"), cells: [{ row: 0, column: 0,
      value: { kind: "blank" }, formula: '=Data!B1+"Data!B1"+[other]Data!B1' }] }] };
    const result = merge({ sheets: [sheet("stable", "DATA"), sheet("stable(1)", "Other")] }, incoming);
    expect(result.sheets[2]).toMatchObject({ id: "stable(2)", name: "Data(2)" });
    expect(result.sheets[2]?.cells[0]?.formula).toBe('=\'Data(2)\'!B1+"Data!B1"+[other]Data!B1');
    expect(incoming.sheets[0]?.cells[0]?.formula).toBe('=Data!B1+"Data!B1"+[other]Data!B1');
  });

  it("keeps workbook and sheet-local namespaces distinct while repairing positions and spans", () => {
    const range = { sheet: "local", endSheet: "tail", startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 };
    const result = merge({ sheets: [sheet("local", "Data")], names: [{ name: "Rate", expression: "=1" }] },
      { sheets: [sheet("local", "Data"), sheet("tail", "End")], names: [{ name: "Rate", sheet: "local",
        position: { sheet: "local", row: 0, column: 0 }, expression: "=Data!A1" }],
        dependencies: [{ dependent: range, precedent: range, dynamic: true }] });
    expect(result.names).toEqual([{ name: "Rate", expression: "=1" }, { name: "Rate", sheet: "local(1)",
      position: { sheet: "local(1)", row: 0, column: 0 }, expression: "='Data(2)'!A1" }]);
    expect(result.dependencies?.[0]).toMatchObject({ dependent: { sheet: "local(1)", endSheet: "tail" },
      precedent: { sheet: "local(1)", endSheet: "tail" }, dynamic: true });
  });

  it("aborts an exact workbook-name conflict without changing either source", () => {
    const target: Workbook = { sheets: [sheet("one")], names: [{ name: "REVENUE", expression: "=1" }] };
    const incoming: Workbook = { sheets: [sheet("two")], names: [{ name: "REVENUE", expression: "=2" }] };
    expect(() => merge(target, incoming)).toThrow("Name conflict during merge: 'REVENUE' appears twice at workbook scope.");
    expect(target.sheets.map(s => s.id)).toEqual(["one"]);
    expect(incoming.names?.[0]?.name).toBe("REVENUE");
  });

  it("repairs both 3D sheet endpoints and shared-group expressions without changing group ownership", () => {
    const result = merge({ sheets: [sheet("head", "Start"), sheet("tail", "End")] },
      { sheets: [{ ...sheet("head", "Start"), cells: [{ row: 0, column: 0, value: { kind: "blank" },
        formulaGroup: "group", formula: "=SUM(Start:End!B1)" }], formulaGroups: [{ id: "group", kind: "shared",
        range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }, expression: "=SUM(Start:End!B1)" }] },
      sheet("tail", "End")] });
    expect(result.sheets[2]?.cells[0]?.formula).toBe("=SUM('Start(2)':'End(2)'!B1)");
    expect(result.sheets[2]?.cells[0]?.formulaGroup).toBe("group");
    expect(result.sheets[2]?.formulaGroups?.[0]).toMatchObject({ id: "group", expression: "=SUM('Start(2)':'End(2)'!B1)" });
  });

  it("charges formula rewriting to the explicit workbook-work budget", () => {
    expect(() => mergeWorkbookSheets({ sheets: [] }, { sheets: [{ ...sheet("one"), cells: [
      { row: 0, column: 0, value: { kind: "blank" }, formula: "=" + "1+".repeat(100) + "1" }
    ] }] }, { ...limits, workbookWork: 100 })).toThrow("ssconvert workbook work limit exceeded");
  });

  it("owns retained object data independently of mutable input records", () => {
    const data = { name: "Objects", children: [{ name: "Shape", attributes: { label: "original" } }] };
    const result = merge({ sheets: [] }, { sheets: [{ ...sheet("one"), unsupportedRecords: [
      { source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained", data }
    ] }] });
    data.children[0]!.attributes.label = "mutated";
    expect(result.sheets[0]?.unsupportedRecords?.[0]?.data).toMatchObject({ children: [{ attributes: { label: "original" } }] });
    expect(Object.isFrozen(result.sheets[0]?.unsupportedRecords?.[0]?.data)).toBe(true);
  });

  it("preserves actual cancellation reason before ownership or collision work", () => {
    const controller = new AbortController(), reason = { cancelled: true };
    controller.abort(reason);
    const context: CapabilityContext = { limits, signal: controller.signal, environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} };
    let caught: unknown;
    try { mergeWorkbookSheets({ sheets: [] }, { sheets: [sheet("one")] }, limits, context); } catch (error) { caught = error; }
    expect(caught).toBe(reason);
  });

  it("admits combined sheet/cell limits before transfer and rejects unsupported detached ownership", () => {
    expect(() => mergeWorkbookSheets({ sheets: [sheet("one")] }, { sheets: [sheet("two")] }, { ...limits, sheets: 1 }))
      .toThrow("ssconvert workbook storage limit exceeded");
    expect(() => mergeWorkbookSheets({ sheets: [] }, { sheets: [{ ...sheet("two"), cells: [
      { row: 0, column: 0, value: { kind: "number", value: 1 } }
    ] }] }, { ...limits, cells: 0 })).toThrow("ssconvert workbook storage limit exceeded");
    expect(() => merge({ sheets: [] }, { sheets: [sheet("one")], detachedSheets: [sheet("detached")] }))
      .toThrow("Unsupported ssconvert feature: merge reference records");
  });

  it("graph absence detection observes cancellation even without object records", () => {
    const controller = new AbortController(), reason = { cancelled: true };
    controller.abort(reason);
    const context: CapabilityContext = { limits, signal: controller.signal, environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} };
    let caught: unknown;
    try { hasGraphObjects({ sheets: [] }, context); } catch (error) { caught = error; }
    expect(caught).toBe(reason);
  });

  it("detects direct native graph objects and their historical alias without treating nested metadata as graphs", () => {
    const context: CapabilityContext = { limits, signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} };
    const book = (children: readonly { name: string; children?: readonly { name: string }[] }[]): Workbook => ({ sheets: [{ ...sheet("one"), unsupportedRecords: [
      { source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained", data: { name: "Objects", children } }
    ] }] });
    expect(hasGraphObjects(book([{ name: "SheetObjectGraph" }]), context)).toBe(true);
    expect(hasGraphObjects(book([{ name: "GnmGraph" }]), context)).toBe(true);
    expect(hasGraphObjects(book([{ name: "CellComment", children: [{ name: "SheetObjectGraph" }] }]), context)).toBe(false);
  });

  it("graph absence scanning respects disposition, unknown source admission and a bounded work budget", () => {
    const context: CapabilityContext = { limits, signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} };
    const records: Workbook = { sheets: [{ ...sheet("one"), unsupportedRecords: [
      { source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "dropped", data: { name: "Objects", children: [{ name: "SheetObjectGraph" }] } }
    ] }] };
    expect(hasGraphObjects(records, context)).toBe(false);
    expect(hasGraphObjects({ sheets: [{ ...sheet("one"), unsupportedRecords: [
      { source: "unknown", kind: "Objects", disposition: "retained" }
    ] }] }, context)).toBe(true);
    expect(() => hasGraphObjects({ sheets: [{ ...sheet("one"), unsupportedRecords: [
      { source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained", data: { name: "Objects", children: Array.from({ length: 200 }, () => ({ name: "CellComment" })) } }
    ] }] }, { ...context, limits: { ...limits, workbookWork: 100 } })).toThrow("ssconvert workbook work limit exceeded");
  });

  it("preserves UTF-8 conflict spelling and local namespaces through C fallback diagnostics", () => {
    const target: Workbook = { sheets: [sheet("one")], names: [{ name: "é𐀀", expression: "=1" }] };
    const incoming: Workbook = { sheets: [sheet("two")], names: [{ name: "é𐀀", expression: "=2" }] };
    const context: CapabilityContext = { limits, signal: new AbortController().signal, environment: { env: {}, locale: "C.UTF-8", timezone: "UTC" }, own() {} };
    expect(() => mergeWorkbookSheets(target, incoming, limits, context)).toThrow("Name conflict during merge: 'é𐀀' appears twice at workbook scope.");
    expect(() => mergeWorkbookSheets(target, incoming, limits, { ...context, environment: { ...context.environment, locale: "C" } }))
      .toThrow("Name conflict during merge: '??' appears twice at workbook scope.");
    expect(incoming.names?.[0]?.name).toBe("é𐀀");
    expect(mergeWorkbookSheets(target, { ...incoming, names: [{ ...incoming.names![0]!, sheet: "two" }] }, limits, context).names?.[1]?.name).toBe("é𐀀");
  });

  it("keeps case-distinct globals and local shadows separate in direct and INDIRECT evaluation and invalidation", () => {
    const context: CapabilityContext = { limits: { ...limits, workbookWork: 10000 }, signal: new AbortController().signal,
      environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} };
    const numeric = (value: number) => ({ kind: "number" as const, value });
    const merged = mergeWorkbookSheets({ sheets: [{ ...sheet("first", "Data"), cells: [
      { row: 0, column: 0, value: numeric(10) }, { row: 0, column: 1, value: numeric(0), formula: "=Clash" }
    ] }], names: [{ name: "Clash", expression: "=Data!$A$1" }] },
    { sheets: [{ ...sheet("second", "Data"), cells: [
      { row: 0, column: 0, value: numeric(20) }, { row: 0, column: 1, value: numeric(30) },
      ...["=clash", "=Clash", '=INDIRECT("clash")', '=INDIRECT("Clash")', "=CLASH"].map((formula, index) =>
        ({ row: 0, column: index + 2, value: numeric(0), formula }))
    ] }], names: [{ name: "clash", expression: "=Data!$A$1" }, { name: "Clash", sheet: "second", expression: "=Data!$B$1" }] }, limits, context);
    expect(merged.names?.map(name => [name.name, name.sheet])).toEqual([["Clash", undefined], ["clash", undefined], ["Clash", "second"]]);
    const calculated = recalculateWorkbook(merged, context, true);
    expect(calculated.sheets[0]?.cells[1]?.value).toEqual(numeric(10));
    expect(calculated.sheets[1]?.cells.slice(2).map(cell => cell.value)).toEqual([
      numeric(20), numeric(30), numeric(20), numeric(30), { kind: "error", value: "#NAME?" }
    ]);
    const change = (sheetId: string, column: number) => [{ sheet: sheetId, startRow: 0, endRow: 0, startColumn: column, endColumn: column }];
    expect(dirtyWorkbook(calculated, change("first", 0), context).sheets[1]?.cells.slice(2).map(cell => cell.formulaDirty)).toEqual([false, false, false, false, false]);
    expect(dirtyWorkbook(calculated, change("second", 0), context).sheets[1]?.cells.slice(2).map(cell => cell.formulaDirty)).toEqual([true, false, true, false, false]);
    expect(dirtyWorkbook(calculated, change("second", 1), context).sheets[1]?.cells.slice(2).map(cell => cell.formulaDirty)).toEqual([false, true, false, true, false]);
    expect(calculated.names?.map(name => name.name)).toEqual(["Clash", "clash", "Clash"]);
    const replay: Workbook = JSON.parse(JSON.stringify(calculated));
    expect(recalculateWorkbook(replay, context)).toEqual(calculated);
    expect(dirtyWorkbook(replay, change("second", 0), context).sheets[1]?.cells.slice(2).map(cell => cell.formulaDirty)).toEqual([true, false, true, false, false]);
  });

  it("uses compatibility folding for ordering without collapsing exact workbook-name identity", () => {
    const context: CapabilityContext = { limits: { ...limits, workbookWork: 10000 }, signal: new AbortController().signal,
      environment: { env: {}, locale: "C.UTF-8", timezone: "UTC" }, own() {} };
    const merged = mergeWorkbookSheets({ sheets: [sheet("first")], names: [{ name: "Ａ", expression: "=10" }] },
      { sheets: [{ ...sheet("second"), cells: ["=Ａ", "=A", "=a"].map((formula, column) =>
        ({ row: 0, column, formula, value: { kind: "blank" as const } })) }], names: [{ name: "A", expression: "=20" }] }, limits, context);
    expect(recalculateWorkbook(merged, context, true).sheets[1]?.cells.map(cell => cell.value)).toEqual([
      { kind: "number", value: 10 }, { kind: "number", value: 20 }, { kind: "error", value: "#NAME?" }
    ]);
    const names = [{ name: "Zulu", expression: "=1" }, { name: "Ａ", expression: "=2" }];
    expect(() => mergeWorkbookSheets({ sheets: [sheet("first")], names }, { sheets: [sheet("second")], names }, limits, context))
      .toThrow("Name conflict during merge: 'Ａ' appears twice at workbook scope.");
  });
});
