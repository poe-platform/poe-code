import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, editDocumentProperties, inspectDocumentProperties, writeArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const group of ["core", "extended", "custom"] as const) for (const parameter of ["", ";audit=coast", '; audit="coast; dune"'] as const)
for (const route of ["sdk", "shell"] as const)
it(`${route} handles ${group} properties with ${JSON.stringify(parameter)}; ${kind} strict=${strict}`, async () => {
  const encode = (text: string) => new TextEncoder().encode(text), decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Coast</w:t></w:r></w:p>', {}, strict));
  const office = strict ? "http://purl.oclc.org/ooxml/officeDocument/" : "http://schemas.openxmlformats.org/officeDocument/2006/";
  const type = group === "core" ? "application/vnd.openxmlformats-package.core-properties+xml" : `application/vnd.openxmlformats-officedocument.${group}-properties+xml`;
  const name = `docProps/${group}.xml`, key = group === "core" ? "core:title" : group === "extended" ? "extended:company" : "custom:Audit";
  const xml = group === "core" ? '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Original coast</dc:title><!--retain--></cp:coreProperties>' : group === "extended" ? `<ep:Properties xmlns:ep="${office + (strict ? "extendedProperties" : "extended-properties")}"><ep:Company>Original coast</ep:Company><!--retain--></ep:Properties>` : `<cp:Properties xmlns:cp="${office + (strict ? "customProperties" : "custom-properties")}" xmlns:vt="${office}docPropsVTypes"><cp:property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Audit"><vt:lpwstr>Original coast</vt:lpwstr></cp:property><!--retain--></cp:Properties>`;
  parts.set(name, encode(xml));
  parts.set("_rels/.rels", encode(decode(parts.get("_rels/.rels")!).replace("</Relationships>", `<Relationship Id="metadata" Type="${group === "core" ? "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" : office + "relationships/" + group + "-properties"}" Target="${name}"/></Relationships>`)));
  parts.set("[Content_Types].xml", encode(decode(parts.get("[Content_Types].xml")!).replace("</Types>", `<Override PartName="/${name}" ContentType="${(type + parameter).replaceAll('"', '&quot;')}"/></Types>`).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`)));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), rejected = group === "core" && parameter !== "";
  if (rejected) await expect(Document(input, textContext)).rejects.toMatchObject({code: "invalid-package"});
  if (route === "sdk") {
    const read = inspectDocumentProperties(input, {name: key}, textContext);
    if (rejected) await expect(read).rejects.toMatchObject({code: "invalid-package"});
    else {
      expect((await read).items[0]!.properties[0]!.value).toBe("Original coast");
      await editDocumentProperties(input, {operation: "properties.set", name: key, value: "Changed coast", output: "-"}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: sink});
    }
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
    const result = await shell.exec(`docx properties set /input --name ${key} --value 'Changed coast' --output - > /output`);
    expect(result.exitCode, result.stderr).toBe(rejected ? 1 : 0);
    if (rejected) {expect(result.stderr).toContain("invalid-package"); expect((await fs.readFile("/output")).length).toBe(0);}
    else memory.writeFileSync("/output", await fs.readFile("/output"));
    expect(await fs.readFile("/input")).toEqual(input);
  }
  if (!rejected) {
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
    expect(decode(saved.get(name)!)).toBe(xml.replace("Original coast", "Changed coast"));
    expect((await inspectDocumentProperties(output, {name: key}, textContext)).items[0]!.properties[0]!.value).toBe("Changed coast");
    for (const [part, bytes] of parts) if (part !== name) expect(saved.get(part), part).toEqual(bytes);
    expect((await Document(output, textContext)).paragraphs[0]!.text).toBe("Coast");
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
