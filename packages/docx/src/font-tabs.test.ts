import { expect, it } from "vitest";
import { Volume } from "memfs";
import { DocumentXmlEditor } from "./xml-write.js";
import { formattedRunProperties } from "./run-properties.js";
import { paragraphProperties } from "./paragraph-properties.js";
import { parseDocumentXml } from "./package-xml.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { w } from "../tests/fixtures/text.js";

const flags = { allCaps: "caps", bold: "b", complexScriptEnabled: "cs", csBold: "bCs", csItalic: "iCs", doubleStrike: "dstrike", emboss: "emboss", hidden: "vanish", imprint: "imprint", italic: "i", math: "oMath", noProof: "noProof", outline: "outline", rtl: "rtl", shadow: "shadow", smallCaps: "smallCaps", snapToGrid: "snapToGrid", specVanish: "specVanish", strike: "strike", webHidden: "webHidden" };
function format(source: string, options: DocxOperationArguments<"runs.set">) {
  const volume = Volume.fromJSON({ "/run.xml": `<w:r xmlns:w="${w}">${source}<w:t>Bay</w:t></w:r>` });
  const editor = new DocumentXmlEditor(new Uint8Array(volume.readFileSync("/run.xml") as Buffer));
  return formattedRunProperties(editor, editor.root, options);
}
it.each(Object.entries(flags))("preserves three-state %s and unrelated properties", (key, tag) => {
  for (const value of [true, false, null]) {
    for (const old of ["", `<w:${tag}/>`, ...["0", "1", "on", "off", "true", "false", "invalid"].map(lexical => `<w:${tag} w:val="${lexical}"/>`)]) {
      const xml = format(`<w:rPr>${old}<w:color w:val="214365"/><!--kept--></w:rPr>`, { [key]: value });
      const props = parseDocumentXml(new TextEncoder().encode(`<w:r xmlns:w="${w}">${xml}</w:r>`)).root.children[0]!;
      const node = props.children.find(c => c.localName === tag);
      expect(node !== undefined).toBe(value !== null);
      if (node) expect(["1", "on", "true"].includes(node.attributes.find(a => a.localName === "val")?.value ?? "1")).toBe(value);
      expect(xml).toContain('<w:color w:val="214365"/>');
      expect(xml).toContain("<!--kept-->");
    }
  }
});
function tabs(source: string, options: DocxOperationArguments<"paragraphs.set">) {
  const volume = Volume.fromJSON({ "/paragraph.xml": `<w:p xmlns:w="${w}"><w:pPr>${source}</w:pPr><w:r><w:t>Bay</w:t></w:r></w:p>` });
  const editor = new DocumentXmlEditor(new Uint8Array(volume.readFileSync("/paragraph.xml") as Buffer));
  const xml = paragraphProperties(editor, editor.root, options);
  const root = parseDocumentXml(new TextEncoder().encode(`<w:p xmlns:w="${w}">${xml}</w:p>`)).root.children[0]!;
  const container = root.children.find(c => c.localName === "tabs");
  return { xml, container, positions: container?.children.filter(c => c.localName === "tab").map(c => c.attributes.find(a => a.localName === "pos")?.value) ?? [] };
}
const stops = '<w:tabs><!--keep--><w:tab w:pos="-40" w:val="left"/><w:tab w:pos="100" w:val="right"/><w:tab w:pos="300" w:val="decimal"/></w:tabs><w:keepNext/>';
it.each([-80, -40, 0, 100, 400])("inserts a tab at %s twips without replacing existing stops", position => {
  const result = tabs(stops, { tabStopAdd: { position: { value: position, unit: "twip" } } });
  expect(result.positions).toEqual([-40, 100, 300, position].sort((a, b) => a - b).map(String));
  expect(result.xml).toContain('<!--keep-->');
  expect(result.xml).toContain('<w:tab w:pos="100" w:val="right"/>');
});
it.each([0, 1, 2, -1, -3])("deletes exactly one zero-based tab index %s", index => {
  const expected = ["-40", "100", "300"]; expected.splice(index, 1);
  expect(tabs(stops, { tabStopDelete: index }).positions).toEqual(expected);
});
it.each([3, -4])("rejects a missing tab index %s", index => {
  expect(() => tabs(stops, { tabStopDelete: index })).toThrow("Tab stop index is out of range.");
});
it("removes the last tab container and clears an absent or populated collection", () => {
  expect(tabs('<w:tabs><w:tab w:pos="0" w:val="left"/></w:tabs>', { tabStopDelete: 0 }).container).toBeUndefined();
  expect(tabs(stops, { tabStopsClear: true }).container).toBeUndefined();
  expect(tabs("", { tabStopsClear: true }).container).toBeUndefined();
  expect(() => tabs("", { tabStopDelete: 0 })).toThrow("Tab stop index is out of range.");
});
it("inserts into an absent collection with default alignment and leader", () => {
  const result = tabs("", { tabStopAdd: { position: { value: -1, unit: "pt" } } });
  expect(result.positions).toEqual(["-20"]);
  expect(result.container!.children[0]!.attributes.filter(a => a.namespace === w).map(a => [a.localName, a.value])).toEqual([["pos", "-20"], ["val", "left"], ["leader", "none"]]);
});
it("keeps opaque content when deleting its neighboring final tab", () => {
  const result = tabs('<w:tabs><!--evidence--><w:tab w:pos="0" w:val="left"/></w:tabs>', { tabStopDelete: 0 });
  expect(result.positions).toEqual([]);
  expect(result.xml).toContain("<!--evidence-->");
});
it("does not clear tabs when the clear switch is false", () => {
  expect(tabs(stops, { tabStopsClear: false }).positions).toEqual(["-40", "100", "300"]);
});
it("rejects malformed tab positions even after the insertion point", () => {
  expect(() => tabs('<w:tabs><w:tab w:pos="100" w:val="left"/><w:tab w:pos="bad" w:val="left"/></w:tabs>', { tabStopAdd: { position: { value: 0, unit: "pt" } } })).toThrow("Malformed tab stop positions cannot be edited.");
});
