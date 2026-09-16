import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createDocumentFixture } from "../tests/fixtures/documents.js";
import { createDocxInspectionCommandEngine } from "./inspection-command.js";
import type { FileStat, FileSystem } from "@poe-code/safe-fs/core";
import { extractDocumentImages, type ImageExtractionData } from "./images.js";
import { executeImagesCommand } from "./images-command.js";
import { validateDocxInvocation } from "./command.js";
import { DocumentBudget } from "./budget.js";
const limits = { maxArchiveBytes: 65536, maxEntryBytes: 32768, maxTotalBytes: 65536, maxMembers: 64, maxPathBytes: 256, maxDepth: 32, maxExtraBytes: 1024, maxCommentBytes: 1024, maxRetainedBytes: 32000000, chunkSize: 512 };
function publication(bytes: Uint8Array, fail = false) {
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(bytes) }); volume.mkdirSync("/out"); const scope = {};
  const stat = async (path: string): Promise<FileStat> => { const value = volume.lstatSync(path); return { type: value.isDirectory() ? "directory" : "file", size: value.size, mode: value.mode, mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs, atimeMs: value.atimeMs, ino: value.ino, dev: value.dev, nlink: value.nlink, identityScope: scope, revision: value.mtimeMs }; };
  let publications = 0;
  const fs = { capabilities: { atomicFileStaging: true, write: true }, lstat: stat, stat,
    async readFile(path: string) { return new Uint8Array(volume.readFileSync(path) as Uint8Array); },
    async realpath(path: string) { return String(volume.realpathSync(path)); },
    async access(path: string, mode: number) { volume.accessSync(path, mode); },
    createStagedFile: (async (directory, name, content) => { if (content.type !== "file") throw new Error("Unsupported original fixture staging"); volume.mkdirSync(directory); volume.writeFileSync(`${directory}/${name}`, content.data); return { parent: { path: "/out", stat: await stat("/out") }, directory: { path: directory, stat: await stat(directory) }, file: { path: `${directory}/${name}`, stat: await stat(`${directory}/${name}`) } }; }) as NonNullable<FileSystem["createStagedFile"]>,
    publishStagedFile: (async (stage, path) => { if (fail && publications++ === 1) throw new Error("Original second publication failure"); volume.renameSync(stage.file.path, path); }) as NonNullable<FileSystem["publishStagedFile"]>,
    removeStagedFile: (async stage => { volume.rmSync(stage.directory.path, { recursive: true }); }) as NonNullable<FileSystem["removeStagedFile"]>
  } as unknown as FileSystem;
  return { fs, volume };
}
it("captures actual extraction receipts synchronously before command diagnostics", async () => {
  const { bytes } = await createDocumentFixture("museum"), { fs } = publication(bytes), signal = new AbortController().signal, budget = new DocumentBudget({}, signal); let captured: ImageExtractionData | undefined, calls = 0;
  const invocation = validateDocxInvocation({ operation: "images.extract", inputs: ["document"], options: { outputDir: "/out", allowPartialOutput: true, json: true } }, budget);
  await executeImagesCommand(invocation, bytes, undefined, { args: [], cwd: "/", filesystem: fs, signal, stdin: { [Symbol.asyncIterator]() { return { async next(): Promise<IteratorResult<Uint8Array>> { throw new Error("implicit input"); } }; } }, stdout: { async write() {} }, stderr: { async write() { expect(captured?.manifest.published).toBe(true); } } }, { limits, signal, budget }, data => { captured = data; calls++; return undefined; });
  expect(calls).toBe(1); expect(captured?.entries.map(entry => entry.published)).toEqual([true, true]);
});
it("reserves all chosen result allocation before original publication effects", async () => {
  const { bytes } = await createDocumentFixture("garden", "empty"), signal = new AbortController().signal;
  const run = async (budget: DocumentBudget, fs: FileSystem) => executeImagesCommand(validateDocxInvocation({ operation: "images.extract", inputs: ["document"], options: { outputDir: "/out", json: true } }, budget), bytes, undefined, { args: [], cwd: "/", filesystem: fs, signal, stdin: { [Symbol.asyncIterator]() { return { async next(): Promise<IteratorResult<Uint8Array>> { throw new Error("implicit input"); } }; } }, stdout: { async write() {} }, stderr: { async write() {} } }, { limits, signal, budget });
  const baseline = new DocumentBudget({}, signal); await run(baseline, publication(bytes).fs);
  const constrained = new DocumentBudget({ retainedBytes: baseline.usage.retainedBytes - 2000 }, signal), { fs, volume } = publication(bytes);
  await expect(run(constrained, fs)).rejects.toMatchObject({ code: "limit-exceeded" }); expect(volume.readdirSync("/out")).toEqual([]);
});
it("retains typed actual media receipts when cancellation follows the first publish", async () => {
  const { bytes } = await createDocumentFixture("museum"), { fs, volume } = publication(bytes), controller = new AbortController(), publish = fs.publishStagedFile!.bind(fs); let count = 0;
  fs.publishStagedFile = async (...args) => { await publish(...args); if (++count === 1) controller.abort(new Error("Original cancellation after publication")); };
  await expect(extractDocumentImages(bytes, { outputDir: "/out", allowPartialOutput: true }, { limits, signal: controller.signal, filesystem: fs, encoding: { order: "name", compression: "store" } })).rejects.toMatchObject({ code: "cancelled", data: { complete: false, entries: [{ published: true }, { published: false }], manifest: { published: false } } });
  expect(volume.readdirSync("/out")).toEqual(["image-1.bmp"]);
});
it.each(["reject", "fulfill"])("retains all typed publication receipts when cancelled diagnostics %s", async outcome => {
  const { bytes } = await createDocumentFixture("museum"), { fs, volume } = publication(bytes), controller = new AbortController(), reason = new Error("Original diagnostic cancellation");
  const budget = new DocumentBudget({}, controller.signal), invocation = validateDocxInvocation({ operation: "images.extract", inputs: ["document"], options: { outputDir: "/out", allowPartialOutput: true, json: true } }, budget);
  const pending = executeImagesCommand(invocation, bytes, undefined, { args: [], cwd: "/", filesystem: fs, signal: controller.signal, stdin: { [Symbol.asyncIterator]() { return { async next(): Promise<IteratorResult<Uint8Array>> { throw new Error("implicit input"); } }; } }, stdout: { async write() {} }, stderr: { async write() { controller.abort(reason); if (outcome === "reject") throw reason; } } }, { limits, signal: controller.signal, budget });
  await expect(pending).rejects.toMatchObject({ code: "cancelled", data: { complete: false, entries: [{ published: true }, { published: true }], manifest: { published: true } }, published: [{ path: "/out/image-1.bmp" }, { path: "/out/image-2.bmp" }, { path: "/out/manifest.json" }] });
  expect(volume.readdirSync("/out")).toEqual(["image-1.bmp", "image-2.bmp", "manifest.json"]);
});
it("refuses a throwing prepublication admission hook before any staged acquisition", async () => {
  const { bytes } = await createDocumentFixture("garden", "empty"), { fs, volume } = publication(bytes), reason = new Error("Original output admission refusal");
  const context = { limits, signal: new AbortController().signal, filesystem: fs, encoding: { order: "name", compression: "store" } as const, admitPublication() { throw reason; } };
  await expect(extractDocumentImages(bytes, { outputDir: "/out" }, context)).rejects.toBe(reason); expect(volume.readdirSync("/out")).toEqual([]);
});
it("refuses and observes asynchronous prepublication admission hooks without publishing", async () => {
  const { bytes } = await createDocumentFixture("garden", "empty"), { fs, volume } = publication(bytes);
  const context = { limits, signal: new AbortController().signal, filesystem: fs, encoding: { order: "name", compression: "store" } as const, admitPublication: (async () => { throw new Error("Original asynchronous admission refusal"); }) as unknown as () => undefined };
  await expect(extractDocumentImages(bytes, { outputDir: "/out" }, context)).rejects.toMatchObject({ code: "usage" }); expect(volume.readdirSync("/out")).toEqual([]);
});
it("reports actual original-byte receipts and staging cleanup after a later publication failure", async () => {
  const { bytes } = await createDocumentFixture("museum"), { fs, volume } = publication(bytes, true); let stdout = "";
  const result = await createDocxInspectionCommandEngine({ limits }).execute({ args: ["images", "extract", "/input.docx", "--output-dir", "/out", "--allow-partial-output", "--json"].map(arg => new TextEncoder().encode(arg)), cwd: "/", filesystem: fs, signal: new AbortController().signal, stdin: { [Symbol.asyncIterator]() { return { async next(): Promise<IteratorResult<Uint8Array>> { throw new Error("implicit input"); } }; } }, stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write() {} } });
  expect(result.exitCode).toBe(3); expect(JSON.parse(stdout)).toMatchObject({ ok: false, data: { complete: false, manifest: { published: false }, entries: [{ published: true }, { published: false }] } });
  expect(volume.readdirSync("/out")).toEqual(["image-1.bmp"]);
});
it("preflights the complete chosen extraction JSON before acquiring publication staging", async () => {
  const { bytes } = await createDocumentFixture("garden", "empty"), { fs, volume } = publication(bytes); let stdout = "";
  const result = await createDocxInspectionCommandEngine({ limits }).execute({ args: ["images", "extract", "/input.docx", "--output-dir", "/out", "--limit", "serializedOutput=300", "--json"].map(arg => new TextEncoder().encode(arg)), cwd: "/", filesystem: fs, signal: new AbortController().signal, stdin: { [Symbol.asyncIterator]() { return { async next(): Promise<IteratorResult<Uint8Array>> { throw new Error("implicit input"); } }; } }, stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write() {} } });
  expect(result.exitCode).toBe(4); expect(JSON.parse(stdout).ok).toBe(false); expect(volume.readdirSync("/out")).toEqual([]);
});
it("retains typed public extraction receipts when stdout cancels after publication", async () => {
  const { bytes } = await createDocumentFixture("museum"), { fs, volume } = publication(bytes), controller = new AbortController(), reason = new Error("Original stdout cancellation");
  const pending = createDocxInspectionCommandEngine({ limits }).execute({ args: ["images", "extract", "/input.docx", "--output-dir", "/out", "--allow-partial-output", "--json"].map(arg => new TextEncoder().encode(arg)), cwd: "/", filesystem: fs, signal: controller.signal, stdin: { [Symbol.asyncIterator]() { return { async next(): Promise<IteratorResult<Uint8Array>> { throw new Error("implicit input"); } }; } }, stdout: { async write() { controller.abort(reason); throw reason; } }, stderr: { async write() {} } });
  await expect(pending).rejects.toMatchObject({ code: "cancelled", data: { complete: false, entries: [{ published: true }, { published: true }], manifest: { published: true } } });
  expect(volume.readdirSync("/out")).toEqual(["image-1.bmp", "image-2.bmp", "manifest.json"]);
});
it("keeps public stdout failure status and actual extraction metadata together", async () => {
  const { bytes } = await createDocumentFixture("museum"), { fs, volume } = publication(bytes);
  const result = await createDocxInspectionCommandEngine({ limits }).execute({ args: ["images", "extract", "/input.docx", "--output-dir", "/out", "--allow-partial-output", "--json"].map(arg => new TextEncoder().encode(arg)), cwd: "/", filesystem: fs, signal: new AbortController().signal, stdin: { [Symbol.asyncIterator]() { return { async next(): Promise<IteratorResult<Uint8Array>> { throw new Error("implicit input"); } }; } }, stdout: { async write() { throw new Error("Original stdout failure"); } }, stderr: { async write() {} } });
  expect(result).toMatchObject({ exitCode: 3, extraction: { entries: [{ published: true }, { published: true }], manifest: { published: true } } });
  expect(volume.readdirSync("/out")).toEqual(["image-1.bmp", "image-2.bmp", "manifest.json"]);
});
it("admits the exact chosen empty human image summary without charging hidden JSON", async () => {
  const { bytes } = await createDocumentFixture("garden", "empty"); let stdout = "";
  const result = await createDocxInspectionCommandEngine({ limits }).execute({ args: ["images", "list", "-", "--limit", "serializedOutput=10"].map(arg => new TextEncoder().encode(arg)), cwd: "/", filesystem: { async readFile() { throw new Error("undeclared input"); } }, signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() { yield bytes; } }, stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write() {} } });
  expect(result.exitCode).toBe(0); expect(stdout).toBe("Images: 0\n");
});
it("runs public image list and get through explicit memfs command input", async () => {
  const { bytes } = await createDocumentFixture("museum"), volume = Volume.fromJSON({ "/input.docx": Buffer.from(bytes) });
  const before = volume.toJSON();
  for (const args of [["images", "list", "/input.docx", "--unique", "--json"], ["images", "get", "/input.docx", "--image", "2", "--json"]]) {
    let stdout = "", stderr = "";
    const result = await createDocxInspectionCommandEngine({ limits }).execute({ args: args.map(arg => new TextEncoder().encode(arg)), cwd: "/", filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Uint8Array); } }, signal: new AbortController().signal, stdin: { [Symbol.asyncIterator]() { return { async next(): Promise<IteratorResult<Uint8Array>> { throw new Error("implicit input"); } }; } }, stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
    expect(result.exitCode).toBe(0); expect(JSON.parse(stdout)).toMatchObject({ ok: true, affected: 0, errors: [] });
    if (args[1] === "list") expect(JSON.parse(stdout).data.items).toHaveLength(1);
    else expect(JSON.parse(stdout).data.item.kind).toBe("images");
    expect(stderr).not.toContain("not implemented");
  }
  expect(volume.toJSON()).toEqual(before);
});
