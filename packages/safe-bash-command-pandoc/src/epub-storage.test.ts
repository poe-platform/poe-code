import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {createZipCodec} from "@poe-code/office-package/zip";
import {createCompressionCodec} from "@poe-code/compression";
import {readDocument, convert} from "./engine.js";
import {createPandocCommand} from "./command.js";

const encoder = new TextEncoder();
const zip = createZipCodec({compression: createCompressionCodec(), yieldTurn: async () => {}, fail(message) {throw new Error(message);}});
const zipLimits = {maxArchiveBytes: 8 * 1024 * 1024, maxEntryBytes: 8 * 1024 * 1024, maxTotalBytes: 8 * 1024 * 1024, maxMembers: 20, maxPathBytes: 1024, maxDepth: 16, maxPaxBytes: 1024, maxTextBytes: 1024, chunkSize: 4096};
async function publication(size = 256 * 1024, content = "<p>Streamed book.</p>") {
  const files = {
    mimetype: encoder.encode("application/epub+zip"),
    "META-INF/container.xml": encoder.encode('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    "package.opf": encoder.encode('<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Stored book</dc:title></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>'),
    "chapter.xhtml": encoder.encode(`<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body>${content}</body></html>`),
    "unused.bin": new Uint8Array(size).fill(91)
  };
  const signal = new AbortController().signal;
  const entries = await Promise.all(Object.entries(files).map(([name, bytes]) => zip.makeZipEntry(name, bytes, {modified: new Date("1980-01-01T00:00:00Z"), mode: 0o100644, directory: false, symlink: false, compression: "store"}, zipLimits, signal)));
  return zip.writeZipArchive({entries, comment: new Uint8Array()}, zipLimits, signal);
}

it("stores large streamed EPUB input and unused expanded members only in the supplied backing filesystem", async () => {
  const bytes = await publication();
  const fs = new MemoryFileSystem();
  const open = vi.spyOn(fs, "open");
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("whole-file reads forbidden"));
  const storageRead = vi.spyOn(PagedStorage.prototype, "read");
  let closed = false;
  const chunks = (async function* () {try {for(let offset = 0; offset < bytes.length; offset += 4096) yield bytes.subarray(offset, offset + 4096);} finally {closed = true;}})();
  try {
    const document = await readDocument({chunks}, {from: "epub"}, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, limits: {retainedBytes: 128 * 1024}, yield: async () => {}});
    expect(document.blocks).toMatchObject([{t: "Div", c: [expect.anything(), [{t: "Para", c: [{t: "Str", c: "Streamed"}, {t: "Space"}, {t: "Str", c: "book."}]}]]}]);
    expect(open).toHaveBeenCalled();
    expect(Math.max(...storageRead.mock.calls.map(([, length]) => length))).toBeLessThanOrEqual(65536);
    expect(closed).toBe(true);
    expect(await fs.readdir("/")).toEqual([]);
  } finally {storageRead.mockRestore();}
});

it("reads referenced chapters larger than a storage page without lowering format limits", async () => {
  const text = "long chapter ".repeat(2000);
  const bytes = await publication(0, `<p>${text}</p>`);
  const fs = new MemoryFileSystem();
  const result = await convert([{chunks: (async function* () {yield bytes;})()}], {from: "epub", to: "plain"}, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, yield: async () => {}});
  expect(result).toMatchObject({kind: "text", text: `${text.trim()}\n`});
  expect(await fs.readdir("/")).toEqual([]);
});

it("preserves missing image diagnostics while replacing unresolved images with their alternate text", async () => {
  const bytes = await publication(0, '<p><img src="missing.png" alt="missing illustration"/></p>');
  const fs = new MemoryFileSystem();
  const result = await convert([{chunks: (async function* () {yield bytes;})()}], {from: "epub", to: "plain"}, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, yield: async () => {}});
  expect(result.diagnostics).toContainEqual(expect.objectContaining({code: "W_RESOURCE_MISSING", location: "missing.png"}));
  expect(result).toMatchObject({kind: "text", text: "missing illustration\n"});
  expect(await fs.readdir("/")).toEqual([]);
});

it("retires a pending input iterator and backing storage when EPUB reading is cancelled", async () => {
  const fs = new MemoryFileSystem();
  const controller = new AbortController();
  let enter!: () => void;
  const entered = new Promise<void>(resolve => {enter = resolve;});
  let release!: (result: IteratorResult<Uint8Array>) => void;
  const pending = new Promise<IteratorResult<Uint8Array>>(resolve => {release = resolve;});
  let reads = 0, closed = 0;
  const iterator = {
    async next(): Promise<IteratorResult<Uint8Array>> {
      if (reads++ === 0) return {done: false, value: new Uint8Array(32768)};
      enter();
      return pending;
    },
    async return(): Promise<IteratorResult<Uint8Array>> {
      closed++;
      release({done: true, value: undefined});
      return {done: true, value: undefined};
    }
  };
  const result = readDocument({chunks: {[Symbol.asyncIterator]: () => iterator}}, {from: "epub"}, {signal: controller.signal, workingFiles: {fs, directory: "/", cacheBytes: 16384}, yield: async () => {}});
  const settled = result.then(() => undefined, error => error);
  try {
    await entered;
    controller.abort(new Error("cancel EPUB input"));
    expect(await settled).toMatchObject({code: "E_CANCELLED"});
    expect(closed).toBe(1);
    expect(await fs.readdir("/")).toEqual([]);
  } finally {release({done: true, value: undefined}); await settled;}
});

it("preserves EPUB SDK conversion through caller-backed input", async () => {
  const bytes = await publication();
  const fs = new MemoryFileSystem();
  const result = await convert([{chunks: (async function* () {yield bytes;})()}], {from: "epub", to: "plain"}, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, limits: {retainedBytes: 128 * 1024}, yield: async () => {}});
  expect(result).toMatchObject({kind: "text", text: "Streamed book.\n"});
  expect(await fs.readdir("/")).toEqual([]);
});

it("uses the command's injected filesystem for EPUB backing instead of collecting its file input", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/book.epub", await publication(2 * 1024 * 1024));
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("whole-file reads forbidden"));
  const open = vi.spyOn(fs, "open");
  let output = "", errors = "";
  const result = await createPandocCommand({limits: {retainedBytes: 2 * 1024 * 1024}}).execute({
    command: "pandoc", args: ["-f", "epub", "-t", "plain", "/book.epub"], cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}},
    stderr: {async write(bytes) {errors += new TextDecoder().decode(bytes);}}
  });
  expect(errors).toBe("");
  expect(result).toEqual({exitCode: 0});
  expect(output).toBe("Streamed book.\n");
  expect(open).toHaveBeenCalled();
  expect(await fs.readdir("/")).toEqual([{name: "book.epub", type: "file"}]);
});

it("owns streamed EPUB bytes before the producer overwrites or retires its window", async () => {
  const bytes = await publication(32768);
  const fs = new MemoryFileSystem();
  let closed = 0;
  const chunks = (async function* () {
    const window = new Uint8Array(997);
    try {
      for (let offset = 0; offset < bytes.length; offset += window.length) {
        const count = Math.min(window.length, bytes.length - offset);
        window.fill(255);
        window.set(bytes.subarray(offset, offset + count));
        yield window.subarray(0, count);
      }
    } finally {window.fill(0); closed++;}
  })();
  const result = await convert([{chunks}], {from: "epub", to: "plain"}, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, yield: async () => {}});
  expect(result).toMatchObject({kind: "text", text: "Streamed book.\n"});
  expect(closed).toBe(1);
  expect(await fs.readdir("/")).toEqual([]);
});

it.each(["unused CRC", "truncated archive"])("rejects %s and removes caller-backed scratch storage", async corruption => {
  let bytes = await publication(32768);
  if (corruption === "truncated archive") bytes = bytes.slice(0, -1);
  else {
    const namePosition = Buffer.from(bytes).indexOf("unused.bin");
    expect(namePosition).toBeGreaterThan(30);
    const extraLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(namePosition - 2, true);
    bytes[namePosition + "unused.bin".length + extraLength]! ^= 1;
  }
  const fs = new MemoryFileSystem();
  let closed = 0;
  const chunks = (async function* () {try {yield bytes;} finally {closed++;}})();
  await expect(readDocument({chunks}, {from: "epub"}, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, yield: async () => {}}))
    .rejects.toMatchObject({code: "E_PARSE", message: expect.stringContaining(corruption === "unused CRC" ? "CRC32" : "end of central directory")});
  expect(closed).toBe(1);
  expect(await fs.readdir("/")).toEqual([]);
});

it.each(["expandedBytes", "resourceBytes"] as const)("preserves the %s quota for unused spilled EPUB members", async budget => {
  const bytes = await publication(32768);
  const fs = new MemoryFileSystem();
  await expect(readDocument({chunks: (async function* () {yield bytes;})()}, {from: "epub"}, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, limits: {[budget]: 1024}, yield: async () => {}}))
    .rejects.toMatchObject({code: "E_LIMIT"});
  expect(await fs.readdir("/")).toEqual([]);
});

it("uses injected EPUB backing for command file destinations as well as stdout", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/book.epub", await publication(2 * 1024 * 1024));
  const read = fs.readFile.bind(fs);
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("whole-file input forbidden"));
  let errors = "";
  const stdout = vi.fn(async () => {});
  const result = await createPandocCommand({limits: {retainedBytes: 2 * 1024 * 1024}}).execute({
    command: "pandoc", args: ["-f", "epub", "-t", "plain", "/book.epub", "-o", "/book.txt"], cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: (async function* () {})(), stdout: {write: stdout},
    stderr: {async write(bytes) {errors += new TextDecoder().decode(bytes);}}
  });
  expect(result).toEqual({exitCode: 0});
  expect(errors).toBe("");
  expect(stdout).not.toHaveBeenCalled();
  expect(new TextDecoder().decode(await read("/book.txt"))).toBe("Streamed book.\n");
  expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["book.epub", "book.txt"]);
});

it("reads a book with many unused long-named members through the caller-backed directory index", async () => {
  const signal = new AbortController().signal;
  const base = await zip.readZipArchive(await publication(0), zipLimits, signal);
  const limits = {...zipLimits, maxMembers: 200};
  const extra = await Promise.all(Array.from({length: 128}, (_, index) => zip.makeZipEntry(`unused/${"shared-prefix-".repeat(30)}${index}.bin`, Uint8Array.of(index), {modified: new Date("1980-01-01T00:00:00Z"), mode: 0o100644, directory: false, symlink: false, compression: "store"}, limits, signal)));
  const bytes = await zip.writeZipArchive({entries: [...base.entries, ...extra], comment: new Uint8Array()}, limits, signal);
  expect(bytes.length).toBeGreaterThan(64 * 1024);
  const fs = new MemoryFileSystem();
  const open = vi.spyOn(fs, "open");
  const read = vi.spyOn(PagedStorage.prototype, "read");
  try {
    const result = await convert([{chunks: (async function* () {for (let offset = 0; offset < bytes.length; offset += 997) yield bytes.subarray(offset, offset + 997);})()}], {from: "epub", to: "plain"}, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, limits: {retainedBytes: 64 * 1024}, yield: async () => {}});
    expect(result).toMatchObject({kind: "text", text: "Streamed book.\n", diagnostics: []});
    expect(open).toHaveBeenCalled();
    expect(Math.max(...read.mock.calls.map(([, length]) => length))).toBeLessThanOrEqual(4096);
    expect(await fs.readdir("/")).toEqual([]);
  } finally {read.mockRestore();}
});

it("avoids a complete XML source copy for an SDK-backed chapter containing many small comments", async () => {
  const content = `<!--${"x".repeat(4096)}-->`.repeat(128) + "<p>é😀 &amp; preserved.</p>";
  const bytes = await publication(0, content);
  const fs = new MemoryFileSystem();
  const read = vi.spyOn(PagedStorage.prototype, "read");
  try {
    const result = await convert([{chunks: (async function* () {for (let offset = 0; offset < bytes.length; offset += 997) yield bytes.subarray(offset, offset + 997);})()}], {from: "epub", to: "plain"}, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, limits: {retainedBytes: 128 * 1024}, yield: async () => {}});
    expect(result).toMatchObject({kind: "text", text: "é😀 & preserved.\n", diagnostics: []});
    expect(Math.max(...read.mock.calls.map(([, length]) => length))).toBeLessThanOrEqual(4096);
    expect(await fs.readdir("/")).toEqual([]);
  } finally {read.mockRestore();}
});
