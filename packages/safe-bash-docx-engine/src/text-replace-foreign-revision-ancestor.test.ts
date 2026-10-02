import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["document", "template"] as const)
for (const wrapper of ["del", "ins", "moveFrom", "moveTo"] as const)
for (const view of ["final", "original", "all"] as const) for (const route of ["sdk", "cli"] as const)
it(`${route} preserves replacement in a transparent foreign ${wrapper} ancestor; ${view} ${kind} strict=${strict}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const enc = (s: string) => new TextEncoder().encode(s);
  const selected = `<f:${wrapper}><w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Before é 🌊</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>日本 עברית after</w:t></w:r></w:p></f:${wrapper}>`;
  const outside = "<w:p><w:r><w:t>Outside retained</w:t></w:r></w:p>";
  const parts = new Map<string, Uint8Array>([
    ["[Content_Types].xml", enc(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="bin" ContentType="application/octet-stream"/><Override PartName="/reports/main.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}.main+xml"/></Types>`)],
    ["_rels/.rels", enc(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="${r}/officeDocument" Target="reports/main.xml"/></Relationships>`)],
    ["reports/main.xml", enc(`<w:document xmlns:w="${w}" xmlns:r="${r}" xmlns:f="urn:original:transparent" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:${wrapper}"><w:body>${selected}${outside}<!--retain--><?original keep?><w:sectPr/></w:body></w:document>`)],
    ["reports/_rels/main.xml.rels", enc('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="retain" Type="urn:original:retained" Target="../audit/opaque.bin"/></Relationships>')],
    ["audit/opaque.bin", new Uint8Array([0, 255, 10, 7])]
  ]);
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  expect((await api.validateDocument(input, textContext)).valid).toBe(true);
  expect((await api.extractDocumentText(input, textContext, { view })).text).toBe("Before é 🌊日本 עברית after\nOutside retained");
  expect((await api.Document(input, textContext)).paragraphs[0]!.text).toBe("Before é 🌊日本 עברית after");
  let output: Uint8Array;
  if (route === "sdk") {
    const result = await api.replaceDocumentText(input, { find: "é 🌊日本 עברית", with: "Lake 日本 🌊", all: true, view, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } });
    expect(result.changes.length).toBe(1);
    output = new Uint8Array(memory.readFileSync("/output") as Buffer);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/out", enc("Original destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(`docx text replace /input --find 'é 🌊日本 עברית' --with 'Lake 日本 🌊' --all --view ${view} --output /out --force --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      const envelope = JSON.parse(result.stdout); expect(envelope.ok).toBe(true); expect(envelope.affected).toBe(1); expect(envelope.errors).toEqual([]);
      output = await fs.readFile("/out"); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const saved = readPackage(output!); assertPackageLinks(saved); expect([...saved.keys()]).toEqual([...parts.keys()]);
  for (const [name, bytes] of parts) if (name !== "reports/main.xml") expect(saved.get(name), name).toEqual(bytes);
  const xml = new TextDecoder().decode(saved.get("reports/main.xml")); expect(xml).toContain(outside); expect(xml).toContain("<!--retain--><?original keep?>"); expect(xml).toContain(`<f:${wrapper}>`); expect(xml).toContain(`</f:${wrapper}>`);
  const document = await api.Document(output!, textContext), paragraph = document.paragraphs[0]!;
  expect(paragraph.text).toBe("Before Lake 日本 🌊 after"); expect(paragraph.paragraph_format.keep_with_next).toBe(true);
  expect(paragraph.runs[0]!.bold).toBe(true); expect(paragraph.runs[1]!.italic).toBe(true);
  expect((await api.extractDocumentText(output!, textContext, { view })).text).toBe("Before Lake 日本 🌊 after\nOutside retained");
  expect((await api.validateDocument(output!, textContext)).valid).toBe(true); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
