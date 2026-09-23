import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, inspectDocument, replaceDocumentXmlPart, writeArchive, createDocxInspectionCommandEngine } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const enc = (text: string) => new TextEncoder().encode(text);
const codecs = ["utf8", "bom", "utf16le", "utf16be"] as const;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process", "nested"] as const)
for (const placement of ["font", "embedding", "both"] as const) for (const codec of codecs)
for (const dryRun of [false, true]) for (const route of ["sdk", "shell"] as const)
it(`${route} rejects embedded-font subset mutation in ${placement}/${carrier}/${codec}; ${kind} strict=${strict} dryRun=${dryRun}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const wrap = (xml: string): string => carrier === "direct" ? xml : carrier === "process" ? `<f:bridge>${xml}</f:bridge>` : carrier === "nested" ? `<f:bridge><mc:AlternateContent><mc:Choice Requires="w">${xml}</mc:Choice><mc:Fallback><f:kept/></mc:Fallback></mc:AlternateContent></f:bridge>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? xml : "<f:kept/>"}</mc:Choice><mc:Fallback>${carrier === "fallback" ? xml : "<f:kept/>"}</mc:Fallback></mc:AlternateContent>`;
  const embedding = '<w:embedRegular r:id="font" w:fontKey="{12345678-1234-1234-1234-123456789ABC}" w:subsetted="1"/>';
  const font = `<w:font w:name="Coastal Serif">${placement === "font" ? embedding : wrap(embedding)}<!--retained font--></w:font>`;
  const source = `<?xml version="1.0" encoding="${codec.startsWith("utf16") ? "UTF-16" : "UTF-8"}"?><?audit retained?><w:fonts xmlns:w="${w}" xmlns:r="${r}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:coastal:future" mc:Ignorable="f" mc:ProcessContent="f:bridge">${placement === "embedding" ? font : wrap(font)}</w:fonts><!--after-->`;
  const encode = (xml: string) => codec === "utf8" ? enc(xml) : codec === "bom" ? Uint8Array.from([239, 187, 191, ...enc(xml)]) : new Uint8Array(codec === "utf16le" ? Buffer.from("\ufeff" + xml, "utf16le") : Buffer.from("\ufeff" + xml, "utf16le").swap16());
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Retained body</w:t></w:r></w:p>', {}, strict));
  parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`).replace("</Types>", '<Override PartName="/resources/fonts.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml;Audit=Coast"/><Override PartName="/resources/font.bin" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont;Audit=Coast"/></Types>')));
  parts.set("resources/fonts.xml", encode(source));
  parts.set("resources/font.bin", Uint8Array.of(0, 1, 2, 253));
  parts.set("resources/_rels/fonts.xml.rels", enc(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="font" Type="${r}/font" Target="font.bin"/></Relationships>`));
  const memory = Volume.fromJSON({ "/input": "", "/output": "", "/copy": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), replacement = encode(source.replace('w:subsetted="1"', 'w:subsetted="0"'));
  const report = await inspectDocument(input, textContext);
  expect(report.fontResources.fontTables[0]!.fonts[0]!.embedded[0]).toMatchObject({ subsetted: "1", target: "/resources/font.bin", status: "resolved" });
  if (route === "sdk") {
    await expect(replaceDocumentXmlPart(input, replacement, { part: "/resources/fonts.xml", dryRun, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } })).rejects.toMatchObject({ code: "unsupported-edit", message: expect.stringContaining("Embedded font") });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/replacement", replacement); await fs.writeFile("/output", enc("Existing destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(`docx xml set /input --part /resources/fonts.xml --file /replacement --output /output --force --json${dryRun ? " --dry-run" : ""}`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit", message: expect.stringContaining("Embedded font") }] });
      expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/output")).toEqual(enc("Existing destination"));
    } finally { await shell.dispose(); }
  }
  expect(memory.readFileSync("/output")).toHaveLength(0);
  const model = await Document(input, textContext); await model.save({ async write(bytes) { memory.appendFileSync("/copy", bytes); } });
  expect(readPackage(new Uint8Array(memory.readFileSync("/copy") as Buffer))).toEqual(parts);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
