import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const fontFlags = ["all_caps", "bold", "complex_script", "cs_bold", "cs_italic", "double_strike", "emboss", "hidden", "imprint", "italic", "math", "no_proof", "outline", "rtl", "shadow", "small_caps", "snap_to_grid", "spec_vanish", "strike", "web_hidden", "superscript", "subscript"];
const cases: readonly { owner: "font" | "paragraph" | "color" | "tab"; member: string; wrong: unknown }[] = [
 ...fontFlags.map(member => ({ owner: "font" as const, member, wrong: "false" })),
 { owner: "font", member: "name", wrong: false }, { owner: "font", member: "size", wrong: 12 },
 { owner: "font", member: "underline", wrong: "single" }, { owner: "font", member: "highlight_color", wrong: "YELLOW" },
 ...["keep_with_next", "keep_together", "widow_control", "page_break_before"].map(member => ({ owner: "paragraph" as const, member, wrong: "false" })),
 { owner: "paragraph", member: "alignment", wrong: "CENTER" }, { owner: "paragraph", member: "line_spacing_rule", wrong: "SINGLE" },
 { owner: "paragraph", member: "line_spacing", wrong: "1" },
 ...["left_indent", "right_indent", "first_line_indent", "space_before", "space_after"].map(member => ({ owner: "paragraph" as const, member, wrong: 12 })),
 { owner: "color", member: "rgb", wrong: "AABBCC" }, { owner: "color", member: "theme_color", wrong: "ACCENT_1" },
 { owner: "tab", member: "position", wrong: "12pt" }, { owner: "tab", member: "alignment", wrong: "CENTER" }, { owner: "tab", member: "leader", wrong: "DOTS" }
];
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
 for (const { owner, member, wrong } of cases)
 it(`raises the neutral wrong-type class for native ${owner}.${member}; ${kind}; strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:pPr><w:keepNext/><w:tabs><w:tab w:pos="720" w:val="center" w:leader="dot"/></w:tabs></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>Retain é 日本 עברית 🌊</w:t></w:r><!--retain--><?policy keep?></w:p>');
  const doc = await api.Document(input, textContext), paragraph = doc.paragraphs[0]!, font = paragraph.runs[0]!.font;
  const target = owner === "font" ? font : owner === "paragraph" ? paragraph.paragraph_format : owner === "color" ? font.color : paragraph.paragraph_format.tab_stops.at(0), before = doc.part.blob;
  expect(() => { Reflect.set(target, member, wrong); }).toThrow(api.InputTypeError); expect(doc.part.blob).toEqual(before);
  const memory = Volume.fromJSON({ "/out": "" }); await doc.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } });
  expect(readPackage(new Uint8Array(memory.readFileSync("/out") as Buffer))).toEqual(readPackage(input));
  expect(paragraph.text).toBe("Retain é 日本 עברית 🌊"); expect(font.italic).toBe(true);
 });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
 for (const wrong of ["missing position", "string position", "string alignment", "string leader"] as const)
 it(`raises the neutral wrong-type class on native tab addition: ${wrong}; ${kind}; strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:pPr><w:tabs><w:tab w:pos="720" w:val="center" w:leader="dot"/></w:tabs></w:pPr><w:r><w:t>Retain é 日本 עברית 🌊</w:t></w:r></w:p>');
  const doc = await api.Document(input, textContext), tabs = doc.paragraphs[0]!.paragraph_format.tab_stops, before = doc.part.blob;
  const arguments_ = wrong === "missing position" ? [] : wrong === "string position" ? ["12pt"] : wrong === "string alignment" ? [api.Pt(12), "LEFT"] : [api.Pt(12), undefined, "DOTS"];
  expect(() => Reflect.apply(tabs.add_tab_stop, tabs, arguments_)).toThrow(api.InputTypeError);
  expect(doc.part.blob).toEqual(before); expect(tabs.length).toBe(1); expect(tabs.at(0).position.twips).toBe(720);
  const memory = Volume.fromJSON({ "/out": "" }); await doc.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } });
  expect(readPackage(new Uint8Array(memory.readFileSync("/out") as Buffer))).toEqual(readPackage(input));
 });
