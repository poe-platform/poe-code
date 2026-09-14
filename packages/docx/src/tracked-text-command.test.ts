import { describe, expect, expectTypeOf, it } from "vitest";
import { parseDocxArguments, validateDocxInvocation } from "./command.js";
import { getDocxDiscovery, type DocxSchemaData, type DocxCapabilitiesData } from "./discovery.js";
import { getDocxOperationSchema } from "./operation-json-schema.js";
import { encodeLocation } from "./location-token.js";
import { docxOperationSchemas } from "./operation-schema.js";
import type { DocxOperationArgumentMap, DocxBatchArgumentMap } from "./operation-types.js";

const metadata = { author: "", timestamp: "2026-04-03T02:01:00.123Z" };
const replace = { find: "before", with: "after", first: true, dryRun: true };
const validate = (options: Record<string, unknown>) => validateDocxInvocation({ operation: "text.replace", inputs: ["input.docx"], options });

describe("explicit tracked text command metadata", () => {
  it("admits explicit tracking with empty author and UTC precision through both transports", () => {
    expect(validate({ ...replace, trackChanges: true, ...metadata }).options).toMatchObject(metadata);
    const args = ["text", "replace", "input.docx", "--find", "before", "--with", "after", "--first", "--dry-run", "--track-changes", "--author", "", "--timestamp", metadata.timestamp];
    expect(parseDocxArguments(args.map(arg => new TextEncoder().encode(arg))).options.trackChanges).toBe(true);
  });
  it("requires caller metadata only for true tracking", () => {
    for (const options of [{ trackChanges: true }, { trackChanges: true, author: "A" }, { trackChanges: true, timestamp: metadata.timestamp }, { ...metadata }, { trackChanges: false, ...metadata }]) {
      expect(() => validate({ ...replace, ...options })).toThrow();
    }
    expect(() => validate({ ...replace, trackChanges: false })).not.toThrow();
    expect(() => validate({ ...replace, trackChanges: true, ...metadata, timestamp: "2026-04-03T02:01:00+00:00" })).toThrow();
  });
  it("requires tracking metadata in public TypeScript arguments", () => {
    // @ts-expect-error Explicit tracking requires author and timestamp.
    const missing: DocxOperationArgumentMap["text.replace"] = { find: "a", with: "b", trackChanges: true };
    // @ts-expect-error Ordinary replacement cannot carry review metadata.
    const ordinary: DocxBatchArgumentMap["text.replace"] = { find: "a", with: "b", author: "A", timestamp: metadata.timestamp };
    expectTypeOf(missing).toMatchTypeOf<DocxOperationArgumentMap["text.replace"]>();
    expectTypeOf(ordinary).toMatchTypeOf<DocxBatchArgumentMap["text.replace"]>();
  });
  it("keeps declared direct, SDK and batch option types aligned", () => {
    const schema = docxOperationSchemas["text.replace"]!;
    for (const fields of [schema.fields, schema.sdkFields, schema.batchFields!]) {
      expect(fields.trackChanges).toEqual({ type: "boolean", required: false });
      expect(fields.author).toEqual({ type: "string", required: false });
      expect(fields.timestamp).toEqual({ type: "UTC instant", required: false });
    }
    expectTypeOf<DocxOperationArgumentMap["text.replace"]["trackChanges"]>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<DocxBatchArgumentMap["text.replace"]["timestamp"]>().toEqualTypeOf<string | undefined>();
  });
});


describe("tracked creation placement and schema", () => {
  const revision = (options: Record<string, unknown>) => validateDocxInvocation({ operation: "revisions.add", inputs: ["input.docx"], options: { ...metadata, dryRun: true, ...options } });
  const token = (start: number, end: number) => encodeLocation({ version: 1, sourceSha256: "a".repeat(64), generation: 0, part: "/word/document.xml", story: "body", path: [0, 0], range: { start, end } });
  it("allows paragraph/run append and whole-text deletion while guarding range kinds", () => {
    expect(() => revision({ kind: "insert", paragraph: 1, text: "tail" })).not.toThrow();
    expect(() => revision({ kind: "delete", all: true, scope: "body" })).not.toThrow();
    expect(() => revision({ kind: "delete", paragraph: 1, run: 2 })).not.toThrow();
    expect(() => revision({ kind: "insert", select: token(2, 2), text: "new" })).not.toThrow();
    expect(() => revision({ kind: "insert", select: token(1, 3), text: "new" })).toThrow();
    expect(() => revision({ kind: "delete", select: token(2, 2) })).toThrow();
    expect(() => revision({ kind: "insert", paragraph: 1 })).toThrow();
    expect(() => revision({ kind: "delete", paragraph: 1, text: "old" })).toThrow();
    expect(() => revision({ kind: "move", paragraph: 1, text: "old" })).toThrow();
    expect(() => revision({ kind: "insert", table: 1, text: "new" })).toThrow();
  });
  it("requires insertion text and forbids deletion text in public types", () => {
    // @ts-expect-error Insertion requires explicit text.
    const missing: DocxOperationArgumentMap["revisions.add"] = { kind: "insert", ...metadata };
    // @ts-expect-error Deletion selects existing text rather than accepting replacement text.
    const deletion: DocxBatchArgumentMap["revisions.add"] = { kind: "delete", ...metadata, text: "old" };
    expectTypeOf(missing).toMatchTypeOf<DocxOperationArgumentMap["revisions.add"]>();
    expectTypeOf(deletion).toMatchTypeOf<DocxBatchArgumentMap["revisions.add"]>();
  });
  it("exposes conditional metadata and insertion requirements in generated schemas", () => {
    for (const transport of ["cli", "sdk", "batch"] as const) {
      expect(getDocxOperationSchema("text.replace", transport).allOf).toEqual([
        { anyOf: [
          { properties: { trackChanges: { const: true } }, required: ["trackChanges", "author", "timestamp"] },
          { properties: { trackChanges: { const: false } }, not: { anyOf: [{ required: ["author"] }, { required: ["timestamp"] }] } },
        ] },
      ]);
      expect(getDocxOperationSchema("revisions.add", transport).allOf).toEqual([{ anyOf: [
        { properties: { kind: { const: "insert" } }, required: ["text"] },
        { properties: { kind: { const: "delete" } }, not: { required: ["text"] } },
      ] }]);
    }
  });
});


it("advertises bounded tracked creation alongside bounded revision decisions", () => {
  const schema = getDocxDiscovery({ operation: "schema", inputs: [], options: {} })!.data as DocxSchemaData;
  expect(schema.operations.filter(item => ["revisions.add", "text.replace", "revisions.accept", "revisions.reject"].includes(item.id)).map(({ id, support, featureIds }) => ({ id, support, featureIds }))).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "revisions.add", support: "edit", featureIds: expect.arrayContaining(["F26"]) }),
    expect.objectContaining({ id: "text.replace", support: "edit", featureIds: expect.arrayContaining(["F26"]) }),
  ]));
  for (const operation of ["revisions.accept", "revisions.reject"]) {
    const declared = getDocxDiscovery({ operation: "schema", inputs: [], options: { operation } })!.data as DocxSchemaData;
    expect(declared.operations).toMatchObject([{ id: operation, support: "edit", featureIds: ["F26"] }]);
  }
  const capabilities = getDocxDiscovery({ operation: "capabilities", inputs: [], options: {} })!.data as DocxCapabilitiesData;
  expect(capabilities).toMatchObject({ features: expect.arrayContaining([
    expect.objectContaining({ id: "F26", level: "edit", subsets: expect.arrayContaining([
      expect.objectContaining({ name: "tracked-text-creation", level: "edit" }),
    ]) }),
  ]) });
});
