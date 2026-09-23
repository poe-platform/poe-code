import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, editDocumentBookmarks, inspectDocumentBookmarks, writeArchive } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const role of ["main", "header"] as const) for (const parameter of ["", ";audit=coast", '; audit="coast; dune"'] as const) for (const route of ["sdk", "shell"] as const)
it(`${route} renames bookmark and owned references with ${role} MIME ${JSON.stringify(parameter)}; ${kind} strict=${strict}`, async () => {
  const encode = (text: string) => new TextEncoder().encode(text), decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  const parts = readPackage(await textFixture('<w:p><w:bookmarkStart w:id="1" w:name="Coast"/><w:r><w:t>Coast text</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p><w:sectPr><w:headerReference w:type="default" r:id="header"/></w:sectPr>', {header: {kind: "header", xml: `<w:hdr xmlns:w="${w}"><w:p><w:hyperlink w:anchor="Coast"><w:r><w:t>Header link</w:t></w:r></w:hyperlink></w:p><!--keep header--></w:hdr>`}}, strict));
  const type = `application/vnd.openxmlformats-officedocument.wordprocessingml.${role === "main" ? (kind === "dotx" ? "template" : "document") + ".main" : "header"}+xml`;
  parts.set("[Content_Types].xml", encode(decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`).replace(`ContentType="${type}"`, `ContentType="${(type + parameter).replaceAll('"', '&quot;')}"`)));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}); await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  if (route === "sdk") {
    expect((await inspectDocumentBookmarks(input, {}, textContext)).items).toEqual([expect.objectContaining({name: "Coast", id: "1", issues: []})]);
    await editDocumentBookmarks(input, {operation: "bookmarks.set", options: {bookmark: 1, name: "Bay", references: "update", output: "-"}}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: {async write(bytes) {memory.appendFileSync("/output", bytes);}}});
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
    const read = await shell.exec("docx bookmarks list /input --json"); expect(read.exitCode, read.stderr).toBe(0); expect(JSON.parse(read.stdout).data.items).toEqual([expect.objectContaining({name: "Coast", id: "1", issues: []})]);
    const edit = await shell.exec("docx bookmarks set /input --bookmark 1 --name Bay --references update --output - > /output"); expect(edit.exitCode, edit.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  for (const [name, bytes] of parts) expect(saved.get(name), name).toEqual(name === "word/document.xml" ? encode(decode(bytes).replace('w:name="Coast"', 'w:name="Bay"')) : name === "word/header.xml" ? encode(decode(bytes).replace('w:anchor="Coast"', 'w:anchor="Bay"')) : bytes);
  const doc = await Document(output, textContext); expect(doc.paragraphs[0]!.text).toBe("Coast text"); expect(doc.sections.at(0).header.paragraphs[0]!.text).toBe("Header link");
  expect((await inspectDocumentBookmarks(output, {}, textContext)).items[0]!.name).toBe("Bay"); expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
