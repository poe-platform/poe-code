import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Font, ParagraphFormat, RGBColor } from "./formatting-model.js";
import { w } from "../tests/fixtures/text.js";
function owner(content: string) {
  const volume = Volume.fromJSON({ "/owner.xml": content });
  return { getXml: () => volume.readFileSync("/owner.xml", "utf8") as string, setXml: (xml: string) => { volume.writeFileSync("/owner.xml", xml); } };
}
it("exposes live neutral font flags and removes only its own baseline mode", () => {
  const backing = owner(`<w:r xmlns:w="${w}"><w:t>Bay</w:t></w:r>`);
  const font = new Font(backing);
  expect(font.all_caps).toBeNull(); font.all_caps = true; expect(font.all_caps).toBe(true);
  font.cs_bold = false; expect(font.cs_bold).toBe(false);
  font.all_caps = null; expect(font.all_caps).toBeNull();
  font.subscript = true; font.superscript = false; expect(font.subscript).toBe(true);
  font.subscript = false; expect(font.subscript).toBeNull();
  font.superscript = true; font.subscript = null; expect(font.superscript).toBeNull();
  expect(backing.getXml()).toContain("Bay");
});
it("returns live paragraph tab handles with sorted movement, negative indexing and clear", () => {
  const backing = owner(`<w:p xmlns:w="${w}"><w:r><w:t>Bay</w:t></w:r></w:p>`);
  const format = new ParagraphFormat(backing);
  const tabs = format.tab_stops;
  expect(tabs.length).toBe(0);
  const first = tabs.add_tab_stop({ value: 10, unit: "pt" });
  tabs.add_tab_stop({ value: -2, unit: "pt" });
  expect(tabs.length).toBe(2);
  expect(tabs.at(-1).position).toEqual({ value: 200, unit: "twip" });
  first.position = { value: -4, unit: "pt" };
  expect([...tabs].map(tab => tab.position.value)).toEqual([-80, -40]);
  expect(first.position.value).toBe(-80);
  first.leader = null; expect(first.leader.name).toBe("SPACES");
  tabs.delete(-1); expect(tabs.length).toBe(1);
  tabs.clear_all(); expect(tabs.length).toBe(0);
  expect(() => tabs.at(0)).toThrow(RangeError);
  expect(() => first.position).toThrow();
});
it("merges paragraph tri-state values and keeps inherited absence", () => {
  const backing = owner(`<w:p xmlns:w="${w}"><w:r><w:t>Bay</w:t></w:r></w:p>`);
  const format = new ParagraphFormat(backing);
  expect(format.keep_with_next).toBeNull();
  format.keep_with_next = false; expect(format.keep_with_next).toBe(false);
  format.keep_with_next = null; expect(format.keep_with_next).toBeNull();
  format.left_indent = { value: -6, unit: "pt" }; expect(format.left_indent).toEqual({ value: -120, unit: "twip" });
});
it("roundtrips font name, size, underline and highlighting with typed values", () => {
  const backing = owner(`<w:r xmlns:w="${w}"><w:t>Bay</w:t></w:r>`), font = new Font(backing);
  font.name = "Marine"; expect(font.name).toBe("Marine");
  font.size = { value: 240, unit: "twip" }; expect(font.size).toEqual({ value: 12, unit: "pt" });
  font.underline = true; expect(font.underline).toBe(true);
  font.underline = { enum: "WD_UNDERLINE", name: "DOUBLE" }; expect(font.underline).toEqual({ enum: "WD_UNDERLINE", name: "DOUBLE" });
  font.underline = false; expect(font.underline).toBe(false);
  font.highlight_color = { enum: "WD_COLOR_INDEX", name: "YELLOW" }; expect(font.highlight_color).toEqual({ enum: "WD_COLOR_INDEX", name: "YELLOW" });
  font.highlight_color = null; expect(font.highlight_color).toBeNull();
});
it("reads and writes paragraph lengths, enum alignment and line spacing", () => {
  const format = new ParagraphFormat(owner(`<w:p xmlns:w="${w}"><w:r><w:t>Bay</w:t></w:r></w:p>`));
  format.right_indent = { value: 40, unit: "twip" }; expect(format.right_indent).toEqual({ value: 40, unit: "twip" });
  format.first_line_indent = { value: -10, unit: "pt" }; expect(format.first_line_indent).toEqual({ value: -200, unit: "twip" });
  format.space_before = { value: 4, unit: "pt" }; expect(format.space_before).toEqual({ value: 80, unit: "twip" });
  format.space_after = null; expect(format.space_after).toBeNull();
  format.alignment = { enum: "WD_PARAGRAPH_ALIGNMENT", name: "JUSTIFY" }; expect(format.alignment).toEqual({ enum: "WD_PARAGRAPH_ALIGNMENT", name: "JUSTIFY" });
  format.line_spacing = 1.5; expect(format.line_spacing).toBe(1.5); expect(format.line_spacing_rule).toEqual({ enum: "WD_LINE_SPACING", name: "ONE_POINT_FIVE" });
  format.line_spacing_rule = { enum: "WD_LINE_SPACING", name: "DOUBLE" }; expect(format.line_spacing).toBe(2);
  format.line_spacing = { value: 16, unit: "pt" }; expect(format.line_spacing).toEqual({ value: 320, unit: "twip" });
});
it("keeps tab handles live across unrelated paragraph edits and preserves opaque stop attributes", () => {
  const backing = owner(`<w:p xmlns:w="${w}" xmlns:x="urn:marine"><w:pPr><w:tabs><w:tab w:pos="40" w:val="left" x:note="retain"/></w:tabs></w:pPr></w:p>`);
  const format = new ParagraphFormat(backing), stop = format.tab_stops.at(0);
  format.keep_with_next = true;
  expect(stop.position.value).toBe(40);
  stop.alignment = { enum: "WD_TAB_ALIGNMENT", name: "RIGHT" };
  expect(backing.getXml()).toContain('x:note="retain"');
  expect(stop.alignment.name).toBe("RIGHT");
});
it.each(["all_caps", "bold", "complex_script", "cs_bold", "cs_italic", "double_strike", "emboss", "hidden", "imprint", "italic", "math", "no_proof", "outline", "rtl", "shadow", "small_caps", "snap_to_grid", "spec_vanish", "strike", "web_hidden"] as const)("roundtrips every neutral Font flag %s with explicit null and false", key => {
  const font = new Font(owner(`<w:r xmlns:w="${w}"><w:t>Bay</w:t></w:r>`));
  for (const value of [false, true, null]) { font[key] = value; expect(font[key]).toBe(value); }
  expect(() => { font[key] = 1 as unknown as boolean; }).toThrow(TypeError);
});

it("keeps live color format values, theme precedence and explicit inherited absence", () => {
  const backing = owner(`<w:r xmlns:w="${w}"><w:t>Bay</w:t></w:r>`), font = new Font(backing), color = font.color;
  expect(color.type).toBeNull(); color.rgb = new RGBColor(12, 34, 56);
  expect(String(color.rgb)).toBe("0C2238"); expect(color.type?.name).toBe("RGB");
  color.theme_color = { enum: "MSO_THEME_COLOR", name: "ACCENT_2" }; expect(color.type?.name).toBe("THEME"); expect(String(color.rgb)).toBe("0C2238");
  color.theme_color = null; expect(color.rgb).toBeNull(); expect(color.type).toBeNull();
  color.rgb = RGBColor.from_string("AA0022"); expect([...color.rgb!]).toEqual([170, 0, 34]);
  expect(color.rgb!.at(-1)).toBe(34); expect(color.rgb!.length).toBe(3);
  expect(() => RGBColor.from_string("AAQQ22")).toThrow(TypeError);
  expect(() => new RGBColor(0, -1, 20)).toThrow(RangeError);
});
it("rejects fractional tab indexes and does not expose slicing", () => {
  const tabs = new ParagraphFormat(owner(`<w:p xmlns:w="${w}"/>`)).tab_stops;
  for (const value of [1, 2, 3]) tabs.add_tab_stop({ value, unit: "pt" });
  expect("slice" in tabs).toBe(false);
  expect(() => tabs.at(0.5)).toThrow(TypeError);
});
it("retains an at-least line rule when assigning an absolute line height", () => {
  const format = new ParagraphFormat(owner(`<w:p xmlns:w="${w}"/>`));
  format.line_spacing_rule = { enum: "WD_LINE_SPACING", name: "AT_LEAST" };
  format.line_spacing = { value: 15, unit: "pt" };
  expect(format.line_spacing_rule?.name).toBe("AT_LEAST");
});
it("supports readonly numeric tab indexing, bounded element views and owner equality", () => {
  const backing = owner(`<w:p xmlns:w="${w}"/>`), format = new ParagraphFormat(backing), tabs = format.tab_stops;
  const stop = tabs.add_tab_stop({ value: 2, unit: "pt" });
  expect(tabs[0]!.equals(stop)).toBe(true);
  expect(tabs[-1]!.element.localName).toBe("tab");
  expect(tabs.element.localName).toBe("pPr");
  expect(new ParagraphFormat(backing).equals(format)).toBe(true);
  expect(format.part).toBeNull();
});
it("does not create color properties when clearing already inherited color", () => {
  const backing = owner(`<w:r xmlns:w="${w}"/>`), font = new Font(backing), before = backing.getXml();
  font.color.rgb = null; font.color.theme_color = null;
  expect(backing.getXml()).toBe(before);
});
it("keeps the font color view read-only", () => {
  const font = new Font(owner(`<w:r xmlns:w="${w}"/>`));
  expect(Reflect.set(font, "color", null)).toBe(false);
});

it("searches RGB tuple components inside signed half-open index bounds", () => {
  const color = new RGBColor(20, 40, 20);
  expect(color.index(20, 1)).toBe(2);
  expect(color.index(20, -2, 3)).toBe(2);
  expect(() => color.index(20, 1, -1)).toThrow(RangeError);
  expect(() => color.index(20, 0.5)).toThrow(TypeError);
});
