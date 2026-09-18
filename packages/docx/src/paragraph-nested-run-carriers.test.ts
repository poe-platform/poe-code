import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

for (const strict of [false, true]) for (const carrier of ["choice", "fallback", "process"] as const) for (const domain of ["text", "properties"] as const)
 for (const route of ["model", "sdk", "shell", "sdk-batch", "shell-batch"] as const) for (const text of ["🌊 é日本 العربية עברית\tA\nB", ""])
 it(`${route} paragraph assignment clears native nested ${domain} ${carrier} run carriers while retaining inert payload; text=${JSON.stringify(text)} strict=${strict}`, async () => {
  const properties = '<w:rPr><w:b/><w:rtl/><w:color w:val="224466"/></w:rPr>', content = '<w:t>Original coast</w:t>';
  const active = domain === "text" ? content : properties, inactive = (domain === "text" ? '<w:t>Inactive coast</w:t>' : '<w:rPr><w:i/></w:rPr>') + '<f:opaque f:identity="retained">Stored</f:opaque>';
  const wrapped = carrier === "process" ? `<f:pass>${active}</f:pass><f:opaque>${inactive}</f:opaque>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : inactive}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : inactive}</mc:Fallback></mc:AlternateContent>`;
  const input = await textFixture(`<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:paragraph-nested-carriers" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:pPr><w:keepNext/><w:bidi/></w:pPr><w:r>${domain === "text" ? properties + wrapped : wrapped + content}</w:r><w:r><w:rPr><w:i/></w:rPr><w:t> remove this ordinary run</w:t></w:r><!--retain paragraph--></w:p>`, {}, strict);
  const memory = Volume.fromJSON({ "/out": "" }), context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } } }, options = { paragraph: 1, text }, batch = { version: 1, operations: [{ id: "assign", operation: "paragraphs.set", arguments: options }] };
  if (route === "model") { const doc = await api.Document(input, textContext); if (text) doc.paragraphs[0]!.text = text; else doc.paragraphs[0]!.clear(); await doc.save(context.stdout); }
  else if (route === "sdk") await api.editDocumentParagraphs(input, { operation: "paragraphs.set", options: { ...options, output: "-" } }, context);
  else if (route === "sdk-batch") await api.executeDocumentBatch(input, batch, { output: "-" }, context);
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
   try { const path = route === "shell-batch" ? `batch /input --ops-json '${JSON.stringify(batch)}'` : `paragraphs set /input --paragraph 1 --text '${text}'`; const result = await shell.exec(`docx ${path} --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after); for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const p = (await api.Document(output, textContext)).paragraphs[0]!; expect(p.text).toBe(text); expect(p.paragraph_format.keep_with_next).toBe(true); expect(p.runs.every(run => run.bold === null && run.italic === null && run.font.rtl === null && run.font.color.rgb === null)).toBe(true);
  const xml = new TextDecoder().decode(after.get("word/document.xml")); for (const retained of [inactive, '<!--retain paragraph-->']) expect(xml.split(retained)).toHaveLength(2); expect(xml).not.toContain('remove this ordinary run');
 });
