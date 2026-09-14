import { describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { createMountFileSystem, ReadOnlyFileSystem, type FileStat, type FileSystem } from "@poe-code/safe-fs/core";
import { CancellationError, DocumentBudget, createDocument, createDocumentArchive, publishDocumentArchive, publishDocumentFiles, type ArchiveContext } from "./index.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

const context = (): ArchiveContext => ({ signal: new AbortController().signal, limits: {
  maxArchiveBytes: 65536, maxEntryBytes: 32768, maxTotalBytes: 65536, maxMembers: 100,
  maxPathBytes: 256, maxDepth: 16, maxExtraBytes: 0, maxCommentBytes: 0,
  maxRetainedBytes: 16 * 1024 * 1024, chunkSize: 512
} });
const encoding = { order: "name", compression: "store" } as const;
function fixture() {
  const volume = Volume.fromJSON({ "/work/input": "source", "/work/old": "original" });
  const scope = {};
  const snapshot = (path: string): FileStat => {
    const s = volume.lstatSync(path);
    return { type: s.isDirectory() ? "directory" : s.isSymbolicLink() ? "symlink" : "file", size: s.size,
      mode: s.mode, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, atimeMs: s.atimeMs,
      ino: s.ino, dev: s.dev, nlink: s.nlink, identityScope: scope, revision: s.mtimeMs };
  };
  const stat = async (path: string) => snapshot(path);
  const check = (path: string, expected: FileStat | null) => {
    let current: FileStat | null = null;
    try { current = snapshot(path); } catch (error) { if ((error as { code: string }).code !== "ENOENT") throw error; }
    const fields = expected?.type === "directory" ? ["ino", "dev", "type"] as const : ["ino", "dev", "type", "revision", "size", "mode", "nlink", "mtimeMs", "ctimeMs"] as const;
    if ((current === null) !== (expected === null) || fields.some(key => current?.[key] !== expected?.[key])) throw Object.assign(new Error("stale"), { code: "EAGAIN" });
  };
  const fs = {
    capabilities: { atomicFileStaging: true, write: true },
    capabilitiesFor: vi.fn(async () => ({ atomicFileStaging: true, write: true })),
    lstat: stat, stat,
    realpath: async (path: string) => String(volume.realpathSync(path)),
    readlink: async (path: string) => String(volume.readlinkSync(path)),
    access: async (path: string, mode: number) => { volume.accessSync(path, mode); },
    compareEntry: vi.fn(async (path: string, _peer: FileSystem, other: string) => {
      try { return volume.statSync(path).ino === volume.statSync(other).ino ? "same" : "distinct"; }
      catch { return "unknown"; }
    }),
    createStagedFile: vi.fn(async (directory: string, name: string, content: { data: Uint8Array }, options: { parent: FileStat }) => {
      check("/work", options.parent);
      volume.mkdirSync(directory); volume.writeFileSync(`${directory}/${name}`, content.data);
      return { parent: { path: "/work", stat: await stat("/work") }, directory: { path: directory, stat: await stat(directory) }, file: { path: `${directory}/${name}`, stat: await stat(`${directory}/${name}`) } };
    }),
    publishStagedFile: vi.fn<NonNullable<FileSystem["publishStagedFile"]>>(async (stage, path, options) => {
      check(path, options.destination);
      volume.renameSync(stage.file.path, path);
    }),
    removeStagedFile: vi.fn<NonNullable<FileSystem["removeStagedFile"]>>(async stage => { volume.rmSync(stage.directory.path, { recursive: true }); }),
  } as unknown as FileSystem;
  return { fs, volume, stat };
}
async function run(options: Parameters<typeof publishDocumentArchive>[1], env = fixture()) {
  const ctx = context();
  const archive = await createDocumentArchive({}, ctx);
  return publishDocumentArchive(archive, options, { ...ctx, filesystem: env.fs, encoding });
}

describe("document publication", () => {
  it("creates through the SDK with conflict preservation, force and owned output intent", async () => {
    const env = fixture();
    const creation = { content: { version: 1, blocks: [{ kind: "paragraph", text: "Harbor ledger" }] } } as const;
    const contextForCreate = { ...context(), filesystem: env.fs, encoding };
    await expect(createDocument(creation, { output: "/work/old" }, contextForCreate)).rejects.toMatchObject({ code: "conflict" });
    expect(env.volume.readFileSync("/work/old", "utf8")).toBe("original");
    const publication = { output: "/work/new" };
    const pending = createDocument(creation, publication, contextForCreate);
    publication.output = "/work/wrong";
    await pending;
    const parts = readPackage(new Uint8Array(env.volume.readFileSync("/work/new") as Buffer));
    assertPackageLinks(parts);
    expect(new TextDecoder().decode(parts.get("word/document.xml"))).toContain("Harbor ledger");
    const input = { path: "/work/new", stat: await env.stat("/work/new") };
    await expect(createDocument({ template: new Uint8Array(env.volume.readFileSync(input.path) as Buffer) }, { input, output: input.path, force: true }, contextForCreate)).rejects.toMatchObject({ code: "conflict" });
    await createDocument(creation, { output: "/work/old", force: true }, contextForCreate);
    expect(env.volume.readFileSync("/work/input", "utf8")).toBe("source");
  });
  it.each([false, true])("rejects force for binary stdout with dry-run %s", async dryRun => {
    const env = fixture(); const ctx = context();
    const archive = await createDocumentArchive({}, ctx);
    const stdout = { write: vi.fn(async (bytes: Uint8Array) => { env.volume.writeFileSync("/stdout", bytes); }) };
    await expect(publishDocumentArchive(archive, { output: "-", force: true, dryRun }, { ...ctx, filesystem: env.fs, encoding, stdout }))
      .rejects.toMatchObject({ code: "usage" });
    expect(stdout.write).not.toHaveBeenCalled();
    expect(env.volume.toJSON()).toEqual({ "/work/input": "source", "/work/old": "original" });
  });
  it.each([{}, { output: "/work/new", inPlace: true }, { force: true }, { inPlace: true }, { output: "-", json: true }])("rejects invalid intent %j", async options => {
    await expect(run(options)).rejects.toMatchObject({ code: "usage" });
  });
  it("requires output for creation but permits destination-free dry runs", async () => {
    await expect(run({ creation: true })).rejects.toMatchObject({ code: "usage" });
    expect(await run({ dryRun: true })).toMatchObject({ published: [] });
  });
  it("publishes an exclusively created validated package", async () => {
    const env = fixture();
    const result = await run({ output: "/work/new" }, env);
    expect(result.published).toEqual([{ path: "/work/new", bytes: env.volume.statSync("/work/new").size }]);
    expect(env.volume.readFileSync("/work/new", "utf8").slice(0, 2)).toBe("PK");
    expect(env.volume.readdirSync("/work").sort()).toEqual(["input", "new", "old"]);
  });
  it("requires force for existing output and preserves it on invalid archive", async () => {
    const env = fixture();
    await expect(run({ output: "/work/old" }, env)).rejects.toMatchObject({ code: "conflict" });
    await expect(publishDocumentArchive({ members: [], comment: new Uint8Array() }, { output: "/work/old", force: true }, { ...context(), filesystem: env.fs, encoding })).rejects.toBeDefined();
    expect(env.volume.readFileSync("/work/old", "utf8")).toBe("original");
    await run({ output: "/work/old", force: true }, env);
    expect(env.volume.readFileSync("/work/input", "utf8")).toBe("source");
  });
  it("refuses same and unknown input aliases even with force", async () => {
    const env = fixture();
    const input = { path: "/work/input", stat: await env.stat("/work/input") };
    env.volume.linkSync(input.path, "/work/alias");
    await expect(run({ input, output: "/work/alias", force: true }, env)).rejects.toMatchObject({ code: "conflict" });
    vi.mocked(env.fs.compareEntry!).mockResolvedValue("unknown");
    await expect(run({ input, output: "/work/old", force: true }, env)).rejects.toMatchObject({ code: "unsupported-publication" });
  });
  it("uses the admitted input snapshot for in-place replacement", async () => {
    const env = fixture();
    const input = { path: "/work/input", stat: await env.stat("/work/input") };
    env.volume.unlinkSync(input.path); env.volume.writeFileSync(input.path, "changed");
    await expect(run({ input, inPlace: true }, env)).rejects.toMatchObject({ code: "conflict", published: [] });
    expect(env.volume.readFileSync(input.path, "utf8")).toBe("changed");
    await run({ input: { path: input.path, stat: await env.stat(input.path) }, inPlace: true }, env);
  });
  it.each([{ readOnly: true }, { atomicFileStaging: false }, {}])("uses mounted destination capabilities %j in dry-run too", async capabilities => {
    const env = fixture();
    vi.mocked(env.fs.capabilitiesFor!).mockResolvedValue(capabilities);
    await expect(run({ output: "/work/new", dryRun: true }, env)).rejects.toMatchObject({ code: capabilities.readOnly ? "permission" : "unsupported-publication" });
    expect(env.fs.createStagedFile).not.toHaveBeenCalled();
  });
  it("refuses an adapter advertising staging without its methods", async () => {
    const env = fixture(); delete env.fs.publishStagedFile;
    await expect(run({ output: "/work/new" }, env)).rejects.toMatchObject({ code: "unsupported-publication" });
  });
  it("preserves a raced output and cleans only owned staging", async () => {
    const env = fixture(); const publish = vi.mocked(env.fs.publishStagedFile!).getMockImplementation()!;
    vi.mocked(env.fs.publishStagedFile!).mockImplementation(async (...args) => {
      env.volume.writeFileSync("/work/new", "winner"); await publish(...args);
    });
    await expect(run({ output: "/work/new" }, env)).rejects.toMatchObject({ code: "conflict", published: [] });
    expect(env.volume.readFileSync("/work/new", "utf8")).toBe("winner");
    expect(env.volume.readdirSync("/work").sort()).toEqual(["input", "new", "old"]);
  });
  it("reports uncertain stdout effects after a transport failure", async () => {
    const env = fixture(); const ctx = context();
    const archive = await createDocumentArchive({}, ctx);
    const stdout = { write: vi.fn(async (bytes: Uint8Array) => { env.volume.writeFileSync("/stdout", bytes.subarray(0, 3)); throw new Error("broken pipe"); }) };
    await expect(publishDocumentArchive(archive, { output: "-" }, { ...ctx, filesystem: env.fs, encoding, stdout }))
      .rejects.toMatchObject({ code: "sink-failure", stdoutMayBePartial: true });
    expect(env.volume.statSync("/stdout").size).toBe(3);
  });
  it("requires partial extraction intent and reports exactly completed files", async () => {
    const env = fixture();
    const files = [{ path: "/work/a", bytes: Uint8Array.of(1) }, { path: "/work/b", bytes: Uint8Array.of(2) }];
    await expect(publishDocumentFiles(files, {}, { ...context(), filesystem: env.fs })).rejects.toMatchObject({ code: "unsupported-publication" });
    const publish = vi.mocked(env.fs.publishStagedFile!).getMockImplementation()!;
    vi.mocked(env.fs.publishStagedFile!).mockImplementation(async (...args) => { if (args[1] === "/work/b") throw new Error("offline"); await publish(...args); });
    await expect(publishDocumentFiles(files, { allowPartialOutput: true }, { ...context(), filesystem: env.fs }))
      .rejects.toMatchObject({ code: "sink-failure", published: [{ path: "/work/a", bytes: 1 }] });
  });
  it("owns archive bytes and publication intent before awaited capability queries", async () => {
    const env = fixture(); const ctx = context(); const archive = await createDocumentArchive({}, ctx);
    const options = { output: "/work/new" };
    const pending = publishDocumentArchive(archive, options, { ...ctx, filesystem: env.fs, encoding });
    options.output = "/work/input";
    for (const member of archive.members) member.bytes.fill(0);
    await pending;
    expect(env.volume.readFileSync("/work/new", "utf8").slice(0, 2)).toBe("PK");
    expect(env.volume.readFileSync("/work/input", "utf8")).toBe("source");
  });
  it("validates stale in-place snapshots even without publication", async () => {
    const env = fixture();
    const input = { path: "/work/input", stat: await env.stat("/work/input") };
    env.volume.writeFileSync(input.path, "new source contents");
    await expect(run({ input, inPlace: true, dryRun: true }, env)).rejects.toMatchObject({ code: "conflict" });
    expect(env.fs.createStagedFile).not.toHaveBeenCalled();
  });
  it("uses actual mount and read-only wrappers over memfs", async () => {
    const env = fixture();
    const mounted = createMountFileSystem({ root: env.fs, mounts: { "/readonly": new ReadOnlyFileSystem(env.fs) } });
    await expect(run({ output: "/readonly/work/new", dryRun: true }, { ...env, fs: mounted })).rejects.toMatchObject({ code: "permission" });
    await run({ output: "/work/new" }, { ...env, fs: mounted });
    expect(env.volume.existsSync("/work/new")).toBe(true);
  });
  it("reports committed files if cleanup fails and never rolls back output", async () => {
    const env = fixture();
    vi.mocked(env.fs.removeStagedFile!).mockRejectedValue(new Error("cleanup unavailable"));
    await expect(run({ output: "/work/new" }, env)).rejects.toMatchObject({
      code: "sink-failure", published: [{ path: "/work/new", bytes: expect.any(Number) }]
    });
    expect(env.volume.existsSync("/work/new")).toBe(true);
  });
  it("preserves committed receipts when cancellation follows publication", async () => {
    const env = fixture(); const controller = new AbortController();
    const publish = vi.mocked(env.fs.publishStagedFile!).getMockImplementation()!;
    vi.mocked(env.fs.publishStagedFile!).mockImplementation(async (...args) => { await publish(...args); controller.abort(); });
    const ctx = { ...context(), signal: controller.signal };
    const archive = await createDocumentArchive({}, ctx);
    expect(await publishDocumentArchive(archive, { output: "/work/new" }, { ...ctx, filesystem: env.fs, encoding })).toMatchObject({ published: [{ path: "/work/new" }] });
    expect(env.fs.removeStagedFile).toHaveBeenCalledOnce();
  });
  it("cleans acquired staging on cancellation before publication", async () => {
    const env = fixture(); const controller = new AbortController();
    const create = vi.mocked(env.fs.createStagedFile!).getMockImplementation()!;
    vi.mocked(env.fs.createStagedFile!).mockImplementation(async (...args) => { const stage = await create(...args); controller.abort(); return stage; });
    const ctx = { ...context(), signal: controller.signal }; const archive = await createDocumentArchive({}, ctx);
    const pending = publishDocumentArchive(archive, { output: "/work/new" }, { ...ctx, filesystem: env.fs, encoding });
    await expect(pending).rejects.toMatchObject({ code: "cancelled", published: [] });
    await expect(pending).rejects.toBeInstanceOf(CancellationError);
    expect(env.volume.readdirSync("/work").sort()).toEqual(["input", "old"]);
    expect(env.fs.publishStagedFile).not.toHaveBeenCalled();
    await expect(publishDocumentArchive(archive, { output: "-" }, { ...ctx, encoding, stdout: { async write() {} } })).rejects.toBeInstanceOf(CancellationError);
  });
  it("preflights every extraction destination and bounds bytes before publication", async () => {
    const env = fixture();
    await expect(publishDocumentFiles([{ path: "/work/a", bytes: Uint8Array.of(1) }, { path: "/work/old", bytes: Uint8Array.of(2) }], { allowPartialOutput: true }, { ...context(), filesystem: env.fs })).rejects.toMatchObject({ code: "conflict", published: [] });
    expect(env.fs.createStagedFile).not.toHaveBeenCalled();
    await expect(publishDocumentFiles([{ path: "/work/a", bytes: new Uint8Array(32769) }], {}, { ...context(), filesystem: env.fs })).rejects.toMatchObject({ code: "limit-exceeded" });
  });

  it("preserves staging budget errors without reporting a transport failure", async () => {
    const env = fixture(); const ctx = context(); const archive = await createDocumentArchive({}, ctx);
    const baseline = new DocumentBudget({}, ctx.signal);
    await publishDocumentArchive(archive, { output: "/work/new" }, { ...ctx, filesystem: env.fs, encoding, budget: baseline });
    const budget = new DocumentBudget({ retainedBytes: baseline.usage.retainedBytes - 1 }, ctx.signal);
    await expect(publishDocumentArchive(archive, { output: "/work/old", force: true }, { ...ctx, filesystem: env.fs, encoding, budget }))
      .rejects.toMatchObject({ code: "limit-exceeded" });
    expect(env.volume.readFileSync("/work/old", "utf8")).toBe("original");
  });
  it.each(["documentProtection", "writeProtection", "lock"])("force cannot publish a package containing %s", async name => {
    const env = fixture(); const ctx = context(); const archive = await createDocumentArchive({}, ctx);
    const member = archive.members.find(item => item.name === "word/document.xml")!;
    const text = new TextDecoder().decode(member.bytes).replace("<w:p/>", `<w:p><w:pPr><w:${name} w:val="locked"/></w:pPr></w:p>`);
    const altered = { ...archive, members: archive.members.map(item => item === member ? { ...item, bytes: new TextEncoder().encode(text) } : item) };
    await expect(publishDocumentArchive(altered, { output: "/work/old", force: true }, { ...ctx, filesystem: env.fs, encoding })).rejects.toMatchObject({ code: "unsupported-edit" });
    expect(env.volume.readFileSync("/work/old", "utf8")).toBe("original");
  });

  it("owns extraction dry-run intent before asynchronous preflight", async () => {
    const env = fixture(); const options = { dryRun: true };
    const pending = publishDocumentFiles([{ path: "/work/new", bytes: Uint8Array.of(1) }], options, { ...context(), filesystem: env.fs });
    options.dryRun = false;
    expect(await pending).toEqual({ published: [] });
    expect(env.volume.existsSync("/work/new")).toBe(false);
  });
  it("requires typed explicit publication flags", async () => {
    const env = fixture();
    await expect(run({ output: "/work/old", force: "false" } as unknown as Parameters<typeof run>[0], env)).rejects.toMatchObject({ code: "usage" });
    await expect(publishDocumentFiles([{ path: "/work/a", bytes: Uint8Array.of(1) }, { path: "/work/b", bytes: Uint8Array.of(2) }], { allowPartialOutput: "false" } as unknown as Parameters<typeof publishDocumentFiles>[1], { ...context(), filesystem: env.fs })).rejects.toMatchObject({ code: "usage" });
    expect(env.volume.readFileSync("/work/old", "utf8")).toBe("original");
  });

});
