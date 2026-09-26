import { expect, it } from "vitest";
import { parseXmlSteps, type XmlElement } from "@poe-code/safe-fs/xml";
import type { CapabilityContext } from "../contracts.js";
import { readXlsxStyles, readXlsxString } from "./xlsx-styles.js";

const ss = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 3, operations: 1000 } };
function xml(source: string): XmlElement {
  const parser = parseXmlSteps(source); let step = parser.next(); while (!step.done) step = parser.next(); return step.value;
}
it("maps measured native font, fill, border, alignment, protection and builtin date style", async () => {
  const root = xml(`<styleSheet xmlns="${ss}"><fonts><font><name val="Liberation Sans"/><sz val="12"/><b/><i/><u val="doubleAccounting"/><strike/><vertAlign val="superscript"/><color rgb="00112233"/></font></fonts><fills><fill><patternFill patternType="solid"><fgColor rgb="FFABCDEF"/><bgColor rgb="FF445566"/></patternFill></fill></fills><borders><border><left style="thin"><color rgb="FF010203"/></left></border></borders><cellXfs><xf fontId="0" fillId="0" borderId="0" numFmtId="14"><alignment horizontal="center" vertical="top" textRotation="120" wrapText="1" indent="2" shrinkToFit="1"/><protection locked="0" hidden="1"/></xf></cellXfs></styleSheet>`);
  const styles = await readXlsxStyles(root, undefined, context);
  expect(styles[0]!.format).toBe("[$-f8f2]m/d/yy");
  const record = styles[0]!.style.gnumeric as { attributes: readonly { name: string; value: string }[]; children: readonly unknown[] };
  expect(Object.fromEntries(record.attributes.map(a => [a.name, a.value]))).toMatchObject({ HAlign: "GNM_HALIGN_CENTER", VAlign: "GNM_VALIGN_TOP", WrapText: "1", ShrinkToFit: "1", Rotation: "330", Shade: "1", Indent: "2", Locked: "0", Hidden: "1", Fore: "1111:2222:3333", Back: "ABAB:CDCD:EFEF", PatternColor: "4444:5555:6666" });
  expect(record.children).toMatchObject([{ name: "Font", text: "Liberation Sans", attributes: [{ name: "Unit", value: "12" }, { name: "Bold", value: "1" }, { name: "Italic", value: "1" }, { name: "Underline", value: "4" }, { name: "StrikeThrough", value: "1" }, { name: "Script", value: "1" }] }, { name: "StyleBorder", children: [{ name: "Left", attributes: [{ name: "Style", value: "1" }, { name: "Color", value: "101:202:303" }] }] }]);
});
it("matches native UTF8 rich offsets, family handler, size clamp and markup spellings", () => {
  const result = readXlsxString(xml(`<si xmlns="${ss}"><r><rPr><rFont val="IgnoredFont"/><family val="NativeFamily"/><sz val="2000"/><b/><u val="doubleAccounting"/><color rgb="FF010203"/></rPr><t>é😀</t></r><r><rPr><i val="0"/></rPr><t>z</t></r></si>`), context);
  expect(result).toEqual({ value: "é😀z", richText: [{ start: 0, end: 6, attributes: { family: "NativeFamily", size: 1024000, bold: 1, underline: "low", color: "01x02x03" } }, { start: 6, end: 7, attributes: { italic: 0 } }] });
});
it("ignores attempts to redefine native builtin number formats", async () => {
  const messages: string[] = [];
  const styles = await readXlsxStyles(xml(`<styleSheet xmlns="${ss}"><numFmts><numFmt numFmtId="2" formatCode="0.000"/></numFmts><cellXfs><xf numFmtId="2"/></cellXfs></styleSheet>`), undefined, { ...context, async diagnostic(d) { messages.push(d.message); } });
  expect(styles[0]!.format).toBe("0.00");
  expect(messages).toEqual(["Ignoring attempt to override number format 2"]);
});
it("inherits omitted font and format from the referenced parent XF", async () => {
  const root = xml(`<styleSheet xmlns="${ss}"><fonts><font><name val="Inherited"/><sz val="17"/></font></fonts><cellStyleXfs><xf fontId="0" numFmtId="2"/></cellStyleXfs><cellXfs><xf xfId="0"/></cellXfs></styleSheet>`);
  const result = await readXlsxStyles(root, undefined, context);
  expect(result[0]!.format).toBe("0.00");
  expect(result[0]!.style.gnumeric).toMatchObject({ children: [{ name: "Font", text: "Inherited", attributes: [{ name: "Unit", value: "17" }, { name: "Bold", value: "0" }, { name: "Italic", value: "0" }, { name: "Underline", value: "0" }, { name: "StrikeThrough", value: "0" }, { name: "Script", value: "0" }] }] });
});
it("resolves theme color indices by native named order and integer HSL tint", async () => {
  const theme = xml('<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:accent1><a:srgbClr val="010203"/></a:accent1></a:clrScheme></a:themeElements></a:theme>');
  const root = xml(`<styleSheet xmlns="${ss}"><fonts><font><color theme="1" tint="0.5"/></font></fonts><cellXfs><xf fontId="0"/></cellXfs></styleSheet>`);
  const result = await readXlsxStyles(root, theme, context);
  expect(result[0]!.style.gnumeric).toMatchObject({ attributes: expect.arrayContaining([{ name: "Fore", namespace: "", value: "7F7F:7F7F:7F7F" }]) });
});
