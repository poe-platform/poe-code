import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

for (const strict of [false, true]) for (const carrier of ["direct", "choice", "fallback", "process"] as const) for (const variant of ["note-policy", "annotations", "inert-payload"] as const) for (const route of ["sdk", "shell", "sdk-batch", "shell-batch"] as const) for (const caret of [0, 2, 4])
 it(`${route} moves complete ${variant} section through ${carrier} to scalar suffix ${caret}; strict=${strict}`, async () => {
  const policy = '<w:footnotePr><w:pos w:val="beneathText"/><w:numFmt w:val="lowerRoman"/><w:numStart w:val="0"/><w:numRestart w:val="eachSect"/></w:footnotePr><w:endnotePr><w:pos w:val="sectEnd"/><w:numFmt w:val="upperLetter"/><w:numStart w:val="2"/><w:numRestart w:val="continuous"/></w:endnotePr>';
  const contents = variant === "note-policy" ? policy : variant === "annotations" ? '<!--section-history--><?original retain?><w:pgSz w:w="12240" w:h="15840"/>' : '<w:pgSz w:w="12240" w:h="15840"/><f:opaque f:identity="section-owned"><f:nested/></f:opaque>';
  const section = `<w:sectPr${variant === "inert-payload" ? ' f:policy="preserve"' : ""}><w:headerReference w:type="default" r:id="header"/>${contents}</w:sectPr>`;
  const wrap = (active: string) => carrier === "direct" ? active : carrier === "process" ? `<f:pass>${active}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : '<w:keepLines/>'}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : '<w:keepLines/>'}</mc:Fallback></mc:AlternateContent>`;
  const body = `<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:transferred-section" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:pPr><w:keepNext/>${wrap(section)}</w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t>c🌊st</w:t></w:r></w:p>`;
  const input = await textFixture(body, { header: { kind: "header", xml: `<w:hdr xmlns:w="${w}"><w:p><w:r><w:t>Retained section header</w:t></w:r></w:p></w:hdr>` } }, strict), locations = await api.openDocumentLocations(input, textContext), select = locations.range(locations.at("paragraph", 1).token, caret, caret).token, memory = Volume.fromJSON({ "/out": "" });
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
