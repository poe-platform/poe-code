import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, inspectDocument, writeArchive, type InspectionData } from "./index.js";
import { chartFixture, chartContext } from "../tests/fixtures/charts.js";
import { readPackage } from "../tests/assertions.js";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const role of ["settings", "fontTable", "glossary", "custom-xml-properties", "binary"] as const)
for (const parameter of ["", ";audit=font"] as const) for (const route of ["sdk", "shell"] as const)
it(`${route} derives ${role} feature presence from media essence ${JSON.stringify(parameter)}; ${kind} strict=${strict}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", encode = (text: string) => new TextEncoder().encode(text);
  const type = role === "binary" ? "application/octet-stream" : role === "custom-xml-properties" ? "application/vnd.openxmlformats-officedocument.customXmlProperties+xml" : "application/vnd.openxmlformats-officedocument.wordprocessingml." + (role === "glossary" ? "document.glossary" : role) + "+xml";
  const bytes = role === "binary" ? new Uint8Array([1, 3, 5]) : role === "custom-xml-properties" ? '<ds:datastoreItem xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"/>' : `<w:${role === "glossary" ? "glossaryDocument" : role === "fontTable" ? "fonts" : "settings"} xmlns:w="${w}"/>`;
  const parts = readPackage(await chartFixture({strict, definitions: [], resources: [{name: "audit/declared.bin", type: type + parameter, bytes}]}));
  parts.set("[Content_Types].xml", encode(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`)));
  const memory = Volume.fromJSON({"/input": "", "/output": ""});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, chartContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer); let data: InspectionData;
  if (route === "sdk") data = await inspectDocument(input, chartContext);
  else {const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: chartContext.limits})})); const result = await shell.exec("docx inspect /input --json"); expect(result.exitCode, result.stderr).toBe(0); data = JSON.parse(result.stdout).data; expect(await fs.readFile("/input")).toEqual(input);}
  expect(data.features.find(feature => feature.id === "F41")!.detected).toBe(role === "glossary" || role === "custom-xml-properties");
  expect(data.features.find(feature => feature.id === "F42")!.detected).toBe(role === "settings" || role === "fontTable");
  expect(data.fonts.embedded).toEqual([]); expect(data.parts.find(part => part.name === "/audit/declared.bin")!.contentType).toBe(type + parameter);
  const doc = await Document(input, chartContext); doc.paragraphs[0]!.runs[0]!.text = "shore"; await doc.save({async write(bytes) {memory.appendFileSync("/output", bytes);}});
  const saved = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer)); for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
