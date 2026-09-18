import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

for (const strict of [false, true]) for (const carrier of ["direct", "choice", "fallback", "process"] as const) for (const variant of ["review-snapshot", "printer-binding"] as const) for (const route of ["sdk", "shell", "sdk-batch", "shell-batch"] as const) for (const caret of [0, 2, 4])
 it(`${route} moves complete ${variant} section through ${carrier} to scalar suffix ${caret}; strict=${strict}`, async () => {
  const ignoredPolicy = '<w:footnotePr><w:pos w:val="beneathText"/><w:numFmt w:val="lowerRoman"/><w:numStart w:val="0"/><w:numRestart w:val="eachSect"/></w:footnotePr><w:endnotePr><w:pos w:val="sectEnd"/><w:numFmt w:val="upperLetter"/><w:numStart w:val="2"/><w:numRestart w:val="continuous"/></w:endnotePr>';
  const contents = variant === "review-snapshot" ? '<w:sectPrChange w:id="8" w:author="Original Reviewer" w:date="2026-01-02T03:04:06Z"><w:sectPr><w:pgSz w:w="10000" w:h="14000"/><w:pgMar w:top="720" w:bottom="720" w:left="720" w:right="720"/></w:sectPr></w:sectPrChange>' : '<w:printerSettings r:id="printer"/>';
  const section = `<w:sectPr xml:lang="ja-JP"><w:headerReference w:type="default" r:id="header"/><w:pgSz w:w="12240" w:h="15840"/>${contents}<!--retained-section--></w:sectPr>`;
  const wrap = (active: string) => carrier === "direct" ? active : carrier === "process" ? `<f:pass>${active}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : '<w:keepLines/>'}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : '<w:keepLines/>'}</mc:Fallback></mc:AlternateContent>`;
  const body = `<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:transferred-section" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:pPr><w:keepNext/>${wrap(section)}</w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t>c🌊st</w:t></w:r></w:p>`;
  const initial = await textFixture(body, { header: { kind: "header", xml: `<w:hdr xmlns:w="${w}"><w:p><w:r><w:t>Retained section header</w:t></w:r></w:p></w:hdr>` } }, strict);
  const parts = readPackage(initial), relPart = "word/_rels/document.xml.rels", typesPart = "[Content_Types].xml", relationNamespace = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  if (variant === "printer-binding") {
    parts.set(relPart, new TextEncoder().encode(new TextDecoder().decode(parts.get(relPart)).replace("</Relationships>", `<Relationship Id="printer" Type="${relationNamespace}/printerSettings" Target="printers/original.bin"/></Relationships>`)));
    parts.set(typesPart, new TextEncoder().encode(new TextDecoder().decode(parts.get(typesPart)).replace("</Types>", '<Override PartName="/word/printers/original.bin" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.printerSettings"/></Types>')));
    parts.set("word/printers/original.bin", new Uint8Array([0,255,11,7,9]));
  }
  const source = Volume.fromJSON({ "/input": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")})) }, {async write(bytes) {source.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(source.readFileSync("/input") as Buffer), locations = await api.openDocumentLocations(input, textContext), select = locations.range(locations.at("paragraph", 1).token, caret, caret).token, memory = Volume.fromJSON({ "/out": "" });
  const args = { select, text: "NEW" }, batch = { version: 1 as const, operations: [{ operation: "paragraphs.add" as const, arguments: args }] }, context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } } };
  if (route === "sdk") await api.editDocumentParagraphs(input, { operation: "paragraphs.add", options: { ...args, output: "-" } }, context);
  else if (route === "sdk-batch") await api.executeDocumentBatch(input, batch, { output: "-" }, context);
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const result = await shell.exec(route === "shell" ? `docx paragraphs add /input --select '${select}' --text NEW --output - > /out` : `docx batch /input --ops-json '${JSON.stringify(batch)}' --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); } }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after); for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const chars = [..."c🌊st"], doc = await api.Document(output, textContext); expect(doc.paragraphs.map(p => p.text)).toEqual([chars.slice(0, caret).join(""), "NEW", chars.slice(caret).join("")]); expect(doc.paragraphs[0]!.paragraph_format.keep_with_next).toBe(true); expect(doc.paragraphs[2]!.paragraph_format.keep_with_next).toBe(true);
  const xml = new TextDecoder().decode(after.get("word/document.xml")); expect(xml.split(section)).toHaveLength(2);
  const paragraphs = api.parseDocumentXml(after.get("word/document.xml")!, {}).root.children[0]!.children.filter(n => n.localName === "p");
  expect(xml.indexOf(section)).toBeGreaterThan(xml.indexOf("NEW")); expect(paragraphs).toHaveLength(3);
 });
