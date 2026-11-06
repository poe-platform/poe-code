import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PdfDocument, encodePng, encodeJpeg } from "@poe-code/pdf-ast";
import { createSofficeCommand, createStoredZipArchive, runSofficeCli, runSofficeFileCli } from "./index.js";

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

it("preserves DOCX inline fonts across words and wrapped lines through the public command", async () => {
  const { createCommandArguments, toByteSource } = await import("safe-bash-contracts");
  const fs = new MemoryFileSystem();
  const runs = [
    ["<w:i/>", "  café "], ["", "Plain "], ["<w:i/>", "italic"], ["", " and "], ["<w:b/>", "bold"],
    ["<w:b/><w:i/>", "both"], ["<w:b w:val=\"false\"/><w:i w:val=\"0\"/>", " reset "],
    ["<w:i w:val=\"true\"/>", "wrapped ".repeat(25)], ["", "end"]
  ];
  await fs.writeFile("/input.docx", createStoredZipArchive({
    "word/document.xml": new TextEncoder().encode('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>' + runs.map(([properties, text]) => `<w:r><w:rPr>${properties}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`).join("") + '</w:p></w:body></w:document>')
  }));
  const result = await createSofficeCommand().execute({ command: "soffice", cwd: "/", env: {}, fs,
    ...createCommandArguments(["--headless", "--convert-to", "pdf", "/input.docx"]),
    signal: new AbortController().signal, stdin: toByteSource(""), stdout: { async write() {} },
    stderr: { async write(bytes) { assert.fail(new TextDecoder().decode(bytes)); } }
  });
  assert.equal(result.exitCode, 0);
  const pdf = PdfDocument.load(await fs.readFile("/input.pdf"));
  const glyphs = pdf.getPage(0).evaluateDisplayList().glyphs;
  const fonts = glyphs.filter(glyph => glyph.unicode.trim()).map(glyph => glyph.fontName);
  const expected = runs.flatMap(([properties, text]) => Array.from(text!).filter(char => char.trim()).map(() =>
    properties!.includes('false') ? "Helvetica" : properties!.includes('<w:b') ? properties!.includes('<w:i') ? "Helvetica-BoldOblique" : "Helvetica-Bold" : properties!.includes('<w:i') ? "Helvetica-Oblique" : "Helvetica"));
  assert.deepEqual(fonts, expected);
  assert.equal(glyphs.map(glyph => glyph.unicode).join("").split(" ").join(""), runs.map(([,text]) => text).join("").split(" ").join(""));
  assert.ok(new Set(glyphs.map(glyph => glyph.baselineY)).size > 1);
});
