import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const encode = (value: string) => new TextEncoder().encode(value);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["sdk", "cli", "sdk-batch", "cli-batch"] as const)
for (const boundary of ["part-scalar-order", "owner-xml-order"] as const)
it(`${route} retains property ${boundary}; ${kind}; strict=${strict}`, async () => {
  const files = readPackage(await textFixture('<w:p><w:r><w:t>Retained coast</w:t></w:r></w:p>', {}, strict, { kind }));
  const type = "application/vnd.openxmlformats-package.core-properties+xml", relationship = "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties";
  const types = new api.DocumentXmlEditor(files.get("[Content_Types].xml")!), rels = new api.DocumentXmlEditor(files.get("_rels/.rels")!);
  const names = boundary === "part-scalar-order" ? ["🌊", "豈"] : ["original"];
  types.insertChildren(types.root, names.map(name => `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/metadata/${name}.xml" ContentType="${type}"/>`).join(""));
  rels.insertChildren(rels.root, boundary === "part-scalar-order" ? names.map((name, index) => `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="metadata${index}" Type="${relationship}" Target="metadata/${name}.xml"/>`).join("") : ["z-first", "a-second"].map(id => `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="${id}" Type="${relationship}" Target="metadata/original.xml"/>`).join(""));
  files.set("[Content_Types].xml", types.serialize()); files.set("_rels/.rels", rels.serialize());
  for (const name of names) files.set(`metadata/${name}.xml`, encode('<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Stored coast 海</dc:title></cp:coreProperties>'));
  const memory = Volume.fromJSON({ "/input": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...files].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-03-04T05:06:08Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), batch = { version: 1 as const, operations: [{ operation: "properties.list" as const, arguments: {} }] };
  let items: readonly api.PropertyResourceRecord[];
  if (route === "sdk") items = (await api.inspectDocumentProperties(input, { json: true }, textContext)).items;
  else if (route === "sdk-batch") items = ((await api.executeDocumentBatch(input, batch, {}, { ...textContext, encoding: { order: "input", compression: "store" } })).results[0]!.data as api.PropertyInspectionData).items;
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", encode(JSON.stringify(batch))); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec(route === "cli" ? "docx properties list /input --json" : "docx batch /input --ops-file /ops --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); const envelope = JSON.parse(result.stdout); items = route === "cli" ? envelope.data.items : envelope.data.results[0].data.items; expect(await fs.readFile("/input")).toEqual(input); }
    finally { await shell.dispose(); }
  }
  expect(items.every(item => item.support === "preserve")).toBe(true);
  if (boundary === "part-scalar-order") expect(items.map(item => item.location.value.part)).toEqual(["/metadata/豈.xml", "/metadata/🌊.xml"]);
  else expect(items[0]!.references.map(reference => reference.id)).toEqual(["z-first", "a-second"]);
  expect(readPackage(input)).toEqual(files);
});
