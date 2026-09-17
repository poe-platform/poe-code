import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, editDocumentParagraphs, writeArchive } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice"] as const)
for (const type of ["", "unrecognized", "character", "table", "numbering", undefined])
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} rejects ${type === undefined ? "omitted paragraph as run" : "explicit " + JSON.stringify(type) + " as paragraph"} in ${carrier}; ${kind} strict=${strict}`, async () => {
  const definition = `<w:style${type === undefined ? "" : ` w:type="${type}"`} w:styleId="Coast"><w:name w:val="Coast"/></w:style>`;
  const content = carrier === "direct" ? definition : `<mc:AlternateContent><mc:Choice Requires="w">${definition}</mc:Choice><mc:Fallback/></mc:AlternateContent>`;
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Original coast</w:t></w:r></w:p>', {styles: {kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">${content}</w:styles>`}}, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({"/input": "", "/output": "sentinel"});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  if (route === "model") {
    const document = await Document(input, textContext), original = document.part.blob;
    if (type === undefined) expect(() => document.paragraphs[0]!.add_run("Added coast", "Coast")).toThrow(TypeError);
    else expect(() => document.add_paragraph("Added coast", "Coast")).toThrow(TypeError);
    expect(document.part.blob).toEqual(original); expect(document.styles.part.blob).toEqual(parts.get("word/styles.xml"));
  } else if (route === "sdk") {
    await expect(editDocumentParagraphs(input, {operation: type === undefined ? "runs.add" : "paragraphs.add", options: {text: "Added coast", style: "Coast", ...(type === undefined ? {paragraph: 1} : {}), output: "-"}}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: {async write(bytes) {memory.appendFileSync("/output", bytes);}}})).rejects.toMatchObject({code: "usage"});
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})).exec(`docx ${type === undefined ? "runs" : "paragraphs"} add /input --text 'Added coast' --style Coast ${type === undefined ? "--paragraph 1 " : ""}--output -`);
    expect(result.exitCode).toBe(2); expect(result.stdout).toBe(""); expect(result.stderr).toContain("usage"); expect(await fs.readFile("/input")).toEqual(input);
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input)); expect(memory.readFileSync("/output", "utf8")).toBe("sentinel");
});
