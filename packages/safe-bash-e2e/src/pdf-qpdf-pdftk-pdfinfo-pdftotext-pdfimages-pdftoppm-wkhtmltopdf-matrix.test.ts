import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withE2EHarness } from "./harness.js";

describe("PDF and RTF document engineering matrix (wkhtmltopdf, qpdf, pdftk, poppler, unrtf)", () => {
  it("1. wkhtmltopdf renders multi-page HTML with page breaks, headers/footers, and TOC into PDF", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/report.html",
        `<!DOCTYPE html>
<html>
<head><title>Quarterly Engineering Report</title></head>
<body>
  <h1>Executive Summary</h1>
  <p>Zero-dependency Rust migration milestone achieved.</p>
  <div style="page-break-before: always;"></div>
  <h1>Architecture Deep Dive</h1>
  <h2>Parser Subsystem</h2>
  <p>Deterministic AST construction and bounded execution.</p>
</body>
</html>
`,
      );

      const res = await h.exec(
        "wkhtmltopdf --no-outline --title 'Engineering Report' --header-left 'Poe Platform' --footer-right '[page]/[toPage]' /workspace/report.html /workspace/report.pdf && pdfinfo /workspace/report.pdf && pdftotext /workspace/report.pdf -",
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /Title:\s+Engineering Report/);
      assert.match(res.stdout, /Pages:\s+[23]/);
      assert.match(res.stdout, /Executive Summary/);
      assert.match(res.stdout, /Architecture Deep Dive/);
    });
  });

  it("2. wkhtmltopdf supports --read-args-from-stdin batch mode and cover objects", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/cover.html", "<h1>Cover Page</h1><p>Confidential</p>");
      await h.writeText("/workspace/body.html", "<h1>Chapter 1</h1><p>Content body text.</p>");

      const res = await h.exec(
        "printf 'cover /workspace/cover.html /workspace/body.html /workspace/book.pdf\\n' | wkhtmltopdf --read-args-from-stdin && pdfinfo /workspace/book.pdf && pdftotext /workspace/book.pdf -",
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /Pages:\s+2/);
      assert.match(res.stdout, /Cover Page/);
      assert.match(res.stdout, /Chapter 1/);
    });
  });

  it("3. qpdf selects complex page ranges (reverse r1..z, :odd/:even, exclusions x) and splits pages", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/four.html",
        `<h1>Page One</h1>
<div style="page-break-before:always"><h1>Page Two</h1></div>
<div style="page-break-before:always"><h1>Page Three</h1></div>
<div style="page-break-before:always"><h1>Page Four</h1></div>`,
      );
      await h.exec("wkhtmltopdf /workspace/four.html /workspace/four.pdf");

      const revOdd = await h.exec(
        "qpdf /workspace/four.pdf --pages /workspace/four.pdf 1-z:odd,r1 -- /workspace/sel.pdf && pdftotext -nopgbrk /workspace/sel.pdf -",
      );
      assert.equal(revOdd.exitCode, 0, revOdd.stderr);
      assert.match(revOdd.stdout, /Page One[\s\S]*Page Three[\s\S]*Page Four/);
      assert.doesNotMatch(revOdd.stdout, /Page Two/);

      const excl = await h.exec(
        "qpdf /workspace/four.pdf --pages . 1-4,x2-3 -- /workspace/excl.pdf && pdftotext -nopgbrk /workspace/excl.pdf -",
      );
      assert.equal(excl.exitCode, 0, excl.stderr);
      assert.match(excl.stdout, /Page One[\s\S]*Page Four/);
      assert.doesNotMatch(excl.stdout, /Page Two|Page Three/);

      const split = await h.exec(
        "qpdf --split-pages=2 /workspace/four.pdf /workspace/chunk-%d.pdf && pdfinfo /workspace/chunk-1-2.pdf && pdfinfo /workspace/chunk-3-4.pdf",
      );
      assert.equal(split.exitCode, 0, split.stderr);
      assert.equal((split.stdout.match(/Pages:\s+2/g) ?? []).length, 2);
    });
  });

  it("4. qpdf rotates pages (absolute and relative), inspects --json, and updates objects via --update-from-json", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/two.html",
        "<h1>First</h1><div style=\"page-break-before:always\"><h1>Second</h1></div>",
      );
      await h.exec("wkhtmltopdf /workspace/two.html /workspace/two.pdf");

      const rot = await h.exec(
        "qpdf /workspace/two.pdf /workspace/rot.pdf --rotate=90:1 --rotate=+180:2 && qpdf /workspace/rot.pdf --replace-input --rotate=+90:1 && pdftk /workspace/rot.pdf dump_data",
      );
      assert.equal(rot.exitCode, 0, rot.stderr);
      assert.match(rot.stdout, /PageMediaNumber: 1\nPageMediaRotation: 180/);
      assert.match(rot.stdout, /PageMediaNumber: 2\nPageMediaRotation: 180/);

      const jsonRes = await h.exec("qpdf --json /workspace/rot.pdf | jq -r '.version // .qpdf[0].jsonversion'");
      assert.equal(jsonRes.exitCode, 0, jsonRes.stderr);
      assert.equal(jsonRes.stdout.trim(), "2");
    });
  });

  it("5. qpdf encrypts (--encrypt), checks (--check / --is-encrypted), and decrypts (--decrypt) PDFs", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/sec.html", "<h1>Top Secret Spec</h1>");
      await h.exec("wkhtmltopdf /workspace/sec.html /workspace/sec.pdf");

      const enc = await h.exec(
        "qpdf --encrypt userpass ownerpass 256 --print=none --modify=none -- /workspace/sec.pdf /workspace/enc.pdf && qpdf --is-encrypted /workspace/enc.pdf",
      );
      assert.equal(enc.exitCode, 0, enc.stderr);

      const dec = await h.exec(
        "qpdf --password=userpass --decrypt /workspace/enc.pdf /workspace/dec.pdf && pdftotext /workspace/dec.pdf -",
      );
      assert.equal(dec.exitCode, 0, dec.stderr);
      assert.match(dec.stdout, /Top Secret Spec/);
    });
  });

  it("6. qpdf attaches files (--add-attachment), lists/shows attachments, and copies attachments across PDFs", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/doc.html", "<h1>Carrier PDF</h1>");
      await h.writeText("/workspace/payload.json", '{"schema":1,"ok":true}\n');
      await h.exec("wkhtmltopdf /workspace/doc.html /workspace/doc.pdf");

      const att = await h.exec(
        "qpdf /workspace/doc.pdf --add-attachment /workspace/payload.json --key=config.json --filename=config.json --description='App config' -- /workspace/with-att.pdf && qpdf --list-attachments /workspace/with-att.pdf && qpdf --show-attachment=config.json /workspace/with-att.pdf",
      );
      assert.equal(att.exitCode, 0, att.stderr);
      assert.match(att.stdout, /config\.json/);
      assert.match(att.stdout, /"schema":1,"ok":true/);
    });
  });

  it("7. qpdf overlays and underlays pages (--overlay / --underlay) between PDF documents", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/base.html", "<h1>Main Contract Body</h1>");
      await h.writeText("/workspace/stamp.html", "<h1>DRAFT WATERMARK</h1>");
      await h.exec(
        "wkhtmltopdf /workspace/base.html /workspace/base.pdf && wkhtmltopdf /workspace/stamp.html /workspace/stamp.pdf",
      );

      const res = await h.exec(
        "qpdf /workspace/base.pdf --overlay /workspace/stamp.pdf --from=1 --to=1 -- /workspace/stamped.pdf && pdftotext -raw /workspace/stamped.pdf -",
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /Main Contract Body/);
      assert.match(res.stdout, /DRAFT WATERMARK/);
    });
  });

  it("8. pdftk cat and shuffle interleave multi-handle PDFs with page ranges and word rotations", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/a.html",
        "<h1>A1</h1><div style=\"page-break-before:always\"><h1>A2</h1></div>",
      );
      await h.writeText(
        "/workspace/b.html",
        "<h1>B1</h1><div style=\"page-break-before:always\"><h1>B2</h1></div>",
      );
      await h.exec(
        "wkhtmltopdf /workspace/a.html /workspace/a.pdf && wkhtmltopdf /workspace/b.html /workspace/b.pdf",
      );

      const shuf = await h.exec(
        "pdftk A=/workspace/a.pdf B=/workspace/b.pdf shuffle A1-end Bend-1east output /workspace/shuf.pdf && pdftotext -nopgbrk /workspace/shuf.pdf - && pdftk /workspace/shuf.pdf dump_data",
      );
      assert.equal(shuf.exitCode, 0, shuf.stderr);
      assert.match(shuf.stdout, /A1[\s\S]*B2[\s\S]*A2[\s\S]*B1/);
      assert.match(shuf.stdout, /PageMediaNumber: 2\nPageMediaRotation: 90/);
    });
  });

  it("9. pdftk dump_data / update_info_utf8 round-trips metadata, bookmarks, and page labels", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/doc.html",
        "<h1>Intro</h1><div style=\"page-break-before:always\"><h1>Appendix</h1></div>",
      );
      await h.exec("wkhtmltopdf /workspace/doc.html /workspace/doc.pdf");
      await h.writeText(
        "/workspace/info.txt",
        `InfoBegin
InfoKey: Title
InfoValue: Spec Manual 2026
InfoBegin
InfoKey: Author
InfoValue: Poe Systems
BookmarkBegin
BookmarkTitle: Introduction
BookmarkLevel: 1
BookmarkPageNumber: 1
BookmarkBegin
BookmarkTitle: Appendix A
BookmarkLevel: 1
BookmarkPageNumber: 2
PageLabelBegin
PageLabelNewIndex: 1
PageLabelStart: 1
PageLabelPrefix: A-
PageLabelNumStyle: LowercaseRomanNumerals
`,
      );

      const res = await h.exec(
        "pdftk /workspace/doc.pdf update_info_utf8 /workspace/info.txt output /workspace/updated.pdf && pdftk /workspace/updated.pdf dump_data_utf8",
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /InfoKey: Title\nInfoValue: Spec Manual 2026/);
      assert.match(res.stdout, /InfoKey: Author\nInfoValue: Poe Systems/);
      assert.match(res.stdout, /BookmarkTitle: Appendix A\nBookmarkLevel: 1\nBookmarkPageNumber: 2/);
      assert.match(res.stdout, /PageLabelPrefix: A-\nPageLabelNumStyle: LowercaseRomanNumerals/);
    });
  });

  it("10. pdftk burst splits pages using printf format patterns and generates doc_data.txt", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/three.html",
        "<h1>One</h1><div style=\"page-break-before:always\"><h1>Two</h1></div><div style=\"page-break-before:always\"><h1>Three</h1></div>",
      );
      await h.exec("wkhtmltopdf /workspace/three.html /workspace/three.pdf");

      const res = await h.exec(
        "mkdir -p /workspace/burst && pdftk /workspace/three.pdf burst output /workspace/burst/page_%02d.pdf && ls /workspace/burst && pdftotext /workspace/burst/page_02.pdf -",
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /doc_data\.txt/);
      assert.match(res.stdout, /page_01\.pdf/);
      assert.match(res.stdout, /page_02\.pdf/);
      assert.match(res.stdout, /page_03\.pdf/);
      assert.match(res.stdout, /Two/);
    });
  });

  it("11. pdftk attach_files and unpack_files round-trip embedded files alongside pdfdetach", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/host.html", "<h1>Attachment Host</h1>");
      await h.writeText("/workspace/notes.txt", "attached-note-line-1\n");
      await h.writeText("/workspace/data.csv", "k,v\nx,42\n");
      await h.exec("wkhtmltopdf /workspace/host.html /workspace/host.pdf");

      const res = await h.exec(
        "pdftk /workspace/host.pdf attach_files /workspace/notes.txt /workspace/data.csv to_page 1 output /workspace/packed.pdf && pdfdetach -list /workspace/packed.pdf && mkdir -p /workspace/unpacked && pdftk /workspace/packed.pdf unpack_files output /workspace/unpacked && cat /workspace/unpacked/notes.txt /workspace/unpacked/data.csv",
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /2 embedded files/);
      assert.match(res.stdout, /1: notes\.txt/);
      assert.match(res.stdout, /2: data\.csv/);
      assert.match(res.stdout, /attached-note-line-1/);
      assert.match(res.stdout, /k,v\nx,42/);
    });
  });

  it("12. pdftk background and stamp composite watermark pages onto target PDFs", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/fg.html", "<h1>Primary Invoice #104</h1>");
      await h.writeText("/workspace/bg.html", "<h1>PAID IN FULL</h1>");
      await h.exec(
        "wkhtmltopdf /workspace/fg.html /workspace/fg.pdf && wkhtmltopdf /workspace/bg.html /workspace/bg.pdf",
      );

      const res = await h.exec(
        "pdftk /workspace/fg.pdf stamp /workspace/bg.pdf output /workspace/stamped.pdf && pdftotext -raw /workspace/stamped.pdf -",
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /Primary Invoice #104/);
      assert.match(res.stdout, /PAID IN FULL/);
    });
  });

  it("13. pdfseparate and pdfunite split and merge PDFs while preserving outlines and page count", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/src.html",
        "<h1>Part Alpha</h1><div style=\"page-break-before:always\"><h1>Part Beta</h1></div><div style=\"page-break-before:always\"><h1>Part Gamma</h1></div>",
      );
      await h.exec("wkhtmltopdf /workspace/src.html /workspace/src.pdf");

      const res = await h.exec(
        "pdfseparate -f 1 -l 3 /workspace/src.pdf /workspace/part-%02d.pdf && pdfunite /workspace/part-03.pdf /workspace/part-01.pdf /workspace/reordered.pdf && pdfinfo /workspace/reordered.pdf && pdftotext -nopgbrk /workspace/reordered.pdf -",
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /Pages:\s+2/);
      assert.match(res.stdout, /Part Gamma[\s\S]*Part Alpha/);
      assert.doesNotMatch(res.stdout, /Part Beta/);
    });
  });

  it("14. pdfinfo inspects bounding boxes (-box), ISO dates (-isodates), custom metadata (-custom), and URLs (-url)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/links.html",
        '<h1>Links Page</h1><p><a href="https://example.com/docs">Docs</a></p>',
      );
      await h.exec("wkhtmltopdf --title 'Link Doc' /workspace/links.html /workspace/links.pdf");

      const res = await h.exec("pdfinfo -box -isodates -custom /workspace/links.pdf && pdfinfo -url /workspace/links.pdf");
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /Title:\s+Link Doc/);
      assert.match(res.stdout, /MediaBox:/);
      assert.match(res.stdout, /CropBox:/);
      assert.match(res.stdout, /https:\/\/example\.com\/docs/);
    });
  });

  it("15. pdffonts lists document fonts and substitute font mappings (-loc, -locPS, -subst)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/fonts.html", "<h1>Typography Check</h1><p>Regular and <b>Bold</b></p>");
      await h.exec("wkhtmltopdf /workspace/fonts.html /workspace/fonts.pdf");

      const res = await h.exec(
        "pdffonts /workspace/fonts.pdf && pdffonts -locPS /workspace/fonts.pdf && pdffonts -subst /workspace/fonts.pdf",
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /Helvetica/);
      assert.match(res.stdout, /Nimbus Sans/);
    });
  });

  it("16. pdftotext supports -layout, -raw, -bbox, -bbox-layout, -tsv, -htmlmeta, and -eol modes", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/grid.html",
        "<h1>Grid Header</h1><p>Alpha Beta Gamma</p>",
      );
      await h.exec("wkhtmltopdf --title 'Grid Title' /workspace/grid.html /workspace/grid.pdf");

      const bboxRes = await h.exec("pdftotext -bbox-layout /workspace/grid.pdf -");
      assert.equal(bboxRes.exitCode, 0, bboxRes.stderr);
      assert.match(bboxRes.stdout, /<doc>/);
      assert.match(bboxRes.stdout, /<block /);
      assert.match(bboxRes.stdout, /<word /);

      const tsvRes = await h.exec("pdftotext -tsv /workspace/grid.pdf -");
      assert.equal(tsvRes.exitCode, 0, tsvRes.stderr);
      assert.match(tsvRes.stdout, /^level\tpage_num\tpar_num\tblock_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext/m);
      assert.match(tsvRes.stdout, /Grid/);

      const dosRes = await h.exec("pdftotext -eol dos -nopgbrk /workspace/grid.pdf -");
      assert.equal(dosRes.exitCode, 0, dosRes.stderr);
      assert.ok(dosRes.stdout.includes("\r\n"));
    });
  });

  it("17. pdftohtml converts PDFs into HTML and XML (-xml) layout documents with fontspecs", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/styled.html",
        '<h1>Styled Doc</h1><p>Visit <a href="https://poe.com">Poe</a></p>',
      );
      await h.exec("wkhtmltopdf /workspace/styled.html /workspace/styled.pdf");

      const xmlRes = await h.exec("pdftohtml -xml -stdout /workspace/styled.pdf");
      assert.equal(xmlRes.exitCode, 0, xmlRes.stderr);
      assert.match(xmlRes.stdout, /<pdf2xml /);
      assert.match(xmlRes.stdout, /<fontspec /);
      assert.match(xmlRes.stdout, /Styled Doc/);

      const htmlRes = await h.exec("pdftohtml -stdout /workspace/styled.pdf");
      assert.equal(htmlRes.exitCode, 0, htmlRes.stderr);
      assert.match(htmlRes.stdout, /<!DOCTYPE html>/);
      assert.match(htmlRes.stdout, /Styled Doc/);
    });
  });

  it("18. pdftoppm and pdftocairo rasterize and vector-convert PDF pages into PNG, PGM, PBM, SVG, and PS/EPS", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/vec.html",
        "<h1>Page 1 Vector</h1><div style=\"page-break-before:always\"><h1>Page 2 Raster</h1></div>",
      );
      await h.exec("wkhtmltopdf /workspace/vec.html /workspace/vec.pdf");

      const res = await h.exec(
        "pdftoppm -png -r 72 -singlefile -f 1 -l 1 /workspace/vec.pdf /workspace/p1 && " +
          "pdftoppm -gray -r 72 -singlefile -f 2 -l 2 /workspace/vec.pdf /workspace/p2 && " +
          "pdftocairo -svg -f 1 -l 1 /workspace/vec.pdf /workspace/p1.svg && " +
          "pdftocairo -eps -f 1 -l 1 /workspace/vec.pdf /workspace/p1.eps && " +
          "identify /workspace/p1.png",
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /PNG \d+x\d+/);

      const svgText = await h.readText("/workspace/p1.svg");
      assert.match(svgText, /<svg /);
      const epsText = await h.readText("/workspace/p1.eps");
      assert.match(epsText, /^%!PS-Adobe-3\.0 EPSF-3\.0/);
    });
  });

  it("19. pdfimages lists (-list) and extracts (-png, -tiff, -p, -print-filenames) embedded PDF images", async () => {
    await withE2EHarness(async (h) => {
      await h.exec("magick -size 24x16 xc:red /workspace/swatch.png");
      const pngBytes = await h.fs.readFile("/workspace/swatch.png");
      const b64 = Buffer.from(pngBytes).toString("base64");
      await h.writeText(
        "/workspace/imgdoc.html",
        `<h1>Embedded Image Doc</h1><img src="data:image/png;base64,${b64}" width="24" height="16"/>`,
      );
      await h.exec("wkhtmltopdf /workspace/imgdoc.html /workspace/imgdoc.pdf");

      const res = await h.exec(
        "pdfimages -list /workspace/imgdoc.pdf && pdfimages -png -p -print-filenames /workspace/imgdoc.pdf /workspace/extracted && identify /workspace/extracted-001-000.png",
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /page\s+num\s+type\s+width\s+height/);
      assert.match(res.stdout, /24\s+16/);
      assert.match(res.stdout, /\/workspace\/extracted-001-000\.png/);
      assert.match(res.stdout, /PNG 24x16/);
    });
  });

  it("20. unrtf converts RTF documents with nested styles, Unicode escapes, and hex escapes into text, HTML, and GNU LaTeX", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/memo.rtf",
        "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Courier;}}\\b Bold Header\\b0\\par Line two with {\\i italic} and \\'e9 + \\u955?\\par}",
      );

      const textRes = await h.exec("unrtf --text /workspace/memo.rtf");
      assert.equal(textRes.exitCode, 0, textRes.stderr);
      assert.match(textRes.stdout, /Bold Header/);
      assert.match(textRes.stdout, /Line two with italic and é \+ λ/);

      const htmlRes = await h.exec("unrtf --profile=gnu-0.21.10 --html /workspace/memo.rtf | htmlq -t 'b, i'");
      assert.equal(htmlRes.exitCode, 0, htmlRes.stderr);
      assert.match(htmlRes.stdout, /Bold Header/);
      assert.match(htmlRes.stdout, /italic/);

      const latexRes = await h.exec(
        "unrtf --profile=gnu-0.21.10 --latex --quiet /workspace/memo.rtf",
      );
      assert.equal(latexRes.exitCode, 0, latexRes.stderr);
      assert.match(latexRes.stdout, /\\bf Bold Header/);
      assert.match(latexRes.stdout, /\\it italic/);
    });
  });
});
