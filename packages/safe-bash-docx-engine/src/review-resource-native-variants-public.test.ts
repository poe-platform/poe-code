import { Ajv2020 } from "ajv/dist/2020.js";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import type { DocxSchemaData } from "./discovery.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const operation of ["comments.list", "comments.get", "revisions.list"] as const)
for (const route of ["sdk-batch", "cli", "cli-batch"] as const)
for (const date of [null, "2026-03-04T05:06:07.987+02:30", "bad-date"])
it(`review native resource schema and relationship order; strict=${strict}; kind=${kind}; operation=${operation}; route=${route}; date=${date}`, async () => {
  const dateAttribute = date === null ? "" : ` w:date="${date}"`;
  const original = await textFixture(`<w:p><w:ins w:id="8" w:author="海🌊"${dateAttribute}><w:r><w:t>Inserted</w:t></w:r></w:ins></w:p>`, { comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id=" &#x9;+007&#xA; " w:author="海🌊"${dateAttribute}><w:p><w:r><w:t>Note</w:t></w:r></w:p></w:comment></w:comments>` } }, strict, { kind });
  const archive = await api.readArchive(original, textContext);
  const relationshipNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
  const target = operation.startsWith("comments.") ? "comments.xml" : "document.xml";
  // Two inert declarations in reverse ID order distinguish XML order from ID sorting.
  const owner = archive.members.find(member => member.name === "word/_rels/document.xml.rels")!;
  const editor = new api.DocumentXmlEditor(owner.bytes);
  editor.insertChildren(editor.root, `<Relationship xmlns="${relationshipNamespace}" Id="z-audit" Type="urn:review:audit" Target="${target}"/><Relationship xmlns="${relationshipNamespace}" Id="a-audit" Type="urn:review:audit" Target="${target}"/>`);
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ ...archive, members: archive.members.map(member => member === owner ? { ...member, bytes: editor.serialize() } : member) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const options = operation === "comments.get" ? { comment: 1 } : {};
  const batch = { version: 1 as const, operations: [{ operation, arguments: options }] };
  let result: unknown;
  if (route === "sdk-batch") result = (await api.executeDocumentBatch(input, batch, { dryRun: true }, { ...textContext, encoding: { order: "input", compression: "store" } })).results[0];
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const response = await shell.exec((route === "cli-batch" ? `docx batch /input --ops-json '${JSON.stringify(batch)}' --dry-run` : `docx ${operation.split(".").join(" ")} /input${operation === "comments.get" ? " --comment 1" : ""}`) + " --json");
      expect(response.exitCode, response.stdout + response.stderr).toBe(0);
      const envelope = JSON.parse(response.stdout); result = route === "cli-batch" ? envelope.data.results[0] : envelope;
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const schema = api.getDocxDiscovery({ operation: "schema", inputs: [], options: { operation } })!.data as DocxSchemaData;
  const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(schema.operations[0]!.result);
  const { id: stepId, ...operationResult } = result as Record<string, unknown>;
  expect(stepId).toBe(route === "cli" ? undefined : "step1");
  expect(validate(operationResult), JSON.stringify(validate.errors)).toBe(true);
  const data = (result as { data: { item?: { properties: { name: string; value: unknown }[]; references: { owner: string; id: string; target: string }[]; details: { storedTimestamp: unknown }; location: api.Location }; items?: { properties: { name: string; value: unknown }[]; references: { owner: string; id: string; target: string }[]; details: { storedTimestamp: unknown }; location: api.Location }[] } }).data;
  const item = data.item ?? data.items![0]!;
  expect(item.properties.find(property => property.name === "timestamp")!.value).toBe(date !== null && date !== "bad-date" ? "2026-03-04T02:36:07Z" : null);
  expect(item.properties.find(property => property.name === "stored_timestamp")!.value).toBe(date);
  expect(item.references.filter(reference => reference.owner === "/word/document.xml").map(reference => reference.id)).toEqual(operation.startsWith("comments.") ? ["comments", "z-audit", "a-audit"] : ["z-audit", "a-audit"]);
  expect(item.references.filter(reference => reference.owner === "/word/document.xml").every(reference => reference.target === target)).toBe(true);
  const document = await api.openDocumentLocations(input, textContext);
  expect(document.resolve(item.location.token)).toEqual(item.location);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
  expect(memory.statSync("/output").size).toBe(0);
});
