import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { validateDocxValue } from "./operation-schema.js";
import { applyStyleModelBatch } from "./style-model-batch.js";
import { styleModelBatchOperations } from "./style-model-batch-operations.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";

// Original domain boundaries; identical integers in different families stay typed.
const families = [
  ["WD_CELL_VERTICAL_ALIGNMENT", [["TOP", 0, "top"], ["CENTER", 1, "center"], ["BOTTOM", 3, "bottom"], ["BOTH", 101, "both"]]],
  ["WD_ORIENTATION", [["PORTRAIT", 0, "portrait"], ["LANDSCAPE", 1, "landscape"]]],
  ["WD_TABLE_ALIGNMENT", [["LEFT", 0, "left"], ["CENTER", 1, "center"], ["RIGHT", 2, "right"]]],
  ["WD_ROW_HEIGHT_RULE", [["AUTO", 0, "auto"], ["AT_LEAST", 1, "atLeast"], ["EXACTLY", 2, "exact"]]],
  ["WD_SECTION_START", [["CONTINUOUS", 0, "continuous"], ["NEW_COLUMN", 1, "nextColumn"], ["NEW_PAGE", 2, "nextPage"], ["EVEN_PAGE", 3, "evenPage"], ["ODD_PAGE", 4, "oddPage"]]],
  ["WD_TABLE_DIRECTION", [["LTR", 0], ["RTL", 1]]],
  ["WD_BREAK_TYPE", [["COLUMN", 8], ["LINE", 6], ["LINE_CLEAR_LEFT", 9], ["LINE_CLEAR_RIGHT", 10], ["LINE_CLEAR_ALL", 11], ["PAGE", 7], ["SECTION_CONTINUOUS", 3], ["SECTION_EVEN_PAGE", 4], ["SECTION_NEXT_PAGE", 2], ["SECTION_ODD_PAGE", 5], ["TEXT_WRAPPING", 11]]],
  ["WD_INLINE_SHAPE_TYPE", [["CHART", 12], ["LINKED_PICTURE", 4], ["PICTURE", 3], ["SMART_ART", 15], ["NOT_IMPLEMENTED", -6]]],
  ["WD_HEADER_FOOTER_INDEX", [["PRIMARY", 1, "default"], ["FIRST_PAGE", 2, "first"], ["EVEN_PAGE", 3, "even"]]]
] as const;

interface Member { readonly enum: string; readonly name: string; readonly value: number; readonly xml_value?: string | null; toString(): string }
interface Family extends Iterable<Member> { readonly members: Readonly<Record<string, Member>>; fromValue(value: number): Member; from_xml(value: string | null): Member; to_xml(value: Member | number | null): string | null; readonly [key: string]: unknown }
const exported = api as unknown as Record<string, Family>;

it("exercises every documented enum member through its direct value protocol", () => {
  const counts = { WD_UNDERLINE: 19, WD_COLOR_INDEX: 18, WD_PARAGRAPH_ALIGNMENT: 9, WD_LINE_SPACING: 6, WD_TAB_ALIGNMENT: 10, WD_TAB_LEADER: 6, MSO_THEME_COLOR: 17, MSO_COLOR_TYPE: 3, WD_BUILTIN_STYLE: 132, WD_STYLE_TYPE: 4 };
  for (const [name, count] of Object.entries(counts)) {
    const family = exported[name]!;
    expect(Object.keys(family.members)).toHaveLength(count);
    for (const member of Object.values(family.members)) {
      expect(family.fromValue(member.value)).toBe(member);
      expect(member.toString()).toBe(`${member.name} (${member.value})`);
      expect(Object.isFrozen(member)).toBe(true);
      expect(validateDocxValue(name, member)).toBe(true);
      expect(JSON.parse(JSON.stringify(member))).toEqual({ enum: name, name: member.name });
    }
    expect([...family]).toEqual(Object.values(family.members));
  }
});

it.each(families)("exports %s with exact immutable values and conversions", (name, cases) => {
  const family = exported[name]!;
  expect(family).toBeDefined();
  for (const [symbol, value, xml] of cases as readonly (readonly [string, number, string?])[]) {
    const member = family[symbol] as Member;
    const canonical = family.fromValue(value);
    expect(member).toBe(canonical);
    expect(member.value).toBe(value);
    expect(member.toString()).toBe(`${canonical.name} (${value})`);
    expect(family.members[symbol]).toBe(member);
    expect(Object.isFrozen(member)).toBe(true);
    expect(JSON.parse(JSON.stringify(member))).toEqual({ enum: name, name: canonical.name });
    expect(validateDocxValue(name, member)).toBe(true);
    if (xml !== undefined) {
      expect(member.xml_value).toBe(xml);
      expect(family.from_xml(xml)).toBe(member);
      expect(family.to_xml(value)).toBe(xml);
      expect(family.to_xml(member)).toBe(xml);
      expect(family.to_xml(null)).toBeNull();
      expect(() => family.from_xml("unknown")).toThrow(RangeError);
    }
  }
  expect([...family].map(member => member.value)).toEqual([...new Set(cases.map(item => item[1]))]);
  expect(Object.keys(family.members)).toEqual(cases.map(item => item[0]));
  expect(Object.isFrozen(family.members)).toBe(true);
  expect(() => family.fromValue(99999)).toThrow(RangeError);
  expect(() => family.fromValue(0.5)).toThrow(TypeError);
  expect(() => family.fromValue("0" as unknown as number)).toThrow(TypeError);
});

it("retains enum family aliases and canonical break value aliases", () => {
  for (const [alias, name] of [["WD_ALIGN_VERTICAL", "WD_CELL_VERTICAL_ALIGNMENT"], ["WD_ORIENT", "WD_ORIENTATION"], ["WD_ROW_HEIGHT", "WD_ROW_HEIGHT_RULE"], ["WD_SECTION", "WD_SECTION_START"], ["WD_BREAK", "WD_BREAK_TYPE"], ["WD_INLINE_SHAPE", "WD_INLINE_SHAPE_TYPE"], ["WD_HEADER_FOOTER", "WD_HEADER_FOOTER_INDEX"]]) expect(exported[alias!]).toBe(exported[name!]);
  expect(exported.WD_BREAK!.TEXT_WRAPPING).toBe(exported.WD_BREAK!.LINE_CLEAR_ALL);
  expect(validateDocxValue("WD_ALIGN_VERTICAL", exported.WD_ALIGN_VERTICAL!.TOP)).toBe(true);
  expect(validateDocxValue("WD_BREAK", exported.WD_BREAK!.PAGE)).toBe(true);
  expect(validateDocxValue("WD_SECTION", exported.WD_SECTION!.CONTINUOUS)).toBe(true);
});

it("provides direct protocols for existing formatting enums without weakening transport checks", () => {
  const family = exported.WD_UNDERLINE!;
  expect(family.fromValue(0)).toBe(family.NONE);
  expect((family.NONE as Member).value).toBe(0);
  expect(family.from_xml(null)).toBe(family.INHERITED);
  expect(family.to_xml(family.INHERITED as Member)).toBeNull();
  expect(() => family.to_xml(false as unknown as number)).toThrow(TypeError);
  expect(() => family.to_xml(exported.WD_COLOR_INDEX!.BLACK as Member)).toThrow(TypeError);
  expect(validateDocxValue("WD_UNDERLINE", { enum: "WD_UNDERLINE", name: "NONE", toString() { return "unsafe"; } })).toBe(false);
  for (const [name, symbols] of [["WD_LINE_SPACING", ["SINGLE", "ONE_POINT_FIVE", "DOUBLE"]], ["MSO_THEME_COLOR", ["NOT_THEME_COLOR"]]] as const) {
    const family = exported[name]!;
    for (const symbol of symbols) expect(() => family.to_xml(family[symbol] as Member)).toThrow(RangeError);
    expect(() => family.from_xml("UNMAPPED")).toThrow(RangeError);
  }
  expect(() => exported.WD_TABLE_DIRECTION!.to_xml(0)).toThrow(RangeError);
  expect(exported.MSO_THEME_COLOR!.MIXED).toBeUndefined();
});

it("executes missing enum families through the existing typed batch", async () => {
  const input = await textFixture(paragraph("Quay survey"));
  const result = await applyStyleModelBatch(input, { version: 1, operations: [
    { operation: "model.enum.section.WD_ORIENTATION.fromValue.call", arguments: { value: 0 }, resultHandle: "orientation" },
    { operation: "model.enum.section.WD_ORIENTATION.to_xml.call", receiver: { resultHandle: "orientation" }, arguments: { value: 0 } },
    { operation: "model.enum.table.WD_CELL_VERTICAL_ALIGNMENT.BOTTOM.get", arguments: {}, resultHandle: "vertical" },
    { operation: "model.enum.table.WD_CELL_VERTICAL_ALIGNMENT.value.get", receiver: { resultHandle: "vertical" }, arguments: {} }
  ] }, textContext);
  expect(result.results[1]!.value).toBe("portrait");
  expect(result.results[3]!.value).toBe(3);
  expect(result.affected).toBe(0);
});

it("retains alias names in batch getters and members while iterating canonical values", async () => {
  const input = await textFixture(paragraph("Quay markers"));
  const result = await applyStyleModelBatch(input, { version: 1, operations: [
    { operation: "model.enum.text.WD_BREAK_TYPE.TEXT_WRAPPING.get", arguments: {} },
    { operation: "model.enum.text.WD_BREAK_TYPE.members.get", arguments: {} },
    { operation: "model.enum.text.WD_BREAK_TYPE.Symbol.iterator.call", arguments: {} }
  ] }, textContext);
  expect(result.results[0]!.value).toEqual({ enum: "WD_BREAK_TYPE", name: "LINE_CLEAR_ALL" });
  expect(result.results[1]!.value).toContainEqual({ key: "TEXT_WRAPPING", value: { enum: "WD_BREAK_TYPE", name: "LINE_CLEAR_ALL" } });
  expect(result.results[2]!.value).toHaveLength(10);
});

it("rejects enum accessors and coercions before invoking caller code", () => {
  let calls = 0;
  const forged = { get enum() { calls++; return "WD_UNDERLINE"; }, name: "NONE" };
  expect(() => api.enumValue(forged as unknown as Parameters<typeof api.enumValue>[0])).toThrow(TypeError);
  expect(calls).toBe(0);
  expect(() => exported.WD_UNDERLINE!.to_xml(forged as unknown as Member)).toThrow(TypeError);
  expect(calls).toBe(0);
  expect(() => api.enumString(forged as unknown as Parameters<typeof api.enumString>[0])).toThrow(TypeError);
  expect(calls).toBe(0);
  expect(() => api.enumXml(forged as unknown as Parameters<typeof api.enumXml>[0])).toThrow(TypeError);
  expect(calls).toBe(0);
  expect(() => api.enumValue({ enum: "__proto__", name: "toString" } as unknown as Parameters<typeof api.enumValue>[0])).toThrow(RangeError);
  expect(() => Number(exported.WD_UNDERLINE!.NONE)).toThrow(TypeError);
});

it("rejects inherited enum family names", () => {
  expect(() => api.enumValue({ enum: "__proto__", name: "toString" } as unknown as Parameters<typeof api.enumValue>[0])).toThrow(RangeError);
});

it("validates enum stringification before reading a caller name getter", () => {
  let calls = 0;
  const forged = { enum: "WD_UNDERLINE", get name() { calls++; return "NONE"; } };
  expect(() => api.enumString(forged as unknown as Parameters<typeof api.enumString>[0])).toThrow(TypeError);
  expect(calls).toBe(0);
});

it("uses the SDK-backed CLI for enum conversions with pure JSON and no publication", async () => {
  const input = await textFixture(paragraph("Harbor bearings"));
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(input), "/stdout": "", "/stderr": "" });
  const ops = { version: 1, operations: [
    { operation: "model.enum.section.WD_ORIENTATION.fromValue.call", arguments: { value: 1 }, resultHandle: "orientation" },
    { operation: "model.enum.section.WD_ORIENTATION.to_xml.call", receiver: { resultHandle: "orientation" }, arguments: { value: 1 } }
  ] };
  const result = await api.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["batch", "input.docx", "--ops-json", JSON.stringify(ops), "--json"].map(value => new TextEncoder().encode(value)),
    cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { volume.appendFileSync("/stdout", bytes); } },
    stderr: { async write(bytes) { volume.appendFileSync("/stderr", bytes); } }
  });
  expect(result.exitCode).toBe(0);
  expect(volume.readFileSync("/stderr", "utf8")).toBe("");
  expect(JSON.parse(volume.readFileSync("/stdout", "utf8") as string)).toMatchObject({ version: 1, operation: "batch", ok: true, affected: 0, errors: [], data: { output: [], results: [{ value: { enum: "WD_ORIENTATION", name: "LANDSCAPE" } }, { value: "landscape" }] } });
  expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(input));
  expect(styleModelBatchOperations).toContain("model.enum.text.WD_BREAK_TYPE.TEXT_WRAPPING.get");
});
