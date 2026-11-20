import {readFileSync} from "node:fs";
import {expect, it, vi} from "vitest";
import {PDFDocument, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream} from "pdf-lib";
import {readZipArchiveEntries} from "@poe-code/office-package/zip-sync";
import {convert, writeDocument} from "./engine.js";

const encoder = new TextEncoder();
const context = {yield: async () => {}};
const fixtures = ["gif", "bmp", "tiff"] as const;
const routes = ["commonmark", "gfm", "html", "document"] as const;
const outputs = ["docx", "pdf"] as const;
const cases = fixtures.flatMap(extension => routes.flatMap(route => outputs.map(to => ({extension, route, to}))));

it.each(cases)("embeds complete $extension images through $route in $to", async ({extension, route, to}) => {
  const bytes = new Uint8Array(readFileSync(new URL(`../../safe-bash-rust/tests/fixtures/html-images/pixel.${extension}`, import.meta.url)));
  const source = `pixel.${extension}`;
  const resolve = vi.fn(async (requested: string) => {
    expect(requested).toBe(source);
    return bytes;
  });
  const result = route === "document"
    ? await writeDocument({metadata: {}, resources: [{id: source, bytes}], blocks: [{t: "Para", c: [
      {t: "Image", c: [["", [], []], [], [source, ""]]},
      {t: "RawInline", c: ["html", `<img src='${source}'>`]},
    ]}]}, {to}, context)
    : await convert([{bytes: encoder.encode(route === "html"
      ? `<p><img src='${source}'><img src='${source}'></p>`
      : `![picture](${source})\n\n<img src='${source}'>\n`)}], {from: route, to}, {...context, resources: {resolve}});
  if (result.kind !== "binary") throw Error("Expected binary document");
  if (route !== "document") expect(resolve).toHaveBeenCalledOnce();
  if (to === "docx") {
    const parts = readZipArchiveEntries(result.bytes);
    const images = [...parts.entries()].filter(([name]) => name.startsWith("word/media/"));
    expect(images).toHaveLength(1);
    expect(images[0]![1]).toEqual(bytes);
    expect([...new TextDecoder().decode(parts.get("word/document.xml")).matchAll(/<w:drawing\b[^>]*>/g)]).toHaveLength(2);
  } else {
    const pdf = await PDFDocument.load(result.bytes);
    const images = pdf.context.enumerateIndirectObjects().map(([, object]) => object)
      .filter((object): object is PDFRawStream => object instanceof PDFRawStream && object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"));
    expect(images).toHaveLength(1);
    const image = images[0]!;
    expect(image.dict.lookup(PDFName.of("Width"), PDFNumber).asNumber()).toBe(8);
    expect(image.dict.lookup(PDFName.of("Height"), PDFNumber).asNumber()).toBe(6);
    expect(decodePDFRawStream(image).decode()).toEqual(Uint8Array.from(Array.from({length: 48}, () => [200, 20, 40]).flat()));
  }
});

it.each(fixtures)("applies shared decoded memory limits to $extension PDF resources", async extension => {
  const bytes = new Uint8Array(readFileSync(new URL(`../../safe-bash-rust/tests/fixtures/html-images/pixel.${extension}`, import.meta.url)));
  const render = (retainedBytes: number) => writeDocument({metadata: {}, resources: [{id: "picture", bytes}], blocks: [{t: "Para", c: [
    {t: "Image", c: [["", [], []], [], ["picture", ""]]},
  ]}]}, {to: "pdf"}, {...context, limits: {retainedBytes}});
  await expect(render(66303)).rejects.toMatchObject({code: "E_LIMIT"});
  // The JavaScript host also accounts for retained AST, resource and output bytes.
  expect((await render(2 * 1024 * 1024)).kind).toBe("binary");
});
