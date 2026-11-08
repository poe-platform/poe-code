import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync } from "node:fs";
import { PdfDocument, encryptCosDocument, parseCosDocument, serializeCosDocument, cosArray, cosNumber, cosDict, cosName, cosStream, cosString, decodePdfString, dictDelete, dictGet, dictSet } from "@poe-code/pdf-ast";
import { runPdfuniteCli, createPdfuniteCommand } from "./index.js";

it("merges ordered pages without losing geometry, rotation, content, fonts, images or annotations", async () => {
  const first = PdfDocument.create();
  const page = first.addPage([210, 320]);
  page.setRotation(90);
  page.drawText("First page", { x: 12, y: 20 });
  page.addLinkAnnotation({ rect: [0, 0, 10, 10], uri: "https://example.com" });
  page.drawImage(first.embedRgbImage(1, 1, new Uint8Array([12, 34, 56])), { x: 0, y: 0, width: 1, height: 1 });
  const second = PdfDocument.create();
  second.addPage([80, 90]).drawText("Second page", { x: 1, y: 2 });
  const files = new Map([["a.pdf", first.save()], ["b.pdf", second.save()]]);
  assert.equal((await runPdfuniteCli(["a.pdf", "b.pdf", "out.pdf"], files)).exitCode, 0);
  const merged = PdfDocument.load(files.get("out.pdf")!);
  assert.equal(merged.pageCount, 2);
  assert.deepEqual(merged.getPage(0).getSize(), { width: 210, height: 320 });
  assert.equal(merged.getPage(0).getRotation(), 90);
  assert.deepEqual(merged.getPage(1).getSize(), { width: 80, height: 90 });
  assert.ok(merged.extractText().indexOf("First page") < merged.extractText().indexOf("Second page"));
  const streams = [...merged.cos.objects.values()].flatMap(o => o.value.kind === "stream" ? [merged.cos.decodeStream(o.value)] : []);
  assert.ok(streams.some(bytes => Buffer.from(bytes).equals(Buffer.from([12, 34, 56]))));
  assert.ok(JSON.stringify(merged.getPage(0).pageDict).includes("Annots"));
});

it("preserves real embedded font program bytes", async () => {
  const input = new Uint8Array(readFileSync(new URL("../../pdf-ast/src/fixtures/pdfjs-pattern_text_embedded_font.pdf", import.meta.url)));
  const source = PdfDocument.load(input);
  const fonts = [...source.cos.objects.values()].flatMap(object => {
    if (object.value.kind !== "dict") return [];
    const stream = source.cos.resolve(dictGet(object.value, "FontFile") ?? dictGet(object.value, "FontFile2") ?? dictGet(object.value, "FontFile3"));
    return stream?.kind === "stream" ? [source.cos.decodeStream(stream)] : [];
  });
  assert.ok(fonts.length > 0);
  const files = new Map([["a.pdf", input], ["b.pdf", input]]);
  assert.equal((await runPdfuniteCli(["a.pdf", "b.pdf", "out.pdf"], files)).exitCode, 0);
  const merged = PdfDocument.load(files.get("out.pdf")!);
  const streams = [...merged.cos.objects.values()].flatMap(object => object.value.kind === "stream" ? [merged.cos.decodeStream(object.value)] : []);
  for (const font of fonts) assert.ok(streams.some(bytes => Buffer.from(bytes).equals(Buffer.from(font))));
});

it("rejects encrypted and damaged inputs without publishing a destination", async () => {
  const doc = PdfDocument.create(); doc.addPage();
  for (const password of ["", "secret"]) {
    const encrypted = encryptCosDocument(parseCosDocument(doc.save()), { userPassword: password, ownerPassword: "owner" });
    const files = new Map([["a.pdf", encrypted], ["b.pdf", doc.save()]]);
    const result = await runPdfuniteCli(["a.pdf", "b.pdf", "out.pdf"], files);
    assert.equal(result.exitCode, 255);
    assert.equal(result.stderr, password
      ? "Command Line Error: Incorrect password\nSyntax Error: Could not merge damaged documents ('a.pdf')\n"
      : "Unimplemented Feature: Could not merge encrypted files ('a.pdf')\n");
    assert.equal(files.has("out.pdf"), false);
  }
  const files = new Map([["a.pdf", new TextEncoder().encode("broken")]]);
  assert.equal((await runPdfuniteCli(["a.pdf", "b.pdf", "out.pdf"], files)).exitCode, 255);
});

it("preserves nonzero inherited media-box coordinates", async () => {
  const doc = PdfDocument.create();
  doc.addPage([100, 200]);
  const cos = parseCosDocument(doc.save());
  const catalog = cos.resolveDict(cos.rootRef)!;
  const parent = cos.resolveDict(dictGet(catalog, "Pages"))!;
  const page = cos.resolveDict(cos.resolveArray(dictGet(parent, "Kids"))!.items[0])!;
  dictSet(parent, "MediaBox", cosArray([10, 20, 110, 220].map(value => cosNumber(value))));
  dictDelete(page, "MediaBox");
  const input = serializeCosDocument({ objects: [...cos.objects.values()], rootRef: cos.rootRef });
  const files = new Map([["a.pdf", input], ["b.pdf", input]]);
  assert.equal((await runPdfuniteCli(["a.pdf", "b.pdf", "out.pdf"], files)).exitCode, 0);
  assert.deepEqual(PdfDocument.load(files.get("out.pdf")!).getPage(0).getMediaBox(), [10, 20, 110, 220]);
});

it("checks arity, help aliases, version and resource limits", async () => {
  for (const args of [[], ["a"], ["a", "b"]]) {
    const result = await runPdfuniteCli(args, new Map());
    assert.equal(result.exitCode, 99); assert.ok(result.stderr.includes("Usage: pdfunite"));
  }
  for (const flag of ["-h", "-help", "--help", "-v"]) {
    const result = await runPdfuniteCli([flag], new Map());
    assert.equal(result.exitCode, 0); assert.equal(result.stdout, ""); assert.ok(result.stderr.includes("pdfunite"));
  }
  const doc = PdfDocument.create(); doc.addPage();
  for (const limits of [{ maxInputBytes: 1 }, { maxOutputBytes: 1 }, { maxPages: 1 }, { maxObjects: 1 }]) {
    const files = new Map([["a", doc.save()], ["b", doc.save()]]);
    await assert.rejects(runPdfuniteCli(["a", "b", "out"], files, undefined, { limits }), /limit/i);
    assert.equal(files.has("out"), false);
  }
  assert.throws(() => createPdfuniteCommand({ limits: { maxPages: Infinity } }), RangeError);
});

it("preserves Unicode bookmark titles and attachment names", async () => {
  const doc = PdfDocument.create();
  const page = doc.addPage();
  const title = "Résumé 日本";
  const root = doc.cos.resolveDict(doc.cos.rootRef)!;
  const outline = doc.cos.allocateObject(cosDict({ Title: cosString(title), Dest: cosArray([page.ref, cosName("Fit")]) }));
  dictSet(root, "Outlines", cosDict({ First: outline, Last: outline }));
  const attachment = doc.cos.allocateObject(cosStream(new Uint8Array([1, 2, 3])));
  dictSet(root, "Names", cosDict({ EmbeddedFiles: cosDict({ Names: cosArray([cosString(title), cosDict({ F: cosString(title), EF: cosDict({ F: attachment }) })]) }) }));
  const files = new Map([["a.pdf", doc.save()], ["b.pdf", doc.save()]]);
  assert.equal((await runPdfuniteCli(["a.pdf", "b.pdf", "out.pdf"], files)).exitCode, 0);
  const merged = PdfDocument.load(files.get("out.pdf")!);
  const catalog = merged.cos.resolveDict(merged.cos.rootRef)!;
  const outlines = merged.cos.resolveDict(dictGet(catalog, "Outlines"))!;
  const item = merged.cos.resolveDict(dictGet(outlines, "First"))!;
  const value = merged.cos.resolve(dictGet(item, "Title"))!;
  assert.equal(value.kind, "string");
  if (value.kind === "string") assert.equal(decodePdfString(value), title);
  const names = merged.cos.resolveDict(dictGet(catalog, "Names"))!;
  const tree = merged.cos.resolveDict(dictGet(names, "EmbeddedFiles"))!;
  const key = merged.cos.resolveArray(dictGet(tree, "Names"))!.items[0]!;
  assert.equal(key.kind, "string");
  if (key.kind === "string") assert.equal(decodePdfString(key), title);
});
