import { Volume } from "memfs";
import { expect, it, vi } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import type { FileSystem } from "@poe-code/safe-fs/core";

const exported = api as unknown as Record<string, new (message?: string, options?: ErrorOptions) => Error>;
const encode = (text: string) => new TextEncoder().encode(text);
const encoding = { order: "input", compression: "store" } as const;
const denied = (code: string) => Object.assign(new Error("Private credential details"), { code });

async function expectPermission(action: Promise<unknown>, cause?: unknown): Promise<unknown> {
  let failure: unknown;
  try { await action; } catch (error) { failure = error; }
  expect(failure).toMatchObject({ code: "permission" });
  expect(exported.PermissionError).toBeTypeOf("function"); expect(failure).toBeInstanceOf(exported.PermissionError!);
  if (cause !== undefined) expect(failure).toHaveProperty("cause", cause);
  expect((failure as Error).message).not.toContain("Private credential");
  return failure;
}

it("exports a permission error with standard message and cause values", () => {
  expect(exported.PermissionError).toBeTypeOf("function");
  const cause = {}; expect(new exported.PermissionError!("Denied", { cause })).toMatchObject({ code: "permission", message: "Denied", cause });
});

for (const code of ["EACCES", "EPERM", "EROFS", "permission"])
for (const stage of ["open", "next"] as const)
for (const route of ["io", "document", "package", "image", "styles"] as const)
it(`${route} retains ${code} permission classification from ${stage} and settles cleanup`, async () => {
  const volume = Volume.fromJSON({ "/input": "Denied private bytes", "/sentinel": "Retained" }), cause = denied(code), closed = vi.fn(async () => ({ done: true as const, value: undefined }));
  const source = { open() { if (stage === "open") throw cause; return { [Symbol.asyncIterator]() { return { async next(): Promise<IteratorResult<Uint8Array>> { throw cause; }, return: closed }; } }; } };
  const vfs = { open: source.open }, context = { ...textContext, vfs }, input = { path: "/input", capability: vfs };
  const io = new api.DocumentIo(context);
  try {
    await expectPermission(route === "io" ? io.readBytes(source) : route === "document" ? api.Document(input, context) : route === "package" ? api.PackageView.open(input, context) : route === "image" ? api.Image.from_file(input, context) : api.openDocumentStyleModel(input, context), cause);
    expect(closed).toHaveBeenCalledTimes(stage === "next" ? 1 : 0);
    expect(volume.readFileSync("/input", "utf8")).toBe("Denied private bytes"); expect(volume.readFileSync("/sentinel", "utf8")).toBe("Retained");
  } finally { await io.cleanup(); }
});

for (const code of ["EACCES", "EPERM", "EROFS", "permission"])
for (const command of ["inspect", "diff", "batch", "template", "create", "pack", "xml", "equation"] as const)
it(`actual opt-in Shell classifies ${code} from ${command} source acquisition`, async () => {
  const input = await textFixture('<w:p><w:r><w:t>Original coast</w:t></w:r></w:p>'), volume = Volume.fromJSON({ "/input": Buffer.from(input), "/denied": "Private input", "/sentinel": "Retained" });
  const fs = new MemoryFileSystem(); for (const path of ["/input", "/denied", "/sentinel"]) await fs.writeFile(path, new Uint8Array(volume.readFileSync(path) as Buffer));
  const read = fs.readStream.bind(fs), cause = denied(code), opened: string[] = [];
  vi.spyOn(fs, "readStream").mockImplementation((path, options) => { opened.push(path); if (path === "/denied") throw cause; return read(path, options); });
  const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
  const select = command === "equation" ? (await api.openDocumentLocations(input, textContext)).at("paragraph", 1).token : "";
  const commandText = { inspect: "inspect /denied", diff: "diff /input /denied", batch: "batch /input --ops-file /denied --dry-run", template: "template apply /input --data-file /denied --dry-run", create: "create --template /denied --dry-run", pack: "pack /denied --dry-run", xml: "xml set /input --part /word/document.xml --file /denied --dry-run", equation: `equations add /input --select ${select} --file /denied --dry-run` }[command];
  try {
    const result = await shell.exec("docx " + commandText + " --json");
    expect(opened).toContain("/denied"); expect(result.exitCode).toBe(command === "diff" ? 2 : 3);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "permission" }] });
    expect(result.stdout + result.stderr).not.toContain("Private");
    for (const path of ["/input", "/denied", "/sentinel"]) expect(await fs.readFile(path)).toEqual(new Uint8Array(volume.readFileSync(path) as Buffer));
  } finally { await shell.dispose(); }
});

for (const code of ["EACCES", "EPERM", "EROFS", "permission"])
for (const stage of ["preflight", "payload", "destination", "parent", "alias"] as const) for (const route of ["sdk", "shell"] as const)
it(`${route} keeps packing ${code} classification at ${stage} without output`, async () => {
  const input = await textFixture('<w:p><w:r><w:t>Original coast</w:t></w:r></w:p>'), volume = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "Retained" }), fs = new MemoryFileSystem(), cause = denied(code);
  await fs.mkdir("/destination"); await fs.writeFile("/destination/output", encode("Retained"));
  await api.extractDocumentArchive(input, { outputDir: "/tree", allowPartialOutput: true }, { ...textContext, filesystem: fs });
  const inventory = JSON.parse(new TextDecoder().decode(await fs.readFile("/tree/manifest.json"))), payload = await fs.readFile("/tree/word/document.xml");
  const stat = fs.lstat.bind(fs), read = fs.readStream.bind(fs), compare = fs.compareEntry!.bind(fs), deniedPaths: string[] = [];
  vi.spyOn(fs, "lstat").mockImplementation(async (path, options) => { if (stage === "preflight" && path === "/tree/word/document.xml" || stage === "destination" && path === "/destination/output" || stage === "parent" && path === "/destination") { deniedPaths.push(path); throw cause; } return stat(path, options); });
  vi.spyOn(fs, "compareEntry").mockImplementation(async (path, peer, other, options) => { if (stage === "alias" && path === "/destination/output") { deniedPaths.push(path); throw cause; } return compare(path, peer, other, options); });
  vi.spyOn(fs, "readStream").mockImplementation((path, options) => { if (stage === "payload" && path === "/tree/word/document.xml") { deniedPaths.push(path); throw cause; } return read(path, options); });
  if (route === "sdk") await expectPermission(api.packDocumentArchive(inventory, { output: "/destination/output", force: true, json: true }, { ...textContext, filesystem: fs, inventoryDirectory: "/tree" }), cause);
  else {
    const engine = api.createDocxInspectionCommandEngine({ limits: textContext.limits });
    const shell = new Shell({ fs }).use(docxCommands({ engine: { execute(request: Parameters<typeof engine.execute>[0]) {
      const filesystem = new Proxy(request.filesystem, { get(target, key, receiver) {
        if (stage === "alias" && key === "compareEntry") return async (path: string) => { deniedPaths.push(path); throw cause; };
        return Reflect.get(target, key, receiver);
      } });
      return engine.execute({ ...request, filesystem });
    } } }));
    try { const result = await shell.exec("docx pack /tree/manifest.json --output /destination/output --force --json"); expect(result.exitCode).toBe(3); expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "permission" }] }); expect(result.stdout + result.stderr).not.toContain("Private"); }
    finally { await shell.dispose(); }
  }
  expect(deniedPaths.length).toBeGreaterThan(0); expect(await fs.readFile("/destination/output")).toEqual(encode("Retained")); expect(await fs.readFile("/tree/word/document.xml")).toEqual(payload); expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});

for (const code of ["EACCES", "EPERM", "EROFS", "permission"])
for (const stage of ["acquire", "write", "close", "commit"] as const)
for (const route of ["model", "sdk"] as const)
it(`${route} reports typed ${code} during staged ${stage} without publishing`, async () => {
  const input = await textFixture('<w:p/>'), volume = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "Retained", "/stage": "" }), cause = denied(code), events: string[] = [];
  const sink: api.ByteSink = { async stage() {
    events.push("acquire"); if (stage === "acquire") throw cause;
    return {
      async write(bytes) { events.push("write"); if (stage === "write") throw cause; volume.appendFileSync("/stage", bytes); },
      async close() { events.push("close"); if (stage === "close") throw cause; },
      async commit() { events.push("commit"); if (stage === "commit") throw cause; volume.writeFileSync("/output", volume.readFileSync("/stage")); },
      async abort() { events.push("abort"); volume.writeFileSync("/stage", ""); }
    };
  } };
  const pending = route === "model" ? (await api.Document(input, textContext)).save(sink) : api.publishDocumentArchive(await api.readDocumentArchive(input, textContext), { output: "-" }, { ...textContext, encoding, stdout: sink });
  const failure = await expectPermission(pending, cause);
  expect(failure).toBeInstanceOf(api.PublicationError); expect(failure).toMatchObject({ published: [], stdoutMayBePartial: false });
  expect(events.at(-1)).toBe(stage === "acquire" ? "acquire" : "abort"); expect(volume.readFileSync("/stage", "utf8")).toBe(""); expect(volume.readFileSync("/output", "utf8")).toBe("Retained"); expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});

for (const code of ["EACCES", "EPERM", "EROFS", "permission"])
for (const route of ["archive", "io", "model"] as const)
it(`${route} preserves typed ${code} from a borrowed byte sink`, async () => {
  const input = await textFixture('<w:p/>'), archive = await api.readDocumentArchive(input, textContext), cause = denied(code), volume = Volume.fromJSON({ "/sentinel": "Retained" });
  const sink = { async write() { throw cause; } }, io = new api.DocumentIo(textContext);
  try {
    const failure = await expectPermission(route === "archive" ? api.writeArchive(archive, sink, encoding, textContext) : route === "io" ? io.write(archive, sink, encoding) : (await api.Document(input, textContext)).save(sink), cause);
    if (route === "model") expect(failure).toMatchObject({ published: [], stdoutMayBePartial: true });
    expect(volume.readFileSync("/sentinel", "utf8")).toBe("Retained");
  } finally { await io.cleanup(); }
});

it("preserves permission classification for a read-only granted output VFS", async () => {
  const volume = Volume.fromJSON({ "/output": "Retained" });
  const filesystem = { capabilities: { readOnly: true, write: false } } as FileSystem;
  await expectPermission(api.publishDocumentArchive(await api.createDocumentArchive({}, textContext), { output: "/output", force: true }, { ...textContext, encoding, filesystem }));
  expect(volume.readFileSync("/output", "utf8")).toBe("Retained");
});

it("retains permission cause and a separate cleanup failure after stage denial", async () => {
  const volume = Volume.fromJSON({ "/output": "Retained" }), cause = denied("EACCES"), cleanup = new Error("Cleanup failure");
  const sink = { async stage() { return { async write() { throw cause; }, async commit() { throw new Error("Unexpected commit"); }, async abort() { throw cleanup; } }; } };
  const failure = await expectPermission((await api.Document(await textFixture('<w:p/>'), textContext)).save(sink), cause);
  expect(failure).toMatchObject({ cleanupError: cleanup, published: [], stdoutMayBePartial: false }); expect(volume.readFileSync("/output", "utf8")).toBe("Retained");
});

it("retains completed file receipts and the denied destination during partial publication", async () => {
  const volume = Volume.fromJSON({ "/first": "Original first", "/second": "Retained second" }), fs = new MemoryFileSystem(), cause = denied("EPERM");
  for (const path of ["/first", "/second"]) await fs.writeFile(path, new Uint8Array(volume.readFileSync(path) as Buffer));
  const publish = fs.publishStagedFile!.bind(fs);
  vi.spyOn(fs, "publishStagedFile").mockImplementation(async (stage, path, options) => { if (path === "/second") throw cause; await publish(stage, path, options); });
  let failure: unknown;
  try { await api.publishDocumentFiles([{ path: "/first", bytes: encode("Published first") }, { path: "/second", bytes: encode("Denied second") }], { force: true, allowPartialOutput: true }, { ...textContext, filesystem: fs }); }
  catch (error) { failure = error; }
  expect(failure).toMatchObject({ code: "permission", published: [{ path: "/first", bytes: 15 }], stdoutMayBePartial: false, cause });
  expect(await fs.readFile("/first")).toEqual(encode("Published first")); expect(await fs.readFile("/second")).toEqual(encode("Retained second"));
  expect(exported.PermissionError).toBeTypeOf("function"); expect(failure).toBeInstanceOf(exported.PermissionError!);
});

for (const code of ["EACCES", "EPERM", "EROFS", "permission"])
for (const route of ["read", "write"] as const)
it(`borrowed cancellation precedes ${code} on ${route} after owned cleanup`, async () => {
  const controller = new AbortController(), reason = { stopped: true }, context = { ...textContext, signal: controller.signal }, cause = denied(code), closed = vi.fn(async () => ({ done: true as const, value: undefined }));
  const io = new api.DocumentIo(context), input = await textFixture('<w:p/>');
  try {
    const pending = route === "read" ? io.readBytes({ open() { return { [Symbol.asyncIterator]() { return { async next(): Promise<IteratorResult<Uint8Array>> { controller.abort(reason); throw cause; }, return: closed }; } }; } }) : io.write(await api.readDocumentArchive(input, context), { async write() { controller.abort(reason); throw cause; } }, encoding);
    await expect(pending).rejects.toMatchObject({ code: "cancelled" }); if (route === "read") expect(closed).toHaveBeenCalledOnce();
  } finally { await io.cleanup(); }
});

it("keeps generic source failure identity while settling iterator cleanup", async () => {
  const cause = new Error("Generic source failure"), closed = vi.fn(async () => ({ done: true as const, value: undefined })), io = new api.DocumentIo(textContext);
  try {
    await expect(io.readBytes({ open() { return { [Symbol.asyncIterator]() { return { async next(): Promise<IteratorResult<Uint8Array>> { throw cause; }, return: closed }; } }; } })).rejects.toBe(cause);
    expect(closed).toHaveBeenCalledOnce();
  } finally { await io.cleanup(); }
});
