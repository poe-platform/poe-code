import {
  PdfDocument,
  cosArray,
  cosDict,
  cosName,
  cosNumber,
  cosStream,
  cosString,
  decodePng,
  dictSet,
  encodeJpeg
} from "@poe-code/pdf-ast";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Shell, createMemoryFileSystem } from "../../src/index.js";
import { pdfinfoCommands } from "../../src/commands/pdfinfo/index.js";
import { pdftoppmPlugin } from "../../src/commands/pdftoppm/index.js";
import { pdfimagesPlugin } from "../../src/commands/pdfimages/index.js";
import { pdftotextCommands } from "../../src/commands/pdftotext/index.js";
import { pdftkPlugin } from "../../src/commands/pdftk/index.js";
import { qpdfCommands } from "../../src/commands/qpdf/index.js";
import { sofficeCommands, createStoredZipArchive } from "../../src/commands/soffice/index.js";
import { exiftoolCommands } from "../../src/commands/exiftool/index.js";
import { pdfAstWkhtmltopdfCommands } from "../../src/commands/wkhtmltopdf/index.js";

describe("safe-bash PDF tooling suite (pdfinfo, pdftotext, qpdf, soffice, wkhtmltopdf, exiftool)", () => {
  it("runs soffice -> pdfinfo -> pdftotext -> qpdf -> exiftool -> wkhtmltopdf pipeline inside virtual Shell", async () => {
    const fs = createMemoryFileSystem();
    const shell = new Shell({ fs })
      .use(pdfinfoCommands())
      .use(pdftoppmPlugin({ replace: true }))
      .use(pdfimagesPlugin({ replace: true }))
      .use(pdftotextCommands())
      .use(pdftkPlugin())
      .use(qpdfCommands())
      .use(sofficeCommands())
      .use(exiftoolCommands({ replace: true }))
      .use(pdfAstWkhtmltopdfCommands({ replace: true }));

    const docxXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>Unified PDF AST Pipeline</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>First-party COS, content stream, and display list verification.</w:t></w:r>
    </w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Module</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Status</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>pdf-ast</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Verified</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

    await fs.writeFile(
      "/input.docx",
      createStoredZipArchive({
        "word/document.xml": new TextEncoder().encode(docxXml)
      })
    );

    // 1. Convert DOCX to PDF via soffice
    const sofficeRes = await shell.exec(
      "soffice --headless --convert-to pdf:writer_pdf_Export --outdir / /input.docx"
    );
    assert.equal(sofficeRes.exitCode, 0);
    assert.match(sofficeRes.stdout, /convert \/input\.docx -> \/input\.pdf/);

    // 2. Inspect generated PDF via pdfinfo
    const infoRes = await shell.exec("pdfinfo -box /input.pdf");
    assert.equal(infoRes.exitCode, 0);
    assert.match(infoRes.stdout, /Title:\s+input/);
    assert.match(infoRes.stdout, /Pages:\s+1/);
    assert.match(infoRes.stdout, /MediaBox:\s+0\.00\s+0\.00\s+612\.00\s+792\.00/);

    // 3. Edit and inspect PDF metadata via exiftool
    const exifWrite = await shell.exec(
      "exiftool -overwrite_original -Title=\"Enterprise PDF Spec\" -Author=\"Poe Platform\" /input.pdf"
    );
    assert.equal(exifWrite.exitCode, 0);

    const exifRead = await shell.exec("exiftool -j /input.pdf");
    assert.equal(exifRead.exitCode, 0);
    const exifJson = JSON.parse(exifRead.stdout);
    assert.equal(exifJson[0].Title, "Enterprise PDF Spec");
    assert.equal(exifJson[0].Author, "Poe Platform");

    // 4. Extract text and XHTML bbox via pdftotext
    const txtRes = await shell.exec("pdftotext /input.pdf -");
    assert.equal(txtRes.exitCode, 0);
    assert.match(txtRes.stdout, /Unified PDF AST Pipeline/);
    assert.match(txtRes.stdout, /Verified/);

    // 5. Render HTML to multi-page PDF via wkhtmltopdf (pdfAstWkhtmltopdfCommands)
    await fs.writeFile(
      "/web.html",
      new TextEncoder().encode(
        "<html><head><title>HTML Report</title></head><body><h1>HTML Heading</h1><p>Rendered via pdf-ast.</p></body></html>"
      )
    );
    const wkRes = await shell.exec("wkhtmltopdf /web.html /web.pdf");
    assert.equal(wkRes.exitCode, 0, wkRes.stderr);

    // 6. Merge /input.pdf and /web.pdf via qpdf, rotate, and encrypt
    const qpdfMergeRes = await shell.exec("qpdf --empty --pages /input.pdf /web.pdf -- /merged.pdf");
    assert.equal(qpdfMergeRes.exitCode, 0);

    const mergedInfo = await shell.exec("pdfinfo /merged.pdf");
    assert.equal(mergedInfo.exitCode, 0);
    assert.match(mergedInfo.stdout, /Pages:\s+2/);

    const qpdfEncRes = await shell.exec(
      "qpdf --encrypt userpw ownerpw 256 --print=none -- /merged.pdf /encrypted.pdf"
    );
    assert.equal(qpdfEncRes.exitCode, 0);

    const encInfoRes = await shell.exec("pdfinfo -upw userpw /encrypted.pdf");
    assert.equal(encInfoRes.exitCode, 0);
    assert.match(encInfoRes.stdout, /Encrypted:\s+yes \(print:no/);

    // 7. Verify Poppler pdftoppm, pdfunite, pdfseparate, pdftohtml, and libreoffice --cat in Shell
    const uniteRes = await shell.exec("pdfunite /input.pdf /web.pdf /united.pdf");
    assert.equal(uniteRes.exitCode, 0);

    const sepRes = await shell.exec("pdfseparate -f 1 -l 2 /united.pdf /page-%d.pdf");
    assert.equal(sepRes.exitCode, 0);

    const ppmRes = await shell.exec("pdftoppm -png -r 72 -singlefile /page-1.pdf /rendered-p1");
    assert.equal(ppmRes.exitCode, 0);
    const pngBytes = await fs.readFile("/rendered-p1.png");
    assert.equal(pngBytes[0], 137);
    assert.equal(pngBytes[1], 80);

    const htmlRes = await shell.exec("pdftohtml -xml -stdout /page-2.pdf");
    assert.equal(htmlRes.exitCode, 0);
    assert.match(htmlRes.stdout, /<pdf2xml/);
    assert.match(htmlRes.stdout, /HTML Heading/);

    const loCatRes = await shell.exec("libreoffice --cat /page-1.pdf");
    assert.equal(loCatRes.exitCode, 0);
    assert.match(loCatRes.stdout, /Unified PDF AST Pipeline/);

    // 8. Verify pdftk cat multi-handle assembly, rotation, burst, and pdfimages -list
    const tkCatRes = await shell.exec(
      "pdftk A=/page-1.pdf B=/page-2.pdf cat A1 B1east output /tk-combined.pdf"
    );
    assert.equal(tkCatRes.exitCode, 0);

    const tkDataRes = await shell.exec("pdftk /tk-combined.pdf dump_data");
    assert.equal(tkDataRes.exitCode, 0);
    assert.match(tkDataRes.stdout, /NumberOfPages: 2/);
    assert.match(tkDataRes.stdout, /PageMediaRotation: 90/);

    const imgListRes = await shell.exec("pdfimages -list /tk-combined.pdf");
    assert.equal(imgListRes.exitCode, 0);
    assert.match(imgListRes.stdout, /page\s+num\s+type\s+width\s+height/);
  });

  it("runs end-to-end pdftk AcroForm fill+flatten, encryption, binary stdin/stdout piping, pdftoppm, and pdfimages in Shell", async () => {
    const fs = createMemoryFileSystem();
    const shell = new Shell({ fs })
      .use(pdfinfoCommands())
      .use(pdftoppmPlugin({ replace: true }))
      .use(pdfimagesPlugin({ replace: true }))
      .use(pdftotextCommands())
      .use(pdftkPlugin());

    // Build a PDF with an AcroForm (Text + Checkbox) and an embedded JPEG + PNG image
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 100]);

    const rgba = new Uint8Array(8 * 8 * 4);
    for (let i = 0; i < 64; i++) {
      rgba[i * 4] = 200;
      rgba[i * 4 + 1] = 50;
      rgba[i * 4 + 2] = 40;
      rgba[i * 4 + 3] = 255;
    }
    const jpgBytes = encodeJpeg({ width: 8, height: 8, data: rgba }, 90);
    const embJpg = doc.embedJpg(jpgBytes);
    page.drawImage(embJpg, { x: 10, y: 10, width: 40, height: 40 });

    const textFieldRef = doc.cos.allocateObject(
      cosDict({
        FT: cosName("Tx"),
        T: cosString("applicant.name"),
        V: cosString("Initial Name"),
        Ff: cosNumber(0),
        Rect: cosArray([cosNumber(60), cosNumber(50), cosNumber(180), cosNumber(75)])
      })
    );
    const checkFieldRef = doc.cos.allocateObject(
      cosDict({
        FT: cosName("Btn"),
        T: cosString("applicant.agreed"),
        V: cosName("Off"),
        Ff: cosNumber(0),
        Rect: cosArray([cosNumber(60), cosNumber(20), cosNumber(80), cosNumber(40)]),
        AP: cosDict({
          N: cosDict({
            Off: cosDict({}),
            Yes: cosDict({})
          })
        })
      })
    );
    dictSet(page.pageDict, "Annots", cosArray([textFieldRef, checkFieldRef]));
    const root = doc.cos.resolveDict(doc.cos.rootRef)!;
    dictSet(
      root,
      "AcroForm",
      cosDict({
        Fields: cosArray([textFieldRef, checkFieldRef])
      })
    );

    await fs.writeFile("/form.pdf", doc.save());
    await fs.writeFile(
      "/answers.fdf",
      new TextEncoder().encode(
        "%FDF-1.2\n1 0 obj << /FDF << /Fields [ << /T (applicant.name) /V (Grace Hopper) >> << /T (applicant.agreed) /V /Yes >> ] >> >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"
      )
    );

    // 1. Inspect fields via pdftk dump_data_fields_utf8
    const dumpFields = await shell.exec("pdftk /form.pdf dump_data_fields_utf8");
    assert.equal(dumpFields.exitCode, 0);
    assert.match(dumpFields.stdout, /FieldName: applicant\.name/);
    assert.match(dumpFields.stdout, /FieldStateOption: Yes/);

    // 2. Fill and flatten via pdftk, then verify baked text via pdftotext and zero remaining fields
    const fillRes = await shell.exec("pdftk /form.pdf fill_form /answers.fdf output /filled.pdf flatten");
    assert.equal(fillRes.exitCode, 0);

    const bakedText = await shell.exec("pdftotext /filled.pdf -");
    assert.equal(bakedText.exitCode, 0);
    assert.match(bakedText.stdout, /Grace Hopper/);

    const postFlattenFields = await shell.exec("pdftk /filled.pdf dump_data_fields_utf8");
    assert.equal(postFlattenFields.exitCode, 0);
    assert.equal(postFlattenFields.stdout.trim(), "");

    // 3. Encrypt with user_pw / owner_pw / allow Printing, then read via -upw and input_pw
    const encRes = await shell.exec(
      "pdftk /filled.pdf output /locked.pdf user_pw secret123 owner_pw admin456 allow Printing"
    );
    assert.equal(encRes.exitCode, 0);

    const tkLockedDump = await shell.exec("pdftk /locked.pdf input_pw secret123 dump_data");
    assert.equal(tkLockedDump.exitCode, 0);
    assert.match(tkLockedDump.stdout, /NumberOfPages: 1/);

    const ppmLocked = await shell.exec(
      "pdftoppm -png -r 72 -singlefile -upw secret123 /locked.pdf /unlocked-thumb"
    );
    assert.equal(ppmLocked.exitCode, 0);
    const decodedThumb = decodePng(await fs.readFile("/unlocked-thumb.png"));
    assert.equal(decodedThumb.width, 200);
    assert.equal(decodedThumb.height, 100);

    // 4. Binary stdout/stdin pipeline: pdftk ... output - | pdftoppm -png -r 72 -singlefile - /piped
    const pipeRes = await shell.exec(
      "pdftk /filled.pdf cat 1east output - | pdftoppm -png -r 72 -singlefile - /piped"
    );
    assert.equal(pipeRes.exitCode, 0);
    const pipedPng = decodePng(await fs.readFile("/piped.png"));
    assert.equal(pipedPng.width, 100);
    assert.equal(pipedPng.height, 200);

    // 5. Extract embedded JPEG via pdfimages -j and PNG via pdfimages -png -p
    const imgJpgRes = await shell.exec("pdfimages -j /filled.pdf /extracted-raw");
    assert.equal(imgJpgRes.exitCode, 0);
    const rawJpg = await fs.readFile("/extracted-raw-000.jpg");
    assert.equal(rawJpg[0], 0xff);
    assert.equal(rawJpg[1], 0xd8);

    const imgPngRes = await shell.exec("pdfimages -png -p /filled.pdf /extracted-png");
    assert.equal(imgPngRes.exitCode, 0);
    const extPng = decodePng(await fs.readFile("/extracted-png-001-000.png"));
    assert.equal(extPng.width, 8);
    assert.equal(extPng.height, 8);

    // 6. Verify stdin piping without explicit '-' positional when value flags (-r 72) are present, and A=- handle stdin in pdftk
    const implicitStdinPipe = await shell.exec(
      "pdftk A=- B=/filled.pdf cat A1 B1 output - < /filled.pdf | pdftoppm -png -r 72 -singlefile > /implicit-stdin.png"
    );
    assert.equal(implicitStdinPipe.exitCode, 0);
    const implicitPng = decodePng(await fs.readFile("/implicit-stdin.png"));
    assert.equal(implicitPng.width, 200);
    assert.equal(implicitPng.height, 100);
  });

  it("executes burst, shuffle, update_info_utf8 bookmarks/page-labels, attach_files/unpack_files, and pdftoppm -svg inside Shell VFS", async () => {
    const fs = createMemoryFileSystem();
    const shell = new Shell({ fs })
      .use(pdfinfoCommands())
      .use(pdftoppmPlugin({ replace: true }))
      .use(pdfimagesPlugin({ replace: true }))
      .use(pdftotextCommands())
      .use(pdftkPlugin());

    const doc = PdfDocument.create();
    for (let i = 1; i <= 3; i++) {
      const p = doc.addPage([300, 200]);
      p.drawText(`Packet Page ${i}`, { x: 40, y: 120, fontSize: 16 });
    }
    await fs.writeFile("/packet.pdf", doc.save());
    await fs.writeFile("/attachment.txt", new TextEncoder().encode("embedded-vfs-payload"));

    // 1. Burst /packet.pdf into /burst_out/pg_%04d.pdf
    const burstRes = await shell.exec("pdftk /packet.pdf burst output /burst_out/pg_%04d.pdf");
    assert.equal(burstRes.exitCode, 0);
    const pg1Txt = await shell.exec("pdftotext /burst_out/pg_0001.pdf -");
    assert.match(pg1Txt.stdout, /Packet Page 1/);
    const docDataBytes = await fs.readFile("/burst_out/doc_data.txt");
    assert.match(new TextDecoder().decode(docDataBytes), /NumberOfPages: 3/);

    // 2. Shuffle burst pages back into a combined document
    const shuffleRes = await shell.exec(
      "pdftk A=/burst_out/pg_0001.pdf B=/burst_out/pg_0002.pdf C=/burst_out/pg_0003.pdf shuffle A B C output /reassembled.pdf"
    );
    assert.equal(shuffleRes.exitCode, 0);

    // 3. Apply update_info_utf8 with BookmarkBegin and PageLabelBegin
    const infoTxt = [
      "InfoBegin",
      "InfoKey: Title",
      "InfoValue: VFS Packet",
      "BookmarkBegin",
      "BookmarkTitle: Cover Section",
      "BookmarkLevel: 1",
      "BookmarkPageNumber: 1",
      "PageLabelBegin",
      "PageLabelNewIndex: 1",
      "PageLabelStart: 1",
      "PageLabelNumStyle: UppercaseRomanNumerals",
      "",
    ].join("\n");
    await fs.writeFile("/meta.info", new TextEncoder().encode(infoTxt));
    const updRes = await shell.exec("pdftk /reassembled.pdf update_info_utf8 /meta.info output /bookmarked.pdf");
    assert.equal(updRes.exitCode, 0);

    const dumpMeta = await shell.exec("pdftk /bookmarked.pdf dump_data_utf8");
    assert.equal(dumpMeta.exitCode, 0);
    assert.match(dumpMeta.stdout, /BookmarkTitle: Cover Section/);
    assert.match(dumpMeta.stdout, /PageLabelNumStyle: UppercaseRomanNumerals/);

    // 4. Attach and unpack files via VFS shell
    const attRes = await shell.exec(
      "pdftk /bookmarked.pdf attach_files /attachment.txt to_page 1 output /bundled.pdf"
    );
    assert.equal(attRes.exitCode, 0);
    const unpRes = await shell.exec("pdftk /bundled.pdf unpack_files output /unpacked");
    assert.equal(unpRes.exitCode, 0);
    const unpackedPayload = new TextDecoder().decode(await fs.readFile("/unpacked/attachment.txt"));
    assert.equal(unpackedPayload, "embedded-vfs-payload");

    // 5. Render page 1 to SVG via pdftoppm -svg and verify <text> glyphs
    const svgRes = await shell.exec("pdftoppm -svg -f 1 -l 1 -singlefile /bundled.pdf /page1-vec");
    assert.equal(svgRes.exitCode, 0);
    const svgContent = new TextDecoder().decode(await fs.readFile("/page1-vec.svg"));
    assert.match(svgContent, /<svg/);
    assert.match(svgContent, /<text/);
  });

  it("executes end-to-end TIFF rendering/extraction, SVG image embedding, -hide-annotations, and PDFtk XFA/CropBox pipelines", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 100]);
    const rgb = new Uint8Array(4 * 4 * 3);
    for (let i = 0; i < 16; i++) {
      rgb[i * 3] = 20;
      rgb[i * 3 + 1] = 200;
      rgb[i * 3 + 2] = 100;
    }
    const img = doc.embedRgbImage(4, 4, rgb);
    page.drawImage(img, { x: 10, y: 10, width: 40, height: 40 });

    const widgetDict = cosDict({
      Type: cosName("Annot"),
      Subtype: cosName("Widget"),
      FT: cosName("Tx"),
      T: cosName("note"),
      V: cosString("WIDGET_LABEL"),
      Rect: cosArray([cosNumber(80), cosNumber(20), cosNumber(180), cosNumber(60)]),
    });
    const widgetRef = doc.cos.allocateObject(widgetDict);
    dictSet(page.pageDict, "Annots", cosArray([widgetRef]));
    dictSet(
      page.pageDict,
      "CropBox",
      cosArray([cosNumber(5), cosNumber(5), cosNumber(195), cosNumber(95)])
    );

    const fs = createMemoryFileSystem();
    await fs.mkdir("/work", { recursive: true });
    await fs.writeFile("/work/input.pdf", doc.save());
    await fs.writeFile("/work/spec.txt", new TextEncoder().encode("Attached Specification v1\n"));
    const shell = new Shell({ fs })
      .use(pdftkPlugin())
      .use(pdftoppmPlugin({ replace: true }))
      .use(pdfimagesPlugin({ replace: true }));

    const res = await shell.exec(
      [
        "pdftk /work/input.pdf attach_files /work/spec.txt to_page 1 output /work/prepared.pdf drop_xfa drop_xmp need_appearances",
        "pdftoppm -tiff -hide-annotations -singlefile /work/prepared.pdf /work/page_tif",
        "pdftoppm -svg -singlefile /work/prepared.pdf /work/page_vec",
        "pdfimages -tiff /work/prepared.pdf /work/ext_tif",
        "pdftk /work/prepared.pdf dump_data_utf8",
      ].join(" && ")
    );

    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /PageMediaCropBox: 5 5 195 95/);

    const pageTif = await fs.readFile("/work/page_tif.tif");
    assert.deepEqual(Array.from(pageTif.subarray(0, 4)), [0x49, 0x49, 0x2a, 0x00]);

    const extTif = await fs.readFile("/work/ext_tif-000.tif");
    assert.deepEqual(Array.from(extTif.subarray(0, 4)), [0x49, 0x49, 0x2a, 0x00]);

    const svgContent = new TextDecoder().decode(await fs.readFile("/work/page_vec.svg"));
    assert.match(svgContent, /<image/);
    assert.match(svgContent, /data:image\/png;base64,/);
  });

  it("remaps AcroForm fields and bookmarks across pdftk cat/burst, crops pdftoppm -svg -cropbox, and prints pdfimages -print-filenames", async () => {
    const doc1 = PdfDocument.create();
    const p1 = doc1.addPage([200, 100]);
    const rgb = new Uint8Array(2 * 2 * 3).fill(180);
    p1.drawImage(doc1.embedRgbImage(2, 2, rgb), { x: 10, y: 10, width: 20, height: 20 });
    dictSet(p1.pageDict, "CropBox", cosArray([cosNumber(10), cosNumber(10), cosNumber(110), cosNumber(60)]));
    const w1 = doc1.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Widget"),
        FT: cosName("Tx"),
        T: cosString("first_name"),
        V: cosString("Ada"),
        Rect: cosArray([cosNumber(20), cosNumber(30), cosNumber(100), cosNumber(50)]),
      })
    );
    dictSet(p1.pageDict, "Annots", cosArray([w1]));
    dictSet(doc1.cos.resolveDict(doc1.cos.rootRef)!, "AcroForm", doc1.cos.allocateObject(cosDict({ Fields: cosArray([w1]) })));

    const doc2 = PdfDocument.create();
    const p2 = doc2.addPage([200, 100]);
    const w2 = doc2.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Widget"),
        FT: cosName("Tx"),
        T: cosString("last_name"),
        V: cosString("Lovelace"),
        Rect: cosArray([cosNumber(20), cosNumber(30), cosNumber(100), cosNumber(50)]),
      })
    );
    dictSet(p2.pageDict, "Annots", cosArray([w2]));
    dictSet(doc2.cos.resolveDict(doc2.cos.rootRef)!, "AcroForm", doc2.cos.allocateObject(cosDict({ Fields: cosArray([w2]) })));

    const vfs = createMemoryFileSystem();
    await vfs.mkdir("/work", { recursive: true });
    await vfs.writeFile("/work/f1.pdf", doc1.save());
    await vfs.writeFile("/work/f2.pdf", doc2.save());
    await vfs.writeFile(
      "/work/bm1.info",
      new TextEncoder().encode("BookmarkBegin\nBookmarkTitle: FirstDoc\nBookmarkLevel: 1\nBookmarkPageNumber: 1\n")
    );
    await vfs.writeFile(
      "/work/bm2.info",
      new TextEncoder().encode("BookmarkBegin\nBookmarkTitle: SecondDoc\nBookmarkLevel: 1\nBookmarkPageNumber: 1\n")
    );

    const shell = new Shell({ fs: vfs })
      .use(pdftkPlugin())
      .use(pdftoppmPlugin({ replace: true }))
      .use(pdfimagesPlugin({ replace: true }));

    const pipeline = await shell.exec(
      [
        "pdftk /work/f1.pdf update_info_utf8 /work/bm1.info output /work/f1_bm.pdf",
        "pdftk /work/f2.pdf update_info_utf8 /work/bm2.info output /work/f2_bm.pdf",
        "pdftk A=/work/f1_bm.pdf B=/work/f2_bm.pdf cat A1 B1 output /work/merged.pdf",
        "pdftk /work/merged.pdf burst output /work/burst_%02d.pdf",
        "pdftoppm -svg -r 72 -cropbox -f 1 -l 1 -singlefile /work/merged.pdf /work/cropped_svg",
        "pdfimages -png -print-filenames /work/merged.pdf /work/ext_img",
      ].join(" && ")
    );
    assert.equal(pipeline.exitCode, 0);
    assert.equal(pipeline.stdout.trim(), "/work/ext_img-000.png");

    const dumpMergedFields = await shell.exec("pdftk /work/merged.pdf dump_data_fields_utf8");
    assert.match(dumpMergedFields.stdout, /FieldName: first_name/);
    assert.match(dumpMergedFields.stdout, /FieldName: last_name/);

    const dumpMergedInfo = await shell.exec("pdftk /work/merged.pdf dump_data_utf8");
    assert.match(dumpMergedInfo.stdout, /BookmarkTitle: FirstDoc\nBookmarkLevel: 1\nBookmarkPageNumber: 1/);
    assert.match(dumpMergedInfo.stdout, /BookmarkTitle: SecondDoc\nBookmarkLevel: 1\nBookmarkPageNumber: 2/);

    const dumpBurst1 = await shell.exec("pdftk /work/burst_01.pdf dump_data_fields_utf8");
    assert.match(dumpBurst1.stdout, /FieldName: first_name/);
    assert.doesNotMatch(dumpBurst1.stdout, /FieldName: last_name/);

    const svgStr = new TextDecoder().decode(await vfs.readFile("/work/cropped_svg.svg"));
    assert.match(svgStr, /width="100" height="50" viewBox="10 40 100 50"/);
  });

  it("supports pdftk PdfID0/PdfID1, keep_final_id, compress/uncompress, and pdftoppm -transp -progress in VFS shell", async () => {
    const vfs = createMemoryFileSystem();
    await vfs.mkdir("/work", { recursive: true });

    const d1 = PdfDocument.create();
    const p1 = d1.addPage({ width: 100, height: 100 });
    p1.drawText("UncompressedTextToken", { x: 10, y: 50, size: 12 });
    p1.drawRect({ x: 20, y: 20, width: 40, height: 40, fill: { r: 1, g: 0, b: 0 } });
    const d2 = PdfDocument.create();
    d2.addPage({ width: 100, height: 100 });

    await vfs.writeFile("/work/d1.pdf", d1.save());
    await vfs.writeFile("/work/d2.pdf", d2.save());
    await vfs.writeFile(
      "/work/id1.info",
      new TextEncoder().encode(
        "PdfID0: 1234567890abcdef1234567890abcdef\nPdfID1: 1234567890abcdef1234567890abcdef\n"
      )
    );
    await vfs.writeFile(
      "/work/id2.info",
      new TextEncoder().encode(
        "PdfID0: fedcba0987654321fedcba0987654321\nPdfID1: fedcba0987654321fedcba0987654321\n"
      )
    );

    const shell = new Shell({ fs: vfs })
      .use(pdftkPlugin())
      .use(pdftoppmPlugin({ replace: true }));

    const res = await shell.exec(
      [
        "pdftk /work/d1.pdf update_info_utf8 /work/id1.info output /work/d1_id.pdf",
        "pdftk /work/d2.pdf update_info_utf8 /work/id2.info output /work/d2_id.pdf",
        "pdftk A=/work/d1_id.pdf B=/work/d2_id.pdf cat A B output /work/out.pdf keep_final_id uncompress",
        "pdftoppm -png -transp -progress -r 72 -f 1 -l 1 -singlefile /work/out.pdf /work/tr_page",
      ].join(" && ")
    );
    assert.equal(res.exitCode, 0);
    assert.equal(res.stderr.trim(), "1 1 /work/tr_page.png");

    const dumpRes = await shell.exec("pdftk /work/out.pdf dump_data_utf8");
    assert.match(dumpRes.stdout, /PdfID0: fedcba0987654321fedcba0987654321/);

    const outPdfAscii = new TextDecoder("latin1").decode(await vfs.readFile("/work/out.pdf"));
    assert.match(outPdfAscii, /UncompressedTextToken/);

    const trBmp = decodePng(await vfs.readFile("/work/tr_page.png"));
    assert.equal(trBmp.data[(5 * trBmp.width + 5) * 4 + 3], 0);
    assert.equal(trBmp.data[(40 * trBmp.width + 40) * 4 + 3], 255);
  });

  it("supports pdftotext -nodiag -cropbox, pdftohtml -xml -zoom, and qpdf --flatten-annotations=print in VFS shell", async () => {
    const vfs = createMemoryFileSystem();
    await vfs.mkdir("/work", { recursive: true });

    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 200, height: 200 });
    dictSet(
      page.pageDict,
      "CropBox",
      cosArray([cosNumber(0), cosNumber(0), cosNumber(200), cosNumber(120)])
    );
    const content = [
      "BT /F1 12 Tf 1 0 0 1 20 60 Tm (VisibleMainText) Tj ET",
      "BT /F1 12 Tf 0.7071 0.7071 -0.7071 0.7071 50 50 Tm (DiagonalDraftStamp) Tj ET",
      "BT /F1 12 Tf 1 0 0 1 20 170 Tm (CroppedHeaderBleed) Tj ET",
    ].join("\n");
    dictSet(
      page.pageDict,
      "Contents",
      doc.cos.allocateObject(cosStream(new TextEncoder().encode(content), { compress: false }))
    );
    const apRef = doc.cos.allocateObject({
      kind: "stream",
      dict: cosDict({
        Type: cosName("XObject"),
        Subtype: cosName("Form"),
        BBox: cosArray([cosNumber(0), cosNumber(0), cosNumber(50), cosNumber(20)]),
      }),
      rawBytes: new TextEncoder().encode("BT /F1 10 Tf 5 5 Td (FlattenedAPBadge) Tj ET"),
    });
    const printAnnotRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Stamp"),
        F: cosNumber(4),
        Rect: cosArray([cosNumber(20), cosNumber(20), cosNumber(120), cosNumber(50)]),
        AP: cosDict({ N: apRef }),
      })
    );
    dictSet(page.pageDict, "Annots", cosArray([printAnnotRef]));
    await vfs.writeFile("/work/src.pdf", doc.save());

    const shell = new Shell({ fs: vfs })
      .use(pdftotextCommands())
      .use(qpdfCommands());

    const flatRes = await shell.exec("qpdf --flatten-annotations=print /work/src.pdf /work/flat.pdf");
    assert.equal(flatRes.exitCode, 0);

    const txtRes = await shell.exec("pdftotext -nodiag -cropbox /work/flat.pdf -");
    assert.equal(txtRes.exitCode, 0);
    assert.match(txtRes.stdout, /VisibleMainText/);
    assert.match(txtRes.stdout, /FlattenedAPBadge/);
    assert.doesNotMatch(txtRes.stdout, /DiagonalDraftStamp/);
    assert.doesNotMatch(txtRes.stdout, /CroppedHeaderBleed/);

    const xmlRes = await shell.exec("pdftohtml -xml -stdout -zoom 2 /work/flat.pdf");
    assert.equal(xmlRes.exitCode, 0);
    assert.match(xmlRes.stdout, /height="400" width="400"/);
  });

  it("pdffonts, pdfdetach, and pdftoppm -transp -progress execute end-to-end in a VFS Shell", async () => {
    const vfs = createMemoryFileSystem();
    await vfs.mkdir("/work", { recursive: true });

    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 100, height: 100 });
    page.drawText("Hello Poppler Suite", { x: 10, y: 50, size: 12 });

    await vfs.writeFile("/work/input.pdf", doc.save());
    await vfs.writeFile("/work/readme.txt", new TextEncoder().encode("embedded-readme-text"));

    const shell = new Shell({ fs: vfs })
      .use(pdfinfoCommands({ replace: true }))
      .use(pdftkPlugin({ replace: true }));

    // 1. Attach readme.txt via pdftk attach_files
    const attachRes = await shell.exec("pdftk /work/input.pdf attach_files /work/readme.txt output /work/attached.pdf");
    assert.equal(attachRes.exitCode, 0);

    // 2. Inspect fonts via pdffonts
    const fontsRes = await shell.exec("pdffonts /work/attached.pdf");
    assert.equal(fontsRes.exitCode, 0);
    assert.match(fontsRes.stdout, /Helvetica/);

    // 3. List and extract embedded files via pdfdetach
    const detachList = await shell.exec("pdfdetach -list /work/attached.pdf");
    assert.equal(detachList.exitCode, 0);
    assert.match(detachList.stdout, /1: readme\.txt/);

    const detachSave = await shell.exec("pdfdetach -saveall -o /work/detached /work/attached.pdf");
    assert.equal(detachSave.exitCode, 0);
    const detachedContent = new TextDecoder().decode(await vfs.readFile("/work/detached/readme.txt"));
    assert.equal(detachedContent, "embedded-readme-text");

    // 4. Render with pdftoppm -png -transp -progress -singlefile
    const ppmRes = await shell.exec(
      "pdftoppm -png -transp -progress -singlefile -r 72 /work/attached.pdf /work/transparent-page"
    );
    assert.equal(ppmRes.exitCode, 0);
    assert.match(ppmRes.stderr, /1 1 \/work\/transparent-page\.png/);
    const png = decodePng(await vfs.readFile("/work/transparent-page.png"));
    assert.equal(png.data[3], 0); // Background alpha is transparent
  });

  it("executes qpdf --add-attachment / --set-page-labels, pdftotext -clip, and pdftoppm axial gradient sh in VFS Shell", async () => {
    const vfs = createMemoryFileSystem();
    await vfs.mkdir("/work", { recursive: true });

    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 100, height: 100 });

    const axialFn = cosDict([
      ["FunctionType", cosNumber(2)],
      ["Domain", cosArray([cosNumber(0), cosNumber(1)])],
      ["C0", cosArray([cosNumber(1), cosNumber(0), cosNumber(0)])],
      ["C1", cosArray([cosNumber(0), cosNumber(0), cosNumber(1)])],
      ["N", cosNumber(1)],
    ]);
    const shRef = doc.cos.allocateObject(
      cosDict([
        ["ShadingType", cosNumber(2)],
        ["ColorSpace", cosName("DeviceRGB")],
        ["Coords", cosArray([cosNumber(0), cosNumber(0), cosNumber(100), cosNumber(0)])],
        ["Function", axialFn],
        ["Extend", cosArray([{ kind: "boolean", value: true }, { kind: "boolean", value: true }])],
      ])
    );
    dictSet(
      page.pageDict,
      "Resources",
      cosDict([
        ["Shading", cosDict([["Grad1", shRef]])],
        [
          "Font",
          cosDict([
            [
              "F1",
              cosDict([
                ["Type", cosName("Font")],
                ["Subtype", cosName("Type1")],
                ["BaseFont", cosName("Helvetica")],
              ]),
            ],
          ]),
        ],
      ])
    );

    const content = [
      "q 0 50 100 50 re W n /Grad1 sh Q",
      "q 10 10 80 40 re W n",
      "BT /F1 10 Tf 1 0 0 1 15 25 Tm (ClippedVisible) Tj ET",
      "BT /F1 10 Tf 1 0 0 1 15 80 Tm (ClippedHidden) Tj ET",
      "Q",
    ].join("\n");
    dictSet(
      page.pageDict,
      "Contents",
      doc.cos.allocateObject(cosStream(new TextEncoder().encode(content), { compress: false }))
    );

    await vfs.writeFile("/work/grad.pdf", doc.save());
    await vfs.writeFile("/work/manifest.json", new TextEncoder().encode('{"pkg":"pdf-suite"}'));

    const shell = new Shell({ fs: vfs })
      .use(qpdfCommands())
      .use(pdftotextCommands())
      .use(pdftoppmPlugin({ replace: true }));

    // 1. qpdf --add-attachment and --set-page-labels
    const qRes = await shell.exec(
      "qpdf --add-attachment /work/manifest.json --key=meta --filename=manifest.json -- --set-page-labels 1:D/3/P- -- /work/grad.pdf /work/grad-att.pdf"
    );
    assert.equal(qRes.exitCode, 0);

    const showAtt = await shell.exec("qpdf --show-attachment=meta /work/grad-att.pdf");
    assert.equal(showAtt.exitCode, 0);
    assert.equal(showAtt.stdout, '{"pkg":"pdf-suite"}');

    // 2. pdftotext -clip filters out ClippedHidden
    const txtRes = await shell.exec("pdftotext -clip -table /work/grad-att.pdf -");
    assert.equal(txtRes.exitCode, 0);
    assert.match(txtRes.stdout, /ClippedVisible/);
    assert.doesNotMatch(txtRes.stdout, /ClippedHidden/);

    // 3. pdftoppm renders /Grad1 sh axial gradient
    const ppmRes = await shell.exec("pdftoppm -png -singlefile -r 72 /work/grad-att.pdf /work/grad-out");
    assert.equal(ppmRes.exitCode, 0);
    const bmp = decodePng(await vfs.readFile("/work/grad-out.png"));
    const leftPx = (25 * bmp.width + 10) * 4;
    const rightPx = (25 * bmp.width + 90) * 4;
    assert.ok(bmp.data[leftPx]! > 200);
    assert.ok(bmp.data[rightPx + 2]! > 200);
  });

  it("orchestrates pdftk update_info_utf8 & attach_files, qpdf --copy-attachments-from & --remove-info, pdfdetach, and pdftotext -htmlmeta -tsv", async () => {
    const vfs = createMemoryFileSystem();
    await vfs.mkdir("/work", { recursive: true });

    const doc = PdfDocument.create();
    doc.addPage({ width: 200, height: 100 }).drawText("Pipeline Content Row", { x: 20, y: 50, size: 12 });
    await vfs.writeFile("/work/base.pdf", doc.save());
    await vfs.writeFile(
      "/work/info.txt",
      new TextEncoder().encode(
        [
          "InfoBegin",
          "InfoKey: Title",
          "InfoValue: Pipeline Report",
          "InfoBegin",
          "InfoKey: CreationDate",
          "InfoValue: D:20240102030405+05'30'",
          "InfoBegin",
          "InfoKey: ModDate",
          "InfoValue: D:20260924120000Z",
        ].join("\n")
      )
    );
    await vfs.writeFile("/work/audit.csv", new TextEncoder().encode("id,score\n1,99\n"));

    const shell = new Shell({ fs: vfs })
      .use(pdftkPlugin({ replace: true }))
      .use(qpdfCommands())
      .use(pdfinfoCommands())
      .use(pdftotextCommands());

    // 1. pdftk update_info_utf8 and attach_files
    const tkInfo = await shell.exec("pdftk /work/base.pdf update_info_utf8 /work/info.txt output /work/dated.pdf");
    assert.equal(tkInfo.exitCode, 0);
    const tkAtt = await shell.exec("pdftk /work/dated.pdf attach_files /work/audit.csv output /work/with-csv.pdf");
    assert.equal(tkAtt.exitCode, 0);

    // 2. pdfinfo verifies CreationDate timezone conversion
    const infoRes = await shell.exec("pdfinfo /work/with-csv.pdf");
    assert.equal(infoRes.exitCode, 0);
    assert.match(infoRes.stdout, /CreationDate:\s+Mon Jan  1 21:34:05 2024 UTC/);

    // 3. qpdf --copy-attachments-from --prefix=CP_ and --remove-info
    const qpdfRes = await shell.exec(
      "qpdf --copy-attachments-from /work/with-csv.pdf --prefix=CP_ -- --remove-info /work/base.pdf /work/copied.pdf"
    );
    assert.equal(qpdfRes.exitCode, 0);

    // 4. pdfdetach extracts the copied attachment
    const detachRes = await shell.exec("pdfdetach -savefile audit.csv -o /work/extracted-audit.csv /work/copied.pdf");
    assert.equal(detachRes.exitCode, 0);
    assert.equal(new TextDecoder().decode(await vfs.readFile("/work/extracted-audit.csv")), "id,score\n1,99\n");

    // 5. pdftotext -htmlmeta -tsv emits HTML <pre> around TSV
    const htmlTsv = await shell.exec("pdftotext -htmlmeta -tsv /work/with-csv.pdf -");
    assert.equal(htmlTsv.exitCode, 0);
    assert.match(htmlTsv.stdout, /<title>Pipeline Report<\/title>/);
    assert.match(htmlTsv.stdout, /<pre>\nlevel\tpage_num\tpar_num\tblock_num/);
    assert.match(htmlTsv.stdout, /\t100\tPipeline\n/);
    assert.match(htmlTsv.stdout, /\t100\tContent\n/);
    assert.match(htmlTsv.stdout, /\t100\tRow\n/);
  });

  it("executes Type 3 font /CharProcs in pdftoppm & pdftotext, dumps annotations with pdftk dump_data_annots_utf8, and rotates even pages with qpdf", async () => {
    const doc = PdfDocument.create();
    const p1 = doc.addPage([200, 100]);
    const p2 = doc.addPage([200, 100]);
    p2.drawText("Second Page", { x: 20, y: 50 });

    const gAStream = doc.cos.allocateObject(
      cosStream(new TextEncoder().encode("100 0 0 0 100 100 d1 0 0 100 100 re f"))
    );
    const type3FontRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Font"),
        Subtype: cosName("Type3"),
        FontBBox: cosArray([cosNumber(0), cosNumber(0), cosNumber(100), cosNumber(100)]),
        FontMatrix: cosArray([cosNumber(0.01), cosNumber(0), cosNumber(0), cosNumber(0.01), cosNumber(0), cosNumber(0)]),
        FirstChar: cosNumber(65),
        LastChar: cosNumber(65),
        Widths: cosArray([cosNumber(100)]),
        Encoding: cosDict({
          Type: cosName("Encoding"),
          Differences: cosArray([cosNumber(65), cosName("gA")]),
        }),
        CharProcs: cosDict({ gA: gAStream }),
        ToUnicode: doc.cos.allocateObject(
          cosStream(new TextEncoder().encode("beginbfchar\n<41> <0041>\nendbfchar"))
        ),
      })
    );
    dictSet(p1.pageDict, "Resources", cosDict({ Font: cosDict({ T3: type3FontRef }) }));
    p1.setRawContentStream("1 0 0 rg BT /T3 20 Tf 10 30 Td (A) Tj ET");

    const linkAnnotRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Link"),
        Rect: cosArray([cosNumber(10), cosNumber(10), cosNumber(100), cosNumber(25)]),
        F: cosNumber(4),
        A: cosDict({
          S: cosName("URI"),
          URI: cosString("https://poe.com/pdf-suite"),
        }),
      })
    );
    dictSet(p1.pageDict, "Annots", cosArray([linkAnnotRef]));

    const vfs = createMemoryFileSystem();
    await vfs.mkdir("/work", { recursive: true });
    await vfs.writeFile("/work/type3.pdf", doc.save());

    const shell = new Shell({ fs: vfs })
      .use(pdftkPlugin({ replace: true }))
      .use(qpdfCommands())
      .use(pdftoppmPlugin({ replace: true }))
      .use(pdftotextCommands());

    // 1. pdftk dump_data_annots_utf8 reports the Link URI annotation
    const annotRes = await shell.exec("pdftk /work/type3.pdf dump_data_annots_utf8");
    assert.equal(annotRes.exitCode, 0);
    assert.match(annotRes.stdout, /AnnotSubtype: Link/);
    assert.match(annotRes.stdout, /AnnotActionURI: https:\/\/poe\.com\/pdf-suite/);

    // 2. pdftotext extracts "A" from the Type 3 font
    const txtRes = await shell.exec("pdftotext /work/type3.pdf -");
    assert.equal(txtRes.exitCode, 0);
    assert.match(txtRes.stdout, /A/);

    // 3. pdftoppm renders page 1 Type 3 /CharProcs glyph to red pixels
    const ppmRes = await shell.exec("pdftoppm -png -r 72 -f 1 -l 1 -singlefile /work/type3.pdf /work/p1");
    assert.equal(ppmRes.exitCode, 0);
    const p1Png = decodePng(await vfs.readFile("/work/p1.png"));
    const idx = (60 * p1Png.width + 20) * 4;
    assert.equal(p1Png.data[idx], 255);
    assert.equal(p1Png.data[idx + 1], 0);
    assert.equal(p1Png.data[idx + 2], 0);

    // 4. qpdf rotates only even pages (--rotate=+90:1-z:even)
    const qpdfRes = await shell.exec("qpdf /work/type3.pdf /work/rot-even.pdf --rotate=+90:1-z:even");
    assert.equal(qpdfRes.exitCode, 0);
    const rotDoc = PdfDocument.load(await vfs.readFile("/work/rot-even.pdf"));
    assert.equal(rotDoc.getPage(0).getRotation(), 0);
    assert.equal(rotDoc.getPage(1).getRotation(), 90);
  });

  it("discovers tiling pattern fonts in pdffonts and preserves /PatternType 2 shading patterns across pdftk stamp + pdftoppm", async () => {
    // 1. Create base PDF with a /PatternType 1 tiling pattern containing a Courier-Bold font
    const baseDoc = PdfDocument.create();
    const pBase = baseDoc.addPage({ width: 100, height: 100 });
    const courierRef = baseDoc.cos.allocateObject(
      cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Courier-Bold") })
    );
    const tilePatRef = baseDoc.cos.allocateObject(
      cosStream(new TextEncoder().encode("BT /FPat 10 Tf 2 10 Td (TileText) Tj ET"), {
        dict: cosDict({
          Type: cosName("Pattern"),
          PatternType: cosNumber(1),
          PaintType: cosNumber(1),
          TilingType: cosNumber(1),
          BBox: cosArray([cosNumber(0), cosNumber(0), cosNumber(50), cosNumber(50)]),
          XStep: cosNumber(50),
          YStep: cosNumber(50),
          Resources: cosDict({ Font: cosDict({ FPat: courierRef }) }),
        }),
      })
    );
    dictSet(pBase.pageDict, "Resources", cosDict({ Pattern: cosDict({ PTile: tilePatRef }) }));
    pBase.setRawContentStream("/Pattern cs /PTile scn 0 0 50 50 re f");

    // 2. Create stamp PDF with a /PatternType 2 shading pattern (solid green via FunctionType 2) in [50, 20, 40, 40]
    const stampDoc = PdfDocument.create();
    const pStamp = stampDoc.addPage({ width: 100, height: 100 });
    const shadPatRef = stampDoc.cos.allocateObject(
      cosDict({
        Type: cosName("Pattern"),
        PatternType: cosNumber(2),
        Shading: cosDict({
          ShadingType: cosNumber(2),
          ColorSpace: cosName("DeviceRGB"),
          Coords: cosArray([cosNumber(50), cosNumber(0), cosNumber(90), cosNumber(0)]),
          Function: cosDict({
            FunctionType: cosNumber(2),
            Domain: cosArray([cosNumber(0), cosNumber(1)]),
            C0: cosArray([cosNumber(0), cosNumber(1), cosNumber(0)]),
            C1: cosArray([cosNumber(0), cosNumber(1), cosNumber(0)]),
            N: cosNumber(1),
          }),
        }),
      })
    );
    dictSet(pStamp.pageDict, "Resources", cosDict({ Pattern: cosDict({ PShad: shadPatRef }) }));
    pStamp.setRawContentStream("/Pattern cs /PShad scn 50 20 40 40 re f");

    const vfs = createMemoryFileSystem();
    await vfs.mkdir("/work", { recursive: true });
    await vfs.writeFile("/work/base.pdf", baseDoc.save());
    await vfs.writeFile("/work/stamp.pdf", stampDoc.save());

    const shell = new Shell({ fs: vfs })
      .use(pdfinfoCommands())
      .use(pdftkPlugin({ replace: true }))
      .use(pdftoppmPlugin({ replace: true }));

    // Verify pdffonts discovers Courier-Bold inside /PatternType 1 /Resources
    const fontsRes = await shell.exec("pdffonts /work/base.pdf");
    assert.equal(fontsRes.exitCode, 0);
    assert.match(fontsRes.stdout, /Courier-Bold/);

    // Stamp /work/stamp.pdf onto /work/base.pdf and render with pdftoppm
    const stampRes = await shell.exec("pdftk /work/base.pdf stamp /work/stamp.pdf output /work/stamped.pdf");
    assert.equal(stampRes.exitCode, 0);

    const ppmRes = await shell.exec("pdftoppm -png -r 72 -singlefile /work/stamped.pdf /work/stamped-page");
    assert.equal(ppmRes.exitCode, 0);
    const png = decodePng(await vfs.readFile("/work/stamped-page.png"));
    // At PDF (70, 40) -> screen (70, 60), the stamped /PatternType 2 shading paints green (0, 255, 0)
    const idx = (60 * png.width + 70) * 4;
    assert.equal(png.data[idx], 0);
    assert.equal(png.data[idx + 1], 255);
    assert.equal(png.data[idx + 2], 0);
  });

  it("executes qpdf --flatten-rotation (with CropBox transformation) and pdftk generate_fdf -> fill_form hierarchical /Kids round-trip in VFS Shell", async () => {
    const doc = PdfDocument.create();
    const p1 = doc.addPage({ width: 200, height: 100 });
    dictSet(p1.dict, "CropBox", cosArray([cosNumber(10), cosNumber(20), cosNumber(190), cosNumber(80)]));
    const firstRef = doc.cos.allocateObject(
      cosDict({ FT: cosName("Tx"), T: cosString("first"), V: cosString("Grace") })
    );
    const parentRef = doc.cos.allocateObject(
      cosDict({ T: cosString("user"), Kids: cosArray([firstRef]) })
    );
    dictSet(doc.cos.resolveDict(firstRef)!, "Parent", parentRef);
    const cat = doc.cos.resolveDict(doc.cos.rootRef)!;
    dictSet(cat, "AcroForm", doc.cos.allocateObject(cosDict({ Fields: cosArray([parentRef]) })));

    const blankDoc = PdfDocument.create();
    blankDoc.addPage({ width: 200, height: 100 });
    const blankFirstRef = blankDoc.cos.allocateObject(
      cosDict({ FT: cosName("Tx"), T: cosString("first"), V: cosString("") })
    );
    const blankParentRef = blankDoc.cos.allocateObject(
      cosDict({ T: cosString("user"), Kids: cosArray([blankFirstRef]) })
    );
    dictSet(blankDoc.cos.resolveDict(blankFirstRef)!, "Parent", blankParentRef);
    dictSet(blankDoc.cos.resolveDict(blankDoc.cos.rootRef)!, "AcroForm", blankDoc.cos.allocateObject(cosDict({ Fields: cosArray([blankParentRef]) })));

    const vfs = createMemoryFileSystem();
    await vfs.mkdir("/work", { recursive: true });
    await vfs.writeFile("/work/src.pdf", doc.save());
    await vfs.writeFile("/work/blank.pdf", blankDoc.save());

    const shell = new Shell({ fs: vfs })
      .use(qpdfCommands())
      .use(pdftkPlugin({ replace: true }))
      .use(pdfinfoCommands());

    const res = await shell.exec(
      "qpdf /work/src.pdf /work/flatrot.pdf --rotate=+90:1 --flatten-rotation && " +
      "pdftk /work/src.pdf generate_fdf output /work/data.fdf && " +
      "pdftk /work/blank.pdf fill_form /work/data.fdf output /work/filled.pdf && " +
      "pdftk /work/filled.pdf dump_data_fields_utf8"
    );
    assert.equal(res.exitCode, 0);
    assert.ok(res.stdout.includes("FieldName: user.first"));
    assert.ok(res.stdout.includes("FieldValue: Grace"));

    const infoRes = await shell.exec("pdfinfo -box /work/flatrot.pdf");
    assert.equal(infoRes.exitCode, 0);
    assert.ok(infoRes.stdout.includes("60 x 180 pts"));
    assert.ok(infoRes.stdout.includes("100.00   200.00"));
    assert.ok(infoRes.stdout.includes("20.00    10.00    80.00   190.00"));
  });

  it("chains qpdf --externalize-inline-images --remove-unreferenced-resources with pdffonts, pdfimages -list, and pdftohtml outlines", async () => {
    const doc = PdfDocument.create();
    const p1 = doc.addPage({ width: 200, height: 120 });
    const p2 = doc.addPage({ width: 200, height: 120 });
    p2.drawText("Section Two Target", { x: 20, y: 80, size: 12 });

    const fUsedRef = doc.cos.allocateObject(
      cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Helvetica") })
    );
    const fUnusedRef = doc.cos.allocateObject(
      cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Courier-Bold") })
    );
    const inlineBytes = new TextEncoder().encode(
      "BT /FUsed 12 Tf 20 80 Td (Go to Section 2) Tj ET\n" +
      "q 16 0 0 16 20 20 cm BI /W 2 /H 2 /CS /RGB /BPC 8 ID \xFF\x00\x00\x00\xFF\x00\x00\x00\xFF\xFF\xFF\x00 EI Q\n"
    );
    dictSet(p1.dict, "Contents", doc.cos.allocateObject(cosStream(inlineBytes)));
    dictSet(
      p1.dict,
      "Resources",
      cosDict({
        Font: cosDict({ FUsed: fUsedRef, FUnused: fUnusedRef }),
      })
    );
    const gotoRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Link"),
        Rect: cosArray([cosNumber(18), cosNumber(75), cosNumber(140), cosNumber(95)]),
        Dest: cosArray([p2.ref, cosName("Fit")]),
      })
    );
    dictSet(p1.dict, "Annots", cosArray([gotoRef]));
    const outlineItemRef = doc.cos.allocateObject(
      cosDict({
        Title: cosString("Bookmark Page 2"),
        Dest: cosArray([p2.ref, cosName("Fit")]),
      })
    );
    dictSet(
      doc.cos.resolveDict(doc.cos.rootRef)!,
      "Outlines",
      doc.cos.allocateObject(
        cosDict({
          Type: cosName("Outlines"),
          First: outlineItemRef,
          Last: outlineItemRef,
        })
      )
    );

    const vfs = createMemoryFileSystem();
    await vfs.mkdir("/work", { recursive: true });
    await vfs.writeFile("/work/raw.pdf", doc.save());

    const shell = new Shell({ fs: vfs })
      .use(qpdfCommands())
      .use(pdfinfoCommands())
      .use(pdfimagesPlugin({ replace: true }))
      .use(pdftotextCommands());

    const res = await shell.exec(
      "qpdf /work/raw.pdf /work/clean.pdf --externalize-inline-images --ii-min-bytes=4 --remove-unreferenced-resources=yes && " +
      "pdffonts /work/clean.pdf && " +
      "pdfimages -list /work/clean.pdf && " +
      "pdftohtml -stdout /work/clean.pdf"
    );
    assert.equal(res.exitCode, 0);
    // FUsed (Helvetica) remains, FUnused (Courier-Bold) was removed
    assert.ok(res.stdout.includes("Helvetica"));
    assert.ok(!res.stdout.includes("Courier-Bold"));
    // Externalized inline image appears in pdfimages -list
    assert.ok(res.stdout.includes("image"));
    // pdftohtml includes #page2 internal link and Document Outline
    assert.ok(res.stdout.includes('href="#page2"'));
    assert.ok(res.stdout.includes("<h1>Document Outline</h1>"));
    assert.ok(res.stdout.includes("Bookmark Page 2"));
  });

  it("evaluates Optional Content Groups (/OCProperties), /ActualText, rotation-aligned pdftk stamp, pdftoppm -forcenum, and pdfinfo -js in VFS Shell", async () => {
    const doc = PdfDocument.create();
    const p1 = doc.addPage({ width: 200, height: 100 });
    p1.setRotation(90);

    const ocgVisibleRef = doc.cos.allocateObject(
      cosDict({ Type: cosName("OCG"), Name: cosString("VisibleLayer") })
    );
    const ocgHiddenRef = doc.cos.allocateObject(
      cosDict({ Type: cosName("OCG"), Name: cosString("HiddenLayer") })
    );
    const catalog = doc.cos.resolveDict(doc.cos.rootRef)!;
    dictSet(
      catalog,
      "OCProperties",
      cosDict({
        OCGs: cosArray([ocgVisibleRef, ocgHiddenRef]),
        D: cosDict({
          BaseState: cosName("ON"),
          OFF: cosArray([ocgHiddenRef]),
        }),
      })
    );

    const fRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Font"),
        Subtype: cosName("Type1"),
        BaseFont: cosName("Helvetica"),
      })
    );
    const sepImgRef = doc.cos.allocateObject(
      cosStream(Uint8Array.from([180]), {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(1),
          Height: cosNumber(1),
          BitsPerComponent: cosNumber(8),
          ColorSpace: cosArray([
            cosName("Separation"),
            cosName("SpotBlue"),
            cosName("DeviceRGB"),
            cosDict({
              FunctionType: cosNumber(2),
              C0: cosArray([cosNumber(1), cosNumber(1), cosNumber(1)]),
              C1: cosArray([cosNumber(0.1), cosNumber(0.2), cosNumber(0.9)]),
              N: cosNumber(1),
            }),
          ]),
        }),
      })
    );

    dictSet(
      p1.dict,
      "Resources",
      cosDict({
        Font: cosDict({ F1: fRef }),
        XObject: cosDict({ ImSep: sepImgRef }),
        Properties: cosDict({
          LVis: ocgVisibleRef,
          LHid: ocgHiddenRef,
          PActual: cosDict({ ActualText: cosString("Expanded-Formula") }),
        }),
      })
    );
    dictSet(
      p1.dict,
      "AA",
      cosDict({
        O: doc.cos.allocateObject(
          cosDict({
            S: cosName("JavaScript"),
            JS: cosString("app.alert('page-opened');"),
          })
        ),
      })
    );
    p1.setRawContentStream(
      "q 10 0 0 10 10 10 cm /ImSep Do Q " +
      "BT /F1 12 Tf 20 60 Td /OC /LVis BDC (Visible-Layer-Text ) Tj EMC " +
      "/OC /LHid BDC (Secret-Hidden-Layer ) Tj EMC " +
      "/Span /PActual BDC (X) Tj EMC ET"
    );

    const stampDoc = PdfDocument.create();
    const sp = stampDoc.addPage({ width: 100, height: 200 });
    sp.drawText("ROTATED-STAMP", { x: 20, y: 100, size: 12 });

    const vfs = createMemoryFileSystem();
    await vfs.mkdir("/work", { recursive: true });
    await vfs.writeFile("/work/base.pdf", doc.save());
    await vfs.writeFile("/work/stamp.pdf", stampDoc.save());

    const shell = new Shell({ fs: vfs })
      .use(pdfinfoCommands())
      .use(pdftkPlugin({ replace: true }))
      .use(pdftoppmPlugin({ replace: true }))
      .use(pdfimagesPlugin({ replace: true }))
      .use(pdftotextCommands());

    const res = await shell.exec(
      "pdftk /work/base.pdf stamp /work/stamp.pdf output /work/stamped.pdf && " +
      "pdftotext /work/stamped.pdf - && " +
      "pdfinfo -js /work/stamped.pdf && " +
      "pdfimages -list /work/stamped.pdf && " +
      "pdftoppm -png -singlefile -forcenum -r 72 /work/stamped.pdf /work/page"
    );
    assert.equal(res.exitCode, 0);
    assert.ok(res.stdout.includes("Visible-Layer-Text"));
    assert.ok(!res.stdout.includes("Secret-Hidden-Layer"));
    assert.ok(res.stdout.includes("Expanded-Formula"));
    assert.ok(res.stdout.includes("ROTATED-STAMP"));
    assert.ok(res.stdout.includes("app.alert('page-opened')"));
    assert.ok(res.stdout.includes("sep  "));
    const renderedPng = await vfs.readFile("/work/page-1.png");
    assert.ok(renderedPng.byteLength > 50);
  });

  it("executes qpdf --generate-appearances --normalize-content=y and pdftk fill_form replacement_font in VFS Shell", async () => {
    const doc = PdfDocument.create();
    const p = doc.addPage({ width: 200, height: 120 });
    const f1Ref = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Widget"),
        FT: cosName("Tx"),
        T: cosString("BadgeId"),
        V: cosString("INIT-001"),
        Rect: cosArray([cosNumber(20), cosNumber(60), cosNumber(180), cosNumber(90)]),
      })
    );
    dictSet(p.dict, "Annots", cosArray([f1Ref]));
    const catalog = doc.cos.resolveDict(doc.cos.rootRef)!;
    dictSet(
      catalog,
      "AcroForm",
      doc.cos.allocateObject(
        cosDict({
          Fields: cosArray([f1Ref]),
          NeedAppearances: { kind: "boolean", value: true },
        })
      )
    );

    const fdfBytes = new TextEncoder().encode(
      "%FDF-1.2\n1 0 obj\n<< /FDF << /Fields [ << /T (BadgeId) /V (BADGE-777) >> ] >> >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n"
    );

    const vfs = createMemoryFileSystem();
    await vfs.mkdir("/work", { recursive: true });
    await vfs.writeFile("/work/form.pdf", doc.save());
    await vfs.writeFile("/work/data.fdf", fdfBytes);

    const shell = new Shell({ fs: vfs })
      .use(pdfinfoCommands())
      .use(pdftkPlugin({ replace: true }))
      .use(qpdfCommands())
      .use(pdftotextCommands());

    const res = await shell.exec(
      "qpdf /work/form.pdf /work/gen.pdf --generate-appearances --normalize-content=y && " +
      "pdftk /work/gen.pdf fill_form /work/data.fdf output /work/filled.pdf replacement_font Courier flatten && " +
      "pdffonts /work/filled.pdf && " +
      "pdftotext /work/filled.pdf -"
    );
    assert.equal(res.exitCode, 0);
    assert.ok(res.stdout.includes("Courier"));
    assert.ok(res.stdout.includes("BADGE-777"));
  });

  it("executes qpdf --object-streams=generate / --show-xref and pdftk update_info_utf8 PageMediaRect / PageMediaCropRect in VFS Shell", async () => {
    const doc = PdfDocument.create();
    doc.cos.version = "1.4";
    const page = doc.addPage({ width: 400, height: 300 });
    page.drawText("Object Stream & PageMedia Pipeline", { x: 20, y: 150, size: 12 });

    const infoTxt = [
      "PageMediaBegin",
      "PageMediaNumber: 1",
      "PageMediaRotation: 90",
      "PageMediaRect: 10 20 410 320",
      "PageMediaCropRect: 15 25 405 315",
    ].join("\n") + "\n";

    const vfs = createMemoryFileSystem();
    await vfs.mkdir("/work", { recursive: true });
    await vfs.writeFile("/work/src.pdf", doc.save());
    await vfs.writeFile("/work/media.txt", new TextEncoder().encode(infoTxt));

    const shell = new Shell({ fs: vfs })
      .use(pdfinfoCommands())
      .use(pdftkPlugin({ replace: true }))
      .use(qpdfCommands())
      .use(pdftotextCommands());

    const res = await shell.exec(
      "pdftk /work/src.pdf update_info_utf8 /work/media.txt output /work/updated.pdf && " +
      "qpdf /work/updated.pdf /work/packed.pdf --object-streams=generate && " +
      "qpdf /work/packed.pdf --show-xref && " +
      "pdftk /work/packed.pdf dump_data_utf8 && " +
      "pdfinfo -box /work/packed.pdf"
    );
    assert.equal(res.exitCode, 0);
    assert.ok(res.stdout.includes("compressed; stream = "));
    assert.ok(res.stdout.includes("PageMediaRect: 10 20 410 320"));
    assert.ok(res.stdout.includes("PageMediaCropRect: 15 25 405 315"));
    assert.ok(res.stdout.includes("MediaBox:"));
    assert.ok(res.stdout.includes("CropBox:"));
  });

  it("executes qpdf --json, qpdf --json-input, qpdf --update-from-json, and pdffonts -subst in VFS Shell", async () => {
    const doc = PdfDocument.create();
    doc.setTitle("Initial VFS Title");
    const page = doc.addPage({ width: 300, height: 200 });
    page.drawText("JSON VFS Pipeline Text", { x: 20, y: 100, size: 12 });
    const infoObjNum = doc.cos.infoRef!.objectNumber;
    const patchJson = JSON.stringify({
      qpdf: [
        { jsonversion: 2 },
        {
          [`obj:${infoObjNum} 0 R`]: {
            value: {
              "/Title": "u:Updated VFS Title From JSON",
            },
          },
        },
      ],
    });

    const vfs = createMemoryFileSystem();
    await vfs.mkdir("/work", { recursive: true });
    await vfs.writeFile("/work/in.pdf", doc.save());
    await vfs.writeFile("/work/patch.json", new TextEncoder().encode(patchJson));

    const shell = new Shell({ fs: vfs })
      .use(pdfinfoCommands())
      .use(qpdfCommands())
      .use(pdftotextCommands());

    const res = await shell.exec(
      "qpdf /work/in.pdf --json --json-stream-data=file --json-stream-prefix=/work/stm- /work/dump.json && " +
      "qpdf --json-input /work/dump.json /work/rebuilt.pdf && " +
      "qpdf /work/rebuilt.pdf --update-from-json=/work/patch.json /work/patched.pdf && " +
      "pdfinfo /work/patched.pdf && " +
      "pdffonts -subst /work/patched.pdf && " +
      "pdftotext /work/patched.pdf -"
    );
    assert.equal(res.exitCode, 0);
    assert.ok(res.stdout.includes("Updated VFS Title From JSON"));
    assert.ok(res.stdout.includes("Nimbus Sans"));
    assert.ok(res.stdout.includes("JSON VFS Pipeline Text"));
  });

  it("executes pdftocairo (-svg, -pdf, -eps) and Named Destination /Outlines across pdftk, qpdf --json, and pdftohtml -xml in VFS Shell", async () => {
    const doc = PdfDocument.create();
    const p1 = doc.addPage({ width: 300, height: 200 });
    p1.drawText("Chapter One Cover", { x: 20, y: 150, size: 16, font: "Helvetica-Bold" });
    const p2 = doc.addPage({ width: 300, height: 200 });
    p2.drawText("Chapter Two Named Target", { x: 20, y: 150, size: 12 });

    const catalog = doc.cos.resolveDict(doc.cos.rootRef)!;
    dictSet(
      catalog,
      "Names",
      doc.cos.allocateObject(
        cosDict({
          Dests: doc.cos.allocateObject(
            cosDict({
              Names: cosArray([
                cosString("dest-p2"),
                cosDict({ D: cosArray([p2.ref, cosName("Fit")]) }),
              ]),
            })
          ),
        })
      )
    );
    const bmRef = doc.cos.allocateObject(
      cosDict({
        Title: cosString("Go To Page Two"),
        Dest: cosString("dest-p2"),
      })
    );
    dictSet(catalog, "Outlines", doc.cos.allocateObject(cosDict({ First: bmRef, Last: bmRef })));

    const vfs = createMemoryFileSystem();
    await vfs.mkdir("/work", { recursive: true });
    await vfs.writeFile("/work/book.pdf", doc.save());

    const shell = new Shell({ fs: vfs })
      .use(pdfinfoCommands())
      .use(pdftoppmPlugin({ replace: true }))
      .use(pdftkPlugin({ replace: true }))
      .use(qpdfCommands())
      .use(pdftotextCommands());

    const res = await shell.exec(
      "pdftocairo -svg /work/book.pdf /work/cover.svg && " +
      "pdftocairo -pdf -f 2 -l 2 -W 180 -H 120 /work/book.pdf /work/p2.pdf && " +
      "pdftocairo -eps -f 1 -l 1 /work/book.pdf /work/p1.eps && " +
      "pdftk /work/book.pdf dump_data_utf8 && " +
      "pdftohtml -xml -stdout /work/book.pdf"
    );
    assert.equal(res.exitCode, 0);
    assert.ok(res.stdout.includes("BookmarkPageNumber: 2"));
    assert.ok(res.stdout.includes('<item page="2">Go To Page Two</item>'));
    assert.ok(res.stdout.includes("<b>Chapter One Cover</b>"));
    const epsBytes = await vfs.readFile("/work/p1.eps");
    assert.ok(new TextDecoder().decode(epsBytes).includes("%!PS-Adobe-3.0 EPSF-3.0"));
    const p2Doc = PdfDocument.load(await vfs.readFile("/work/p2.pdf"));
    assert.equal(p2Doc.getPage(0).getSize().width, 180);
  });

  it("executes multi-filter /DecodeParms in pdfimages -all -print-filenames, pdftocairo default output stem, pdftk PageLabelPrefix entities, and pdftohtml HTML bold/italic styling in VFS Shell", async () => {
    const doc = PdfDocument.create();
    const p1 = doc.addPage([200, 200]);
    p1.drawText("BoldHeading", { x: 20, y: 150, size: 16, font: "Helvetica-Bold" });
    p1.drawText("ItalicNote", { x: 20, y: 120, size: 12, font: "Helvetica-Oblique" });

    const jb2GlobalsRef = doc.cos.allocateObject(
      cosStream(Uint8Array.from([0x00, 0x00, 0x00, 0x01, 0x00]), { dict: cosDict({}) })
    );
    const jb2Ref = doc.cos.allocateObject(
      cosStream(new TextEncoder().encode("0000000230>"), {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(4),
          Height: cosNumber(4),
          BitsPerComponent: cosNumber(1),
          ColorSpace: cosName("DeviceGray"),
          Filter: cosArray([cosName("ASCIIHexDecode"), cosName("JBIG2Decode")]),
          DecodeParms: cosArray([{ kind: "null" }, cosDict({ JBIG2Globals: jb2GlobalsRef })]),
        }),
      })
    );
    const kJb2 = p1.ensureXObjectResource(jb2Ref);
    const prevStream = new TextDecoder().decode(p1.getRawContentStream());
    p1.setRawContentStream(`${prevStream}\nq 20 0 0 20 10 10 cm /${kJb2} Do Q`);

    const vfs = createMemoryFileSystem();
    await vfs.mkdir("/work", { recursive: true });
    await vfs.writeFile("/work/multi.pdf", doc.save());
    await vfs.writeFile(
      "/work/labels.txt",
      new TextEncoder().encode(
        [
          "PageLabelBegin",
          "PageLabelNewIndex: 1",
          "PageLabelStart: 1",
          "PageLabelPrefix: Sec&#231;-",
          "PageLabelNumStyle: DecimalArabicNumerals",
          "",
        ].join("\n")
      )
    );

    const shell = new Shell({ fs: vfs })
      .use(pdfinfoCommands())
      .use(pdfimagesPlugin({ replace: true }))
      .use(pdftoppmPlugin({ replace: true }))
      .use(pdftkPlugin({ replace: true }))
      .use(pdftotextCommands());

    const res = await shell.exec(
      "pdfimages -all -print-filenames /work/multi.pdf /work/ext && " +
      "pdftocairo -png -singlefile /work/multi.pdf && " +
      "pdftk /work/multi.pdf update_info /work/labels.txt output /work/labeled.pdf && " +
      "pdftk /work/labeled.pdf dump_data && " +
      "pdftohtml -stdout /work/multi.pdf"
    );
    assert.equal(res.exitCode, 0);
    assert.ok(res.stdout.includes("/work/ext-000.jb2e"));
    assert.ok(res.stdout.includes("/work/ext-000.jb2g"));
    assert.ok(res.stdout.includes("PageLabelPrefix: Sec&#231;-"));
    assert.ok(res.stdout.includes("<b>BoldHeading</b>"));
    assert.ok(res.stdout.includes("<i>ItalicNote</i>"));
    const defaultCairoPng = await vfs.readFile("/work/multi.png");
    assert.equal(defaultCairoPng[0], 0x89);
    assert.equal(defaultCairoPng[1], 0x50);
  });

  it("executes multi-select Choice AcroForm round-trip, pdfunite attachment/PageLabel merging, qpdf --json/--remove-attachment, and pdftk cat/burst uncompress in VFS Shell", async () => {
    const docChoice = PdfDocument.create();
    const pChoice = docChoice.addPage({ width: 300, height: 200 });
    const fieldRef = docChoice.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Widget"),
        FT: cosName("Ch"),
        Ff: cosNumber(1 << 21),
        T: cosString("skills"),
        Opt: cosArray([cosString("Rust"), cosString("TypeScript"), cosString("SQL")]),
        V: cosArray([cosString("Rust"), cosString("SQL")]),
        Rect: cosArray([cosNumber(20), cosNumber(50), cosNumber(200), cosNumber(100)]),
      })
    );
    dictSet(pChoice.dict, "Annots", cosArray([fieldRef]));
    const catChoice = docChoice.cos.resolveDict(docChoice.cos.rootRef)!;
    dictSet(catChoice, "AcroForm", docChoice.cos.allocateObject(cosDict({ Fields: cosArray([fieldRef]) })));

    const docPart2 = PdfDocument.create();
    docPart2.addPage({ width: 300, height: 200 }).drawText("Part Two Body", { x: 20, y: 100, size: 12 });
    const ef2 = docPart2.cos.allocateObject(cosStream(new TextEncoder().encode("attached-manifest-v1")));
    const fs2 = docPart2.cos.allocateObject(
      cosDict({
        Type: cosName("Filespec"),
        UF: cosString("manifest.txt"),
        EF: cosDict({ UF: ef2 }),
      })
    );
    const cat2 = docPart2.cos.resolveDict(docPart2.cos.rootRef)!;
    dictSet(cat2, "AF", cosArray([fs2]));
    dictSet(
      cat2,
      "PageLabels",
      docPart2.cos.allocateObject(
        cosDict({ Nums: cosArray([cosNumber(0), cosDict({ S: cosName("D"), St: cosNumber(5), P: cosString("P2-") })]) })
      )
    );

    const vfs = createMemoryFileSystem();
    await vfs.mkdir("/work", { recursive: true });
    await vfs.mkdir("/work/unpacked", { recursive: true });
    await vfs.writeFile("/work/choice.pdf", docChoice.save());
    await vfs.writeFile("/work/part2.pdf", docPart2.save());
    const shell = new Shell({ fs: vfs })
      .use(pdfinfoCommands())
      .use(pdfimagesPlugin({ replace: true }))
      .use(pdftoppmPlugin({ replace: true }))
      .use(pdftkPlugin({ replace: true }))
      .use(pdftotextCommands())
      .use(qpdfCommands());

    const fdfRes = await shell.exec("pdftk /work/choice.pdf generate_fdf output /work/exported.fdf");
    assert.equal(fdfRes.exitCode, 0);
    const exportedFdf = new TextDecoder().decode(await vfs.readFile("/work/exported.fdf"));
    assert.ok(exportedFdf.includes("/V [ (Rust) (SQL) ]"));

    const customFdf = "%FDF-1.2\n1 0 obj\n<< /FDF << /Fields [ << /T (skills) /V [ (TypeScript) (SQL) ] >> ] >> >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n";
    await vfs.writeFile("/work/new-choices.fdf", new TextEncoder().encode(customFdf));
    const fillRes = await shell.exec("pdftk /work/choice.pdf fill_form /work/new-choices.fdf output /work/filled-choice.pdf");
    assert.equal(fillRes.exitCode, 0);

    const dumpFields = await shell.exec("pdftk /work/filled-choice.pdf dump_data_fields_utf8");
    assert.equal(dumpFields.exitCode, 0);
    assert.ok(dumpFields.stdout.includes("FieldValue: TypeScript"));
    assert.ok(dumpFields.stdout.includes("FieldValue: SQL"));

    const uniteRes = await shell.exec("pdfunite /work/filled-choice.pdf /work/part2.pdf /work/united.pdf");
    assert.equal(uniteRes.exitCode, 0);

    const detachRes = await shell.exec("pdfdetach -list /work/united.pdf");
    assert.equal(detachRes.exitCode, 0);
    assert.ok(detachRes.stdout.includes("1: manifest.txt"));

    const qpdfJson = await shell.exec("qpdf /work/united.pdf --json");
    assert.equal(qpdfJson.exitCode, 0);
    const parsedJson = JSON.parse(qpdfJson.stdout);
    assert.equal(parsedJson.qpdf[0].attachments["manifest.txt"].filename, "manifest.txt");
    assert.equal(parsedJson.qpdf[0].pagelabels.length, 1);
    assert.equal(parsedJson.qpdf[0].pagelabels[0].index, 1);
    assert.equal(parsedJson.qpdf[0].pagelabels[0].prefix, "P2-");

    const catRes = await shell.exec("pdftk /work/united.pdf cat 1-2 output /work/catted.pdf");
    assert.equal(catRes.exitCode, 0);
    const unpackRes = await shell.exec("pdftk /work/catted.pdf unpack_files output /work/unpacked");
    assert.equal(unpackRes.exitCode, 0);
    assert.equal(new TextDecoder().decode(await vfs.readFile("/work/unpacked/manifest.txt")), "attached-manifest-v1");

    const burstRes = await shell.exec("pdftk /work/catted.pdf burst output /work/pg_%02d.pdf uncompress");
    assert.equal(burstRes.exitCode, 0);
    const burstPage2 = new TextDecoder("latin1").decode(await vfs.readFile("/work/pg_02.pdf"));
    assert.ok(burstPage2.includes("(Part Two Body)"));
  });

  it("executes pdftocairo -pdf -paper A4, pdftoppm -png -gray / -tiff -mono, pdfdetach -enc ASCII7 / -o <dir/>, and pdftk dump_data_annots /Next chains in VFS Shell", async () => {
    const doc = PdfDocument.create();
    doc.setTitle("VFS Suite Test 22");
    const p1 = doc.addPage({ width: 200, height: 200 });
    p1.drawRect({ x: 0, y: 0, width: 200, height: 200, fill: { r: 1, g: 0, b: 0 } });
    p1.drawText("Page 1 Content", { x: 20, y: 150, size: 12 });
    const p2 = doc.addPage({ width: 200, height: 200 });
    p2.drawText("Page 2 Destination", { x: 20, y: 150, size: 12 });

    const linkAnnot = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Link"),
        Rect: cosArray([cosNumber(20), cosNumber(140), cosNumber(120), cosNumber(165)]),
        A: cosDict({
          S: cosName("URI"),
          URI: cosString("https://example.org/step1"),
          Next: cosDict({
            S: cosName("GoTo"),
            D: cosArray([p2.ref, cosName("Fit")]),
          }),
        }),
      })
    );
    dictSet(p1.dict, "Annots", cosArray([linkAnnot]));

    const efStream = doc.cos.allocateObject(cosStream(new TextEncoder().encode("café-payload")));
    const fsSpec = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Filespec"),
        UF: cosString("caf\u00e9_\uFB01le.txt"),
        EF: cosDict({ UF: efStream }),
      })
    );
    dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "AF", cosArray([fsSpec]));

    const vfs = createMemoryFileSystem();
    await vfs.mkdir("/work", { recursive: true });
    await vfs.mkdir("/work/extracted", { recursive: true });
    await vfs.writeFile("/work/suite22.pdf", doc.save());
    const shell = new Shell({ fs: vfs })
      .use(pdfinfoCommands())
      .use(pdfimagesPlugin({ replace: true }))
      .use(pdftoppmPlugin({ replace: true }))
      .use(pdftkPlugin({ replace: true }))
      .use(pdftotextCommands())
      .use(qpdfCommands());

    const annotsRes = await shell.exec("pdftk /work/suite22.pdf dump_data_annots_utf8");
    assert.equal(annotsRes.exitCode, 0);
    assert.ok(annotsRes.stdout.includes("AnnotActionURI: https://example.org/step1"));
    assert.ok(annotsRes.stdout.includes("AnnotActionType: GoTo"));
    assert.ok(annotsRes.stdout.includes("AnnotActionPageNumber: 2"));

    const detachAscii = await shell.exec("pdfdetach -list -enc ASCII7 /work/suite22.pdf");
    assert.equal(detachAscii.exitCode, 0);
    assert.ok(detachAscii.stdout.includes("1: cafe_file.txt"));

    const detachSave = await shell.exec("pdfdetach -save 1 -o /work/extracted/ /work/suite22.pdf");
    assert.equal(detachSave.exitCode, 0);
    assert.equal(new TextDecoder().decode(await vfs.readFile("/work/extracted/caf\u00e9_\uFB01le.txt")), "café-payload");

    const cairoRes = await shell.exec("pdftocairo -pdf -paper A4 /work/suite22.pdf /work/a4.pdf");
    assert.equal(cairoRes.exitCode, 0);
    const a4Doc = PdfDocument.load(await vfs.readFile("/work/a4.pdf"));
    assert.equal(a4Doc.getPage(0).width, 595);
    assert.equal(a4Doc.getPage(0).height, 842);
    assert.equal(a4Doc.getMetadata().title, "VFS Suite Test 22");

    const ppmGray = await shell.exec("pdftoppm -png -gray -singlefile -f 1 -l 1 /work/suite22.pdf /work/gray");
    assert.equal(ppmGray.exitCode, 0);
    const decodedGray = decodePng(await vfs.readFile("/work/gray.png"));
    assert.equal(decodedGray.data[0], decodedGray.data[1]);
    assert.equal(decodedGray.data[1], decodedGray.data[2]);
    assert.equal(decodedGray.data[0], 76);
  });
});
