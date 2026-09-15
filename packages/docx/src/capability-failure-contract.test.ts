import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createDocxInspectionCommandEngine } from "./inspection-command.js";
import { getDocxDiscovery, type DocxSchemaData } from "./discovery.js";

it("declares the unsupported-operation failure exposed by pending commands", async () => {
  let output = "", reads = 0;
  const volume = Volume.fromJSON({ "/source.docx": "unread" });
  const result = await createDocxInspectionCommandEngine({ limits: {
    maxArchiveBytes: 65536, maxEntryBytes: 16384, maxTotalBytes: 65536,
    maxMembers: 32, maxPathBytes: 256, maxDepth: 16, maxExtraBytes: 1024,
    maxCommentBytes: 1024, maxRetainedBytes: 500000, chunkSize: 1024
  } }).execute({
    args: ["paragraphs", "list", "/source.docx", "--json"].map(value => new TextEncoder().encode(value)),
    cwd: "/", signal: new AbortController().signal,
    filesystem: { async readFile(path) { reads++; return new Uint8Array(volume.readFileSync(path) as Uint8Array); } },
    stdin: { [Symbol.asyncIterator]() { return {
      async next(): Promise<IteratorResult<Uint8Array>> { throw new Error("Unexpected stdin"); }
    }; } },
    stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } }, stderr: { async write() {} }
  });
  expect(result.exitCode).toBe(1);
  expect(reads).toBe(0);
  const envelope = JSON.parse(output);
  expect(envelope).toMatchObject({ ok: false, data: null, errors: [{ code: "unsupported-profile" }] });
  const schema = getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: "paragraphs.list" } })!.data as DocxSchemaData;
  expect(schema.operations[0]!.support).toBe("reject");
  const errorSchema = schema.operations[0]!.result.properties!.errors!.items;
  if (!errorSchema) throw new Error("Expected a structured rejection schema");
  expect(errorSchema.properties!.code!.enum).toContain(envelope.errors[0].code);
});

it("advertises the document admission failures emitted by input capabilities", async () => {
  const volume = Volume.fromJSON({ "/source.docx": "not an archive" });
  const before = volume.toJSON();
  let output = "";
  const encoder = new TextEncoder();
  const result = await createDocxInspectionCommandEngine({ limits: {
    maxArchiveBytes: 65536, maxEntryBytes: 16384, maxTotalBytes: 65536,
    maxMembers: 32, maxPathBytes: 256, maxDepth: 16, maxExtraBytes: 1024,
    maxCommentBytes: 1024, maxRetainedBytes: 500000, chunkSize: 1024
  } }).execute({
    args: ["capabilities", "/source.docx", "--json"].map(value => encoder.encode(value)),
    cwd: "/", signal: new AbortController().signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Uint8Array); } },
    stdin: { [Symbol.asyncIterator]() { return {
      async next(): Promise<IteratorResult<Uint8Array>> { throw new Error("Unexpected stdin acquisition"); }
    }; } },
    stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
    stderr: { async write() {} }
  });
  expect(result.exitCode).toBe(1);
  const envelope = JSON.parse(output);
  expect(envelope).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "invalid-container" }] });
  const schema = getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: "capabilities" } })!.data as DocxSchemaData;
  const errorSchema = schema.operations[0]!.result.oneOf![1]!.properties!.errors!.items;
  if (!errorSchema) throw new Error("Expected a structured failure schema");
  const codes = errorSchema.properties!.code!.enum!;
  for (const error of envelope.errors) expect(codes).toContain(error.code);
  expect(volume.toJSON()).toEqual(before);
});
