import { expect, it } from "vitest";
import { Volume } from "memfs";
import { DocumentBudget, editDocumentProperties, extractDocumentText, inspectDocument, readDocumentArchive, writeArchive, writeDocumentArchive } from "./index.js";
import { paragraph, table, textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

it("refuses exhausted work without publishing or changing source bytes", async () => {
  const input = await textFixture(paragraph("Estuary sampling"));
  const volume = Volume.fromJSON({ "/source": Buffer.from(input), "/destination": "Retain destination" });
  const before = volume.toJSON();
  let writes = 0;
  const context = { ...textContext, budget: new DocumentBudget({ work: 1 }), encoding: { order: "input", compression: "store" } as const, stdout: { async write() { writes++; } } };
  await expect(inspectDocument(input, context)).rejects.toMatchObject({ code: "limit-exceeded" });
  await expect(extractDocumentText(input, { ...textContext, budget: new DocumentBudget({ work: 1 }) })).rejects.toMatchObject({ code: "limit-exceeded" });
  await expect(editDocumentProperties(input, { operation: "properties.set", name: "core:title", value: "Survey", output: "-" }, { ...context, budget: new DocumentBudget({ work: 1 }) })).rejects.toMatchObject({ code: "limit-exceeded" });
  expect(writes).toBe(0);
  expect(volume.toJSON()).toEqual(before);
  expect(input).toEqual(new Uint8Array(volume.readFileSync("/source") as Buffer));
});

it("round trips mixed structures and changes only selected core title bytes", async () => {
  const body = '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Water</w:t></w:r><w:r><w:t>line</w:t></w:r></w:p>' + table([paragraph("North"), paragraph("South")]) + '<w:p><w:fldSimple w:instr="DATE"><w:r><w:t>Cached season</w:t></w:r></w:fldSimple></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>';
  const archive = await readDocumentArchive(await textFixture(body), textContext);
  const encode = (text: string) => new TextEncoder().encode(text);
  const core = '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Field draft</dc:title><dc:creator>Original analyst</dc:creator><cp:keywords>delta; survey</cp:keywords></cp:coreProperties>';
  const members = archive.members.map(member => member.name === "[Content_Types].xml" ? { ...member, bytes: encode(new TextDecoder().decode(member.bytes).replace("</Types>", '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>')) } : member.name === "_rels/.rels" ? { ...member, bytes: encode(new TextDecoder().decode(member.bytes).replace("</Relationships>", '<Relationship Id="core" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>')) } : member);
  members.push({ name: "docProps/core.xml", bytes: encode(core), directory: false, modified: new Date("2025-01-01T00:00:00Z") });
  const volume = Volume.fromJSON({ "/source": "", "/round": "", "/edit": "" });
  await writeArchive({ ...archive, members }, { async write(bytes) { volume.appendFileSync("/source", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(volume.readFileSync("/source") as Buffer);
  const baseline = readPackage(input);
  const inspection = await inspectDocument(input, textContext);
  expect(inspection.counts).toMatchObject({ tables: 1, cells: 2, sections: 1, fields: 1 });
  const text = await extractDocumentText(input, textContext);
  expect(text.text).toContain("Waterline");
  await writeDocumentArchive(await readDocumentArchive(input, textContext), { async write(bytes) { volume.appendFileSync("/round", bytes); } }, { order: "input", compression: "store" }, textContext);
  expect(readPackage(new Uint8Array(volume.readFileSync("/round") as Buffer))).toEqual(baseline);
  const result = await editDocumentProperties(input, { operation: "properties.set", name: "core:title", value: "Field final", output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/edit", bytes); } } });
  expect(result.changed).toBe(true);
  const edited = readPackage(new Uint8Array(volume.readFileSync("/edit") as Buffer));
  expect([...edited.keys()]).toEqual([...baseline.keys()]);
  for (const [name, bytes] of baseline) {
    if (name === "docProps/core.xml") expect(new TextDecoder().decode(edited.get(name))).toBe(core.replace("Field draft", "Field final"));
    else expect(edited.get(name)).toEqual(bytes);
  }
  expect((await extractDocumentText(new Uint8Array(volume.readFileSync("/edit") as Buffer), textContext)).text).toBe(text.text);
  expect(input).toEqual(new Uint8Array(volume.readFileSync("/source") as Buffer));
});

it("rejects bracketed auxiliary part paths before any metadata output", async () => {
  const input = await textFixture(paragraph("Marsh survey"));
  const archive = await readDocumentArchive(input, textContext);
  const volume = Volume.fromJSON({ "/source": "" });
  await writeArchive({ ...archive, members: [...archive.members, { name: "[discarded]/entry.dat", bytes: new Uint8Array([7, 11]), directory: false, modified: new Date("2025-01-01T00:00:00Z") }] }, { async write(bytes) { volume.appendFileSync("/source", bytes); } }, { order: "input", compression: "store" }, textContext);
  const source = new Uint8Array(volume.readFileSync("/source") as Buffer);
  const before = volume.toJSON();
  let writes = 0;
  await expect(readDocumentArchive(source, textContext)).rejects.toMatchObject({ code: "invalid-package" });
  await expect(editDocumentProperties(source, { operation: "properties.set", name: "core:title", value: "Survey", output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write() { writes++; } } })).rejects.toMatchObject({ code: "invalid-package" });
  expect(writes).toBe(0);
  expect(volume.toJSON()).toEqual(before);
});

it("keeps successful admission distinct from a later work-limited inspection", async () => {
  const input = await textFixture(paragraph("Wetland transect") + paragraph("Reed density"));
  const measured = new DocumentBudget();
  await readDocumentArchive(input, { ...textContext, budget: measured });
  const ceiling = measured.usage.work;
  await expect(readDocumentArchive(input, { ...textContext, budget: new DocumentBudget({ work: ceiling }) })).resolves.toMatchObject({ kind: "docx" });
  await expect(inspectDocument(input, { ...textContext, budget: new DocumentBudget({ work: ceiling }) })).rejects.toMatchObject({ code: "limit-exceeded" });
});
