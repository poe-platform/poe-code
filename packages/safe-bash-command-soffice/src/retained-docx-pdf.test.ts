import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PdfDocument, encodePng, encodeJpeg } from "@poe-code/pdf-ast";
import { createStoredZipArchive, runSofficeCli, runSofficeFileCli } from "./index.js";

for (const kind of ['png', 'jpeg', 'invalid'] as const) it(`retains DOCX PDF headings, tables and ${kind} images`, async () => {
  const fs = new MemoryFileSystem(), encode = (value: string) => new TextEncoder().encode(value);
  const bitmap = {width: 2, height: 2, data: Uint8Array.of(255,0,0,255,0,255,0,128,0,0,255,0,255,255,0,255)};
  const bytes = createStoredZipArchive({
    'word/document.xml': encode('<w:p><w:pStyle w:val="Custom"/><w:t>Heading</w:t></w:p><w:tbl><w:tr><w:tc><w:t>A</w:t></w:tc><w:tc><w:t>B</w:t></w:tc></w:tr></w:tbl><w:p><w:drawing><wp:extent cx="1270000" cy="635000"/><a:blip r:embed="pic"/></w:drawing></w:p><w:p><w:t>End</w:t></w:p>'),
    'word/styles.xml': encode('<w:style w:styleId="Custom"><w:name w:val="Heading 1"/></w:style>'),
    'word/_rels/document.xml.rels': encode('<Relationship Id="pic" Target="media/pic"/>'),
    'word/media/pic': kind === 'png' ? encodePng(bitmap) : kind === 'jpeg' ? encodeJpeg(bitmap) : Uint8Array.of(1)
  });
  await fs.writeFile('/input.docx', bytes);
  const args = ['--convert-to','pdf','/input.docx'], files = new Map([['/input.docx',bytes]]), expected = await runSofficeCli(args, files);
  const filesystem = new Proxy(fs, {get(target, key) {
    if (key === 'readFile' || key === 'writeFile') return () => {throw new Error('Whole-file I/O forbidden');};
    const value = Reflect.get(target,key,target); return typeof value === 'function' ? value.bind(target) : value;
  }});
  let stdout = '', stderr = '';
  const result = await runSofficeFileCli(args, {filesystem,stdout:{async write(bytes){stdout+=new TextDecoder().decode(bytes);}},stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}}});
  assert.deepEqual({...result,stdout,stderr},expected);
  const actual = PdfDocument.load(await fs.readFile('/input.pdf')), wanted = PdfDocument.load(files.get('/input.pdf')!);
  assert.equal(actual.extractText(),wanted.extractText());
  assert.deepEqual(actual.getMetadata(),wanted.getMetadata());
  assert.equal(actual.pageCount,wanted.pageCount);
  assert.deepEqual(actual.getPage(0).renderToPng(),wanted.getPage(0).renderToPng());
});
