import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, replaceDocumentXmlPart, publishDocumentArchive, readDocumentArchive, writeArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const encode = (text: string) => new TextEncoder().encode(text), decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const role of ["main", "settings", "glossary"] as const) for (const parameter of ["", ";audit=coast"] as const)
for (const route of ["sdk", "shell", "publisher"] as const)
it(`${route} refuses native ${role} lock removal with ${JSON.stringify(parameter)}; ${kind} strict=${strict}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Coast</w:t></w:r></w:p>', {}, strict));
  const name = role === "main" ? "word/document.xml" : `audit/${role}.xml`, type = `application/vnd.openxmlformats-officedocument.wordprocessingml.${role === "main" ? (kind === "dotx" ? "template" : "document") + ".main" : role === "glossary" ? "document.glossary" : "settings"}+xml`;
  const locked = '<w:sdt><w:sdtPr><w:text/><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>Locked coast</w:t></w:r></w:p></w:sdtContent></w:sdt>';
  const xml = role === "settings" ? `<w:settings xmlns:w="${w}"><w:documentProtection w:edit="readOnly" w:enforcement="1"/></w:settings>` : role === "main" ? `<w:document xmlns:w="${w}"><w:body>${locked}</w:body></w:document>` : `<w:glossaryDocument xmlns:w="${w}"><w:docParts><w:docPart><w:docPartBody>${locked}</w:docPartBody></w:docPart></w:docParts></w:glossaryDocument>`;
  const replacement = encode(role === "settings" ? xml.replace('<w:documentProtection w:edit="readOnly" w:enforcement="1"/>', '') : xml.replace(locked, '<w:p><w:r><w:t>Unlocked coast</w:t></w:r></w:p>'));
  parts.set(name, encode(xml));
  let types = decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`);
  types = role === "main" ? types.replace(`ContentType="${type}"`, `ContentType="${type + parameter}"`) : types.replace("</Types>", `<Override PartName="/${name}" ContentType="${type + parameter}"/></Types>`); parts.set("[Content_Types].xml", encode(types));
  const memory = Volume.fromJSON({"/input": "", "/output": "sentinel"});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), context = {...textContext, encoding: {order: "input" as const, compression: "store" as const}, stdout: {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}}};
  await Document(input, textContext); expect((await readDocumentArchive(input, textContext)).package.getPart("/" + name).content_type).toBe(type + parameter);
  if (route === "sdk") await expect(replaceDocumentXmlPart(input, replacement, {part: "/" + name, output: "-"}, context)).rejects.toMatchObject({code: "unsupported-edit"});
  else if (route === "publisher") {const original = await readDocumentArchive(input, textContext); await expect(publishDocumentArchive({...original, members: original.members.map(member => member.name === name ? {...member, bytes: replacement} : member)}, {output: "-"}, context, original)).rejects.toMatchObject({code: "unsupported-edit"});}
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/replacement.xml", replacement);
    const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
    const result = await shell.exec(`docx xml set /input --part /${name} --file /replacement.xml --dry-run --json`); expect(result.exitCode, result.stderr).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ok: false, data: null, affected: 0, errors: [{code: "unsupported-edit"}]}); expect(await fs.readFile("/input")).toEqual(input);
  }
  expect(memory.readFileSync("/output", "utf8")).toBe("sentinel"); expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
