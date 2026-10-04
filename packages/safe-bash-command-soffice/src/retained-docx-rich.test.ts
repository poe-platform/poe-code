import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createStoredZipArchive, readZipArchiveEntries, runSofficeCli, runSofficeFileCli } from "./index.js";

for (const format of ["html", "docx"]) for (const styleId of ["Custom", "ΟΣ", "Ος", "Οσ", "AΣ" + "'".repeat(17000), "İ" + "Z".repeat(17000)]) it(`retains DOCX ${format} headings/tables/images (${styleId.slice(0, 10)}, ${styleId.length})`, async () => {
  const encode = (text: string) => new TextEncoder().encode(text), fs = new MemoryFileSystem();
  const bytes = createStoredZipArchive({
    "word/document.xml": encode('<w:p><w:pPr><w:pStyle w:val="' + styleId + '"/></w:pPr><w:r><w:t> Heading &amp; café </w:t></w:r><w:drawing><a:blip r:embed="image"/></w:drawing></w:p><w:tbl><w:tr><w:tc><w:t> A </w:t></w:tc><w:tc><w:t>&lt; B &gt;</w:t></w:tc></w:tr></w:tbl><w:p><w:rPr><w:sz w:val="28"/></w:rPr><w:t>Large heading</w:t></w:p><w:p><w:t>Paragraph</w:t></w:p>'),
    "word/styles.xml": encode('<w:styles><w:style w:styleId="' + styleId.toLowerCase() + '"><w:name w:val="Custom SECTION"/></w:style></w:styles>'),
    "word/_rels/document.xml.rels": encode('<Relationships><Relationship Id="image" Target="media/image.png"/></Relationships>'),
    "word/media/image.png": Uint8Array.of(1)
  });
  await fs.writeFile('/input.docx', bytes);
  const files = new Map([['/input.docx', bytes]]), args = ['--convert-to', format, '/input.docx'];
  const expected = await runSofficeCli(args, files);
  const filesystem = new Proxy(fs, { get(target, key) {
    if (key === 'readFile' || key === 'writeFile') return () => { throw new Error('Whole-file I/O forbidden'); };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  let stdout = '', stderr = '';
  const result = await runSofficeFileCli(args, { filesystem, stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  assert.deepEqual({ ...result, stdout, stderr }, expected);
  const actual = await fs.readFile('/input.' + format), wanted = files.get('/input.' + format)!;
  if (format === 'docx') assert.deepEqual(readZipArchiveEntries(actual), readZipArchiveEntries(wanted));
  else assert.deepEqual(actual, wanted);
});

for (const format of ["html", "docx"]) for (const body of [undefined, "", '<w:p><w:t> </w:t></w:p>',
  '<w:p><w:pStyle w:val="normal"/><w:t>Normal</w:t></w:p><w:p><w:pStyle w:val="Title"/><w:t>Title</w:t></w:p><w:p><w:pStyle w:val="SUBTITLE"/><w:t>Subtitle</w:t></w:p>',
  '<w:p><w:sz w:val="bad"/><w:sz w:val="28"/><w:t>Large</w:t></w:p><w:p><w:pStyle w:val=""/><w:PSTYLE w:VAL="Heading9"/><w:t>Named</w:t></w:p>',
  '<w:p><w:pStyle w:val="Bold"/><w:t>Bold</w:t></w:p><w:p><w:pStyle w:val="Large"/><w:t>Large</w:t></w:p><w:p><w:pStyle w:val="Duplicate"/><w:t>Duplicate</w:t></w:p>',
  '<w:tbl/><w:tbl><w:tr/></w:tbl><w:tbl><w:tr><w:tc></w:tc></w:tr></w:tbl>'
]) it(`preserves DOCX ${format} empty/style rules (${body?.slice(0, 28) ?? "missing"})`, async () => {
  const fs = new MemoryFileSystem(), encode = (text: string) => new TextEncoder().encode(text);
  const bytes = createStoredZipArchive({ ...(body === undefined ? {} : {"word/document.xml": encode(body)}),
    "word/styles.xml": encode('<w:styles><w:style w:styleId="normal"><w:name w:val="Heading 1"/></w:style><w:style w:styleId="Bold"><w:b/><w:sz w:val="24"/></w:style><w:style w:styleId="Large"><w:sz w:val="bad"/><w:sz w:val="26"/></w:style><w:style w:styleId="Duplicate"><w:name w:val="Heading 1"/></w:style><w:style w:styleId="Duplicate"><w:name w:val="Normal"/></w:style></w:styles>') });
  await fs.writeFile('/input.docx', bytes);
  const files = new Map([['/input.docx', bytes]]), args = ['--convert-to', format, '/input.docx'], expected = await runSofficeCli(args, files);
  const result = await runSofficeFileCli(args, {filesystem: fs, stdout: {async write() {}}, stderr: {async write(bytes) {assert.fail(new TextDecoder().decode(bytes));}}});
  assert.equal(result.exitCode, expected.exitCode);
  const actual = await fs.readFile('/input.' + format), wanted = files.get('/input.' + format)!;
  if (format === 'docx') assert.deepEqual(readZipArchiveEntries(actual), readZipArchiveEntries(wanted));
  else assert.deepEqual(actual, wanted);
});
