import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Length, Inches, Cm, Mm, Pt, Twips, Emu, WD_UNDERLINE, WD_COLOR_INDEX, WD_PARAGRAPH_ALIGNMENT, WD_ALIGN_PARAGRAPH, WD_LINE_SPACING, WD_TAB_ALIGNMENT, WD_TAB_LEADER, MSO_THEME_COLOR, MSO_THEME_COLOR_INDEX, MSO_COLOR_TYPE, WD_STYLE, WD_BUILTIN_STYLE, enumValue, enumFromValue, enumXml, enumFromXml, enumMembers } from "./formatting-values.js";
import { Font, ParagraphFormat } from "./formatting-model.js";
import { w } from "../tests/fixtures/text.js";
it("exports canonical enum records, exact aliases and numeric metadata", () => {
  expect(WD_ALIGN_PARAGRAPH).toBe(WD_PARAGRAPH_ALIGNMENT);
  expect(MSO_THEME_COLOR_INDEX).toBe(MSO_THEME_COLOR);
  expect(WD_STYLE).toBe(WD_BUILTIN_STYLE);
  expect(WD_UNDERLINE.DOUBLE).toEqual({ enum: "WD_UNDERLINE", name: "DOUBLE" });
  expect(enumValue(WD_UNDERLINE.DASH_LONG_HEAVY)).toBe(55);
  expect(enumValue(WD_TAB_ALIGNMENT.START)).toBe(104);
  expect(enumValue(MSO_COLOR_TYPE.AUTO)).toBe(101);
  expect(enumValue(WD_COLOR_INDEX.INHERITED)).toBe(-1);
  expect(enumFromValue("WD_LINE_SPACING", 2)).toBe(WD_LINE_SPACING.DOUBLE);
  expect(enumFromValue("WD_TAB_LEADER", 1)).toBe(WD_TAB_LEADER.DOTS);
  expect(Object.isFrozen(WD_STYLE.TITLE)).toBe(true);
  expect(() => enumFromValue("WD_TAB_ALIGNMENT", 999)).toThrow(RangeError);
  expect(JSON.parse(JSON.stringify(MSO_THEME_COLOR.ACCENT_2))).toEqual({ enum: "MSO_THEME_COLOR", name: "ACCENT_2" });
});
it("converts callable immutable lengths with signed half-away rounding", () => {
  for (const value of [Inches(1), Cm(2.54), Mm(25.4), Pt(72), Twips(1440), Emu(914400)]) {
    expect(value.emu).toBe(914400); expect(value.inches).toBe(1); expect(value.cm).toBe(2.54); expect(value.mm).toBe(25.4); expect(value.pt).toBe(72); expect(value.twips).toBe(1440);
  }
  expect(Length(0.5).emu).toBe(1); expect(Length(-0.5).emu).toBe(-1);
  expect(Length(-317.5).twips).toBe(-1);
  expect(Object.isFrozen(Pt(12))).toBe(true);
  expect(() => Number(Pt(12))).toThrow(TypeError);
  expect(() => Inches("2" as unknown as number)).toThrow(TypeError);
  expect(() => Length(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
});
it("accepts unit helpers at model boundaries and returns length accessors", () => {
  const volume = Volume.fromJSON({ "/p": `<w:p xmlns:w="${w}"/>`, "/r": `<w:r xmlns:w="${w}"/>` });
  const backing = (path: string) => ({ getXml: () => volume.readFileSync(path, "utf8") as string, setXml: (xml: string) => { volume.writeFileSync(path, xml); } });
  const paragraph = new ParagraphFormat(backing("/p")), font = new Font(backing("/r"));
  font.size = Pt(12); expect(font.size?.pt).toBe(12);
  paragraph.left_indent = Inches(-0.5); expect(paragraph.left_indent?.twips).toBe(-720);
  const stop = paragraph.tab_stops.add_tab_stop(Cm(2.54)); expect(stop.position.inches).toBe(1);
  stop.position = Mm(12.7); expect(stop.position.twips).toBe(720);
});

it("resolves enum XML facts without admitting missing representations", () => {
  expect(enumXml(WD_UNDERLINE.DASH_LONG_HEAVY)).toBe("dashLongHeavy");
  expect(enumFromXml("WD_TAB_ALIGNMENT", "decimal")).toBe(WD_TAB_ALIGNMENT.DECIMAL);
  expect(enumFromXml("WD_UNDERLINE", null)).toBe(WD_UNDERLINE.INHERITED);
  expect(() => enumXml(WD_UNDERLINE.INHERITED)).toThrow(RangeError);
  expect(enumMembers("WD_STYLE_TYPE").map(value => value.name)).toEqual(["CHARACTER", "LIST", "PARAGRAPH", "TABLE"]);
});
it("rejects forged length prototypes without invoking their getters", () => {
  let called = false;
  const forged = Object.create(Object.getPrototypeOf(Pt(1)), { value: { get() { called = true; return 1; } }, unit: { value: "pt" } });
  const volume = Volume.fromJSON({ "/r": `<w:r xmlns:w="${w}"/>` });
  const font = new Font({ getXml: () => volume.readFileSync("/r", "utf8") as string, setXml() {} });
  expect(() => { font.size = forged; }).toThrow(TypeError); expect(called).toBe(false);
});

it("formats enum symbols without installing executable properties on transport records", async () => {
  const values = await import("./formatting-values.js");
  expect(values.enumString(values.WD_TAB_ALIGNMENT.RIGHT)).toBe("RIGHT (2)");
  expect(JSON.stringify(values.WD_TAB_ALIGNMENT.RIGHT)).toBe('{"enum":"WD_TAB_ALIGNMENT","name":"RIGHT"}');
});

it("retains the documented color-index enum alias", async () => {
  const values = await import("./formatting-values.js");
  expect(values.WD_COLOR).toBe(values.WD_COLOR_INDEX);
});
