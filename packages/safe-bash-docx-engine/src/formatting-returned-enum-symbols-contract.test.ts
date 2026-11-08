import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";
const enc = (text: string) => new TextEncoder().encode(text);
const cases = [
  ["underline", "WD_UNDERLINE", "DOUBLE", 3, "double"],
  ["highlight", "WD_COLOR_INDEX", "YELLOW", 7, "yellow"],
  ["alignment", "WD_PARAGRAPH_ALIGNMENT", "CENTER", 1, "center"],
  ["spacing-rule", "WD_LINE_SPACING", "EXACTLY", 4, "exact"],
  ["tab-alignment", "WD_TAB_ALIGNMENT", "RIGHT", 2, "right"],
  ["tab-leader", "WD_TAB_LEADER", "DOTS", 1, "dot"],
  ["theme", "MSO_THEME_COLOR", "ACCENT_1", 5, "accent1"],
  ["color-type", "MSO_COLOR_TYPE", "THEME", 2, undefined]
] as const;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const placement of ["container", "leaf"] as const) for (const [property, family, name, number, xml] of cases)
it(`native returned ${property} is an immutable nominal enum with stable value/string/XML protocols; ${carrier}; ${placement}; ${kind}; strict=${strict}`, async () => {
  const wrap = (text: string) => carrier === "direct" ? text : carrier === "process" ? `<f:pass>${text}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? text : ""}</mc:Choice><mc:Fallback>${carrier === "fallback" ? text : ""}</mc:Fallback></mc:AlternateContent>`;
  const properties = ['<w:jc w:val="center"/>', '<w:spacing w:line="360" w:lineRule="exact"/>', '<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="240"/></w:tabs>'], runProperties = ['<w:u w:val="double"/>', '<w:highlight w:val="yellow"/>', '<w:color w:val="123456" w:themeColor="accent1"/>'];
  const paragraph = `<w:p>${wrap(`<w:pPr>${properties.map(p => placement === "leaf" ? wrap(p) : p).join("")}</w:pPr>`)}<w:r>${wrap(`<w:rPr>${runProperties.map(p => placement === "leaf" ? wrap(p) : p).join("")}</w:rPr>`)}<w:t>Retain é 日本 עברית 🌊</w:t></w:r><!--retain--><?policy keep?></w:p>`;
  const parts = readPackage(await textFixture(`<f:pass xmlns:f="urn:original:returned-enums" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:pass">${paragraph}</f:pass>`, {}, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const v = Volume.fromJSON({ "/input": "", "/out": "" }); await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { v.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(v.readFileSync("/input") as Buffer), d = await api.Document(input, textContext), p = d.paragraphs[0]!, font = p.runs[0]!.font, f = p.paragraph_format;
  const value = property === "underline" ? font.underline : property === "highlight" ? font.highlight_color : property === "alignment" ? f.alignment : property === "spacing-rule" ? f.line_spacing_rule : property === "tab-alignment" ? f.tab_stops.at(0).alignment : property === "tab-leader" ? f.tab_stops.at(0).leader : property === "theme" ? font.color.theme_color : font.color.type;
  expect(value).toEqual({ enum: family, name }); expect(Object.isFrozen(value)).toBe(true);
  const symbol = value as NonNullable<Exclude<typeof value, boolean>> & { readonly value: number; readonly xml_value?: string | null };
  expect(symbol.value).toBe(number); expect(symbol.toString()).toBe(`${name} (${number})`); expect(symbol.xml_value).toBe(xml); expect(api.enumValue(symbol)).toBe(number); expect(() => Number(symbol)).toThrow(api.InputTypeError);
  expect(Reflect.set(symbol, "name", "FORGED")).toBe(false); expect(symbol.name).toBe(name);
  await d.save({ async write(bytes) { v.appendFileSync("/out", bytes); } }); const saved = readPackage(new Uint8Array(v.readFileSync("/out") as Buffer)); assertPackageLinks(saved); expect(saved).toEqual(parts); expect(v.readFileSync("/input")).toEqual(Buffer.from(input)); expect(d.paragraphs[0]!.text).toBe("Retain é 日本 עברית 🌊");
});

for (const strict of [false, true]) for (const [markup, expected] of [['<w:u w:val="single"/>', true], ['<w:u w:val="none"/>', false], ["", null]] as const)
it(`native underline ${String(expected)} remains its distinct boolean/null state; strict=${strict}`, async () => {
  const input = await textFixture(`<w:p><w:r><w:rPr>${markup}</w:rPr><w:t>Retain</w:t></w:r></w:p>`, {}, strict), d = await api.Document(input, textContext); expect(d.paragraphs[0]!.runs[0]!.font.underline).toBe(expected);
});
