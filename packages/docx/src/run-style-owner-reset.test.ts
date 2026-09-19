import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { assertPackageLinks, readPackage } from "../tests/assertions.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const foreign = "urn:original:run-style-reset";
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} materializes the native Run.style null-reset owner; strict=${strict}; kind=${kind}; carrier=${carrier}; source=R1520`, async () => {
  const active = '<w:r><w:t>Original é 日本 עברית 🌊</w:t><!--retain--><?audit keep?></w:r>';
  const inactive = '<w:r><w:rPr><w:rStyle w:val="Inactive"/></w:rPr><w:t>Inactive branch</w:t></w:r>';
  const wrapped = carrier === "direct" ? active : carrier === "process" ? `<f:pass>${active}</f:pass><f:opaque f:identity="retained">${inactive}</f:opaque>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}"${carrier === "fallback" ? ' f:identity="retained"' : ""}>${carrier === "choice" ? active : inactive}</mc:Choice><mc:Fallback${carrier === "choice" ? ' f:identity="retained"' : ""}>${carrier === "fallback" ? active : inactive}</mc:Fallback></mc:AlternateContent>`;
  const parts = readPackage(await textFixture(`<w:p xmlns:mc="${mc}" xmlns:f="${foreign}" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:pPr><w:keepNext/></w:pPr>${wrapped}</w:p>`, {}, strict)), memory = Volume.fromJSON({ "/input": "", "/out": "" });
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } };
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "runs" },
    { operation: "model.text.run.Run.style.set", receiver: ref("runs", 0), arguments: { value: null } }
  ];
  if (route === "model") {
    const doc = await api.Document(input, textContext), run = doc.paragraphs[0]!.runs[0]!;
    expect(run.element.children.some(n => n.localName === "rPr")).toBe(false);
    run.style = null;
    expect(run.equals(doc.paragraphs[0]!.runs[0])).toBe(true);
    expect(run.element.children.filter(n => n.localName === "rPr")).toHaveLength(1);
    const once = run.element.serialize(); run.style = null; expect(run.element.serialize()).toEqual(once);
    await doc.save(sink);
  } else if (route === "sdk") {
    const batch = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext); await batch.save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --output /out --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input);
      memory.writeFileSync("/out", await fs.readFile("/out"));
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), after = readPackage(output); assertPackageLinks(after);
  for (const [name, bytes] of parts) if (name !== "word/document.xml" && name !== "[Content_Types].xml" && name !== "word/_rels/document.xml.rels") expect(after.get(name), name).toEqual(bytes);
  const doc = await api.Document(output, textContext), p = doc.paragraphs[0]!, run = p.runs[0]!;
  expect(run.text).toBe("Original é 日本 עברית 🌊"); expect(p.paragraph_format.keep_with_next).toBe(true);
  expect(run.style?.equals(doc.styles.default(api.WD_STYLE_TYPE.CHARACTER))).toBe(true); expect(run.element.children.filter(n => n.localName === "rPr")).toHaveLength(1);
  expect(run.element.children[0]!.localName).toBe("rPr"); expect(run.element.children[0]!.children).toHaveLength(0);
  const xml = new TextDecoder().decode(after.get("word/document.xml"));
  for (const token of ["<!--retain-->", "<?audit keep?>", ...(carrier === "direct" ? [] : [inactive, 'f:identity="retained"'])]) expect(xml.split(token)).toHaveLength(2);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
