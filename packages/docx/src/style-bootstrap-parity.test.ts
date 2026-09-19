import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, WD_STYLE_TYPE, applyStyleModelBatch, createDocxInspectionCommandEngine, writeArchive } from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const encode = (text: string) => new TextEncoder().encode(text);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const precedingRead of [false, true]) for (const route of ["model", "sdk", "shell"] as const) it(`${route} Document.styles creates the same original defaults; ${kind} strict=${strict} precedingRead=${precedingRead}`, async () => {
  const parts = readPackage(await textFixture(paragraph("Original survey"), {}, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const operations = [
    ...(precedingRead ? [{ operation: "model.document.Document.paragraphs.get", receiver: { resultHandle: "document" }, arguments: {} }] : []),
    { operation: "model.document.Document.styles.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "styles" },
    { operation: "model.styles.styles.Styles.__len__.get", receiver: { resultHandle: "styles" }, arguments: {} }
  ];
  if (route === "model") {
    const document = await Document(input, textContext); if (precedingRead) expect(document.paragraphs[0]!.text).toBe("Original survey"); expect(document.styles.length).toBe(4); await document.save(sink);
  } else if (route === "sdk") {
    const batch = await applyStyleModelBatch(input, { version: 1, operations }, textContext); expect(batch.results.at(-1)!.value).toBe(4); await batch.save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops.json", encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    const result = await shell.exec("docx batch /input --ops-file /ops.json --output - > /output"); expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toBe(""); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output), document = await Document(output, textContext);
  expect(document.styles.length).toBe(4);
  expect(document.styles.default(WD_STYLE_TYPE.PARAGRAPH)?.name).toBe("Normal"); expect(document.styles.default(WD_STYLE_TYPE.CHARACTER)?.name).toBe("Default Paragraph Font"); expect(document.styles.default(WD_STYLE_TYPE.TABLE)?.name).toBe("Normal Table");
  expect(document.styles.default(WD_STYLE_TYPE.LIST)?.name).toBe("No List");
  const stylePart = document.part.rels.part_with_reltype((strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships") + "/styles");
  const tree = xmlStructure(stylePart.blob), root = tree.children.find(child => typeof child !== "string")!;
  expect(typeof root).not.toBe("string"); if (typeof root !== "string") { expect(root.name).toBe("{" + (strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main") + "}styles"); expect(root.children.filter(child => typeof child !== "string" && child.name.endsWith("}style"))).toHaveLength(4); }
  for (const [name, bytes] of parts) if (!["[Content_Types].xml", "word/_rels/document.xml.rels"].includes(name)) expect(saved.get(name)).toEqual(bytes);
  expect(new TextDecoder().decode(saved.get("[Content_Types].xml"))).toContain("wordprocessingml." + (kind === "docx" ? "document" : "template") + ".main+xml");
});
