import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

for (const strict of [false, true]) for (const carrier of ["choice", "fallback", "process"] as const) for (const domain of ["runs", "properties"] as const)
 for (const route of ["model", "sdk", "shell", "sdk-batch", "shell-batch"] as const) for (const text of ["🌊 é日本 العربية עברית\tA\nB", ""])
 it(`${route} assigns paragraph ${domain} ${carrier} carrier and retains inactive content; text=${JSON.stringify(text)} strict=${strict}`, async () => {
  const props = '<w:pPr><w:keepNext/><w:bidi/><w:spacing w:after="180"/></w:pPr>', runs = '<w:r><w:rPr><w:b/><w:rtl/></w:rPr><w:t>Original</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t> coast</w:t></w:r>';
  const active = domain === "runs" ? runs : props, inactive = domain === "runs" ? '<w:r><w:t>Inactive coast</w:t></w:r>' : '<w:pPr><w:keepLines/></w:pPr>';
  const wrapped = carrier === "process" ? `<f:pass>${active}</f:pass><f:opaque>${inactive}</f:opaque>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : inactive}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : inactive}</mc:Fallback></mc:AlternateContent>`;
  const body = `<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:paragraph-carriers" mc:Ignorable="f" mc:ProcessContent="f:pass">${domain === "runs" ? props + wrapped : wrapped + runs}<w:bookmarkStart w:id="7" w:name="Coast"/><!--retain paragraph--><?review keep?><w:bookmarkEnd w:id="7"/></w:p>`;
  const input = await textFixture(body, {}, strict), memory = Volume.fromJSON({ "/out": "" }), context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } } };
  const options = { paragraph: 1, text }, batch = { version: 1, operations: [{ id: "assign", operation: "paragraphs.set", arguments: options }] };
  if (route === "model") { const doc = await api.Document(input, textContext); if (text) doc.paragraphs[0]!.text = text; else doc.paragraphs[0]!.clear(); await doc.save(context.stdout); }
  else if (route === "sdk") await api.editDocumentParagraphs(input, { operation: "paragraphs.set", options: { ...options, output: "-" } }, context);
  else if (route === "sdk-batch") await api.executeDocumentBatch(input, batch, { output: "-" }, context);
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
   try { const path = route === "shell-batch" ? `batch /input --ops-json '${JSON.stringify(batch)}'` : `paragraphs set /input --paragraph 1 --text '${text}'`; const result = await shell.exec(`docx ${path} --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after); for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const p = (await api.Document(output, textContext)).paragraphs[0]!; expect(p.text).toBe(text); expect(p.paragraph_format.keep_with_next).toBe(true); expect(p.paragraph_format.space_after?.pt).toBe(9); expect(p.runs.map(run => [run.bold, run.italic, run.font.rtl])).toEqual(text ? [[null, null, null]] : []);
  const xml = new TextDecoder().decode(after.get("word/document.xml")); for (const retained of [inactive, '<w:bookmarkStart w:id="7" w:name="Coast"/>', '<w:bookmarkEnd w:id="7"/>', '<!--retain paragraph-->', '<?review keep?>']) expect(xml.split(retained)).toHaveLength(2);
 });

for (const strict of [false, true]) for (const carrier of ["direct", "choice", "fallback", "process", "ignored"] as const) for (const active of [false, true])
 for (const route of ["model", "sdk", "shell", "sdk-batch", "shell-batch"] as const) for (const text of ["Changed", ""])
 it(`${route} paragraph assignment respects ${active ? "active" : "inert"} ${carrier} review range; text=${JSON.stringify(text)} strict=${strict}`, async () => {
  const wrap = (marker: string) => carrier === "direct" ? active ? marker : `<f:opaque>${marker}</f:opaque>` : carrier === "ignored" || carrier === "process" ? `<f:${active ? "pass" : "opaque"}>${marker}</f:${active ? "pass" : "opaque"}>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active ? marker : "" : active ? "" : marker}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active ? marker : "" : active ? "" : marker}</mc:Fallback></mc:AlternateContent>`;
  const body = wrap('<w:moveFromRangeStart w:id="7" w:name="Original range"/>') + '<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Original</w:t></w:r></w:p>' + wrap('<w:moveFromRangeEnd w:id="7"/>');
  const input0 = await textFixture(body, {}, strict), parts = readPackage(input0), name = "word/document.xml", xml = new TextDecoder().decode(parts.get(name));
  // Namespace declarations belong on the fixture root so body-level carriers are scoped.
  const rootXml = xml.replace('<w:document ', '<w:document xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:paragraph-review-ranges" mc:Ignorable="f" mc:ProcessContent="f:pass" ');
  const memory = Volume.fromJSON({ "/input": "", "/out": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([part, bytes]) => ({ name: part, bytes: part === name ? new TextEncoder().encode(rootXml) : bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } } }, options = { paragraph: 1, text }, batch = { version: 1, operations: [{ id: "assign", operation: "paragraphs.set", arguments: options }] };
  if (route === "model") { const doc = await api.Document(input, textContext); const assign = () => { doc.paragraphs[0]!.text = text; }; if (active) expect(assign).toThrowError(expect.objectContaining({ code: "unsupported-edit" })); else assign(); await doc.save(context.stdout); }
  else if (route === "sdk" || route === "sdk-batch") { const result = route === "sdk" ? api.editDocumentParagraphs(input, { operation: "paragraphs.set", options: { ...options, output: "-" } }, context) : api.executeDocumentBatch(input, batch, { output: "-" }, context); if (active) await expect(result).rejects.toMatchObject({ code: "unsupported-edit" }); else await result; }
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
   try { const path = route === "shell-batch" ? `batch /input --ops-json '${JSON.stringify(batch)}'` : `paragraphs set /input --paragraph 1 --text '${text}'`; const result = await shell.exec(`docx ${path} --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(active ? 1 : 0); if (active) expect(result.stderr).toContain("unsupported-edit"); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); }
  }
  if (active && route !== "model") expect(memory.readFileSync("/out")).toHaveLength(0);
  else { const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after); for (const [part, bytes] of before) if (active || part !== name) expect(after.get(part), part).toEqual(bytes); expect((await api.Document(output, textContext)).paragraphs[0]!.text).toBe(active ? "Original" : text); expect(new TextDecoder().decode(after.get(name))).toContain(wrap('<w:moveFromRangeStart w:id="7" w:name="Original range"/>')); }
 });
