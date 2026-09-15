import { expect, it } from "vitest";
import { Volume } from "memfs";
import { getDocxDiscovery, type DocxSchemaData, type DocxCapabilitiesData, type DocxHelpData } from "./discovery.js";
import { docxOperationSchemas } from "./operation-schema.js";
import { createDocxInspectionCommandEngine } from "./inspection-command.js";
import { createDocumentFixture } from "../tests/fixtures/documents.js";
import { readArchive, writeArchive } from "./index.js";

const encoder = new TextEncoder();
const limits = { maxArchiveBytes: 65536, maxEntryBytes: 16384, maxTotalBytes: 65536, maxMembers: 32, maxPathBytes: 256, maxDepth: 16, maxExtraBytes: 1024, maxCommentBytes: 1024, maxRetainedBytes: 500000, chunkSize: 1024 };
it("keeps human capability descriptions readable at ordinary terminal widths", () => {
  const result = getDocxDiscovery({ operation: "capabilities", inputs: [], options: {} })!;
  expect(result.human.split("\n").every(line => line.length <= 140)).toBe(true);
});
it("escapes directional controls in human namespace reports while retaining JSON values", async () => {
  const { inspectDocxCapabilities } = await import("./discovery.js");
  const context = { limits, signal: new AbortController().signal };
  const source = await createDocumentFixture("equipment");
  const archive = await readArchive(source.bytes, context);
  const namespace = "urn:original:\u202eequipment";
  const members = archive.members.map(member => member.name === "word/document.xml" ? {
    ...member, bytes: encoder.encode(new TextDecoder().decode(member.bytes).replaceAll("urn:original:equipment", namespace))
  } : member);
  const volume = Volume.fromJSON({ "/source.docx": "" });
  await writeArchive({ ...archive, members }, { async write(chunk) { volume.appendFileSync("/source.docx", chunk); } }, { order: "input", compression: "store" }, context);
  const before = volume.toJSON();
  const result = await inspectDocxCapabilities(new Uint8Array(volume.readFileSync("/source.docx") as Uint8Array), context);
  expect((result.data as DocxCapabilitiesData).input!.unsupportedNamespaces).toContain(namespace);
  expect(result.human).not.toContain("\u202e");
  expect(result.human).toContain("urn:original:\\u202eequipment");
  expect(volume.toJSON()).toEqual(before);
});
it("accounts for every declaration in root schemas, including unsupported public receivers", () => {
  const data = getDocxDiscovery({ operation: "schema", inputs: [], options: {} })!.data as DocxSchemaData;
  expect(data.operations.map(item => item.id)).toEqual(Object.keys(docxOperationSchemas));
  expect(data.operations.find(item => item.id === "model.table._Cell.merge.call")).toMatchObject({ path: ["batch"], support: "reject" });
  expect(data.operations.find(item => item.id === "model.image.image.Image.sha1.get")).toMatchObject({ support: "read" });
});
it("classifies every format requirement without promoting preservation to editing", () => {
  const data = getDocxDiscovery({ operation: "capabilities", inputs: [], options: {} })!.data as DocxCapabilitiesData;
  expect(new Set(data.features.map(item => item.id))).toEqual(new Set(Array.from({ length: 50 }, (_, index) => `F${String(index + 1).padStart(2, "0")}`)));
  expect(data.features.find(item => item.id === "F37")).toMatchObject({ level: "read" });
  expect(data.features.find(item => item.id === "F41")).toMatchObject({ level: "preserve" });
  const help = getDocxDiscovery({ operation: "help", inputs: [], options: { operation: "text.replace" } })!.human;
  for (const text of ["headers", "all-stories", "Limits", "stale", "stdout", "Exit", "preserve", "reject"]) expect(help).toContain(text);
});
it("checks input capabilities through explicit memfs without writes or implicit stdin", async () => {
  const { bytes } = await createDocumentFixture("equipment");
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/source.docx", bytes);
  const before = volume.toJSON();
  let output = "";
  const result = await createDocxInspectionCommandEngine({ limits }).execute({
    args: ["capabilities", "/source.docx", "--json"].map(value => encoder.encode(value)), cwd: "/",
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Uint8Array); } },
    stdin: { [Symbol.asyncIterator]() { return { async next(): Promise<IteratorResult<Uint8Array>> { throw new Error("Undeclared stdin access"); } }; } },
    stdout: { async write(value) { output += new TextDecoder().decode(value); } }, stderr: { async write() {} }, signal: new AbortController().signal
  });
  expect(result.exitCode).toBe(0);
  const envelope = JSON.parse(output);
  expect(envelope).toMatchObject({ version: 1, operation: "capabilities", ok: true, affected: 0, data: { host: { read: true }, input: { signed: false } } });
  expect(envelope.data.input.unsupportedNamespaces).toContain("urn:original:equipment");
  expect(envelope.data.features).toEqual(expect.arrayContaining([expect.objectContaining({ id: "F01", detected: true })]));
  expect(volume.toJSON()).toEqual(before);
});
it("declares the actual capabilities result and inspection namespace fields", () => {
  const schema = getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: "capabilities" } })!.data as DocxSchemaData;
  const data = schema.operations[0]!.result.oneOf![0]!.properties!.data!;
  expect(data.required).toContain("input");
  expect(data.properties!.features!.items).toMatchObject({ properties: { detected: { oneOf: [{ type: "boolean" }, { type: "null" }] } } });
  expect(data.properties!.host!.properties!.atomicReplace).toEqual({ type: "boolean" });
});
it("links every declaration to format requirements and usable detailed help", () => {
  const data = getDocxDiscovery({ operation: "schema", inputs: [], options: {} })!.data as DocxSchemaData;
  expect(data.operations.filter(item => item.featureIds.length === 0).map(item => item.id)).toEqual([]);
  const help = getDocxDiscovery({ operation: "help", inputs: [], options: {} })!.data as DocxHelpData;
  expect(help.paths.flatMap(path => path.operationIds)).toEqual(Object.keys(docxOperationSchemas));
  for (const operation of data.operations) {
    const detail = getDocxDiscovery({ operation: "help", inputs: [], options: { operation: operation.id } })!;
    expect((detail.data as DocxHelpData).paths.flatMap(path => path.operationIds)).toEqual([operation.id]);
    expect(detail.human).toContain(`Support for this operation: ${operation.support}`);
  }
});
it("shares admitted-byte capability behavior with the public SDK and rejects unsupported selectors before I/O", async () => {
  const sdk = await import("./index.js");
  const { bytes } = await createDocumentFixture("garden");
  const pending = sdk.inspectDocxCapabilities(bytes, { limits, signal: new AbortController().signal });
  expect(pending).toBeInstanceOf(Promise);
  expect((await pending).data).toMatchObject({ host: { read: false, atomicReplace: false, transactions: false }, input: { signed: false, protected: false } });
  let reads = 0, output = "";
  const result = await createDocxInspectionCommandEngine({ limits }).execute({
    args: ["capabilities", "/source.docx", "--paragraph", "1", "--json"].map(value => encoder.encode(value)), cwd: "/",
    filesystem: { async readFile() { reads++; return bytes; } }, stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
    stdout: { async write(value) { output += new TextDecoder().decode(value); } }, stderr: { async write() {} }, signal: new AbortController().signal
  });
  expect(result.exitCode).toBe(2);
  expect(reads).toBe(0);
  expect(JSON.parse(output)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "usage" }] });
});
it("preserves capability failure categories and publishes no successful partial data", async () => {
  for (const [mode, exitCode, code] of [["invalid", 1, "invalid-container"], ["io", 3, "source-failure"], ["limit", 4, "limit-exceeded"]] as const) {
    let output = "";
    const result = await createDocxInspectionCommandEngine({ limits }).execute({
      args: ["capabilities", "/source.docx", "--json", ...(mode === "limit" ? ["--limit", "compressedInput=1"] : [])].map(value => encoder.encode(value)), cwd: "/",
      filesystem: { async readFile() { if (mode === "io") throw new Error("Private input details"); return new Uint8Array([3, 5, 7]); } }, stdin: { async *[Symbol.asyncIterator]() { yield new Uint8Array(); } },
      stdout: { async write(value) { output += new TextDecoder().decode(value); } }, stderr: { async write() {} }, signal: new AbortController().signal
    });
    expect(result.exitCode).toBe(exitCode);
    expect(JSON.parse(output)).toMatchObject({ operation: "capabilities", ok: false, data: null, affected: 0, errors: [{ code }] });
    expect(output).not.toContain("Private input details");
  }
});
it("does not claim advertised host guarantees from method recognition alone", async () => {
  const sdk = await import("./index.js");
  const { bytes } = await createDocumentFixture("garden");
  let calls = 0;
  const discovery = await sdk.inspectDocxCapabilities(bytes, { limits, signal: new AbortController().signal }, {
    capabilities: { read: false, atomicFileStaging: false }, async readFile() { calls++; return bytes; }
  });
  expect(discovery.data).toMatchObject({ host: { read: false, atomicReplace: false, transactions: false } });
  expect(calls).toBe(0);
});
it("bounds the selected capabilities serialization independently of the alternate human output", async () => {
  const { inspectDocxCapabilities } = await import("./discovery.js");
  const { bytes } = await createDocumentFixture("garden");
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/source.docx", bytes);
  const before = volume.toJSON();
  const baseline = await inspectDocxCapabilities(bytes, { limits, signal: new AbortController().signal });
  const ceiling = encoder.encode(JSON.stringify(baseline.data)).byteLength + 1024;
  let output = "";
  const result = await createDocxInspectionCommandEngine({ limits }).execute({
    args: ["capabilities", "/source.docx", "--json", "--limit", `serializedOutput=${ceiling}`].map(value => encoder.encode(value)), cwd: "/",
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Uint8Array); } },
    stdin: { [Symbol.asyncIterator]() { return { async next(): Promise<IteratorResult<Uint8Array>> { throw new Error("Undeclared stdin access"); } }; } },
    stdout: { async write(value) { output += new TextDecoder().decode(value); } }, stderr: { async write() {} }, signal: new AbortController().signal
  });
  expect(result.exitCode).toBe(0);
  expect(encoder.encode(output).byteLength).toBeLessThanOrEqual(ceiling);
  expect(JSON.parse(output)).toMatchObject({ ok: true, affected: 0 });
  expect(volume.toJSON()).toEqual(before);
});
