import {Volume} from "memfs";
import {expect, it} from "vitest";
import {MemoryFileSystem, Shell} from "@poe-platform/safe-bash";
import {docxCommands} from "@poe-platform/safe-bash/commands/docx";
import {Document, createDocxInspectionCommandEngine, editDocumentParagraphs, formatDocumentRuns, replaceDocumentXmlPart, writeArchive} from "./index.js";
import {textContext, textFixture} from "../tests/fixtures/text.js";
import {readPackage} from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["paragraph", "run"] as const) for (const position of ["before", "after"] as const)
for (const action of ["add", "remove"] as const) for (const route of ["model", "sdk", "shell", "xml-sdk", "xml-shell"] as const)
it(`${route} ${action}s native ${owner} property container beside opaque ${position} content; ${kind} strict=${strict}`, async () => {
  const opaque = '<f:record xmlns:f="urn:original:future">Retained owner metadata</f:record>';
  const flag = owner === "paragraph" ? "keepNext" : "b", tag = owner === "paragraph" ? "pPr" : "rPr", properties = `<w:${tag}><w:${flag}/></w:${tag}>`;
  const content = owner === "paragraph" ? "<w:r><w:t>Original coast</w:t></w:r>" : "<w:t>Original coast</w:t>";
  const inner = (action === "remove" ? properties : "") + (position === "before" ? opaque + content : content + opaque);
  const declarations = 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:future" mc:Ignorable="f"';
  const body = owner === "paragraph" ? `<w:p ${declarations}>${inner}</w:p>` : `<w:p><w:r ${declarations}>${inner}</w:r></w:p>`;
  const parts = readPackage(await textFixture(body, {}, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({"/input": "", "/output": ""});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), value = action === "add" ? true : null;
  const context = {...textContext, encoding: {order: "input" as const, compression: "store" as const}, stdout: {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}}};
  if (route === "model") {
    const doc = await Document(input, textContext);
    if (owner === "paragraph") doc.paragraphs[0]!.paragraph_format.keep_with_next = value; else doc.paragraphs[0]!.runs[0]!.bold = value;
    await doc.save(context.stdout);
  } else if (route === "sdk") {
    if (owner === "paragraph") await editDocumentParagraphs(input, {operation: "paragraphs.set", options: {paragraph: 1, keepWithNext: value, output: "-"}}, context);
    else await formatDocumentRuns(input, {paragraph: 1, run: 1, bold: value, output: "-"}, context);
  } else {
    const original = new TextDecoder().decode(parts.get("word/document.xml"));
    const replacement = enc(action === "remove" ? original.replace(properties, "") : original.replace(inner, properties + inner));
    if (route === "xml-sdk") await replaceDocumentXmlPart(input, replacement, {part: "/word/document.xml", output: "-"}, context);
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/replacement", replacement);
      const command = route === "xml-shell" ? "xml set /input --part /word/document.xml --file /replacement" : (owner === "paragraph" ? "paragraphs set /input --paragraph 1 --keep-with-next " : "runs set /input --paragraph 1 --run 1 --bold ") + value;
      const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})).exec(`docx ${command} --output - > /output`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
    }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes);
  expect(new TextDecoder().decode(saved.get("word/document.xml")).split(opaque)).toHaveLength(2);
  const doc = await Document(output, textContext), p = doc.paragraphs[0]!;
  expect(p.text).toBe("Original coast"); expect(owner === "paragraph" ? p.paragraph_format.keep_with_next : p.runs[0]!.bold).toBe(value);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
