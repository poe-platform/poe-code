import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import type { PropertyValue } from "./property-values.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const operation of ["comments.list", "comments.get", "revisions.list"] as const)
for (const route of ["sdk-batch", "cli", "cli-batch"] as const)
it(`returns the required review resource record; strict=${strict}; kind=${kind}; operation=${operation}; route=${route}`, async () => {
  const input = await textFixture('<w:p><w:commentRangeStart w:id="7"/><w:r><w:t>Range</w:t></w:r><w:commentRangeEnd w:id="7"/><w:r><w:commentReference w:id="7"/></w:r></w:p><w:p><w:ins w:id="8" w:author="Reviewer" w:date="2026-03-04T05:06:07Z"><w:r><w:t>Inserted</w:t></w:r></w:ins></w:p>', { comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="7" w:author="Reviewer" w:date="2026-03-04T05:06:07Z"><w:p><w:r><w:t>Note</w:t></w:r></w:p></w:comment></w:comments>` } }, strict, { kind });
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" }), options = operation === "comments.get" ? { comment: 1 } : {}, batch = { version: 1 as const, operations: [{ operation, arguments: options }] };
  let data: unknown;
  if (route === "sdk-batch") { const result = await api.executeDocumentBatch(input, batch, { dryRun: true }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } }); data = result.results[0]!.data; }
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const result = await shell.exec((route === "cli-batch" ? `docx batch /input --ops-json '${JSON.stringify(batch)}' --dry-run` : `docx ${operation.split(".").join(" ")} /input${operation === "comments.get" ? " --comment 1" : ""}`) + " --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); const envelope = JSON.parse(result.stdout); data = route === "cli-batch" ? envelope.data.results[0].data : envelope.data; expect(await fs.readFile("/input")).toEqual(input); } finally { await shell.dispose(); } }
  const records = data as { item?: unknown; items?: unknown[] }, record = operation === "comments.get" ? records.item : records.items?.[0];
  expect(record).toMatchObject({ kind: operation.startsWith("comments.") ? "comments" : "revisions", location: { kind: operation.startsWith("comments.") ? "story" : "annotation" }, properties: expect.any(Array), references: expect.any(Array), support: expect.stringMatching(/^(edit|read|preserve|reject)$/u) });
  const document = await api.openDocumentLocations(input, textContext);
  const location = (record as { location: api.Location }).location;
  expect(document.resolve(location.token)).toEqual(location);
  expect(location.value.part).toBe(operation.startsWith("comments.") ? "/word/comments.xml" : "/word/document.xml");
  const properties = (record as { properties: PropertyValue[] }).properties;
  expect(properties).toEqual(expect.arrayContaining([{ name: operation.startsWith("comments.") ? "comment_id" : "id", type: operation.startsWith("comments.") ? "integer" : "string", value: operation.startsWith("comments.") ? 7 : "8", writable: false, cached: false }, expect.objectContaining({ name: "author", type: "string", value: "Reviewer" }), expect.objectContaining({ name: "timestamp", type: "date", value: "2026-03-04T05:06:07Z", writable: false, cached: false })]));
  expect(memory.statSync("/output").size).toBe(0); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
