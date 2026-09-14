import { Volume } from "memfs";
import { readArchive } from "./archive.js";
import { writeArchive } from "./archive-write.js";
import { createDocxInspectionCommandEngine } from "./inspection-command.js";
import { expect, it } from "vitest";
import { textContext, textFixture } from "../tests/fixtures/text.js";
it("returns the closed global package inventory result without acquiring external resources", async () => {
  const { executePackageResourcesCommand } = await import("./ancillary-resources-command.js");
  const request: Parameters<typeof executePackageResourcesCommand>[2] = { args: [], cwd: "/", signal: textContext.signal, filesystem: { async readFile() { throw new Error("Unexpected resource acquisition"); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} }, stderr: { async write() {} } };
  const bytes = await executePackageResourcesCommand({ operation: "custom-xml.list", inputs: ["/input"], options: { json: true } }, await textFixture('<w:p/>'), request, textContext);
  expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual({ version: 1, operation: "custom-xml.list", ok: true, data: { items: [] }, warnings: [], errors: [], affected: 0, locations: [] });
});
it("warns on incomplete native building-block metadata without dumping stored content", async () => {
  const { executePackageResourcesCommand } = await import("./ancillary-resources-command.js");
  const input = await textFixture('<w:p/>', { blocks: { kind: "document.glossary", xml: '<w:glossaryDocument xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docParts><w:docPart><w:docPartBody><w:p><w:r><w:t>Inert stored content</w:t></w:r></w:p></w:docPartBody></w:docPart></w:docParts></w:glossaryDocument>' } });
  const request: Parameters<typeof executePackageResourcesCommand>[2] = { args: [], cwd: "/", signal: textContext.signal, filesystem: { async readFile() { throw new Error("Unexpected resource acquisition"); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} }, stderr: { async write() {} } };
  const result = JSON.parse(new TextDecoder().decode(await executePackageResourcesCommand({ operation: "glossary.list", inputs: ["/input"], options: { json: true } }, input, request, textContext)));
  expect(result.warnings).toEqual([expect.objectContaining({ code: "unrecognized-resource-metadata" })]); expect(JSON.stringify(result)).not.toContain("Inert stored content");
});
it.each(['', '<w:docParts/><w:docParts/>'])("warns when the glossary metadata collection is missing or ambiguous: %s", async collection => {
  const { executePackageResourcesCommand } = await import("./ancillary-resources-command.js"), input = await textFixture('<w:p/>', { blocks: { kind: "document.glossary", xml: `<w:glossaryDocument xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${collection}</w:glossaryDocument>` } });
  const request: Parameters<typeof executePackageResourcesCommand>[2] = { args: [], cwd: "/", signal: textContext.signal, filesystem: { async readFile() { throw new Error("Unexpected resource acquisition"); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} }, stderr: { async write() {} } }, result = JSON.parse(new TextDecoder().decode(await executePackageResourcesCommand({ operation: "glossary.list", inputs: ["/input"], options: { json: true } }, input, request, textContext)));
  expect(result.warnings).toEqual([expect.objectContaining({ code: "unrecognized-resource-metadata" })]);
});

async function untypedItemFixture() {
  const archive = await readArchive(await textFixture('<w:p/>'), textContext), encode = (value: string) => new TextEncoder().encode(value), fs = Volume.fromJSON({ "/input": "" });
  const members = [...archive.members.map(member => member.name === "[Content_Types].xml" ? { ...member, bytes: encode(new TextDecoder().decode(member.bytes).replace('</Types>', '<Override PartName="/payload/item.xml" ContentType="application/xml"/></Types>')) } : member.name === "word/_rels/document.xml.rels" ? { ...member, bytes: encode(new TextDecoder().decode(member.bytes).replace('</Relationships>', '<Relationship Id="data" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../payload/item.xml"/></Relationships>')) } : member), { name: "payload/item.xml", bytes: encode('<data/>'), directory: false, modified: new Date("2025-01-01") }];
  await writeArchive({ ...archive, members }, { async write(bytes) { fs.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext); return new Uint8Array(fs.readFileSync("/input") as Buffer);
}
it("writes metadata warnings to the declared human diagnostic sink before inventory stdout", async () => {
  const input = await untypedItemFixture(), fs = Volume.fromJSON({ "/output": "", "/error": "" }), order: string[] = [];
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ['custom-xml','list','/input'].map(value => new TextEncoder().encode(value)), cwd: "/", signal: textContext.signal, filesystem: { async readFile() { return input; } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { order.push('output'); fs.appendFileSync('/output',bytes); } }, stderr: { async write(bytes) { order.push('diagnostic'); fs.appendFileSync('/error',bytes); } } });
  expect(result.exitCode).toBe(0); expect(fs.readFileSync('/error','utf8')).toContain('unrecognized-resource-metadata'); expect(order).toEqual(['diagnostic','output']);
});
it("admits lowered diagnostic bytes before attempting a warning sink write", async () => {
  const { executePackageResourcesCommand } = await import("./ancillary-resources-command.js"), writes: Uint8Array[] = [], request: Parameters<typeof executePackageResourcesCommand>[2] = { args: [], cwd: "/", signal: textContext.signal, filesystem: { async readFile() { throw new Error("Unexpected resource acquisition"); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} }, stderr: { async write(bytes: Uint8Array) { writes.push(bytes); } } };
  await expect(executePackageResourcesCommand({ operation: 'custom-xml.list', inputs: ['/input'], options: { limit: [{ name: 'diagnosticBytes', value: 1 }] } }, await untypedItemFixture(), request, textContext)).rejects.toMatchObject({ code: 'limit-exceeded' }); expect(writes).toEqual([]);
});
it.each(['failure','cancellation'])("keeps diagnostic %s from publishing inventory stdout", async scenario => {
  const input = await untypedItemFixture(), controller = new AbortController(), reason = new Error('Original diagnostic stop'), writes: Uint8Array[] = [];
  const pending = createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ['custom-xml','list','/input','--json'].map(value => new TextEncoder().encode(value)), cwd: '/', signal: controller.signal, filesystem: { async readFile() { return input; } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { writes.push(bytes); } }, stderr: { async write() { if (scenario === 'cancellation') controller.abort(reason); throw reason; } } });
  if (scenario === 'cancellation') await expect(pending).rejects.toBe(reason); else await expect(pending).resolves.toMatchObject({ exitCode: 3 }); expect(writes).toEqual([]);
});
