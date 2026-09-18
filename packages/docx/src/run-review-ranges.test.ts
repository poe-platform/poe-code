import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

for (const strict of [false, true]) for (const carrier of ["direct", "choice", "fallback", "process", "ignored"] as const) for (const active of [false, true])
 for (const route of ["model", "sdk", "shell", "sdk-batch", "shell-batch"] as const) for (const action of ["text", "format"] as const)
 it(`${route} run edit respects ${active ? "active" : "inert"} ${carrier} review range; action=${action} strict=${strict}`, async () => {
  const wrap = (marker: string) => carrier === "direct" ? active ? marker : `<f:opaque>${marker}</f:opaque>` : carrier === "ignored" || carrier === "process" ? `<f:${active ? "pass" : "opaque"}>${marker}</f:${active ? "pass" : "opaque"}>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active ? marker : "" : active ? "" : marker}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active ? marker : "" : active ? "" : marker}</mc:Fallback></mc:AlternateContent>`;
  const body = wrap('<w:moveFromRangeStart w:id="7" w:name="Original range"/>') + '<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Original</w:t></w:r></w:p>' + wrap('<w:moveFromRangeEnd w:id="7"/>');
  const input0 = await textFixture(body, {}, strict), parts = readPackage(input0), name = "word/document.xml", xml = new TextDecoder().decode(parts.get(name));
  // Namespace declarations belong on the fixture root so body-level carriers are scoped.
  const rootXml = xml.replace('<w:document ', '<w:document xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:paragraph-review-ranges" mc:Ignorable="f" mc:ProcessContent="f:pass" ');
  const memory = Volume.fromJSON({ "/input": "", "/out": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([part, bytes]) => ({ name: part, bytes: part === name ? new TextEncoder().encode(rootXml) : bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } } }, options = { paragraph: 1, run: 1, ...(action === "text" ? { text: "Changed" } : { bold: false }) }, batch = { version: 1, operations: [{ id: "assign", operation: "runs.set", arguments: options }] };
  if (route === "model") { const doc = await api.Document(input, textContext); const assign = () => { const run = doc.paragraphs[0]!.runs[0]!; if (action === "text") run.text = "Changed"; else run.bold = false; }; if (active) expect(assign).toThrowError(expect.objectContaining({ code: "unsupported-edit" })); else assign(); await doc.save(context.stdout); }
  else if (route === "sdk" || route === "sdk-batch") { const result = route === "sdk" ? api.formatDocumentRuns(input, { ...options, output: "-" }, context) : api.executeDocumentBatch(input, batch, { output: "-" }, context); if (active) await expect(result).rejects.toMatchObject({ code: "unsupported-edit" }); else await result; }
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
   try { const path = route === "shell-batch" ? `batch /input --ops-json '${JSON.stringify(batch)}'` : `runs set /input --paragraph 1 --run 1 ${action === "text" ? "--text Changed" : "--bold false"}`; const result = await shell.exec(`docx ${path} --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(active ? 1 : 0); if (active) expect(result.stderr).toContain("unsupported-edit"); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); }
  }
  if (active && route !== "model") expect(memory.readFileSync("/out")).toHaveLength(0);
  else { const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after); for (const [part, bytes] of before) if (active || part !== name) expect(after.get(part), part).toEqual(bytes); expect((await api.Document(output, textContext)).paragraphs[0]!.text).toBe(active || action === "format" ? "Original" : "Changed"); expect(new TextDecoder().decode(after.get(name))).toContain(wrap('<w:moveFromRangeStart w:id="7" w:name="Original range"/>')); }
 });
