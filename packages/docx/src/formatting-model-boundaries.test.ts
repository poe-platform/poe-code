import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Font, ParagraphFormat, RGBColor } from "./formatting-model.js";
import { Pt, Twips, WD_UNDERLINE, WD_COLOR_INDEX, WD_LINE_SPACING, WD_PARAGRAPH_ALIGNMENT, WD_TAB_ALIGNMENT, WD_TAB_LEADER, MSO_THEME_COLOR, enumMembers } from "./formatting-values.js";
import { w } from "../tests/fixtures/text.js";
function owner(kind: "r" | "p", props: string | null) {
  const volume = Volume.fromJSON({ "/owner": `<w:${kind} xmlns:w="${w}">${props === null ? "" : `<w:${kind}Pr>${props}</w:${kind}Pr>`}</w:${kind}>` });
  return { getXml: () => volume.readFileSync("/owner", "utf8") as string, setXml: (xml: string) => { volume.writeFileSync("/owner", xml); } };
}
const flags = { all_caps: "caps", bold: "b", complex_script: "cs", cs_bold: "bCs", cs_italic: "iCs", double_strike: "dstrike", emboss: "emboss", hidden: "vanish", imprint: "imprint", italic: "i", math: "oMath", no_proof: "noProof", outline: "outline", rtl: "rtl", shadow: "shadow", small_caps: "smallCaps", snap_to_grid: "snapToGrid", spec_vanish: "specVanish", strike: "strike", web_hidden: "webHidden" } as const;
it.each(Object.entries(flags) as [keyof typeof flags, string][])("reads every raw Font boolean state for %s", (name, tag) => {
  for (const absent of [null, ""]) expect(new Font(owner("r", absent))[name]).toBeNull();
  for (const lexical of [undefined, "1", "on", "true", "0", "off", "false"]) {
    const font = new Font(owner("r", `<w:${tag}${lexical === undefined ? "" : ` w:val="${lexical}"`}/>`));
    expect(font[name]).toBe(lexical === undefined || ["1", "on", "true"].includes(lexical));
  }
});
it.each(["subscript", "superscript"] as const)("preserves every raw and assigned baseline state for %s", mode => {
  for (const old of [null, "", "baseline", "subscript", "superscript"]) {
    for (const value of [true, false, null]) {
      const backing = owner("r", old === null ? null : old === "" ? "" : `<w:vertAlign w:val="${old}"/>`), font = new Font(backing);
      expect(font[mode]).toBe(old === null || old === "" ? null : old === mode);
      font[mode] = value;
      const expected = value === true ? mode : value === null || old === mode ? null : old === "" ? null : old;
      expect(font.subscript).toBe(expected === null ? null : expected === "subscript");
      expect(font.superscript).toBe(expected === null ? null : expected === "superscript");
      expect(font.element.children.some(child => child.localName === "rPr")).toBe(true);
    }
  }
});
it("covers raw font name and size absence and replacement states", () => {
  for (const source of [null, "", '<w:rFonts/>', '<w:rFonts w:hAnsi="Sea"/>']) expect(new Font(owner("r", source)).name).toBeNull();
  expect(new Font(owner("r", '<w:rFonts w:ascii="Shore" w:hAnsi="Sea"/>')).name).toBe("Shore");
  for (const source of [null, "", '<w:rFonts w:ascii="Shore"/>']) for (const name of ["Marine", null]) {
    const font = new Font(owner("r", source)); font.name = name; expect(font.name).toBe(name);
  }
  for (const source of [null, ""]) expect(new Font(owner("r", source)).size).toBeNull();
  for (const source of [null, "", '<w:sz w:val="27"/>']) for (const value of [Pt(12), Pt(18), null]) {
    const font = new Font(owner("r", source)); if (source) expect(font.size?.pt).toBe(13.5);
    font.size = value; expect(font.size?.pt ?? null).toBe(value?.pt ?? null);
  }
});
it("covers underline raw absence, all representable symbols and transitions", () => {
  for (const source of [null, "", '<w:u/>']) expect(new Font(owner("r", source)).underline).toBeNull();
  for (const source of [null, '<w:u w:val="single"/>']) for (const value of [true, false, null, ...enumMembers("WD_UNDERLINE").filter(item => item.name !== "INHERITED")]) {
    const font = new Font(owner("r", source)); font.underline = value;
    expect(font.underline).toEqual(value && typeof value === "object" ? value.name === "SINGLE" ? true : value.name === "NONE" ? false : value : value);
  }
  expect(new Font(owner("r", '<w:u w:val="wave"/>')).underline).toEqual(WD_UNDERLINE.WAVY);
});
it("covers highlight raw default compatibility and every representable setter", () => {
  for (const source of [null, ""]) expect(new Font(owner("r", source)).highlight_color).toBeNull();
  expect(new Font(owner("r", '<w:highlight w:val="default"/>')).highlight_color).toEqual(WD_COLOR_INDEX.AUTO);
  for (const source of [null, "", '<w:highlight w:val="green"/>']) for (const value of [null, ...enumMembers("WD_COLOR_INDEX").filter(item => item.name !== "INHERITED")]) {
    const font = new Font(owner("r", source)); font.highlight_color = value; expect(font.highlight_color).toEqual(value);
  }
});
it("covers color raw type, RGB, theme, AUTO and cached RGB precedence", () => {
  const cases = [
    [null, null, null, null], ["", null, null, null], ['<w:color w:val="auto"/>', "AUTO", null, null],
    ['<w:color w:val="194A7D"/>', "RGB", "194A7D", null], ['<w:color w:themeColor="dark1"/>', "THEME", null, "DARK_1"],
    ['<w:color w:val="194A7D" w:themeColor="accent1"/>', "THEME", "194A7D", "ACCENT_1"],
    ['<w:color w:val="auto" w:themeColor="accent1"/>', "THEME", null, "ACCENT_1"]
  ] as const;
  for (const [source, type, rgb, theme] of cases) {
    const color = new Font(owner("r", source)).color;
    expect(color.type?.name ?? null).toBe(type); expect(color.rgb?.toString() ?? null).toBe(rgb); expect(color.theme_color?.name ?? null).toBe(theme);
  }
});
it("covers RGB and theme setter creation, replacement and clearing across raw states", () => {
  for (const source of [null, "", '<w:color w:val="auto"/>', '<w:color w:val="223355"/>', '<w:color w:val="223355" w:themeColor="dark1"/>']) {
    for (const rgb of [new RGBColor(9, 19, 29), new RGBColor(3, 6, 9), null]) {
      const color = new Font(owner("r", source)).color; color.rgb = rgb;
      expect(color.rgb?.toString() ?? null).toBe(rgb?.toString() ?? null); expect(color.theme_color).toBeNull();
    }
    for (const theme of [MSO_THEME_COLOR.ACCENT_1, MSO_THEME_COLOR.ACCENT_2, MSO_THEME_COLOR.LIGHT_2, null]) {
      const color = new Font(owner("r", source)).color; color.theme_color = theme;
      expect(color.theme_color).toEqual(theme);
      if (theme === null) expect(color.rgb).toBeNull();
      else if (source === null || source === "") expect(color.rgb?.toString()).toBe("000000");
      else expect(color.rgb?.toString() ?? null).toBe(source.includes("auto") ? null : "223355");
    }
  }
});
const pFlags = { keep_with_next: "keepNext", keep_together: "keepLines", page_break_before: "pageBreakBefore", widow_control: "widowControl" } as const;
it.each(Object.entries(pFlags) as [keyof typeof pFlags, string][])("covers all paragraph boolean raw/set states for %s", (name, tag) => {
  for (const lexical of [null, "", "1", "on", "true", "0", "off", "false"]) for (const value of [true, false, null]) {
    const format = new ParagraphFormat(owner("p", lexical === null ? null : lexical === "" ? "" : `<w:${tag} w:val="${lexical}"/>`));
    expect(format[name]).toBe(lexical === null || lexical === "" ? null : ["1", "on", "true"].includes(lexical));
    format[name] = value; expect(format[name]).toBe(value);
  }
});
it("covers paragraph alignment absence and all documented assignments", () => {
  for (const source of [null, "", '<w:jc w:val="center"/>']) for (const value of [null, ...enumMembers("WD_PARAGRAPH_ALIGNMENT")]) {
    const format = new ParagraphFormat(owner("p", source)); expect(format.alignment).toEqual(source ? WD_PARAGRAPH_ALIGNMENT.CENTER : null);
    format.alignment = value; expect(format.alignment).toEqual(value);
  }
});
it("covers paragraph indent and before/after spacing absence, signed zero and clearing", () => {
  for (const [name, tag, attribute] of [["left_indent", "ind", "left"], ["right_indent", "ind", "right"], ["first_line_indent", "ind", "firstLine"], ["space_before", "spacing", "before"], ["space_after", "spacing", "after"]] as const) {
    for (const source of [null, "", `<w:${tag}/>`, `<w:${tag} w:${attribute}="240"/>`]) for (const value of [Pt(36), ...(tag === "ind" ? [Pt(-3)] : []), Twips(0), null]) {
      const format = new ParagraphFormat(owner("p", source)); expect(format[name]?.twips ?? null).toBe(source?.includes("240") ? 240 : null);
      format[name] = value; expect(format[name]?.twips ?? null).toBe(value?.twips ?? null);
    }
  }
  for (const [raw, expected] of [["-06.3pt", -6.3], ["-4.2pt", -4.2]] as const) {
    const format = new ParagraphFormat(owner("p", `<w:ind w:left="${raw}" w:right="${raw}"/>`)); expect(format.left_indent?.pt).toBe(expected); expect(format.right_indent?.pt).toBe(expected);
  }
  for (const value of [Pt(18), Pt(-18), null]) { const format = new ParagraphFormat(owner("p", '<w:ind w:hanging="240"/>')); expect(format.first_line_indent?.pt).toBe(-12); format.first_line_indent = value; expect(format.first_line_indent?.pt ?? null).toBe(value?.pt ?? null); }
});
it("covers raw line spacing and line rules with all setters and at-least retention", () => {
  for (const source of [null, "", '<w:spacing/>']) { const format = new ParagraphFormat(owner("p", source)); expect(format.line_spacing).toBeNull(); expect(format.line_spacing_rule).toBeNull(); }
  for (const [attrs, line, rule] of [['w:line="240"', 1, "SINGLE"], ['w:line="360"', 1.5, "ONE_POINT_FIVE"], ['w:line="480"', 2, "DOUBLE"], ['w:line="420"', 1.75, "MULTIPLE"], ['w:lineRule="auto"', null, "MULTIPLE"], ['w:line="840" w:lineRule="exact"', 42, "EXACTLY"], ['w:line="840" w:lineRule="atLeast"', 42, "AT_LEAST"], ['w:lineRule="exact"', null, "EXACTLY"], ['w:lineRule="atLeast"', null, "AT_LEAST"]] as const) {
    const format = new ParagraphFormat(owner("p", `<w:spacing ${attrs}/>`)), spacing = format.line_spacing;
    expect(typeof spacing === "object" && spacing !== null ? spacing.pt : spacing).toBe(line); expect(format.line_spacing_rule?.name).toBe(rule);
    for (const value of [1, 2, 1.75, Pt(42), null]) { format.line_spacing = value; expect(typeof format.line_spacing === "object" ? format.line_spacing?.pt ?? null : format.line_spacing).toBe(typeof value === "object" ? value?.pt ?? null : value); }
  }
  for (const source of [null, '<w:spacing w:line="280" w:lineRule="exact"/>']) for (const value of [...enumMembers("WD_LINE_SPACING"), null]) {
    const format = new ParagraphFormat(owner("p", source)); format.line_spacing_rule = value;
    expect(format.line_spacing_rule?.name ?? null).toBe(value?.name ?? (source ? "MULTIPLE" : null));
  }
  const format = new ParagraphFormat(owner("p", '<w:spacing w:line="240" w:lineRule="atLeast"/>')); format.line_spacing = Pt(42); expect(format.line_spacing_rule).toEqual(WD_LINE_SPACING.AT_LEAST);
});
it("covers tab getter defaults, alignment/leader replacements, stable movement and clearing", () => {
  for (const align of ["left", "right"]) for (const leader of [null, "none", "dot"]) {
    const tabs = new ParagraphFormat(owner("p", `<w:tabs><w:tab w:pos="720" w:val="${align}"${leader === null ? "" : ` w:leader="${leader}"`}/></w:tabs>`)).tab_stops, stop = tabs.at(0);
    expect(stop.position.twips).toBe(720); expect(stop.alignment.name).toBe(align.toUpperCase()); expect(stop.leader.name).toBe(leader === "dot" ? "DOTS" : "SPACES");
    for (const value of [WD_TAB_ALIGNMENT.RIGHT, WD_TAB_ALIGNMENT.LEFT]) { stop.alignment = value; expect(stop.alignment).toEqual(value); }
    for (const value of [WD_TAB_LEADER.DOTS, WD_TAB_LEADER.DASHES, WD_TAB_LEADER.SPACES, null]) { stop.leader = value; expect(stop.leader).toEqual(value ?? WD_TAB_LEADER.SPACES); }
  }
  for (const value of [-20, 0, 40, 80, 120]) {
    const tabs = new ParagraphFormat(owner("p", '<w:tabs><w:tab w:pos="0" w:val="left"/><w:tab w:pos="40" w:val="left"/><w:tab w:pos="80" w:val="left"/></w:tabs>')).tab_stops, moving = tabs.at(1);
    moving.position = Twips(value); expect(moving.position.twips).toBe(value); expect([...tabs].map(stop => stop.position.twips)).toEqual([0, 80, value].sort((a, b) => a - b));
    tabs.clear_all(); expect(tabs.length).toBe(0); expect(() => moving.position).toThrow(RangeError);
  }
});
it("rejects nonrepresentable formatting sentinels and malformed direct enum XML atomically", () => {
  const backing = owner("r", null), font = new Font(backing), before = backing.getXml();
  expect(() => { font.underline = WD_UNDERLINE.INHERITED; }).toThrow();
  expect(() => { font.highlight_color = WD_COLOR_INDEX.INHERITED; }).toThrow();
  expect(() => { font.color.theme_color = MSO_THEME_COLOR.NOT_THEME_COLOR; }).toThrow();
  expect(backing.getXml()).toBe(before);
  expect(() => new Font(owner("r", '<w:color w:themeColor="UNMAPPED"/>')).color.theme_color).toThrow(TypeError);
  expect(() => new Font(owner("r", '<w:u w:val="unmapped"/>')).underline).toThrow(TypeError);
});
