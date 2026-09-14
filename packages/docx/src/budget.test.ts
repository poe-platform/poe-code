import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import {
  DocumentBudget, documentLimitDefaults, InvalidValueError, ResourceLimitError,
  readArchive, readDocumentArchive, createDocumentArchive, writeArchive, validateDocumentArchive,
  parseDocumentXml, parseDocumentXmlAsync, DocumentArchiveEditor, MarkupCompatibility,
  type ArchiveLimits
} from "./index.js";
import { createDocumentFixture } from "../tests/fixtures/documents.js";

const bytes = (value: string) => new TextEncoder().encode(value);
const limits: ArchiveLimits = {
  maxArchiveBytes: 65536, maxEntryBytes: 32768, maxTotalBytes: 65536,
  maxMembers: 100, maxPathBytes: 4096, maxDepth: 32, maxExtraBytes: 1024,
  maxCommentBytes: 1024, maxRetainedBytes: 4 * 1024 * 1024, chunkSize: 512
};

it("validates every host and operation ceiling before acquisition", () => {
  for (const key of Object.keys(documentLimitDefaults)) {
    for (const value of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, "2", undefined]) {
      expect(() => new DocumentBudget({ [key]: value } as never)).toThrow(InvalidValueError);
    }
    const host = new DocumentBudget({ [key]: 2 });
    expect(() => host.lower({ [key]: 3 })).toThrow(InvalidValueError);
    expect(host.lower({ [key]: 1 }).limits[key as keyof typeof documentLimitDefaults]).toBe(1);
  }
  expect(() => new DocumentBudget({ typo: 1 } as never)).toThrow(InvalidValueError);
  expect(() => new DocumentBudget({ xmlDepth: 0 })).toThrow(InvalidValueError);
  expect(() => new DocumentBudget({ matches: 0 })).not.toThrow();
});

it("uses one ledger for lowered batch steps and both document inputs", () => {
  const budget = new DocumentBudget({ retainedBytes: 6, matches: 2, batchOperations: 2 });
  const first = budget.document();
  const second = budget.document();
  first.charge("retainedBytes", 3);
  second.charge("retainedBytes", 3);
  expect(() => first.charge("retainedBytes", 1)).toThrow(ResourceLimitError);
  budget.lower({ matches: 1 }).charge("matches", 1);
  budget.charge("matches", 1);
  expect(() => budget.lower({ matches: 1 }).charge("matches", 1)).toThrow(ResourceLimitError);
  budget.charge("batchOperations", 2);
  expect(() => budget.charge("batchOperations", 1)).toThrow(ResourceLimitError);
  expect(budget.usage.retainedBytes).toBe(6);
});

it("admits exact resource boundaries and rejects one more without changing counters", () => {
  for (const key of Object.keys(documentLimitDefaults) as (keyof typeof documentLimitDefaults)[]) {
    const budget = new DocumentBudget({ [key]: 2 });
    budget.charge(key, 2);
    expect(() => budget.charge(key, 1)).toThrow(ResourceLimitError);
    expect(budget.usage[key]).toBe(2);
  }
  const budget = new DocumentBudget({ tableRows: 2, tableColumns: 3, tableCells: 6 });
  budget.table(2, 3);
  expect(() => budget.table(3, 2)).toThrow(ResourceLimitError);
  expect(() => budget.table(1, 4)).toThrow(ResourceLimitError);
  expect(() => budget.table(Number.MAX_SAFE_INTEGER, 2)).toThrow(ResourceLimitError);
});

it("accounts archive inputs cumulatively before allocation", async () => {
  const { bytes: input } = await createDocumentFixture("garden");
  const budget = new DocumentBudget({ retainedBytes: 4 * 1024 * 1024 });
  const context = { limits, signal: new AbortController().signal, budget };
  await readArchive(input, context);
  const first = budget.usage.retainedBytes;
  await expect(readArchive(input, { ...context, budget: budget.lower({ retainedBytes: first }) })).rejects.toThrow(ResourceLimitError);
  expect(budget.usage.retainedBytes).toBe(first);
});

it("charges archive editor and snapshot copies before allocation", () => {
  const volume = Volume.fromJSON({ "/part.xml": "<r/>" });
  const input = new Uint8Array(volume.readFileSync("/part.xml") as Buffer);
  const archive = { members: [{ name: "part.xml", bytes: input, directory: false, modified: new Date(0) }], comment: new Uint8Array() };
  const budget = new DocumentBudget({ retainedBytes: 8 });
  const editor = new DocumentArchiveEditor(archive, {}, undefined, budget);
  expect(editor.snapshot().members[0]!.bytes).toEqual(input);
  expect(() => editor.snapshot()).toThrow(ResourceLimitError);
  expect(volume.readFileSync("/part.xml", "utf8")).toBe("<r/>");
});

it("enforces shared XML byte, node and work limits and lower-only parser options", () => {
  const input = bytes("<r><a/></r>");
  expect(() => parseDocumentXml(input, { maxBytes: 12 }, new DocumentBudget({ xmlPartBytes: 11 }))).toThrow(InvalidValueError);
  expect(() => parseDocumentXml(input, {}, new DocumentBudget({ xmlNodes: 1 }))).toThrow(ResourceLimitError);
  expect(() => parseDocumentXml(input, {}, new DocumentBudget({ work: 1 }))).toThrow(ResourceLimitError);
  expect(parseDocumentXml(input, {}, new DocumentBudget({ xmlPartBytes: input.length })).root.name).toBe("r");
});

it("yields cooperative XML work at bounded intervals and preserves cancellation", async () => {
  const controller = new AbortController();
  const turn = vi.fn(async () => { controller.abort(); });
  const budget = new DocumentBudget({}, controller.signal, turn);
  await expect(parseDocumentXmlAsync(bytes("<r>" + "a".repeat(9000) + "</r>"), {}, budget)).rejects.toMatchObject({ code: "cancelled" });
  expect(turn).toHaveBeenCalledTimes(1);
});

it("counts attributes and all retained XML content across successive parses", () => {
  const budget = new DocumentBudget({ xmlNodes: 6 });
  const source = bytes('<r a="b">text<!--note--></r>');
  parseDocumentXml(source, {}, budget);
  expect(budget.usage.xmlNodes).toBe(4);
  expect(() => parseDocumentXml(source, {}, budget)).toThrow(ResourceLimitError);
});

it("enforces media admission and table dimensions on original package content", async () => {
  const fixture = await createDocumentFixture("museum");
  await expect(readDocumentArchive(fixture.bytes, { limits, signal: new AbortController().signal,
    budget: new DocumentBudget({ embeddedMediaBytes: 61 }) })).rejects.toThrow(ResourceLimitError);
  const archive = await readArchive(fixture.bytes, { limits, signal: new AbortController().signal });
  expect(() => validateDocumentArchive(archive, {}, new DocumentBudget({ tableColumns: 1 }))).toThrow(ResourceLimitError);
});

it("refuses output over the invocation ceiling before calling a sink", async () => {
  const archive = { members: [{ name: "a", bytes: bytes("abc"), directory: false, modified: new Date(0) }], comment: new Uint8Array() };
  const output = vi.fn(async (_bytes: Uint8Array) => {});
  const budget = new DocumentBudget({ serializedOutput: 103 });
  const context = { limits, signal: new AbortController().signal, budget };
  await writeArchive(archive, { write: output }, { compression: "store", order: "name" }, context);
  expect(budget.usage.serializedOutput).toBe(103);
  const retained = budget.usage.retainedBytes;
  output.mockClear();
  await expect(writeArchive(archive, { write: output }, { compression: "store", order: "name" }, context)).rejects.toThrow(ResourceLimitError);
  expect(output).not.toHaveBeenCalled();
  expect(budget.usage.retainedBytes).toBe(retained);
});

it("snapshots host ceilings and rejects getters without invoking them", () => {
  const host = { matches: 2 };
  const budget = new DocumentBudget(host);
  host.matches = 20;
  expect(budget.limits.matches).toBe(2);
  const getter = vi.fn(() => 2);
  expect(() => budget.lower(Object.defineProperty({}, "matches", { get: getter }))).toThrow(InvalidValueError);
  expect(getter).not.toHaveBeenCalled();
  expect(() => Object.assign(budget, { limits: { matches: 20 } })).toThrow(TypeError);
});

it("yields while admitting package metadata before parsing the main part", async () => {
  const fixture = await createDocumentFixture("garden");
  const archive = await readArchive(fixture.bytes, { limits, signal: new AbortController().signal });
  const members = archive.members.map(member => ({ ...member, bytes: member.name === "[Content_Types].xml"
    ? bytes(new TextDecoder().decode(member.bytes).replace(">", ">" + " ".repeat(9000)))
    : member.name === "word/document.xml" ? bytes("<broken") : member.bytes }));
  const chunks: Uint8Array[] = [];
  await writeArchive({ ...archive, members }, { async write(chunk) { chunks.push(chunk); } },
    { order: "name", compression: "store" }, { limits, signal: new AbortController().signal });
  const input = new Uint8Array(Buffer.concat(chunks));
  const controller = new AbortController();
  const budget = new DocumentBudget({}, new AbortController().signal, async () => { controller.abort(); });
  await expect(readDocumentArchive(input, { limits, signal: controller.signal, budget })).rejects.toMatchObject({ code: "cancelled" });
});

it("bounds compatibility traversal work in the shared invocation", () => {
  const root = parseDocumentXml(bytes("<r><a/><b/></r>")).root;
  expect(() => new MarkupCompatibility(root, undefined, new DocumentBudget({ work: 1 }))).toThrow(ResourceLimitError);
});

it("applies a lowered XML work ceiling through final content accounting", () => {
  const input = bytes("<r>text</r>");
  const budget = new DocumentBudget();
  parseDocumentXml(input, {}, budget);
  const work = budget.usage.work;
  expect(() => parseDocumentXml(input, { maxWork: work })).not.toThrow();
  expect(() => parseDocumentXml(input, { maxWork: work - 1 })).toThrow(ResourceLimitError);
});

it("charges original creation against the inserted-node ceiling", async () => {
  await expect(createDocumentArchive({}, { limits, signal: new AbortController().signal,
    budget: new DocumentBudget({ insertedNodes: 1 }) })).rejects.toThrow(ResourceLimitError);
});

it("keeps returned package allocation and traversal on the invocation ledger", async () => {
  const fixture = await createDocumentFixture("garden");
  const budget = new DocumentBudget();
  const document = await readDocumentArchive(fixture.bytes, { limits, signal: new AbortController().signal, budget });
  budget.charge("work", budget.limits.work - budget.usage.work);
  expect(() => document.package.allocateRelationshipId("/")).toThrow(ResourceLimitError);
  expect(() => document.package.allocatePartName("/word/item", ".xml")).toThrow(ResourceLimitError);
  expect(() => [...document.package.iterParts()]).toThrow(ResourceLimitError);
});

it("rejects writer retention before allocating encoded path copies", async () => {
  const archive = { members: [{ name: "note", bytes: bytes("a"), directory: false, modified: new Date(0) }], comment: new Uint8Array() };
  const encode = vi.spyOn(TextEncoder.prototype, "encode");
  try {
    await expect(writeArchive(archive, { async write() {} }, { order: "name", compression: "store" },
      { limits, signal: new AbortController().signal, budget: new DocumentBudget({ retainedBytes: 1 }) })).rejects.toThrow(ResourceLimitError);
    expect(encode).not.toHaveBeenCalled();
  } finally { encode.mockRestore(); }
});
