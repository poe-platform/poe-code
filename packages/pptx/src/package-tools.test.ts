import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { createPresentation } from "./creation.js";
import { extractPackage, packPackage } from "./package-tools.js";
import { inspectZip } from "../tests/zip-reader.js";
import { writePackageArchive } from "./package-writer.js";

const context = {
  limits: { maxBytes: 200000, maxReads: 1000, chunkBytes: 65536 },
  archiveLimits: { maxArchiveBytes: 200000, maxEntryBytes: 100000, maxTotalBytes: 200000, maxMembers: 100, maxPathBytes: 256, maxDepth: 16, maxPaxBytes: 1024, maxTextBytes: 100000, chunkSize: 65536 },
  xmlLimits: { maxBytes: 100000, maxNodes: 10000, maxDepth: 40 },
  relationshipLimits: { maxBytes: 100000, maxParts: 100, maxRelationships: 200 }
};
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) => delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const text = (value: string) => new TextEncoder().encode(value);
async function fixture() {
  const base = await createPresentation({}, context);
  const members = inspectZip(base).map(({ name, payload }) => ({ name, bytes: payload }));
  const types = members.find(member => member.name === "[Content_Types].xml")!;
  types.bytes = text(new TextDecoder().decode(types.bytes).replace("</Types>", '<Override PartName="/extras/keepsake.dat" ContentType="application/octet-stream"/></Types>'));
  members.push({ name: "extras/keepsake.dat", bytes: Uint8Array.of(0, 255, 23, 128) });
  return writePackageArchive(members, context, { compression: "store" });
}

describe("explicit package tools", () => {
  it("extracts deterministic safe names with independent hashes and preserves opaque bytes on repack", async () => {
    const original = await fixture();
    const extracted = await extractPackage(original, context);
    expect(extracted.map(item => item.part)).toEqual(inspectZip(original).map(item => `/${item.name}`).sort());
    expect(extracted.every((item, index) => item.name.startsWith(`part-${String(index + 1).padStart(6, "0")}.`))).toBe(true);
    for (const item of extracted) expect(item.sha256).toBe(digest(item.bytes));
    const opaque = extracted.find(item => item.part === "/extras/keepsake.dat")!;
    expect(opaque.bytes).toEqual(Uint8Array.of(0, 255, 23, 128));
    expect(opaque.name.endsWith(".bin")).toBe(true);
    const volume = Volume.fromJSON({});
    for (const item of extracted) volume.writeFileSync(`/${item.name}`, item.bytes);
    const packed = await packPackage(extracted.map(item => ({ part: item.part, sha256: item.sha256, bytes: { path: `/${item.name}`, capability: { async openRead(path: string) { let read = false; return { async read() { if (read) return null; read = true; return new Uint8Array(volume.readFileSync(path) as Buffer); } }; } } } })), context);
    expect(inspectZip(packed).map(item => [item.name, item.payload])).toEqual(inspectZip(original).sort((a,b) => a.name < b.name ? -1 : 1).map(item => [item.name, item.payload]));
  });
  it("selects canonical parts in requested order without interpreting member paths as output paths", async () => {
    const files = await extractPackage(await fixture(), context, { parts: ["/extras/keepsake.dat", "/[Content_Types].xml"] });
    expect(files.map(file => file.name)).toEqual(["part-000001.bin", "part-000002.xml"]);
    await expect(extractPackage(await fixture(), context, { parts: ["/missing.xml"] })).rejects.toMatchObject({ code: "missing-binding" });
  });
  it.each(["/../outside.xml", "/folder/%2e%2e/outside.xml", "/folder\\outside.xml", "relative.xml"])("rejects unsafe manifest part %s before reading capabilities", async part => {
    let reads = 0;
    await expect(packPackage([{ part, sha256: "0".repeat(64), bytes: { async read() { reads++; return null; } } }], context)).rejects.toMatchObject({ code: "unsafe-path" });
    expect(reads).toBe(0);
  });
  it.each([[["/folder", "/folder/item.xml"]], [["/FOLDER/item.xml", "/folder/item.xml"]]])("rejects manifest namespace collisions before reading capabilities", async parts => {
    let reads = 0;
    await expect(packPackage(parts.map(part => ({ part, sha256: "0".repeat(64), bytes: { async read() { reads++; return null; } } })), context)).rejects.toMatchObject({ code: "invalid-opc" });
    expect(reads).toBe(0);
  });
  it("rejects changed hashes, incomplete graphs and mismatched presentation kinds", async () => {
    const files = await extractPackage(await fixture(), context);
    await expect(packPackage(files.map((file, index) => ({ part: file.part, bytes: file.bytes, sha256: index ? file.sha256 : "0".repeat(64) })), context)).rejects.toMatchObject({ code: "invalid-value" });
    await expect(packPackage(files.filter(file => file.part !== "/ppt/slideLayouts/slideLayout1.xml"), context)).rejects.toMatchObject({ code: "missing-binding" });
    await expect(packPackage(files, context, { kind: "potx" })).rejects.toMatchObject({ code: "invalid-opc" });
  });
  it("rejects extraction selection budgets and accessor records before input reads", async () => {
    let reads = 0;
    const source = { async read() { reads++; return null; } };
    await expect(extractPackage(source, context, { parts: Array(101).fill("/p.xml") })).rejects.toMatchObject({ code: "resource-limit" });
    const options = Object.defineProperty({}, "parts", { get() { reads++; return []; } });
    await expect(extractPackage(source, context, options)).rejects.toMatchObject({ code: "invalid-value" });
    expect(reads).toBe(0);
  });
  it("owns later byte members before awaiting earlier capabilities", async () => {
    const files = await extractPackage(await fixture(), context);
    const last = files.at(-1)!;
    const expected = new Uint8Array(last.bytes);
    let pulled = false;
    const members = files.map(file => ({ part: file.part, sha256: file.sha256, bytes: file.bytes as import("./contracts.js").BinaryInput }));
    const first = files[0]!.bytes;
    members[0]!.bytes = { async read() { if (pulled) return null; pulled = true; last.bytes.fill(0); return first; } };
    const packed = await packPackage(members, context);
    expect(inspectZip(packed).find(file => `/${file.name}` === last.part)!.payload).toEqual(expected);
  });
  it("admits an empty trailing member at the exact aggregate byte ceiling", async () => {
    const files = await extractPackage(await fixture(), context);
    const types = files.find(file => file.part === "/[Content_Types].xml")!;
    const replacement = text(new TextDecoder().decode(types.bytes).replace("</Types>", '<Override PartName="/z-empty.bin" ContentType="application/octet-stream"/></Types>'));
    const members = files.map(file => ({ part: file.part, sha256: file.part === types.part ? digest(replacement) : file.sha256, bytes: file.part === types.part ? replacement : file.bytes }));
    members.push({ part: "/z-empty.bin", sha256: digest(new Uint8Array()), bytes: new Uint8Array() });
    const maxTotalBytes = members.reduce((sum, member) => sum + member.bytes.length, 0);
    const packed = await packPackage(members, { ...context, archiveLimits: { ...context.archiveLimits, maxTotalBytes } });
    expect(inspectZip(packed).find(file => file.name === "z-empty.bin")!.payload).toEqual(new Uint8Array());
  });
  it("rejects cumulative input overflow and cancellation", async () => {
    const files = await extractPackage(await fixture(), context);
    await expect(packPackage(files, { ...context, archiveLimits: { ...context.archiveLimits, maxTotalBytes: 1 } })).rejects.toMatchObject({ code: "resource-limit" });
    const controller = new AbortController(); controller.abort();
    await expect(extractPackage(await fixture(), { ...context, signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" });
  });
});
