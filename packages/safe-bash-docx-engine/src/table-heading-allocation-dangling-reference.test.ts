import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

for (let level = 0; level <= 9; level++) for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["sdk-style", "sdk-batch", "cli-style"] as const)
it(`retains unselected dangling heading fallback during nested table heading allocation; level=${level}; ${route}; ${kind}; strict=${strict}`, async () => {
  const reserved = level === 0 ? "Title" : `Heading${level}`;
  const parts = readPackage(await textFixture(`<w:p><w:pPr><w:pStyle w:val="${reserved}"/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t>Retain 日本 עברית é 🌊</w:t></w:r></w:p>`, {
    styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><!--retained--><?audit retained?></w:styles>` }
  }, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const memory = Volume.fromJSON({ "/input": "", "/out": "" });
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } };
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), before = await api.Document(input, textContext);
  expect(before.paragraphs[0]!.style!.name).toBe("Normal");
  const publication = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: sink };
  const content = { version: 1 as const, blocks: [{ kind: "table" as const, rows: [[{ blocks: [{ kind: "paragraph" as const, level, text: "New coast" }] }]] }] };
  if (route === "sdk-style") await api.editDocumentTables(input, { operation: "tables.add", options: { rows: 1, cols: 1, content, output: "-" } }, publication);
  else if (route === "sdk-batch") await api.executeDocumentBatch(input, { version: 1, operations: [{ operation: "tables.add", arguments: { rows: 1, cols: 1, content } }] }, { output: "-" }, publication);
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", new TextEncoder().encode("Retained destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const command = `docx tables add /input --rows 1 --cols 1 --content-json '${JSON.stringify(content)}'`;
      const result = await shell.exec(command + " --output /destination --force --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, errors: [] });
      expect(await fs.readFile("/input")).toEqual(input);
      memory.writeFileSync("/out", await fs.readFile("/destination"));
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), after = await api.Document(output, textContext);
  expect(after.paragraphs[0]!.style!.name).toBe("Normal");
  expect(after.tables[0]!.cell(0, 0).paragraphs[0]!.style!.style_id).not.toBe(reserved);
  expect(after.tables[0]!.cell(0, 0).paragraphs[0]!.text).toBe("New coast");
  const namespace = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
  type Node = ReturnType<typeof xmlStructure>;
  const flatten = (node: Node): Node[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : flatten(child))];
  const definition = flatten(xmlStructure(readPackage(output).get("word/styles.xml")!)).find(node => node.name === `{${namespace}}style` && node.attributes[`{${namespace}}styleId`] === after.tables[0]!.cell(0, 0).paragraphs[0]!.style!.style_id)!;
  expect(flatten(definition).find(node => node.name === `{${namespace}}outlineLvl`)?.attributes[`{${namespace}}val`]).toBe(level === 0 ? undefined : String(level - 1));
  expect(after.paragraphs[0]!.text).toBe("Retain 日本 עברית é 🌊");
  for (const [name, bytes] of parts) if (name !== "word/styles.xml" && name !== "word/document.xml") expect(readPackage(output).get(name), name).toEqual(bytes);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
