import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, MountFileSystem, ReadOnlyFileSystem, type FileSystem, type FileStat } from "@poe-code/safe-fs/core";
import * as sdk from "./index.js";
import { textContext, textFixture, paragraph } from "../tests/fixtures/text.js";
import { createDocxInspectionCommandEngine } from "./inspection-command.js";
import { getDocxDiscovery } from "./discovery.js";
import { parseDocxArguments } from "./command.js";

function destination(fail = false) {
  const volume = Volume.fromJSON({ "/keep.txt": "untouched" });
  const identityScope = {};
  const stat = async (path: string): Promise<FileStat> => {
    const s = volume.lstatSync(path);
    return { type: s.isSymbolicLink() ? "symlink" : s.isDirectory() ? "directory" : "file", size: s.size, mode: s.mode,
      mtimeMs: s.mtimeMs, atimeMs: s.atimeMs, ctimeMs: s.ctimeMs, ino: s.ino, dev: s.dev, identityScope };
  };
  let writes = 0;
  const fs = { capabilities: { write: true, mkdir: true, explicitDirectories: true, exclusiveCreate: true, atomicFileMutation: true, atomicDirectoryMetadata: true },
    lstat: stat, stat, realpath: async (p: string) => String(volume.realpathSync(p)),
    access: async (p: string, mode: number) => { volume.accessSync(p, mode); },
    prepareDirectory: async (p: string, options: { parent: FileStat }) => {
      const parent = await stat(p.slice(0, p.lastIndexOf("/")) || "/");
      if (parent.ino !== options.parent.ino) throw new Error("Parent changed");
      volume.mkdirSync(p); return stat(p);
    },
    mkdir: async (p: string) => { volume.mkdirSync(p); },
    writeFileConditional: async (p: string, data: Uint8Array, options: { parent: FileStat }) => {
      const parent = await stat(p.slice(0, p.lastIndexOf("/")) || "/");
      if (parent.ino !== options.parent.ino) throw new Error("Parent changed");
      if (fail && writes++ === 1) throw new Error("Destination write failed");
      volume.writeFileSync(p, data, { flag: "wx" }); return stat(p);
    }, readFile: async (p: string) => new Uint8Array(volume.readFileSync(p) as Uint8Array)
  } as unknown as FileSystem;
  return { volume, fs };
}
async function fixture() {
  const base = await sdk.readArchive(await textFixture(paragraph("Original text")), textContext);
  const types = base.members.find(m => m.name === "[Content_Types].xml")!;
  Object.assign(types, { bytes: new TextEncoder().encode(new TextDecoder().decode(types.bytes).replace("</Types>", '<Default Extension="bin" ContentType="application/octet-stream"/></Types>')) });
  const binary = new Uint8Array([0, 255, 17, 0, 128]);
  return { archive: { ...base, members: [...base.members, { name: "word/media/sample.bin", bytes: binary, directory: false, modified: new Date("1980-01-01Z") }] }, binary };
}
async function encode(archive: sdk.DocumentArchive) {
  const chunks: Uint8Array[] = [];
  await sdk.writeArchive(archive, { async write(b) { chunks.push(b.slice()); } }, { order: "input", compression: "store" }, textContext);
  return new Uint8Array(Buffer.concat(chunks));
}
const extract = (bytes: Uint8Array, options: sdk.DocxOperationArguments<"extract">, fs: FileSystem, context = textContext) =>
  sdk.extractDocumentArchive(bytes, { allowPartialOutput: true, ...options }, { ...context, filesystem: fs });

describe("explicit archive extraction", () => {
  it("requires explicit partial-output consent before any mutation", async () => {
    const { archive } = await fixture(), { fs, volume } = destination();
    await expect(extract(await encode(archive), { outputDir: "/new", allowPartialOutput: false }, fs)).rejects.toMatchObject({ code: "usage" });
    expect(volume.existsSync("/new")).toBe(false);
  });
  it("requires atomic conditional tree creation before mutations", async () => {
    const { archive } = await fixture(), { fs, volume } = destination();
    delete fs.prepareDirectory;
    await expect(extract(await encode(archive), { outputDir: "/new" }, fs)).rejects.toThrow();
    expect(volume.existsSync("/new")).toBe(false);
  });
  it("advertises the bounded extraction contract", () => {
    const data = getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: "extract" } })!.data;
    expect(data).toMatchObject({ operations: [{ id: "extract", support: "read", featureIds: ["F50"] }] });
    expect(data).toMatchObject({ operations: [{ result: { oneOf: [
      { properties: { ok: { const: true }, data: { properties: { complete: { const: true }, possiblePartialOutput: { const: false } } }, errors: { maxItems: 0 } } },
      { properties: { ok: { const: false }, errors: { minItems: 1 } } }
    ] } }] });
  });
  it("uses mounted VFS authority and refuses a read-only mount", async () => {
    const { archive, binary } = await fixture(), root = new MemoryFileSystem(), mounted = new MemoryFileSystem();
    await root.mkdir("/mount");
    const fs = new MountFileSystem({ root, mounts: { "/mount": mounted } });
    await extract(await encode(archive), { outputDir: "/mount/new" }, fs);
    expect(await mounted.readFile("/new/word/media/sample.bin")).toEqual(binary);
    const readonly = new MountFileSystem({ root, mounts: { "/mount": new ReadOnlyFileSystem(mounted) } });
    await expect(extract(await encode(archive), { outputDir: "/mount/other" }, readonly)).rejects.toThrow();
    await expect(mounted.lstat("/other")).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("refuses actual VFS symlinks and permissions", async () => {
    const { archive } = await fixture(), fs = new MemoryFileSystem();
    await fs.mkdir("/locked", { mode: 0o555 });
    await fs.symlink("/locked", "/alias");
    for (const outputDir of ["/locked/new", "/alias/new"])
      await expect(extract(await encode(archive), { outputDir }, fs)).rejects.toThrow();
    await expect(fs.lstat("/locked/new")).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("writes exact original bytes and a relative manifest", async () => {
    const { archive, binary } = await fixture(), { volume, fs } = destination();
    const result = await extract(await encode(archive), { outputDir: "/new" }, fs);
    expect(result.complete).toBe(true);
    for (const m of archive.members) expect(new Uint8Array(volume.readFileSync(`/new/${m.name}`) as Uint8Array)).toEqual(m.bytes);
    expect(new Uint8Array(volume.readFileSync("/new/word/media/sample.bin") as Uint8Array)).toEqual(binary);
    expect(JSON.parse(String(volume.readFileSync("/new/manifest.json"))).entries).toHaveLength(archive.members.length);
  });
  it("selects media only and pretty prints XML only when requested", async () => {
    const { archive, binary } = await fixture(), a = destination(), b = destination();
    const bytes = await encode(archive);
    const media = await extract(bytes, { outputDir: "/new", selection: "media-only" }, a.fs);
    expect(media.entries.map(e => e.path)).toEqual(["word/media/sample.bin"]);
    expect(a.volume.existsSync("/new/word/document.xml")).toBe(false);
    await extract(bytes, { outputDir: "/new", pretty: true }, b.fs);
    expect(String(b.volume.readFileSync("/new/word/document.xml"))).toContain("\n  ");
    expect(new Uint8Array(b.volume.readFileSync("/new/word/media/sample.bin") as Uint8Array)).toEqual(binary);
  });
  it.each(["word/Media/sample.bin", "word/media/%73ample.bin", "word/media/sample.bin/child.bin", "manifest.json", "word/media/bad. "])("rejects unsafe excluded namespace member %s before output", async name => {
    const { archive } = await fixture(), { volume, fs } = destination();
    const member = { ...archive.members.at(-1)!, name };
    const bytes = await encode({ ...archive, members: [...archive.members, member] });
    await expect(extract(bytes, { outputDir: "/new", selection: "media-only" }, fs)).rejects.toThrow();
    expect(volume.existsSync("/new")).toBe(false);
  });
  it.each([["custom/items/data.bin", "custom/../xx/data.bin"], ["custom/items/data.bin", "word/media/sample.bin"], ["custom/other/data.bin", "custom/items/data.bin"]])("validates raw unsafe or duplicate entry %s to %s", async (name, target) => {
    const { archive } = await fixture(), { volume, fs } = destination();
    const extra = name === "custom/other/data.bin" ? [{ ...archive.members.at(-1)!, name: target }] : [];
    const bytes = await encode({ ...archive, members: [...archive.members, ...extra, { ...archive.members.at(-1)!, name }] });
    const source = new TextEncoder().encode(name), replacement = new TextEncoder().encode(target);
    expect(replacement.length).toBe(source.length);
    let replacements = 0;
    for (let offset = 0; offset <= bytes.length - source.length; offset++) {
      if (source.every((b, i) => bytes[offset + i] === b)) { bytes.set(replacement, offset); replacements++; }
    }
    expect(replacements).toBe(2);
    await expect(extract(bytes, { outputDir: "/new", selection: "media-only" }, fs)).rejects.toThrow();
    expect(volume.existsSync("/new")).toBe(false);
  });
  it("refuses an excluded ZIP link before any output", async () => {
    const { archive } = await fixture(), { fs, volume } = destination();
    const bytes = await encode({ ...archive, members: [...archive.members, { ...archive.members.at(-1)!, name: "custom/link.bin" }] });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let patched = false;
    for (let offset = 0; offset < bytes.length - 46; offset++) {
      if (view.getUint32(offset, true) !== 0x02014b50) continue;
      const length = view.getUint16(offset + 28, true);
      if (new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + length)) !== "custom/link.bin") continue;
      view.setUint16(offset + 4, 0x0314, true);
      view.setUint32(offset + 38, 0o120777 * 65536, true); patched = true;
    }
    expect(patched).toBe(true);
    await expect(extract(bytes, { outputDir: "/new", selection: "media-only" }, fs)).rejects.toThrow();
    expect(volume.existsSync("/new")).toBe(false);
  });
  it.each([["custom/é.bin", "custom/É.bin"], ["custom/straße.bin", "custom/STRASSE.bin"], ["custom/é.bin", "custom/é.bin"]])("rejects excluded Unicode aliases %s and %s", async (first, second) => {
    const { archive } = await fixture(), { fs, volume } = destination();
    const bytes = await encode({ ...archive, members: [...archive.members, ...[first, second].map(name => ({ ...archive.members.at(-1)!, name }))] });
    await expect(extract(bytes, { outputDir: "/new", selection: "media-only" }, fs)).rejects.toThrow();
    expect(volume.existsSync("/new")).toBe(false);
  });
  it("retains empty archive directories in all selection", async () => {
    const { archive } = await fixture(), { volume, fs } = destination();
    const bytes = await encode({ ...archive, members: [...archive.members, { ...archive.members.at(-1)!, name: "custom/empty/", bytes: new Uint8Array(), directory: true }] });
    await extract(bytes, { outputDir: "/new" }, fs);
    expect(volume.statSync("/new/custom/empty").isDirectory()).toBe(true);
  });
  it("reports cancellation after publication without removing new or user data", async () => {
    const { archive } = await fixture(), { fs, volume } = destination();
    const controller = new AbortController(), write = fs.writeFileConditional!;
    fs.writeFileConditional = async (...args) => { const result = await write(...args); controller.abort(); return result; };
    await expect(extract(await encode(archive), { outputDir: "/new" }, fs, { ...textContext, signal: controller.signal })).rejects.toMatchObject({ code: "cancelled", data: { complete: false, possiblePartialOutput: true, entries: expect.arrayContaining([expect.objectContaining({ published: true })]) } });
    expect(String(volume.readFileSync("/keep.txt"))).toBe("untouched");
    expect(volume.existsSync("/new/[Content_Types].xml")).toBe(true);
  });
  it("refuses preexisting trees even with force and never cleans them", async () => {
    const { archive } = await fixture(), { volume, fs } = destination();
    volume.mkdirSync("/new"); volume.writeFileSync("/new/user.txt", "retain");
    await expect(extract(await encode(archive), { outputDir: "/new", force: true }, fs)).rejects.toThrow();
    expect(String(volume.readFileSync("/new/user.txt"))).toBe("retain");
  });
  it("refuses read-only destination capabilities before creating output", async () => {
    const { archive } = await fixture(), { volume, fs } = destination();
    fs.capabilitiesFor = async () => ({ ...fs.capabilities, readOnly: true });
    await expect(extract(await encode(archive), { outputDir: "/new" }, fs)).rejects.toThrow();
    expect(volume.existsSync("/new")).toBe(false);
  });
  it("reports possible partial new output after I/O failure", async () => {
    const { archive } = await fixture(), { volume, fs } = destination(true);
    await expect(extract(await encode(archive), { outputDir: "/new" }, fs)).rejects.toMatchObject({ code: "unsupported-publication", data: { complete: false, possiblePartialOutput: true, outputDir: "/new" } });
    expect(String(volume.readFileSync("/keep.txt"))).toBe("untouched");
    expect(volume.existsSync("/new")).toBe(true);
  });
  it("admits receipt serialization before creating output", async () => {
    const { archive } = await fixture(), { fs, volume } = destination();
    const context = { ...textContext, budget: new sdk.DocumentBudget({ serializedOutput: 850 }) };
    await expect(extract(await encode(archive), { outputDir: "/new" }, fs, context)).rejects.toMatchObject({ code: "limit-exceeded" });
    expect(volume.existsSync("/new")).toBe(false);
  });
  it("refuses a raced file collision without changing user bytes", async () => {
    const { archive } = await fixture(), { fs, volume } = destination();
    const write = fs.writeFileConditional!;
    fs.writeFileConditional = async (...args) => {
      volume.writeFileSync(args[0], "new user data");
      return write(...args);
    };
    await expect(extract(await encode(archive), { outputDir: "/new" }, fs)).rejects.toMatchObject({ data: { complete: false, possiblePartialOutput: true } });
    expect(String(volume.readFileSync("/new/[Content_Types].xml"))).toBe("new user data");
  });
  it("returns an extraction receipt when final stdout fails", async () => {
    const { archive } = await fixture(), { fs, volume } = destination();
    volume.writeFileSync("/input.docx", await encode(archive));
    const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["extract", "input.docx", "--output-dir", "new", "--allow-partial-output", "--json"].map(w => new TextEncoder().encode(w)), cwd: "/", filesystem: fs,
      stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() { throw new Error("Output unavailable"); } }, stderr: { async write() {} }, signal: textContext.signal });
    expect(result).toMatchObject({ exitCode: 3, extraction: { complete: false, possiblePartialOutput: true, manifestPublished: true } });
    expect(volume.existsSync("/new/manifest.json")).toBe(true);
  });
  it("uses the shared conflict exit status for a preexisting tree", async () => {
    const { archive } = await fixture(), { fs, volume } = destination();
    volume.writeFileSync("/input.docx", await encode(archive)); volume.mkdirSync("/new");
    const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["extract", "input.docx", "--output-dir", "new", "--allow-partial-output", "--json"].map(w => new TextEncoder().encode(w)), cwd: "/", filesystem: fs,
      stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} }, stderr: { async write() {} }, signal: textContext.signal });
    expect(result).toMatchObject({ exitCode: 1, extraction: { complete: false, possiblePartialOutput: false } });
  });
  it("keeps CLI and SDK selection options aligned and executes the command", async () => {
    const invocation = parseDocxArguments(["extract", "input.docx", "--output-dir", "new", "--selection", "media-only", "--allow-partial-output", "--pretty", "--json"].map(w => new TextEncoder().encode(w)));
    expect(invocation.options).toMatchObject({ selection: "media-only", pretty: true });
    const { archive } = await fixture(), { fs, volume } = destination();
    volume.writeFileSync("/input.docx", await encode(archive));
    const chunks: Uint8Array[] = [];
    const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["extract", "input.docx", "--output-dir", "new", "--allow-partial-output", "--json"].map(w => new TextEncoder().encode(w)), cwd: "/", filesystem: fs,
      stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(b) { chunks.push(b.slice()); } }, stderr: { async write() {} }, signal: textContext.signal });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(Buffer.concat(chunks).toString()).data.complete).toBe(true);
  });
});
