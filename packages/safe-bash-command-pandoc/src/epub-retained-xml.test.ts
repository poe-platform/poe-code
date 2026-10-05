import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {ExecutionContext} from "./execution.js";
import {parseEpubXml} from "./epub-xml.js";
import {openEpubXml} from "./epub-retained-xml.js";

const encode = (value: string) => new TextEncoder().encode(value);
async function* bytes(value: string) {yield encode(value);}

it.each([1, 7, 256])("retains EPUB XML through reused %i-byte input windows", async size => {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("read", {workingFiles: {fs, directory: "/", cacheBytes: 16384}, yield: async () => {}});
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole reads forbidden"));
  const input = encode('<html xmlns="http://www.w3.org/1999/xhtml"><body><p title="é&amp;😀">a\r\nb<![CDATA[ c]]></p></body></html>');
  const window = new Uint8Array(size); let closed = 0;
  const source = (async function* () {try {for (let offset = 0; offset < input.length; offset += size) {const length = Math.min(size, input.length - offset); window.set(input.subarray(offset, offset + length)); yield window.subarray(0, length);}} finally {closed++; window.fill(255);}})();
  try {
    const xml = await openEpubXml(source, "chapter.xhtml", context);
    expect(closed).toBe(1);
    let count = 0; for await (const node of xml.elements(xml.root)) {expect(node.kind).toBe("element"); count++;}
    expect(count).toBe(3);
    await xml.close(); await xml.close();
  } finally {await context.close();}
  expect(await fs.readdir("/")).toEqual([]);
});

it.each(['<!DOCTYPE html><html/>', '<html>&missing;</html>', '<html></wrong>', '<?xml version="1.0" encoding="UTF-16"?><html/>'])("preserves XML policy rejection and cleanup: %s", async source => {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("read", {workingFiles: {fs, directory: "/", cacheBytes: 16384}, yield: async () => {}});
  try {await expect(openEpubXml(bytes(source), "bad.xml", context)).rejects.toMatchObject({code: "E_PARSE", format: "epub", location: "bad.xml"});}
  finally {await context.close();}
  expect(await fs.readdir("/")).toEqual([]);
});

it.each(["text", "xmlNodes", "xmlDepth", "attributes"] as const)("enforces the EPUB %s budget", async budget => {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("read", {workingFiles: {fs, directory: "/", cacheBytes: 16384}, limits: {[budget]: 0}, yield: async () => {}});
  try {await expect(openEpubXml(bytes('<html xmlns="urn:test"/>'), "chapter.xml", context)).rejects.toMatchObject({code: "E_LIMIT"});}
  finally {await context.close();}
  expect(await fs.readdir("/")).toEqual([]);
});

it("owns an iterator created by a factory that cancels", async () => {
  const fs = new MemoryFileSystem(), controller = new AbortController();
  const context = new ExecutionContext("read", {signal: controller.signal, workingFiles: {fs, directory: "/", cacheBytes: 16384}, yield: async () => {}});
  const next = vi.fn(async () => ({done: false as const, value: encode("<html/>")})), close = vi.fn(async () => ({done: true as const, value: undefined}));
  try {await expect(openEpubXml({[Symbol.asyncIterator]() {controller.abort(); return {next, return: close};}}, "chapter.xml", context)).rejects.toMatchObject({code: "E_CANCELLED"});}
  finally {await context.close();}
  expect(next).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1); expect(await fs.readdir("/")).toEqual([]);
});

it("preserves producer failure over iterator retirement failure", async () => {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("read", {workingFiles: {fs, directory: "/", cacheBytes: 16384}, yield: async () => {}}), failure = new Error("producer failed");
  const close = vi.fn(async () => {throw new Error("retirement failed");});
  try {await expect(openEpubXml({[Symbol.asyncIterator]() {return {next: async () => {throw failure;}, return: close};}}, "chapter.xml", context)).rejects.toBe(failure);}
  finally {await context.close();}
  expect(close).toHaveBeenCalledTimes(1); expect(await fs.readdir("/")).toEqual([]);
});

it.each(['<html>text<![CDATA[more]]><p a="1"/></html>', '<?xml version="1.0"?> \n<html/> \n', '<!--before--> \n<html><!--inside-->text</html> \n<!--after-->'])("matches semantic XML accounting for %s", async source => {
  const fs = new MemoryFileSystem(), original = new ExecutionContext("read", {yield: async () => {}}), retained = new ExecutionContext("read", {workingFiles: {fs, directory: "/", cacheBytes: 16384}, yield: async () => {}});
  const oldCharges = vi.spyOn(original, "charge"), newCharges = vi.spyOn(retained, "charge");
  try {
    await parseEpubXml(bytes(source), "chapter.xml", original);
    const xml = await openEpubXml(bytes(source), "chapter.xml", retained);
    for (const key of ["text", "xmlNodes", "attributes"] as const) {
      const sum = (calls: typeof oldCharges.mock.calls) => calls.filter(call => call[0] === key).reduce((n, call) => n + call[1], 0);
      expect(sum(newCharges.mock.calls), key).toBe(sum(oldCharges.mock.calls));
    }
    await xml.close();
  } finally {await original.close(); await retained.close();}
  expect(await fs.readdir("/")).toEqual([]);
});

it("keeps large text and attributes backed and retires them with the execution", async () => {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("read", {workingFiles: {fs, directory: "/", cacheBytes: 16384}, yield: async () => {}});
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole reads forbidden"));
  let handles = 0, opened = 0;
  const open = fs.open!.bind(fs);
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args); handles++; opened++;
    const close = handle.close.bind(handle); vi.spyOn(handle, "close").mockImplementation(async () => {try {await close();} finally {handles--;}});
    return handle;
  });
  const chunk = encode("x".repeat(4096));
  const source = (async function* () {yield encode('<html title="'); for (let i = 0; i < 16; i++) yield chunk; yield encode('">'); for (let i = 0; i < 16; i++) yield chunk; yield encode('</html>');})();
  const xml = await openEpubXml(source, "large.xml", context);
  expect(opened).toBeGreaterThan(0); expect(handles).toBeGreaterThan(0);
  let length = 0; for await (const chunk of xml.text(xml.root)) {expect(chunk.length).toBeLessThanOrEqual(16384); length += chunk.length;}
  expect(length).toBe(65536);
  await context.close();
  await expect(xml.nodes().next()).rejects.toMatchObject({code: "invalid-handle"});
  expect(handles).toBe(0); expect(await fs.readdir("/")).toEqual([]);
});

it.each([[0xe2, 0x82], [0xc0, 0xaf], [0xed, 0xa0, 0x80]])("rejects invalid UTF-8 %j without changing its error category", async (...sequence) => {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("read", {workingFiles: {fs, directory: "/", cacheBytes: 16384}, yield: async () => {}});
  const source = (async function* () {yield encode('<html>'); yield Uint8Array.from(sequence);})();
  try {await expect(openEpubXml(source, "bad.xml", context)).rejects.toMatchObject({code: "E_ENCODING"});}
  finally {await context.close();}
  expect(await fs.readdir("/")).toEqual([]);
});

it("retires acquisition when execution closes during a pending source pull", async () => {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("read", {workingFiles: {fs, directory: "/", cacheBytes: 16384}, yield: async () => {}});
  let entered!: () => void, finish!: (value: IteratorResult<Uint8Array>) => void;
  const started = new Promise<void>(resolve => {entered = resolve;}), pending = new Promise<IteratorResult<Uint8Array>>(resolve => {finish = resolve;});
  const close = vi.fn(async () => {finish({done: true, value: undefined}); return {done: true as const, value: undefined};});
  const run = openEpubXml({[Symbol.asyncIterator]() {return {next: () => {entered(); return pending;}, return: close};}}, "chapter.xml", context);
  const settled = run.then(() => undefined, error => error);
  await started; await context.close(); expect(await settled).toMatchObject({code: "E_IO"});
  expect(close).toHaveBeenCalledTimes(1); expect(await fs.readdir("/")).toEqual([]);
});

it("closes XML backing acquired after execution retirement starts", async () => {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("read", {workingFiles: {fs, directory: "/", cacheBytes: 16384}, yield: async () => {}});
  let handles = 0;
  const open = fs.open!.bind(fs);
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args); handles++;
    const close = handle.close.bind(handle); vi.spyOn(handle, "close").mockImplementation(async () => {try {await close();} finally {handles--;}});
    void context.close(); return handle;
  });
  await expect(openEpubXml(bytes('<html>' + '<p/>' .repeat(100) + '</html>'), "chapter.xml", context)).rejects.toMatchObject({code: "E_IO"});
  await context.close(); expect(handles).toBe(0); expect(await fs.readdir("/")).toEqual([]);
});

it("maps backing failures to the Pandoc I/O category", async () => {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("read", {workingFiles: {fs, directory: "/", cacheBytes: 16384}, yield: async () => {}});
  vi.spyOn(fs, "open").mockRejectedValue(new Error("storage offline"));
  try {await expect(openEpubXml(bytes('<html>' + '<p/>'.repeat(100) + '</html>'), "chapter.xml", context)).rejects.toMatchObject({code: "E_IO"});}
  finally {await context.close();}
  expect(await fs.readdir("/")).toEqual([]);
});
