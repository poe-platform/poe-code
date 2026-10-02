import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, readDocumentArchive, writeArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const encode = (text: string) => new TextEncoder().encode(text), decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const role of ["chart", "theme", "custom-properties", "glossary"] as const)
for (const parameter of ["", ";original-audit=coast"] as const) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} rejects opposite-dialect ${role} with ${JSON.stringify(parameter)}; ${kind} strict=${strict}`, async () => {
  const parts = readPackage(await textFixture('<w:p/>', {}, strict));
  const opposite = strict ? "http://schemas.openxmlformats.org/" : "http://purl.oclc.org/ooxml/";
  const namespace = opposite + (role === "chart" ? (strict ? "drawingml/2006/chart" : "drawingml/chart") : role === "theme" ? (strict ? "drawingml/2006/main" : "drawingml/main") : role === "custom-properties" ? (strict ? "officeDocument/2006/custom-properties" : "officeDocument/customProperties") : strict ? "wordprocessingml/2006/main" : "wordprocessingml/main");
  const type = "application/vnd.openxmlformats-officedocument." + (role === "chart" ? "drawingml.chart+xml" : role === "theme" ? "theme+xml" : role === "custom-properties" ? "custom-properties+xml" : "wordprocessingml.document.glossary+xml");
  const root = role === "chart" ? "chartSpace" : role === "theme" ? "theme" : role === "custom-properties" ? "Properties" : "glossaryDocument";
  parts.set("audit/native.xml", encode(`<audit:${root} xmlns:audit="${namespace}"/>`));
  parts.set("[Content_Types].xml", encode(decode(parts.get("[Content_Types].xml")!).replace("</Types>", `<Override PartName="/audit/native.xml" ContentType="${type + parameter}"/></Types>`).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`)));
  const memory = Volume.fromJSON({"/input": ""});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  if (route === "model") await expect(Document(input, textContext)).rejects.toMatchObject({code: "invalid-package"});
  else if (route === "sdk") await expect(readDocumentArchive(input, textContext)).rejects.toMatchObject({code: "invalid-package"});
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
    const result = await shell.exec("docx inspect /input --json");
    expect(result.exitCode, result.stderr).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ok: false, data: null, affected: 0, errors: [{code: "invalid-package"}]});
    expect(await fs.readFile("/input")).toEqual(input);
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
