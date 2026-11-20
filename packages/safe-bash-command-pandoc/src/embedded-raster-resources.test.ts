import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {Volume} from "memfs";
import {PDFDocument, PDFName, PDFRawStream} from "pdf-lib";
import {readZipArchiveEntries} from "@poe-code/office-package/zip-sync";
import {convert, convertToOutput} from "./engine.js";
import type {ResourceFileSystem} from "./types.js";

const fixtures = [
  ["gif", "R0lGODdhCAAGAIEAAMgUKAAAAAAAAAAAACwAAAAACAAGAAAIDgABCBxIsKDBgwgTDgwIADs="],
  ["bmp", "Qk3GAAAAAAAAADYAAAAoAAAACAAAAAYAAAABABgAAAAAAJAAAADEDgAAxA4AAAAAAAAAAAAAKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTIKBTI"],
  ["tiff", "SUkqAAgAAAAKAAABBAABAAAACAAAAAEBBAABAAAABgAAAAIBAwADAAAAhgAAAAMBAwABAAAAAQAAAAYBAwABAAAAAgAAABEBBAABAAAAjAAAABUBAwABAAAAAwAAABYBBAABAAAABgAAABcBBAABAAAAkAAAABwBAwABAAAAAQAAAAAAAAAIAAgACADIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCjIFCg="],
] as const;
const cases = fixtures.flatMap(([mime, encoded]) => ["typed", "raw", "html"].flatMap(route =>
  (["docx", "pdf"] as const).map(to => ({mime, encoded, route, to}))));
it.each(cases)("embeds $mime data URLs through $route in $to without host retrieval", async ({mime, encoded, route, to}) => {
  const url = `data:image/${mime};base64,${encoded}`;
  const text = route === "typed" ? `Before ![Pixel](${url}) After` : `<p>Before <img src="${url}"> After</p>`;
  const options = {from: route === "typed" ? "gfm" : route === "raw" ? "commonmark" : "html", to};
  const input = {bytes: new TextEncoder().encode(text)};
  for (const mode of ["memory", "vfs", "retained"]) {
    const volume = new Volume();
    volume.mkdirSync("/", {recursive: true});
    const readFile = vi.fn(async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer));
    const resourceFiles: ResourceFileSystem = {
      async lstat(path) {const stat = volume.lstatSync(path); return {type: stat.isDirectory() ? "directory" : "file"};},
      readFile,
      async mkdir(path) {volume.mkdirSync(path, {recursive: true});},
      async writeFile(path, bytes) {volume.writeFileSync(path, bytes);},
    };
    const context = {yield: async () => {}, ...(mode === "memory" ? {} : {resourceFiles})};
    let bytes: Uint8Array;
    if (mode === "retained") {
      const fs = new MemoryFileSystem(), chunks: Uint8Array[] = [];
      await convertToOutput([input], options, {...context,
        workingFiles: {fs, directory: "/", cacheBytes: 16384},
        output: {async write(chunk) {chunks.push(chunk.slice());}, async close() {}, async abort() {}},
      });
      bytes = new Uint8Array(Buffer.concat(chunks));
      expect(await fs.readdir("/")).toEqual([]);
    } else {
      const result = await convert([input], options, context);
      if (result.kind !== "binary") throw Error("Expected binary document");
      bytes = result.bytes;
    }
    expect(readFile).not.toHaveBeenCalled();
    if (to === "docx") {
      const parts = readZipArchiveEntries(bytes);
      const images = [...parts].filter(([name]) => name.startsWith("word/media/"));
      expect(images).toHaveLength(1);
      expect(images[0]![1]).toEqual(new Uint8Array(Buffer.from(encoded, "base64")));
      expect(new TextDecoder().decode(parts.get("word/document.xml"))).toMatch(/Before.*After/s);
    } else {
      const pdf = await PDFDocument.load(bytes);
      const images = pdf.context.enumerateIndirectObjects().filter(([, object]) =>
        object instanceof PDFRawStream && object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"));
      expect(images).toHaveLength(1);
      expect(pdf.getPageCount()).toBe(1);
    }
  }
});
