import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createExiftoolCommand } from "./index.js";

const decoder = new TextDecoder();

async function invoke(args: string[], fs = createMemoryFileSystem()) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const res = await createExiftoolCommand().execute({ command: "exiftool",
    args,
    cwd: "/",
    env: {},
    fs,
    signal: new AbortController().signal,
    stdin: (async function* () {})(),
    stdout: { async write(b: Uint8Array) { stdout.push(new Uint8Array(b)); } },
    stderr: { async write(b: Uint8Array) { stderr.push(new Uint8Array(b)); } },
  });
  const join = (arr: Uint8Array[]) => {
    const len = arr.reduce((s, c) => s + c.byteLength, 0);
    const out = new Uint8Array(len);
    let p = 0;
    for (const c of arr) { out.set(c, p); p += c.byteLength; }
    return decoder.decode(out);
  };
  return { exitCode: res.exitCode, stdout: join(stdout), stderr: join(stderr), fs };
}

function createTwoPagePdfBytes(): Uint8Array {
  const pdf = `%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>
endobj
4 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>
endobj
5 0 obj
<< /Title (Original Financial Report) /Author (Risk Team) /Subject (Q3 Audit) /Keywords (finance, audit) /Producer (@poe-code/pdf-ast) >>
endobj
xref
0 6
0000000000 65535 f 
trailer
<< /Size 6 /Root 1 0 R /Info 5 0 R >>
startxref
380
%%EOF
`;
  return new TextEncoder().encode(pdf);
}

test("exiftool selected JSON prefers PDFVersion metadata over the PDF header", async () => {
  const fixture = await readFile(new URL("../../pdf-ast/src/fixtures/pdfbox-6077-example.pdf", import.meta.url));
  const fs = createMemoryFileSystem();
  await fs.writeFile("/example.pdf", fixture);
  const result = await invoke(["-j", "-s", "-n", "-PDFVersion", "example.pdf"], fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [{ SourceFile: "example.pdf", PDFVersion: 1.4 }]);
});

for (const [info, xmp, expected] of [
  ["/PDFVersion (1.4)", "1.5", 1.4],
  ["/PDFVersion <312e34>", "1.5", 1.4],
  ["", "1.5", 1.5],
  ["", "", 1.7],
] as const) {
  test(`exiftool PDFVersion precedence: Info ${info}, XMP ${xmp}`, async () => {
    const fs = createMemoryFileSystem();
    const pdf = decoder.decode(createTwoPagePdfBytes())
      .replace("/Title (Original Financial Report)", info)
      + (xmp ? `<pdf:PDFVersion>${xmp}</pdf:PDFVersion>` : "");
    await fs.writeFile("/version.pdf", new TextEncoder().encode(pdf));
    const result = await invoke(["-j", "-s", "-n", "-PDFVersion", "version.pdf"], fs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [{ SourceFile: "version.pdf", PDFVersion: expected }]);
  });
}

test("exiftool reads and writes PDF metadata, PageCount, and JSON", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/report.pdf", createTwoPagePdfBytes());

  const g1Res = await invoke(["-G1", "report.pdf"], fs);
  assert.equal(g1Res.exitCode, 0, g1Res.stderr);
  assert.match(g1Res.stdout, /^\[PDF\]\s+Title\s+: Original Financial Report$/m);

  const readRes = await invoke(["-j", "report.pdf"], fs);
  assert.equal(readRes.exitCode, 0, readRes.stderr);
  const parsed = JSON.parse(readRes.stdout);
  assert.equal(parsed[0].Title, "Original Financial Report");
  assert.equal(parsed[0].Author, "Risk Team");
  assert.equal(parsed[0].Subject, "Q3 Audit");
  assert.equal(parsed[0].PageCount, 2);

  const writeRes = await invoke(
    ["-overwrite_original", "-Title=Updated 2026 Audit", "-Author=Compliance Officer", "-Keywords+=verified", "report.pdf"],
    fs
  );
  assert.equal(writeRes.exitCode, 0, writeRes.stderr);
  assert.match(writeRes.stdout, /1 image files updated/);

  const verifyRes = await invoke(["-Title", "-Author", "-Keywords", "-s3", "report.pdf"], fs);
  assert.equal(verifyRes.exitCode, 0, verifyRes.stderr);
  assert.equal(
    verifyRes.stdout,
    "Updated 2026 Audit\nCompliance Officer\nfinance, audit, verified\n"
  );

  const updatedBytes = await fs.readFile("/report.pdf");
  const updatedText = new TextDecoder("latin1").decode(updatedBytes);
  const xrefLineMatch = /\n(\d{10}) 00000 n /.exec(updatedText);
  assert.ok(xrefLineMatch);
  const exactOffset = Number(xrefLineMatch[1]);
  const sliceAtOffset = new TextDecoder("latin1").decode(updatedBytes.slice(exactOffset, exactOffset + 12));
  assert.match(sliceAtOffset, /^\d+ 0 obj\n/);
});

test("exiftool extracts nested-parenthesis strings, pre-Type /Count, and XMP packet tags", async () => {
  const fs = createMemoryFileSystem();
  const complexPdf = `%PDF-1.6
1 0 obj
<< /Type /Catalog /Pages 2 0 R /Metadata 6 0 R >>
endobj
2 0 obj
<< /Count 5 /Kids [3 0 R] /Type /Pages >>
endobj
3 0 obj
<< /Count 2 /Kids [] /Type /Pages >>
endobj
5 0 obj
<< /Title (Quarterly Report (2026 Q3/Q4) Final) /Author <FEFF004100640061> >>
endobj
6 0 obj
<< /Type /Metadata /Subtype /XML /Length 210 >>
stream
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><pdf:Keywords>xmp-key, cosmos</pdf:Keywords><xmp:CreatorTool>Illustrator Pro</xmp:CreatorTool></rdf:Description></rdf:RDF></x:xmpmeta>
endstream
endobj
trailer
<< /Size 7 /Root 1 0 R /Info 5 0 R >>
%%EOF`;
  await fs.writeFile("/complex.pdf", new TextEncoder().encode(complexPdf));
  const res = await invoke(["-j", "complex.pdf"], fs);
  assert.equal(res.exitCode, 0, res.stderr);
  const meta = JSON.parse(res.stdout)[0];
  assert.equal(meta.PageCount, 5);
  assert.equal(meta.Title, "Quarterly Report (2026 Q3/Q4) Final");
  assert.equal(meta.Author, "Ada");
  assert.equal(meta.Keywords, "xmp-key, cosmos");
  assert.equal(meta.Creator, "Illustrator Pro");
});

test("exiftool handles UTF-16BE Unicode metadata writes (pdf-lib #1291), ASN.1 PDF dates (pypdf #3892), and FlateDecode XMP streams (pypdf #3940)", async () => {
  const { deflateSync } = await import("node:zlib");
  const fs = createMemoryFileSystem();

  const xmpXml = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:description><rdf:Alt><rdf:li xml:lang="x-default">Compressed XMP Summary</rdf:li></rdf:Alt></dc:description></rdf:Description></rdf:RDF></x:xmpmeta>`;
  const compressedXmp = deflateSync(new TextEncoder().encode(xmpXml));

  const header = new TextEncoder().encode(
    `%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Metadata 6 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n5 0 obj\n<< /CreationDate (D:20250315143000+02'00') /ModDate (D:20250316091500Z) >>\nendobj\n6 0 obj\n<< /Type /Metadata /Subtype /XML /Filter /FlateDecode /Length ${compressedXmp.length} >>\nstream\n`
  );
  const footer = new TextEncoder().encode(
    `\nendstream\nendobj\ntrailer\n<< /Size 7 /Root 1 0 R /Info 5 0 R >>\n%%EOF\n`
  );
  const pdfBytes = new Uint8Array(header.length + compressedXmp.length + footer.length);
  pdfBytes.set(header, 0);
  pdfBytes.set(compressedXmp, header.length);
  pdfBytes.set(footer, header.length + compressedXmp.length);

  await fs.writeFile("/unicode-xmp.pdf", pdfBytes);

  const readRes = await invoke(["-j", "unicode-xmp.pdf"], fs);
  assert.equal(readRes.exitCode, 0, readRes.stderr);
  const meta = JSON.parse(readRes.stdout)[0];
  assert.equal(meta.Description, "Compressed XMP Summary");
  assert.equal(meta.CreateDate, "2025:03:15 14:30:00+02:00");
  assert.equal(meta.ModifyDate, "2025:03:16 09:15:00Z");

  // Write non-ASCII UTF-16BE Title & Author and verify roundtrip + <FEFF...> hex encoding
  const writeRes = await invoke(
    ["-overwrite_original", "-Title=Café — Étude №1", "-Author=Łukasz Żółć", "unicode-xmp.pdf"],
    fs
  );
  assert.equal(writeRes.exitCode, 0, writeRes.stderr);

  const verifyRes = await invoke(["-j", "unicode-xmp.pdf"], fs);
  assert.equal(verifyRes.exitCode, 0, verifyRes.stderr);
  const updatedMeta = JSON.parse(verifyRes.stdout)[0];
  assert.equal(updatedMeta.Title, "Café — Étude №1");
  assert.equal(updatedMeta.Author, "Łukasz Żółć");

  const rawUpdated = new TextDecoder("latin1").decode(await fs.readFile("/unicode-xmp.pdf"));
  assert.match(rawUpdated, /\/Title <FEFF/i);
});

test("PDF exiftool deleting a tag does not resurrect it from earlier revision (issue 1036)", async () => {
  const fs = createMemoryFileSystem();
  const pdfBytes = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Count 1 /Kids [] >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
  await fs.writeFile("/del-test.pdf", pdfBytes);

  await invoke(["-overwrite_original", "-Title=Original Title", "-Author=Café", "del-test.pdf"], fs);
  await invoke(["-overwrite_original", "-Title=", "del-test.pdf"], fs);
  const readRes = await invoke(["-j", "del-test.pdf"], fs);
  assert.equal(readRes.exitCode, 0, readRes.stderr);
  const meta = JSON.parse(readRes.stdout)[0];
  assert.equal(meta.Title, undefined);
  assert.equal(meta.Author, "Café");
});


test("PDF system extension is detected independently of the operand suffix", async () => {
  const fs = createMemoryFileSystem();
  const bytes = createTwoPagePdfBytes();
  await fs.writeFile("/document.bin", bytes);
  const result = await invoke(["-s3", "-n", "-FileTypeExtension", "-FileSize", "document.bin"], fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, `pdf\n${bytes.length}\n`);
});

test("PDF JSON retains text tag types", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/text.pdf", createTwoPagePdfBytes());
  const values = {Title:"1984", Author:"true", Subject:"null", Creator:"123", Producer:"false"};
  const write = await invoke([...Object.entries(values).map(([name,value]) => "-" + name + "=" + value), "-overwrite_original", "text.pdf"], fs);
  assert.equal(write.exitCode, 0, write.stderr);
  const read = await invoke(["-j", "text.pdf"], fs);
  assert.equal(read.exitCode, 0, read.stderr);
  const tags = JSON.parse(read.stdout)[0];
  for (const [name,value] of Object.entries(values)) assert.equal(tags[name], value);
  assert.equal(tags.PageCount, 2);
});

test("encrypted PDF Info is refused instead of returned as ciphertext", async () => {
  const bytes = new Uint8Array(await readFile(new URL("../../pdf-ast/src/fixtures/pdfjs-issue17069.pdf", import.meta.url)));
  const fs = createMemoryFileSystem();
  await fs.writeFile("/encrypted.pdf", bytes);
  for (const args of [
    ["-j", "-s", "-n", "-Author", "-Creator", "-Producer", "-CreateDate", "-ModifyDate"],
    ["-overwrite_original", "-Author=Changed"],
  ]) {
    const result = await invoke([...args, "encrypted.pdf"], fs);
    assert.equal(result.exitCode, args[0] === "-j" ? 0 : 1, result.stderr);
    if (args[0] !== "-j") assert.ok(result.stderr.includes("Encrypted PDF metadata is not supported"), result.stderr);
    assert.ok(!result.stdout.includes('"Author"'), result.stdout);
    assert.deepEqual(await fs.readFile("/encrypted.pdf"), bytes);
    await assert.rejects(fs.stat("/encrypted.pdf_original"), { code: "ENOENT" });
  }
});

test("PDF encryption names are decoded and ordinary metadata text remains readable", async () => {
  const fs = createMemoryFileSystem();
  const plain = new TextDecoder().decode(createTwoPagePdfBytes());
  for (const entry of ["/Encrypt 7 0 R", "/Encr#79pt 7 0 R"]) {
    await fs.writeFile("/test.pdf", new TextEncoder().encode(plain.replace("/Size 6", entry + " /Size 6")));
    const result = await invoke(["-j", "test.pdf"], fs);
    assert.equal(result.exitCode, 0, result.stderr);
    const tags = JSON.parse(result.stdout)[0];
    assert.equal(tags.PageCount, undefined);
    assert.equal(tags.Title, undefined);
  }
  await fs.writeFile("/test.pdf", new TextEncoder().encode(plain
    .replace("Original Financial Report", "Literal /Encrypt (nested) text")
    .replace("/Author (Risk Team)", "/Author <456e6372797074>")
    .replace("trailer", "% /Encrypt 7 0 R\n6 0 obj\n<< /Length 14 >>\nstream\n/Encrypt 7 0 R\nendstream\nendobj\ntrailer")));
  const result = await invoke(["-j", "test.pdf"], fs);
  assert.equal(result.exitCode, 0, result.stderr);
  const tags = JSON.parse(result.stdout)[0];
  assert.equal(tags.Title, "Literal /Encrypt (nested) text");
  assert.equal(tags.Author, "Encrypt");
});

for (const [fixture, modifyDate] of [
  ["pdfjs-issue19484_1.pdf", "2025-02-13T11:52:24-06:00"],
  ["pdfjs-issue19484_2.pdf", "2025-02-13T12:30:19-06:00"],
]) {
  test(`protected PDF hides document tags but retains readable XMP dates: ${fixture}`, async () => {
    const bytes = await readFile(new URL(`../../pdf-ast/src/fixtures/${fixture}`, import.meta.url));
    const fs = createMemoryFileSystem();
    await fs.writeFile("/protected.pdf", bytes);
    const result = await invoke(["-j", "-s", "-n", "-PageCount", "-Creator", "-CreateDate", "-ModifyDate", "protected.pdf"], fs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [{
      SourceFile: "protected.pdf",
      CreateDate: "2025-02-08T20:53:52-06:00",
      ModifyDate: modifyDate,
    }]);
  });
}
