import "safe-bash-docx-engine";
import {expect, it} from "vitest";
import {readZipArchiveEntries} from "@poe-code/office-package/zip-sync";
import {DocumentXmlEditor} from "safe-bash-docx-engine/pandoc-adapter";
import {convert} from "./engine.js";

it.each([
  ["- one\n- two", [true, true]],
  ["- `one`\n- two", [true, true]],
  ["3. one\n4. two", [true, true]],
  ["- one\n\n- two", [false, false]],
  ["3. one\n\n4. two", [false, false]],
  ["- outer\n  - inner\n- sibling", [true, true, true]],
  ["- outer\n\n  - inner\n\n- sibling", [false, true, false]],
] as const)("preserves DOCX list paragraph tightness: %s", async (markdown, compact) => {
  const output = await convert([{bytes: new TextEncoder().encode(markdown)}], {from: "markdown", to: "docx"}, {});
  if (output.kind !== "binary") throw new Error("Expected DOCX");
  const parts = readZipArchiveEntries(output.bytes);
  const document = new DocumentXmlEditor(parts.get("word/document.xml")!);
  const paragraphs = document.root.children.find(child => child.localName === "body")!.children.filter(child => child.localName === "p");
  expect(paragraphs.map(p => p.children.find(child => child.localName === "pPr")?.children.some(child => child.localName === "pStyle" && document.sourceXml(child).includes('w:val="Compact"')) ?? false)).toEqual(compact);
  if (compact.some(Boolean)) {
    const styles = new DocumentXmlEditor(parts.get("word/styles.xml")!);
    const style = styles.root.children.find(child => styles.sourceXml(child).includes('w:styleId="Compact"'));
    expect(style).toBeDefined();
    expect(styles.sourceXml(style!)).toContain('<w:name w:val="Compact"/>');
    expect(styles.sourceXml(style!)).toContain('<w:spacing w:before="0" w:after="0"/>');
  }
});
