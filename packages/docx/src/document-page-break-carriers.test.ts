import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value), ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process", "nested"] as const)
for (const encoding of ["utf8", "utf8bom", "utf16le", "utf16be"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} appends an explicit page break through ${carrier}; ${encoding} ${kind} strict=${strict}`, async () => {
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const paragraph = '<w:p><w:r><w:t>Sounding ledger</w:t></w:r></w:p>', section = '<w:sectPr><w:pgSz w:w="12000" w:h="16000"/></w:sectPr>';
  const body = `<w:body><!--retained--><?sound keep?>${paragraph}${section}</w:body>`;
  const inactive = '<w:body><w:p><w:r><w:t>Inactive ledger</w:t></w:r></w:p></w:body>';
  const active = carrier === "nested" ? `<f:pass>${body}</f:pass>` : body;
  const content = carrier === "direct" ? body : carrier === "process" ? `<f:pass>${body}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "fallback" ? "f" : "w"}">${carrier === "fallback" ? inactive : active}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : inactive}</mc:Fallback></mc:AlternateContent>`;
  const xml = `<w:document xmlns:w="${word}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:sounding:future" mc:Ignorable="f" mc:ProcessContent="f:pass">${content}</w:document>`;
  const parts = readPackage(await textFixture("<w:p/>", {}, strict));
  const bytes = encoding === "utf8" ? enc(xml) : encoding === "utf8bom" ? enc("\ufeff" + xml) : new Uint8Array(encoding === "utf16le" ? Buffer.from("\ufeff" + xml, "utf16le") : Buffer.from("\ufeff" + xml, "utf16le").swap16());
  parts.set("word/document.xml", bytes);
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }), context = { ...textContext, encoding: { order: "input", compression: "store" } as const }, sink = { async write(chunk: Uint8Array) { memory.appendFileSync("/output", chunk); } };
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(chunk) { memory.appendFileSync("/input", chunk); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), operations = [
    { operation: "model.document.Document.add_page_break.call", receiver: ref("document"), arguments: {}, resultHandle: "break" },
    { operation: "model.text.paragraph.Paragraph.text.get", receiver: ref("break"), arguments: {} },
    { operation: "model.text.paragraph.Paragraph.contains_page_break.get", receiver: ref("break"), arguments: {} }
  ];
  if (route === "model") { const doc = await api.Document(input, context), added = doc.add_page_break(); expect(added.text).toBe(""); expect(added.contains_page_break).toBe(false); await doc.save(sink); }
  else if (route === "sdk") { const result = await api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...context, stdout: sink }); expect(result.results.slice(-2).map(row => row.data)).toEqual(["", false]); }
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try { const result = await shell.exec("docx batch /input --ops-file /ops --output /output --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout).data.results.slice(-2).map((row: { data: unknown }) => row.data)).toEqual(["", false]); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input); }
    finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output), stored = saved.get("word/document.xml")!;
  const decoded = new TextDecoder(encoding.startsWith("utf8") ? "utf-8" : encoding === "utf16le" ? "utf-16le" : "utf-16be").decode(stored);
  expect(decoded).toContain(paragraph); expect(decoded).toContain(section); expect(decoded).toContain("<!--retained--><?sound keep?>");
  if (["choice", "fallback", "nested"].includes(carrier)) expect(decoded).toContain(inactive);
  if (encoding !== "utf8") expect(stored.slice(0, encoding === "utf8bom" ? 3 : 2)).toEqual(bytes.slice(0, encoding === "utf8bom" ? 3 : 2));
  const tree = xmlStructure(enc(decoded)), nodes = (node: typeof tree): typeof tree[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : nodes(child))];
  const breaks = nodes(tree).filter(node => node.name === `{${word}}br`); expect(breaks).toHaveLength(1); expect(breaks[0]!.attributes[`{${word}}type`]).toBe("page");
  const reopened = await api.Document(output, context); expect(reopened.paragraphs.map(p => p.text)).toEqual(["Sounding ledger", ""]); expect(reopened.sections.length).toBe(1); expect(reopened.sections[0]!.page_width?.twips).toBe(12000);
  for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
