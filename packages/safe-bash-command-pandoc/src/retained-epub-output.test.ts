import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {createZipCodec} from "@poe-code/office-package/zip";
import {createCompressionCodec} from "@poe-code/compression";
import {convert, convertToOutput} from "./engine.js";
import * as epubXml from "./epub-xml.js";

it.each([{}, {references: 1000000, retainedBytes: 16777216}].flatMap(budgets => ["success", "cancel", "sink-failure", "backing-failure"].map(mode => ({budgets, mode}))))("converts a multi-chapter EPUB with cross-chapter notes through the retained output route (%j)", async ({budgets, mode}) => {
  const encoder = new TextEncoder(), signal = new AbortController().signal;
  const codec = createZipCodec({compression: createCompressionCodec(), yieldTurn: async () => {}, fail(message) {throw new Error(message);}});
  const limits = {maxArchiveBytes: Infinity, maxEntryBytes: Infinity, maxTotalBytes: Infinity, maxMembers: Infinity, maxPathBytes: Infinity, maxDepth: Infinity, maxPaxBytes: Infinity, maxTextBytes: Infinity, chunkSize: 4096};
  const page = (body: string) => '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>' + body + '</body></html>';
  const files = {
    mimetype: "application/epub+zip",
    "META-INF/container.xml": '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    "package.opf": '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Retained book</dc:title></metadata><manifest><item id="first" href="first.xhtml" media-type="application/xhtml+xml"/><item id="second" href="second.xhtml" media-type="application/xhtml+xml"/><item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="first"/><itemref idref="second"/></spine></package>',
    "first.xhtml": page('<h1 id="start">First</h1>' + '<p>Growing chapter text.</p>'.repeat(128) + '<p>See <a href="second.xhtml#end">next</a>.<a epub:type="noteref" href="notes.xhtml#note">1</a></p>'),
    "second.xhtml": page('<h1 id="end">Second</h1><p>Return <a href="first.xhtml#start">home</a>.<a epub:type="noteref" href="notes.xhtml#note">1</a></p>'),
    "notes.xhtml": page('<aside id="note" epub:type="footnote"><p>Shared footnote.</p></aside>')
  };
  const entries = [];
  for (const [name, text] of Object.entries(files)) entries.push(await codec.makeZipEntry(name, encoder.encode(text), {modified: new Date("1980-01-01T00:00:00Z"), mode: 0o100644, directory: false, symlink: false, compression: "store"}, limits, signal));
  const archive = await codec.writeZipArchive({entries, comment: new Uint8Array()}, limits, signal);
  const expected = await convert([{bytes: archive}], {from: "epub", to: "plain"}, {yield: async () => {}});
  if (expected.kind !== "text") throw new Error("Expected reference plain text");
  const fs = new MemoryFileSystem();
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole-file reads forbidden"));
  if (mode === "backing-failure") {
    const open = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {const handle = await open(...args); vi.spyOn(handle, "write").mockRejectedValue(new Error("Backing failed")); return handle;});
  }
  const bufferedXml = vi.spyOn(epubXml, "parseEpubXml").mockRejectedValue(new Error("Buffered EPUB XML reader must not run on the retained output route"));
  let output = "", outstanding = 0, peak = 0, closed = 0;
  const close = vi.fn(async () => {}), abort = vi.fn(async () => {});
  const chunks = (async function* () {const window = new Uint8Array(4096); try {for (let offset = 0; offset < archive.length; offset += window.length) {const size = Math.min(window.length, archive.length - offset); window.set(archive.subarray(offset, offset + size)); yield window.subarray(0, size); window.fill(255);}} finally {closed++;}})();
  const decoder = new TextDecoder(), controller = new AbortController();
  try {
    const conversion = convertToOutput([{chunks}], {from: "epub", to: "plain"}, {signal: controller.signal, limits: budgets, workingFiles: {fs, directory: "/", cacheBytes: 16384}, yield: async () => {}, output: {
      async write(bytes) {outstanding += bytes.length; peak = Math.max(peak, outstanding); try {await Promise.resolve(); if (mode === "cancel") controller.abort(); if (mode === "sink-failure") throw new Error("Sink failed"); output += decoder.decode(bytes, {stream: true});} finally {outstanding -= bytes.length;}}, close, abort
    }});
    if (mode !== "success") {await expect(conversion).rejects.toMatchObject({code: mode === "cancel" ? "E_CANCELLED" : "E_IO"}); expect(abort).toHaveBeenCalledTimes(mode === "backing-failure" ? 0 : 1); expect(close).not.toHaveBeenCalled(); expect(closed).toBe(1); expect(bufferedXml).not.toHaveBeenCalled(); return;}
    await conversion;
    output += decoder.decode();
    expect(output).toBe(expected.text); expect(peak).toBeLessThanOrEqual(65536);
    expect(closed).toBe(1); expect(close).toHaveBeenCalledTimes(1); expect(abort).not.toHaveBeenCalled();
    expect(bufferedXml).not.toHaveBeenCalled();
  } finally {bufferedXml.mockRestore(); expect(await fs.readdir("/")).toEqual([]);}
});
