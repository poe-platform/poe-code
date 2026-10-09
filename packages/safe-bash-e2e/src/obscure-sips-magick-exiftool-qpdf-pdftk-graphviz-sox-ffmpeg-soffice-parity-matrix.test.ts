import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure sips, magick, exiftool, qpdf, pdftk, graphviz, sox, ffmpeg, and soffice parity matrix", () => {
  it("01. formats sips -g multi-property headers without trailing colons, supports -1/--oneLine, and lists --formats", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "magick -size 30x15 xc:#00ff00 /tmp/green.png",
          "sips -g pixelWidth -g pixelHeight -g format /tmp/green.png",
          "sips -1 -g pixelWidth -g pixelHeight -g format /tmp/green.png",
          "sips -z 10 20 /tmp/green.png --out /tmp/resized.png >/dev/null",
          "sips -g pixelWidth -g pixelHeight /tmp/resized.png",
          "sips --formats | grep -c 'public.png'",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "/tmp/green.png",
          "  pixelWidth: 30",
          "  pixelHeight: 15",
          "  format: png",
          "/tmp/green.png|pixelWidth: 30|pixelHeight: 15|format: png|",
          "/tmp/resized.png",
          "  pixelWidth: 20",
          "  pixelHeight: 10",
          "1",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("02. enforces sips Error 6 when combining -g with modification flags, validates -f flip direction, and checks missing/invalid args", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "magick -size 24x12 xc:red /tmp/a.png",
          "sips -g pixelWidth -z 10 10 /tmp/a.png 2>/tmp/err6.txt; rc6=$?",
          "sips -f diagonal /tmp/a.png 2>/tmp/errf.txt; rcf=$?",
          "sips -g 2>/tmp/errg.txt; rcg=$?",
          "sips -c 0 10 /tmp/a.png 2>/tmp/errc.txt; rcc=$?",
          "echo \"rc=$rc6,$rcf,$rcg,$rcc\"",
          "cat /tmp/err6.txt /tmp/errf.txt /tmp/errg.txt /tmp/errc.txt",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "rc=6,1,1,1",
          "Error 6: cannot get properties and modify file in the same invocation",
          "Try 'sips --help' for help using this tool",
          "sips: flip direction must be 'horizontal' or 'vertical'",
          "sips: missing argument for -g",
          "sips: invalid dimensions for -c",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("03. executes magick canvas synthesis, resize, flip/flop, mogrify in-place, composite overlay, and montage tiling", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "magick -size 40x30 xc:blue /tmp/m.png",
          "mogrify -resize 20x15! /tmp/m.png",
          "identify -format '%m %wx%h\\n' /tmp/m.png",
          "magick -size 10x10 xc:red /tmp/fg.png",
          "composite -gravity center /tmp/fg.png /tmp/m.png /tmp/comp.png",
          "identify -format '%m %wx%h\\n' /tmp/comp.png",
          "montage /tmp/fg.png /tmp/fg.png -tile 2x1 -geometry 10x10+0+0 /tmp/mont.png",
          "identify -format '%m %wx%h\\n' /tmp/mont.png",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "PNG 20x15\nPNG 20x15\nPNG 20x10\n");
    } finally {
      await h.dispose();
    }
  });

  it("04. reads, writes, formats as JSON (-j), extracts raw values (-s3), and strips (-all=) image tags via exiftool", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "magick -size 16x16 xc:blue /tmp/img.png",
          "exiftool -Artist='Ada' -Comment='TestComment' -overwrite_original /tmp/img.png >/dev/null",
          "exiftool -j -Artist -Comment -ImageWidth -ImageHeight /tmp/img.png | jq -c '.[0] | {Artist, Comment, ImageWidth, ImageHeight}'",
          "exiftool -s3 -Artist /tmp/img.png",
          "exiftool -all= -overwrite_original /tmp/img.png >/dev/null",
          "exiftool -s3 -Artist /tmp/img.png",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        '{"Artist":"Ada","Comment":"TestComment","ImageWidth":16,"ImageHeight":16}\nAda\n',
      );
    } finally {
      await h.dispose();
    }
  });

  it("05. merges and splits PDFs across wkhtmltopdf, pdfunite, qpdf --show-npages, pdfseparate, and pdftotext", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "printf '<p>PageOneAlpha</p>' > /tmp/1.html",
          "printf '<p>PageTwoBeta</p>' > /tmp/2.html",
          "wkhtmltopdf /tmp/1.html /tmp/1.pdf",
          "wkhtmltopdf /tmp/2.html /tmp/2.pdf",
          "pdfunite /tmp/1.pdf /tmp/2.pdf /tmp/merged.pdf",
          "qpdf --show-npages /tmp/merged.pdf",
          "pdfseparate /tmp/merged.pdf '/tmp/page-%d.pdf'",
          "pdftotext /tmp/page-1.pdf - | grep -o 'PageOneAlpha'",
          "pdftotext /tmp/page-2.pdf - | grep -o 'PageTwoBeta'",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "2\nPageOneAlpha\nPageTwoBeta\n");
    } finally {
      await h.dispose();
    }
  });

  it("06. reorders pages and rotates page orientation via qpdf --pages, --linearize, and --rotate verified by pdfinfo", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "printf '<p>FirstDoc</p>' > /tmp/p1.html",
          "printf '<p>SecondDoc</p>' > /tmp/p2.html",
          "wkhtmltopdf /tmp/p1.html /tmp/p1.pdf",
          "wkhtmltopdf /tmp/p2.html /tmp/p2.pdf",
          "pdfunite /tmp/p1.pdf /tmp/p2.pdf /tmp/u.pdf",
          "qpdf /tmp/u.pdf --pages /tmp/u.pdf 2,1 -- /tmp/rev.pdf",
          "qpdf --show-npages /tmp/rev.pdf",
          "qpdf /tmp/rev.pdf /tmp/rot.pdf --linearize --rotate=+90:1",
          "pdfinfo -f 1 -l 1 /tmp/rot.pdf | grep 'Page    1 rot:' | awk '{print $4}'",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "2\n90\n");
    } finally {
      await h.dispose();
    }
  });

  it("07. combines PDFs with pdftk cat, inspects dump_data, attaches files, and extracts them with pdfdetach", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "printf '<p>Alpha</p>' > /tmp/p1.html",
          "printf '<p>Beta</p>' > /tmp/p2.html",
          "wkhtmltopdf /tmp/p1.html /tmp/p1.pdf",
          "wkhtmltopdf /tmp/p2.html /tmp/p2.pdf",
          "pdftk A=/tmp/p1.pdf B=/tmp/p2.pdf cat A1 B1 output /tmp/comb.pdf",
          "pdftk /tmp/comb.pdf dump_data | grep NumberOfPages",
          "printf 'secret-attachment-payload' > /tmp/note.txt",
          "pdftk /tmp/comb.pdf attach_files /tmp/note.txt output /tmp/att.pdf",
          "pdfdetach -list /tmp/att.pdf",
          "mkdir -p /tmp/extracted && pdfdetach -saveall -o /tmp/extracted /tmp/att.pdf",
          "cat /tmp/extracted/note.txt; echo",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "NumberOfPages: 2\n1 embedded files\n1: note.txt\nsecret-attachment-payload\n",
      );
    } finally {
      await h.dispose();
    }
  });

  it("08. inspects PDF fonts via pdffonts and pdffonts -loc and converts PDF to HTML/XML via pdftohtml", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "printf '<p>HelloPopplerXML</p>' > /tmp/x.html",
          "wkhtmltopdf /tmp/x.html /tmp/x.pdf",
          "pdffonts /tmp/x.pdf | grep -c 'Helvetica'",
          "pdffonts -loc /tmp/x.pdf | grep -c 'Substitute'",
          "pdftohtml -stdout -xml /tmp/x.pdf | grep -o 'HelloPopplerXML'",
          "pdftohtml -stdout /tmp/x.pdf | grep -o 'HelloPopplerXML'",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "1\n1\nHelloPopplerXML\nHelloPopplerXML\n");
    } finally {
      await h.dispose();
    }
  });

  it("09. rasterizes PDF pages via pdftoppm -png and compares identical vs distinct PDFs via diffpdf", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "printf '<p>VisualA</p>' > /tmp/va.html",
          "printf '<p>VisualB</p>' > /tmp/vb.html",
          "wkhtmltopdf /tmp/va.html /tmp/va.pdf",
          "wkhtmltopdf /tmp/vb.html /tmp/vb.pdf",
          "pdftoppm -png /tmp/va.pdf /tmp/vpage",
          "identify -format '%m %wx%h\\n' /tmp/vpage-1.png",
          "diffpdf /tmp/va.pdf /tmp/va.pdf; same_rc=$?",
          "diffpdf /tmp/va.pdf /tmp/vb.pdf >/dev/null 2>&1; diff_rc=$?",
          "echo \"same=$same_rc diff=$diff_rc\"",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "PNG 1240x1754\nsame=0 diff=1\n");
    } finally {
      await h.dispose();
    }
  });

  it("10. renders Graphviz dot and neato graphs across SVG, JSON, plain, canon, and PNG formats", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "printf 'digraph G { rankdir=LR; A -> B [label=\"edge\"]; }\\n' > /tmp/g.dot",
          "dot -Tsvg /tmp/g.dot | grep -c '<svg'",
          "dot -Tjson /tmp/g.dot | jq -r '.nodes | length'",
          "dot -Tplain /tmp/g.dot | head -n 1 | awk '{print $1}'",
          "neato -Tpng /tmp/g.dot -o /tmp/g.png",
          "identify -format '%m\\n' /tmp/g.png",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "1\n2\ngraph\nPNG\n");
    } finally {
      await h.dispose();
    }
  });

  it("11. optimizes SVG via svgo and rasterizes to custom dimensions via rsvg-convert", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "printf '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"50\" height=\"25\"><!-- strip_me --><rect width=\"50\" height=\"25\" fill=\"red\"/></svg>' > /tmp/in.svg",
          "svgo /tmp/in.svg -o /tmp/min.svg >/dev/null",
          "grep -c 'strip_me' /tmp/min.svg || true",
          "rsvg-convert -f png -o /tmp/rsvg.png /tmp/min.svg",
          "sips -g pixelWidth -g pixelHeight /tmp/rsvg.png",
          "rsvg-convert -w 10 /tmp/min.svg 2>/tmp/rsvg.err; echo \"err_rc=$? $(cat /tmp/rsvg.err)\"",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "0\n/tmp/rsvg.png\n  pixelWidth: 50\n  pixelHeight: 25\nerr_rc=1 rsvg-convert: unsupported option -w\n",
      );
    } finally {
      await h.dispose();
    }
  });

  it("12. encodes QR codes with qrencode across PNG, SVG, UTF8, and ASCII output modes", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "qrencode -t PNG -o /tmp/qr.png 'https://example.com'",
          "identify -format '%m\\n' /tmp/qr.png",
          "qrencode -t SVG -o - 'hello' | grep -c '<svg'",
          "qrencode -t UTF8 -o - 'hi' | wc -l | tr -d ' '",
          "qrencode -t ASCII -o - 'hi' | grep -c '#'",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      const lines = r.stdout.trim().split("\n");
      assert.equal(lines[0], "PNG");
      assert.equal(lines[1], "1");
      assert.equal(lines[2], "15");
      assert.ok(Number(lines[3]) > 0);
    } finally {
      await h.dispose();
    }
  });

  it("13. synthesizes, concatenates, resamples, and reverses WAV audio with sox and inspects headers with soxi", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "sox -n -r 8000 -c 1 -b 16 /tmp/t1.wav synth 0.25 sine 440",
          "sox -n -r 8000 -c 1 -b 16 /tmp/t2.wav synth 0.25 sine 880",
          "sox /tmp/t1.wav /tmp/t2.wav /tmp/joined.wav",
          "soxi -r /tmp/joined.wav",
          "soxi -c /tmp/joined.wav",
          "soxi -s /tmp/joined.wav",
          "sox /tmp/joined.wav -r 16000 /tmp/resamp.wav reverse",
          "soxi -r /tmp/resamp.wav",
          "soxi -s /tmp/resamp.wav",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "8000\n1\n4000\n16000\n8000\n");
    } finally {
      await h.dispose();
    }
  });

  it("14. generates synthetic audio/video streams with ffmpeg lavfi and inspects streams/format via ffprobe JSON", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "ffmpeg -y -f lavfi -i testsrc=duration=1:size=32x24:rate=10 -f lavfi -i sine=frequency=440:sample_rate=8000:duration=1 /tmp/av.mp4 2>/dev/null",
          "ffprobe -v quiet -print_format json -show_format -show_streams /tmp/av.mp4 | jq -c '{streams: (.streams | length), width: .streams[0].width, height: .streams[0].height}'",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, '{"streams":2,"width":32,"height":24}\n');
    } finally {
      await h.dispose();
    }
  });

  it("15. converts spreadsheets and documents via soffice --headless --convert-to html and pdf", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "printf 'col1,col2\\nval1,val2\\n' > /tmp/sheet.csv",
          "soffice --headless --convert-to html --outdir /tmp /tmp/sheet.csv >/dev/null",
          "grep -o 'val1' /tmp/sheet.html",
          "printf 'HelloOfficeDoc\\n' > /tmp/doc.txt",
          "soffice --headless --convert-to pdf --outdir /tmp /tmp/doc.txt >/dev/null",
          "pdftotext /tmp/doc.pdf - | grep -o 'HelloOfficeDoc'",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "val1\nHelloOfficeDoc\n");
    } finally {
      await h.dispose();
    }
  });

  it("16. compiles Mermaid diagrams via mmdc into SVG and PNG artifacts", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "printf 'graph TD\\n  Start --> Stop\\n' > /tmp/m.mmd",
          "mmdc -i /tmp/m.mmd -o /tmp/m.svg",
          "grep -c '<svg' /tmp/m.svg",
          "mmdc -i /tmp/m.mmd -o /tmp/m.png",
          "identify -format '%m\\n' /tmp/m.png",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "1\nPNG\n");
    } finally {
      await h.dispose();
    }
  });

  it("17. evaluates formulas and multi-sheet workbooks via ssconvert --recalc, --merge-to, in2csv -n, and ssconvert -S", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "printf 'item,q1,q2,sum\\ncore,10,25,=B2+C2\\nedge,30,15,=B3+C3\\ntotal,=SUM(B2:B3),=SUM(C2:C3),=MAX(D2:D3)\\n' > /tmp/f.csv",
          "ssconvert --recalc /tmp/f.csv /tmp/f.xlsx 2>/dev/null",
          "ssconvert -T Gnumeric_stf:stf_assistant -O 'separator=|' /tmp/f.xlsx /tmp/f.txt 2>/dev/null",
          "cat /tmp/f.txt",
          "printf 'k,v\\n1,a\\n' > /tmp/s1.csv",
          "printf 'k,v\\n2,b\\n' > /tmp/s2.csv",
          "ssconvert --merge-to=/tmp/m.xlsx /tmp/s1.csv /tmp/s2.csv 2>/dev/null",
          "in2csv -n /tmp/m.xlsx | wc -l | tr -d ' '",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "item|q1|q2|sum",
          "core|10|25|35",
          "edge|30|15|45",
          "total|40|40|45",
          "2",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("18. converts documents across Markdown, HTML, LaTeX, JSON AST, and RTF via pandoc and html-to-markdown", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "printf '# Spec\\n\\nUse **bold** and *italic*.\\n' > /tmp/doc.md",
          "pandoc -f markdown -t html /tmp/doc.md | tr -d '\\n'; echo",
          "pandoc -f markdown -t latex /tmp/doc.md | grep -F '\\textbf{bold}'",
          "pandoc -f markdown -t json /tmp/doc.md | jq -r '.blocks[0].t'",
          "printf '<h2>Title</h2><p>Visit <a href=\"https://example.com\">Docs</a></p>' | html-to-markdown",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          '<h1 id="spec">Spec</h1><p>Use <strong>bold</strong> and <em>italic</em>.</p>',
          "Use \\textbf{bold} and \\emph{italic}.",
          "Header",
          "## Title",
          "",
          "Visit [Docs](<https://example.com>)",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("19. decodes RTF tables, codepages, Unicode surrogates, and deterministic error codes via unrtf", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "cat <<'EOF' | unrtf --text",
          "{\\rtf1\\ansi\\trowd K\\cell V\\cell\\row}",
          "EOF",
          "cat <<'EOF' | unrtf --text",
          "{\\rtf1\\ansicpg1251 \\'c0\\'ff}",
          "EOF",
          "echo",
          "printf 'invalid' | unrtf >/dev/null 2>/tmp/p.err; rcp=$?",
          "echo \"rcp=$rcp $(grep -o 'E_[A-Z]*' /tmp/p.err)\"",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "K\tV\t\nАя\nrcp=1 E_PARSE\n");
    } finally {
      await h.dispose();
    }
  });

  it("20. executes an end-to-end Graphviz -> svgo -> rsvg-convert -> sips -> exiftool -> jq -> sqlite3 asset pipeline", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "printf 'digraph Arch { API -> DB; }\\n' | dot -Tsvg > /tmp/arch.svg",
          "svgo /tmp/arch.svg -o /tmp/arch.min.svg >/dev/null",
          "rsvg-convert -f png -o /tmp/arch.png /tmp/arch.min.svg",
          "sips -z 30 60 /tmp/arch.png --out /tmp/arch_thumb.png >/dev/null",
          "exiftool -Artist='PipelineBot' -overwrite_original /tmp/arch_thumb.png >/dev/null",
          "META=$(exiftool -j -Artist -ImageWidth -ImageHeight /tmp/arch_thumb.png | jq -r '.[0] | \"\\(.Artist)|\\(.ImageWidth)|\\(.ImageHeight)\"')",
          "IFS='|' read -r artist w h <<< \"$META\"",
          "sqlite3 /tmp/assets.db 'CREATE TABLE assets(artist TEXT, w INT, h INT);'",
          "sqlite3 /tmp/assets.db \"INSERT INTO assets VALUES ('$artist', $w, $h);\"",
          "sqlite3 /tmp/assets.db 'SELECT artist, w, h, w * h FROM assets;'",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "PipelineBot|60|30|1800\n");
    } finally {
      await h.dispose();
    }
  });
});
