import { Volume } from "memfs";
import { expect, it } from "vitest";
import type { FileSystem } from "@poe-code/safe-fs/core";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, DocumentBudget, createDocxInspectionCommandEngine, packDocumentArchive } from "./index.js";
import { readPackage } from "../tests/assertions.js";
import { textContext } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const essence of ["application/xml", "text/xml", "application/x-audit+xml"])
for (const parameter of ["", ";charset=utf-8", '; audit="coast; dune"'])
for (const delta of [-1, 0, 1]) for (const ceiling of ["host", "option"] as const)
for (const route of ["sdk", "shell"] as const)
it(`${route} packs XML ${essence}${parameter}; ceiling=${ceiling} delta=${delta} ${kind} strict=${strict}`, async () => {
  const encode = (text: string) => new TextEncoder().encode(text), w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships", type = essence + parameter;
  const mainType = `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`, relType = "application/vnd.openxmlformats-package.relationships+xml";
  const parts = new Map<string, Uint8Array>([
    ["[Content_Types].xml", encode(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="${relType}"/><Override PartName="/report/main.xml" ContentType="${mainType}"/><Override PartName="/audit/payload.data" ContentType="${type.replaceAll('"', '&quot;')}"/></Types>`)],
    ["_rels/.rels", encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="${r}/officeDocument" Target="report/main.xml"/></Relationships>`)],
    ["report/main.xml", encode(`<w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t>Retained</w:t></w:r></w:p></w:body></w:document>`)],
    ["audit/payload.data", encode("<audit>" + " ".repeat(4096 + delta - 15) + "</audit>")]
  ]);
  const entries = await Promise.all([...parts].map(async ([name, bytes]) => ({part: name === "[Content_Types].xml" ? name : "/" + name, path: name, contentType: name === "[Content_Types].xml" ? "application/xml" : name === "_rels/.rels" ? relType : name === "report/main.xml" ? mainType : type, bytes: bytes.length, sha256: [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)))].map(byte => byte.toString(16).padStart(2,"0")).join("")})));
  entries.sort((a,b) => a.part < b.part ? -1 : a.part > b.part ? 1 : 0);
  const inventory = {version: 1, kind, dialect: strict ? "strict" : "transitional", entries}, memory = Volume.fromJSON(Object.fromEntries([...parts].map(([name, bytes]) => ["/tree/" + name, Buffer.from(bytes)])));
  memory.writeFileSync("/output", ""); const reads: string[] = [];
  const limit = [{name: "xmlPartBytes", value: 4096}] as const;
  if (route === "sdk") {
    const fs = {
      async lstat(path: string) { const stat = memory.lstatSync(path); return {type: stat.isDirectory() ? "directory" : "file", size: stat.size}; },
      async realpath(path: string) { return String(memory.realpathSync(path)); },
      async readFile(path: string) { reads.push(path); return new Uint8Array(memory.readFileSync(path) as Buffer); }
    } as unknown as FileSystem;
    const task = packDocumentArchive(inventory, {output: "-", ...(ceiling === "option" ? {limit} : {})}, {...textContext, budget: new DocumentBudget(ceiling === "host" ? {xmlPartBytes: 4096} : {}, textContext.signal), filesystem: fs, inventoryDirectory: "/tree", stdout: {async write(bytes) {memory.appendFileSync("/output", bytes);}}});
    if (delta === 1) await expect(task).rejects.toMatchObject({code: "limit-exceeded"}); else expect((await task).changed).toBe(true);
  } else {
    const fs = new MemoryFileSystem(); for (const [name, bytes] of parts) { await fs.mkdir("/tree/" + name.split("/").slice(0,-1).join("/"), {recursive: true}); await fs.writeFile("/tree/" + name, bytes); }
    await fs.writeFile("/tree/manifest.json", encode(JSON.stringify(inventory)));
    const read = fs.readStream.bind(fs); fs.readStream = (path, options) => {if (path !== "/tree/manifest.json") reads.push(path); return read(path, options);};
    const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits, ...(ceiling === "host" ? {documentLimits: {xmlPartBytes: 4096}} : {})})}));
    const result = await shell.exec(`docx pack /tree/manifest.json --output - ${ceiling === "option" ? "--limit xmlPartBytes=4096" : ""} > /output`);
    if (delta === 1) {expect(result.exitCode).toBe(4); expect(result.stderr).toContain("limit-exceeded");} else expect(result.exitCode, result.stderr).toBe(0);
    memory.writeFileSync("/output", await fs.readFile("/output")); for (const [name, bytes] of parts) expect(await fs.readFile("/tree/" + name)).toEqual(bytes);
  }
  if (delta === 1) { expect(reads).toEqual([]); expect(memory.readFileSync("/output").length).toBe(0); }
  else {const output = new Uint8Array(memory.readFileSync("/output") as Buffer); expect(readPackage(output)).toEqual(parts); expect((await Document(output, textContext)).paragraphs[0]!.text).toBe("Retained"); expect(new TextDecoder().decode(readPackage(output).get("[Content_Types].xml"))).toContain(mainType);}
  for (const [name, bytes] of parts) expect(memory.readFileSync("/tree/" + name)).toEqual(Buffer.from(bytes));
});
