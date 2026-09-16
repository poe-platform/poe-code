import {expect, it, vi} from "vitest";
import {PDFDocument, PDFDict, PDFName, PDFArray, PDFRawStream, decodePDFRawStream} from "pdf-lib";
import {Volume} from "memfs";
import {convert, writeDocument, createFormatRegistry, createPandocCommand} from "./index.js";
import type {Document} from "./types.js";
const encode = (text: string) => new TextEncoder().encode(text);
const document: Document = {blocks: [{t: "Header", c: [1, ["owned", [], []], [{t: "Str", c: "Owned heading"}]]}, {t: "Para", c: [{t: "Str", c: "Owned PDF text"}]}], metadata: {title: {t: "MetaString", c: "Café 東京"}, author: {t: "MetaList", c: [{t: "MetaString", c: "Zoë"}, {t: "MetaString", c: "René"}]}}, resources: []};
it("projects supported metadata and heading outlines through the SDK", async () => {
  const result = await writeDocument(document, {to: "pdf"}, {yield: async () => {}});
  expect(result.kind).toBe("binary"); if (result.kind !== "binary") throw new Error("PDF expected");
  const pdf = await PDFDocument.load(result.bytes, {updateMetadata: false});
  expect(pdf.getTitle()).toBe("Café 東京"); expect(pdf.getAuthor()).toBe("Zoë; René");
  expect(pdf.catalog.lookup(PDFName.of("Outlines"), PDFDict).get(PDFName.of("Count"))!.toString()).toBe("1");
});
it("awaits PDF streaming sink writes and close before resolving", async () => {
  let release!: () => void; const blocked = new Promise<void>(resolve => {release = resolve;});
  let started!: () => void; const ready = new Promise<void>(resolve => {started = resolve;});
  const output: Uint8Array[] = []; let complete = false;
  const close = vi.fn(async () => {});
  const pending = writeDocument(document, {to: "pdf"}, {yield: async () => {}, output: {write: async bytes => {output.push(new Uint8Array(bytes)); started(); await blocked;}, close, abort: async () => {}}}).then(result => {complete = true; return result;});
  await ready; expect(complete).toBe(false); expect(close).not.toHaveBeenCalled(); release();
  await pending; expect(close).toHaveBeenCalledOnce();
  const bytes = new Uint8Array(output.reduce((sum, part) => sum + part.length, 0)); let at = 0; for (const part of output) {bytes.set(part, at); at += part.length;}
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
});
it("infers PDF output only with --yes and rejects external engines before acquisition", async () => {
  const volume = Volume.fromJSON({"/owned.md": "Owned PDF text"});
  const read = vi.fn(async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer));
  const write = vi.fn(async (path: string, bytes: Uint8Array) => {volume.writeFileSync(path, bytes);});
  const errors: string[] = [];
  const execute = (args: string[]) => createPandocCommand().execute({args, signal: new AbortController().signal, cwd: "/", stdin: [], readFile: read, writeFile: write, stdout: {write: async () => {}}, stderr: {write: async bytes => {errors.push(new TextDecoder().decode(bytes));}}});
  expect((await execute(["-f", "commonmark", "/owned.md", "-o", "/owned.pdf"])).exitCode).toBe(2); expect(read).not.toHaveBeenCalled();
  errors.length = 0;
  expect((await execute(["--yes", "-f", "commonmark", "/owned.md", "-o", "/owned.pdf"])).exitCode).toBe(0); expect(errors).toEqual([]);
  const sdk = await convert([{bytes: encode("Owned PDF text")}], {from: "commonmark", to: "pdf"}, {});
  if (sdk.kind !== "binary") throw new Error("PDF expected");
  const bytes = new Uint8Array(volume.readFileSync("/owned.pdf") as Buffer);
  expect(bytes.length === sdk.bytes.length && bytes.every((byte, i) => byte === sdk.bytes[i])).toBe(true);
  for (const engine of ["--pdf-engine=xelatex", "--pdf-engine=command", "--pdf-engine=/bin/false"]) {
    read.mockClear(); errors.length = 0;
    expect((await execute(["--yes", "-f", "commonmark", "-t", "pdf", engine, "/owned.md", "-o", "/owned.pdf"])).exitCode).toBe(2);
    expect(errors.join("")).toContain("External PDF engines are forbidden"); expect(read).not.toHaveBeenCalled();
  }
});
const cases: Record<string, string> = {
  commonmark: "Owned PDF text", gfm: "Owned PDF text", html: "<p>Owned PDF text</p>",
  json: JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "Para", c: [{t: "Str", c: "Owned PDF text"}]}]}),
  csv: "Owned,PDF\ntext,value\n", tsv: "Owned\tPDF\ntext\tvalue\n", latex: "Owned PDF text", rst: "Owned PDF text", rtf: "{\\rtf1\\ansi Owned PDF text}"
};
it("accounts for every available reader-to-PDF pair", () => {
  expect([...Object.keys(cases), "epub"].sort()).toEqual(createFormatRegistry().list("read"));
});
it.each([...Object.keys(cases), "epub"])("converts representable %s content to mapped PDF text", async from => {
  let bytes: Uint8Array;
  if (from === "epub") {
    const epub = await writeDocument({...document, metadata: {title: {t: "MetaString", c: "Original EPUB"}}}, {to: "epub"}, {yield: async () => {}});
    if (epub.kind !== "binary") throw new Error("EPUB expected"); bytes = epub.bytes;
  } else bytes = encode(cases[from]!);

    const result = await convert([{bytes}], {from, to: "pdf"}, {yield: async () => {}});
    expect(result.kind, from).toBe("binary"); if (result.kind !== "binary") throw new Error(from);
    const pdf = await PDFDocument.load(result.bytes);
    expect(pdf.getPageCount(), from).toBe(1);
    const page = pdf.getPages()[0]!;
    const font = pdf.context.lookup(page.node.Resources()!.lookup(PDFName.of("Font"), PDFDict).values()[0], PDFDict);
    const cmap = pdf.context.lookup(font.get(PDFName.of("ToUnicode"))) as PDFRawStream;
    const mappings = new Map<string, string>();
    for (const line of new TextDecoder().decode(decodePDFRawStream(cmap).decode()).split("\n")) {
      const parts = line.trim().split(" ");
      if (parts.length === 2 && parts.every(part => part.startsWith("<") && part.endsWith(">"))) {
        const encoded = parts[1]!.slice(1, -1); let unicode = "";
        for (let at = 0; at < encoded.length; at += 4) unicode += String.fromCharCode(Number.parseInt(encoded.slice(at, at + 4), 16));
        mappings.set(parts[0]!.slice(1, -1), unicode);
      }
    }
    let extracted = "";
    const contents = page.node.Contents() as PDFArray;
    for (let i = 0; i < contents.size(); i++) {
      const stream = pdf.context.lookup(contents.get(i)) as PDFRawStream;
      for (const line of new TextDecoder().decode(decodePDFRawStream(stream).decode()).split("\n")) {
        if (!line.startsWith("<") || !line.endsWith("> Tj")) continue;
        const codes = line.slice(1, -4);
        for (let at = 0; at < codes.length; at += 4) extracted += mappings.get(codes.slice(at, at + 4)) ?? "?";
      }
    }
    expect(extracted.split(" ").join(""), from).toContain("OwnedPDFtext");
});
