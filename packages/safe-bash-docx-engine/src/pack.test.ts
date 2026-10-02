import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { type FileSystem, type FileStat } from "@poe-code/safe-fs/core";
import * as sdk from "./index.js";
import { admitPackageInventory } from "./pack-inventory.js";
import { textContext, textFixture, paragraph } from "../tests/fixtures/text.js";

const encoder = new TextEncoder();
async function hash(bytes: Uint8Array) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)))].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function input(strict = false) {
  const original = await sdk.readDocumentArchive(await textFixture(paragraph("  Coastal survey  "), {}, strict), textContext);
  const types = original.members.find(m => m.name === "[Content_Types].xml")!;
  const bytes = encoder.encode(new TextDecoder().decode(types.bytes).replace("</Types>", '<Default Extension="bin" ContentType="application/octet-stream"/></Types>'));
  const archive = { ...original, members: original.members.map(m => m === types ? { ...m, bytes } : m).concat([{ name: "custom/海岸-é.bin", bytes: new Uint8Array([0, 255, 128, 17]), directory: false, modified: new Date("1980-01-01Z") }]) };
  const chunks: Uint8Array[] = [];
  await sdk.writeArchive(archive, { async write(b) { chunks.push(b.slice()); } }, { order: "input", compression: "store" }, textContext);
  return { bytes: new Uint8Array(Buffer.concat(chunks)), archive };
}
function memoryVfs(): FileSystem {
  const volume = Volume.fromJSON({ "/keep.txt": "retained" }), identityScope = {};
  const stat = async (path: string): Promise<FileStat> => {
    const s = volume.lstatSync(path);
    return { type: s.isSymbolicLink() ? "symlink" : s.isDirectory() ? "directory" : "file", size: s.size, mode: s.mode, atimeMs: s.atimeMs, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, ino: s.ino, dev: s.dev, identityScope, revision: s.mtimeMs };
  };
  return {
    capabilities: { write: true, mkdir: true, explicitDirectories: true, atomicFileMutation: true, atomicDirectoryMetadata: true, atomicFileStaging: true },
    lstat: stat, stat, realpath: async (p: string) => String(volume.realpathSync(p)),
    access: async (p: string, mode: number) => { volume.accessSync(p, mode); },
    mkdir: async (p: string) => { volume.mkdirSync(p); },
    prepareDirectory: async (p: string) => { volume.mkdirSync(p); return stat(p); },
    writeFileConditional: async (p: string, bytes: Uint8Array) => { volume.writeFileSync(p, bytes, { flag: "wx" }); return stat(p); },
    writeFile: async (p: string, bytes: Uint8Array) => { volume.writeFileSync(p, bytes); },
    readFile: async (p: string) => new Uint8Array(volume.readFileSync(p) as Uint8Array),
    rename: async (a: string, b: string) => { volume.renameSync(a, b); },
    rm: async (p: string) => { volume.unlinkSync(p); },
    link: async (a: string, b: string) => { volume.linkSync(a, b); },
    compareEntry: async (a: string, _peer: FileSystem, b: string) => volume.statSync(a).ino === volume.statSync(b).ino ? "same" : "distinct",
    symlink: async (a: string, b: string) => { volume.symlinkSync(a, b); },
    createStagedFile: async (directory: string, name: string, content: { data: Uint8Array }) => {
      volume.mkdirSync(directory); volume.writeFileSync(directory + "/" + name, content.data);
      return { parent: { path: "/", stat: await stat("/") }, directory: { path: directory, stat: await stat(directory) }, file: { path: directory + "/" + name, stat: await stat(directory + "/" + name) } };
    },
    publishStagedFile: async (stage: { file: { path: string } }, path: string) => { volume.renameSync(stage.file.path, path); },
    removeStagedFile: async (stage: { directory: { path: string }; file: { path: string } }) => { if (volume.existsSync(stage.file.path)) volume.unlinkSync(stage.file.path); volume.rmdirSync(stage.directory.path); }
  } as unknown as FileSystem;
}
async function tree(pretty = false, strict = false) {
  const fs = memoryVfs(), source = await input(strict);
  await sdk.extractDocumentArchive(source.bytes, { outputDir: "/tree", allowPartialOutput: true, pretty }, { ...textContext, filesystem: fs });
  const inventory = JSON.parse(new TextDecoder().decode(await fs.readFile("/tree/manifest.json")));
  return { fs, inventory, ...source };
}
const pack = (inventory: unknown, fs: FileSystem, options: sdk.DocxOperationArguments<"pack"> = { output: "/packed.docx" }, directory: string | null = "/tree", signal = textContext.signal) =>
  sdk.packDocumentArchive(inventory, options, { ...textContext, signal, filesystem: fs, ...(directory === null ? {} : { inventoryDirectory: directory }) });

describe("explicit archive packing", () => {
  it.each([false, true])("extracts edits and packs with independently reopened unaffected payloads; strict %s", async strict => {
    const { fs, inventory, archive } = await tree(false, strict);
    const path = "/tree/word/document.xml";
    const edited = encoder.encode(new TextDecoder().decode(await fs.readFile(path)).replace("Coastal survey", "Harbor observations"));
    await fs.writeFile(path, edited);
    const entry = inventory.entries.find((e: { path: string }) => e.path === "word/document.xml");
    entry.bytes = edited.length; entry.sha256 = await hash(edited);
    await fs.writeFile("/tree/unlisted.bin", encoder.encode("Do not import"));
    expect(await pack(inventory, fs)).toMatchObject({ changed: true, dryRun: false, output: { path: "/packed.docx" } });
    const reopened = await sdk.readDocumentArchive(await fs.readFile("/packed.docx"), textContext);
    expect(reopened.kind).toBe(archive.kind); expect(reopened.dialect).toBe(strict ? "strict" : "transitional");
    expect(reopened.members.map(m => m.name)).toEqual([...archive.members.map(m => m.name)].sort());
    for (const member of reopened.members) expect(member.bytes).toEqual(member.name === "word/document.xml" ? edited : archive.members.find(m => m.name === member.name)!.bytes);
    expect(reopened.comment).toHaveLength(0);
    expect(reopened.members.every(m => m.modified.toISOString() === "1980-01-01T00:00:00.000Z")).toBe(true);
  });
  it("retains pretty XML text whitespace and every supplied display payload", async () => {
    const { fs, inventory } = await tree(true);
    await pack(inventory, fs);
    const reopened = await sdk.readDocumentArchive(await fs.readFile("/packed.docx"), textContext);
    for (const member of reopened.members) expect(member.bytes).toEqual(await fs.readFile("/tree/" + member.name));
    expect((await sdk.extractDocumentText(await fs.readFile("/packed.docx"), textContext)).text).toBe("  Coastal survey  ");
  });
  it("rejects a stale hash before publication", async () => {
    const { fs, inventory } = await tree();
    await fs.writeFile("/tree/word/document.xml", encoder.encode("changed"));
    await expect(pack(inventory, fs)).rejects.toThrow();
    await expect(fs.lstat("/packed.docx")).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each(["_rels/.rels", "word/document.xml"])("rejects missing graph payload %s", async name => {
    const { fs, inventory } = await tree();
    inventory.entries = inventory.entries.filter((e: { path: string }) => e.path !== name);
    await expect(pack(inventory, fs)).rejects.toMatchObject({ code: "invalid-package" });
    await expect(fs.lstat("/packed.docx")).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each(["word/../document.xml", "word\\document.xml", "word/%2Fdocument.xml", "/outside.xml"])("rejects unsafe relative VFS path %s", async path => {
    const { fs, inventory } = await tree(); inventory.entries[0].path = path;
    await expect(pack(inventory, fs)).rejects.toThrow();
  });
  it("rejects symlink files and ancestors without reading their targets", async () => {
    for (const ancestor of [false, true]) {
      const { fs, inventory } = await tree();
      await fs.mkdir("/outside");
      await fs.writeFile("/outside/document.xml", await fs.readFile("/tree/word/document.xml"));
      if (ancestor) { await fs.rename!("/tree/word", "/saved"); await fs.symlink!("/outside", "/tree/word"); }
      else { await fs.rm("/tree/word/document.xml"); await fs.symlink!("/outside/document.xml", "/tree/word/document.xml"); }
      const read = fs.readFile.bind(fs); let targetRead = false;
      fs.readFile = async (path, options) => { if (path === "/tree/word/document.xml") targetRead = true; return read(path, options); };
      await expect(pack(inventory, fs)).rejects.toThrow(); expect(targetRead).toBe(false);
    }
  });
  it("rejects unsupported VFS kinds", async () => {
    const { fs, inventory } = await tree(), stat = fs.lstat.bind(fs);
    fs.lstat = async (path, options) => path === "/tree/word/document.xml" ? { ...await stat(path, options), type: "fifo" as never } : stat(path, options);
    await expect(pack(inventory, fs)).rejects.toThrow();
  });
  it.each(["/tree/output.docx", "/tree/word/output.docx"])("rejects output inside input tree %s even with force", async output => {
    const { fs, inventory } = await tree();
    await expect(pack(inventory, fs, { output, force: true })).rejects.toMatchObject({ code: "conflict" });
    await expect(fs.lstat(output)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("requires sorted unique records and exact content types", async () => {
    for (const change of [(i: { entries: unknown[] }) => i.entries.reverse(), (i: { entries: { contentType: string }[] }) => i.entries.push(i.entries[0]!), (i: { entries: { contentType: string }[] }) => { i.entries[0]!.contentType = "application/octet-stream"; }]) {
      const { fs, inventory } = await tree(); change(inventory);
      await expect(pack(inventory, fs)).rejects.toThrow();
    }
  });
  it("rejects conflicts and abort without changing existing output", async () => {
    const { fs, inventory } = await tree(); await fs.writeFile("/packed.docx", encoder.encode("keep"));
    await expect(pack(inventory, fs)).rejects.toMatchObject({ code: "conflict" });
    const controller = new AbortController(); controller.abort();
    await expect(pack(inventory, fs, { output: "/packed.docx", force: true }, "/tree", controller.signal)).rejects.toMatchObject({ code: "cancelled" });
    expect(new TextDecoder().decode(await fs.readFile("/packed.docx"))).toBe("keep");
  });
  it("dry runs with no mutation and retains template kind", async () => {
    const { fs, inventory } = await tree();
    const types = inventory.entries.find((e: { path: string }) => e.path === "[Content_Types].xml");
    const changed = encoder.encode(new TextDecoder().decode(await fs.readFile("/tree/[Content_Types].xml")).replace("document.main+xml", "template.main+xml"));
    await fs.writeFile("/tree/[Content_Types].xml", changed); types.bytes = changed.length; types.sha256 = await hash(changed); inventory.kind = "dotx";
    inventory.entries.find((e: { path: string }) => e.path === "word/document.xml").contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml";
    await expect(pack(inventory, fs, { output: "/packed.dotx", kind: "docx" })).rejects.toThrow();
    expect(await pack(inventory, fs, { dryRun: true })).toMatchObject({ dryRun: true, output: null });
    await pack(inventory, fs, { output: "/packed.dotx" });
    expect((await sdk.readDocumentArchive(await fs.readFile("/packed.dotx"), textContext)).kind).toBe("dotx");
  });
  it("admits stdin records only as explicit absolute VFS paths", async () => {
    const { fs, inventory } = await tree();
    await expect(pack(inventory, fs, { output: "/packed.docx" }, null)).rejects.toThrow();
    for (const e of inventory.entries) e.path = "/tree/" + e.path;
    await pack(inventory, fs, { output: "/packed.docx" }, null);
  });
  it("exports CLI packing and schema support with inventory terminology", async () => {
    const { fs } = await tree(), chunks: Uint8Array[] = [];
    const result = await sdk.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["pack", "tree/manifest.json", "-o", "packed.docx", "--json"].map(w => encoder.encode(w)), cwd: "/", filesystem: fs, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(b) { chunks.push(b.slice()); } }, stderr: { async write() {} }, signal: textContext.signal });
    expect(result.exitCode).toBe(0); expect(JSON.parse(Buffer.concat(chunks).toString())).toMatchObject({ operation: "pack", affected: 1, ok: true });
    expect(sdk.getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: "pack" } })!.data).toMatchObject({ operations: [{ id: "pack", support: "edit", featureIds: ["F01", "F50"] }] });
    expect(sdk.getDocxDiscovery({ operation: "help", inputs: [], options: { operation: "pack" } })!.human).toContain("docx pack INVENTORY");
  });
});

it("admits opaque bytes independently of the XML part ceiling", () => {
  const inventory = { version: 1, kind: "docx", dialect: "transitional", entries: [{ part: "/custom/data.bin", path: "custom/data.bin", contentType: "application/octet-stream", bytes: 101, sha256: "0".repeat(64) }] };
  expect(() => admitPackageInventory(inventory, new sdk.DocumentBudget({ xmlPartBytes: 100 }), false)).not.toThrow();
});
it("rejects custom inventory prototypes without invoking callbacks", async () => {
  const { fs, inventory } = await tree(); let calls = 0;
  class Entries extends Array<unknown> { override map<U>(callback: (value: unknown, index: number, array: unknown[]) => U): U[] { calls++; return super.map(callback); } }
  inventory.entries = Entries.from(inventory.entries);
  await expect(pack(inventory, fs)).rejects.toThrow(); expect(calls).toBe(0);
});
it("rejects file/directory namespace conflicts before payload reads", async () => {
  const { fs, inventory } = await tree();
  inventory.directories = ["word/document.xml/empty"];
  let reads = 0; const read = fs.readFile.bind(fs); fs.readFile = async (...args) => { reads++; return read(...args); };
  await expect(pack(inventory, fs)).rejects.toThrow(); expect(reads).toBe(0);
});

it("exposes the full packing inventory record schema", () => {
  expect(sdk.getDocxOperationSchema("pack")).toMatchObject({ $defs: { PackageInventoryV1: { required: ["version", "kind", "dialect", "entries"], properties: { entries: { items: { required: ["part", "path", "contentType", "bytes", "sha256"], additionalProperties: false } } } } } });
});

it("rejects force output aliases of every admitted input payload", async () => {
  const { fs, inventory } = await tree();
  await fs.link!("/tree/word/document.xml", "/alias.docx");
  await expect(pack(inventory, fs, { output: "/alias.docx", force: true })).rejects.toMatchObject({ code: "conflict" });
});
it("rejects inconsistent VFS ancestor spellings before reading", async () => {
  const { fs, inventory } = await tree();
  inventory.entries.find((e: { path: string }) => e.path === "word/document.xml").path = "Word/document.xml";
  let reads = 0; const read = fs.readFile.bind(fs); fs.readFile = async (...args) => { reads++; return read(...args); };
  await expect(pack(inventory, fs)).rejects.toThrow(); expect(reads).toBe(0);
});

it("enforces explicit directory depth before namespace work or payload reads", async () => {
  const { fs, inventory } = await tree(); inventory.directories = ["custom/one/two/three"];
  let reads = 0; const read = fs.readFile.bind(fs); fs.readFile = async (...args) => { reads++; return read(...args); };
  await expect(sdk.packDocumentArchive(inventory, { output: "/packed.docx" }, { ...textContext, limits: { ...textContext.limits, maxDepth: 3 }, filesystem: fs, inventoryDirectory: "/tree" })).rejects.toMatchObject({ code: "limit-exceeded" });
  expect(reads).toBe(0);
});

it.each(["symlink", "fifo"] as const)("admits every payload kind before reading any bytes: %s", async kind => {
  const { fs, inventory } = await tree();
  const stat = fs.lstat.bind(fs), read = fs.readFile.bind(fs);
  fs.lstat = async (path, options) => path === "/tree/word/document.xml" ? { ...await stat(path, options), type: kind as never } : stat(path, options);
  let reads = 0;
  fs.readFile = async (...args) => { reads++; return read(...args); };
  await expect(pack(inventory, fs)).rejects.toMatchObject({ code: "invalid-container" });
  expect(reads).toBe(0);
});
