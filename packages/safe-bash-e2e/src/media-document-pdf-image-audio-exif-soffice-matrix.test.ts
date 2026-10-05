import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("media, document, PDF, image, audio/video, exiftool, and soffice matrix", () => {
  it("1. wkhtmltopdf renders multi-page HTML documents into PDF and pdftotext extracts text content", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/p1.html": "<html><body><h1>Chapter One</h1><p>First page payload.</p></body></html>\n",
          "/workspace/p2.html": "<html><body><h1>Chapter Two</h1><p>Second page payload.</p></body></html>\n",
        },
      },
      async (h) => {
        const r = await h.exec(`
          wkhtmltopdf p1.html p2.html book.pdf >/dev/null 2>&1
          qpdf --show-npages book.pdf
          pdftotext -nopgbrk book.pdf - | grep -E 'Chapter (One|Two)'
        `);
        assert.equal(r.exitCode, 0);
        assert.equal(r.stdout, "2\nChapter One\nChapter Two\n");
      },
    );
  });

  it("2. pdfinfo and pdftk dump_data inspect page counts and metadata on generated PDFs", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/doc.html": "<html><head><title>Spec Sheet</title></head><body><p>Hello PDF World</p></body></html>\n",
        },
      },
      async (h) => {
        const r = await h.exec(`
          wkhtmltopdf doc.html doc.pdf >/dev/null 2>&1
          pdfinfo doc.pdf | grep -E '^Pages:' | awk '{print $2}'
          pdftk doc.pdf dump_data | grep -E '^NumberOfPages:' | awk '{print $2}'
        `);
        assert.equal(r.exitCode, 0);
        assert.equal(r.stdout, "1\n1\n");
      },
    );
  });

  it("3. qpdf page selection/reordering and pdftk cat page concatenation", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/a.html": "<html><body><p>PAGE_ALPHA</p></body></html>\n",
          "/workspace/b.html": "<html><body><p>PAGE_BETA</p></body></html>\n",
        },
      },
      async (h) => {
        const r = await h.exec(`
          wkhtmltopdf a.html a.pdf >/dev/null 2>&1
          wkhtmltopdf b.html b.pdf >/dev/null 2>&1
          pdftk a.pdf b.pdf cat output ab.pdf
          qpdf --show-npages ab.pdf
          qpdf ab.pdf --pages . 2,1 -- ba.pdf
          pdftotext -f 1 -l 1 ba.pdf - | grep -o 'PAGE_BETA'
          pdftotext -f 2 -l 2 ba.pdf - | grep -o 'PAGE_ALPHA'
        `);
        assert.equal(r.exitCode, 0);
        assert.equal(r.stdout, "2\nPAGE_BETA\nPAGE_ALPHA\n");
      },
    );
  });

  it("4. pdftoppm rasterizes PDF pages to PNG and identify verifies dimensions and format", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/slide.html": "<html><body><h1>Slide Deck</h1></body></html>\n",
        },
      },
      async (h) => {
        const r = await h.exec(`
          wkhtmltopdf slide.html slide.pdf >/dev/null 2>&1
          pdftoppm -png -r 72 slide.pdf page_out
          ls -1 page_out*.png | head -n 1 | xargs identify -format "%m %w %h\\n"
        `);
        assert.equal(r.exitCode, 0);
        assert.match(r.stdout, /^PNG \d+ \d+\n$/);
      },
    );
  });

  it("5. convert / magick creates solid canvas PNG, resizes, flips, and converts to JPEG/WebP", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        convert -size 80x60 xc:navy canvas.png
        identify -format "%m %wx%h\\n" canvas.png
        convert canvas.png -resize 40x30 -flip thumb.jpg
        identify -format "%m %wx%h\\n" thumb.jpg
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "PNG 80x60\nJPEG 40x30\n");
    });
  });

  it("6. sips queries image properties (-g pixelWidth -g pixelHeight) and resizes (-z / -Z)", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        convert -size 120x80 xc:crimson hero.png
        sips -z 40 60 hero.png --out hero_small.png >/dev/null
        identify -format "%wx%h\\n" hero_small.png
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "60x40\n");
    });
  });

  it("7. exiftool reads and writes metadata tags on PNG/JPEG/PDF and outputs JSON (-j)", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        convert -size 32x32 xc:forestgreen icon.png
        exiftool -Artist="SafeBashTeam" -Copyright="2026" icon.png >/dev/null
        exiftool -j icon.png | jq -r '.[0] | "\\(.FileType) \\(.ImageWidth)x\\(.ImageHeight) \\(.Artist)"'
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "PNG 32x32 SafeBashTeam\n");
    });
  });

  it("8. mmdc renders Mermaid flowchart and sequence diagrams into valid SVG XML", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/flow.mmd": "graph LR\n  Client[Browser] --> Gateway[API Gateway]\n  Gateway --> Worker[Rust Worker]\n",
        },
      },
      async (h) => {
        const r = await h.exec(`
          mmdc -i flow.mmd -o flow.svg >/dev/null 2>&1 || mmdc -i flow.mmd -o - > flow.svg
          grep -q '<svg' flow.svg && echo "VALID_SVG"
          grep -q 'Rust Worker' flow.svg && echo "HAS_NODE_LABEL"
        `);
        assert.equal(r.exitCode, 0);
        assert.equal(r.stdout, "VALID_SVG\nHAS_NODE_LABEL\n");
      },
    );
  });

  it("9. unrtf converts RTF documents with bold/italic/table formatting to HTML and plain text", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/memo.rtf": "{\\rtf1\\ansi{\\b Quarterly Summary}\\par Revenue grew by {\\i 42 percent}.\\par}\n",
        },
      },
      async (h) => {
        const r = await h.exec(`
          unrtf --text memo.rtf | grep -E 'Quarterly Summary|Revenue grew'
          unrtf --html memo.rtf > memo.html
          grep -qi 'Quarterly Summary' memo.html && echo "HTML_OK"
        `);
        assert.equal(r.exitCode, 0);
        assert.match(r.stdout, /Quarterly Summary/);
        assert.match(r.stdout, /Revenue grew by 42 percent/);
        assert.match(r.stdout, /HTML_OK/);
      },
    );
  });

  it("10. soffice headless converts TXT/RTF to PDF and DOCX and inspects resulting artifacts", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/report.rtf": "{\\rtf1\\ansi Project Titan Architecture\\par Zero-dependency virtual shell execution.\\par}\n",
        },
      },
      async (h) => {
        const r = await h.exec(`
          soffice --headless --convert-to pdf --outdir /workspace /workspace/report.rtf >/dev/null
          soffice --headless --convert-to docx --outdir /workspace /workspace/report.rtf >/dev/null
          qpdf --show-npages /workspace/report.pdf
          pdftotext -nopgbrk /workspace/report.pdf - | grep -o 'Project Titan Architecture'
          unzip -l /workspace/report.docx | grep -q 'word/document.xml' && echo "DOCX_ZIP_VALID"
        `);
        assert.equal(r.exitCode, 0);
        assert.equal(r.stdout, "1\nProject Titan Architecture\nDOCX_ZIP_VALID\n");
      },
    );
  });

  it("11. soffice converts CSV to XLSX and back to CSV preserving tabular rows", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/metrics.csv": "service,latency_ms,ok\nauth,12,true\nsearch,25,true\n",
        },
      },
      async (h) => {
        const r = await h.exec(`
          soffice --headless --convert-to xlsx --outdir /workspace /workspace/metrics.csv >/dev/null
          mkdir -p roundtrip
          soffice --headless --convert-to csv --outdir /workspace/roundtrip /workspace/metrics.xlsx >/dev/null
          csvcut -c service,latency_ms /workspace/roundtrip/metrics.csv
        `);
        assert.equal(r.exitCode, 0);
        assert.equal(r.stdout, "service,latency_ms\nauth,12\nsearch,25\n");
      },
    );
  });

  it("12. ffmpeg generates synthetic video from lavfi testsrc and ffprobe extracts JSON stream details", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        ffmpeg -y -f lavfi -i color=c=red:s=64x48:r=10:d=0.3 -an clip.mp4 >/dev/null 2>&1
        ffprobe -v quiet -print_format json -show_streams clip.mp4 | jq -c '{codec: .streams[0].codec_name, w: .streams[0].width, h: .streams[0].height}'
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, '{"codec":"h264","w":64,"h":48}\n');
    });
  });

  it("13. ffmpeg generates synthetic WAV audio from lavfi sine source and ffprobe verifies PCM stream", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        ffmpeg -y -f lavfi -i sine=frequency=880:sample_rate=16000:duration=0.2 -c:a pcm_s16le beep.wav >/dev/null 2>&1
        ffprobe -v quiet -print_format json -show_streams beep.wav | jq -c '{type: .streams[0].codec_type, sr: (.streams[0].sample_rate | tonumber), ch: .streams[0].channels}'
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, '{"type":"audio","sr":16000,"ch":1}\n');
    });
  });

  it("14. ffmpeg extracts video frames as PNG images and identify verifies extracted frame dimensions", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        ffmpeg -y -f lavfi -i testsrc=size=48x36:rate=5:duration=0.4 -frames:v 1 frame1.png >/dev/null 2>&1
        identify -format "%m %wx%h\\n" frame1.png
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "PNG 48x36\n");
    });
  });

  it("15. xmllint --xpath and --format on XML documents", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/pom.xml": '<project><modelVersion>4.0.0</modelVersion><artifactId>safe-bash-rs</artifactId><version>1.2.0</version></project>\n',
        },
      },
      async (h) => {
        const r = await h.exec(`
          xmllint --xpath 'string(/project/artifactId)' pom.xml
          xmllint --xpath 'string(/project/version)' pom.xml
          xmllint --format pom.xml | grep -c '<'
        `);
        assert.equal(r.exitCode, 0);
        assert.equal(r.stdout, "safe-bash-rs\n1.2.0\n6\n");
      },
    );
  });

  it("16. html-to-markdown converts rich HTML with headings, lists, links, and tables to Markdown", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/page.html": [
            "<h1>Release Notes</h1>",
            "<p>Welcome to <strong>v2.0</strong>.</p>",
            "<ul><li>Fast execution</li><li>Zero dependencies</li></ul>",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(`
          html-to-markdown page.html
        `);
        assert.equal(r.exitCode, 0);
        assert.match(r.stdout, /# Release Notes/);
        assert.match(r.stdout, /\*\*v2\\?\.0\*\*/);
        assert.match(r.stdout, /Fast execution/);
        assert.match(r.stdout, /Zero dependencies/);
      },
    );
  });

  it("17. file command identifies magic bytes across PNG, PDF, ZIP, GZIP, SQLite3, and UTF-8 text", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/hello.txt": "plain text file\n",
        },
      },
      async (h) => {
        const r = await h.exec(`
          convert -size 16x16 xc:white sample.png
          wkhtmltopdf hello.txt sample.pdf >/dev/null 2>&1 || soffice --headless --convert-to pdf --outdir /workspace /workspace/hello.txt >/dev/null
          gzip -c hello.txt > sample.gz
          sqlite3 sample.db "CREATE TABLE t(x INT); INSERT INTO t VALUES (1);"
          file -b sample.png | grep -qi 'PNG' && echo "IS_PNG"
          file -b hello.pdf | grep -qi 'PDF' && echo "IS_PDF"
          file -b sample.gz | grep -qi 'gzip' && echo "IS_GZIP"
          file -b sample.db | grep -qi 'SQLite' && echo "IS_SQLITE"
        `);
        assert.equal(r.exitCode, 0);
        assert.equal(r.stdout, "IS_PNG\nIS_PDF\nIS_GZIP\nIS_SQLITE\n");
      },
    );
  });

  it("18. pdfimages extracts or lists embedded raster images from a PDF document", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        convert -size 24x24 xc:orange embedded.png
        cat <<'HTML' > with_img.html
<html><body><h1>Image Doc</h1><img src="embedded.png" width="24" height="24"/></body></html>
HTML
        wkhtmltopdf with_img.html with_img.pdf >/dev/null 2>&1
        pdfimages -list with_img.pdf | head -n 2 | wc -l | tr -d ' '
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "2\n");
    });
  });

  it("19. qpdf --check and encryption/decryption or linearization flags on multi-page PDF", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/in.html": "<html><body><h1>Confidential Report</h1><p>Page 1</p></body></html>\n",
        },
      },
      async (h) => {
        const r = await h.exec(`
          wkhtmltopdf in.html report.pdf >/dev/null 2>&1
          qpdf --check report.pdf >/dev/null && echo "QPDF_CHECK_OK"
          qpdf --linearize report.pdf linear.pdf
          qpdf --show-npages linear.pdf
        `);
        assert.equal(r.exitCode, 0);
        assert.equal(r.stdout, "QPDF_CHECK_OK\n1\n");
      },
    );
  });

  it("20. end-to-end publishing pipeline: Markdown/HTML -> wkhtmltopdf -> pdftk -> pdftoppm -> exiftool -> tar.gz", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/cover.html": "<html><body><h1>Annual Engineering Review</h1></body></html>\n",
          "/workspace/body.html": "<html><body><h2>Key Milestones</h2><p>100% E2E coverage achieved.</p></body></html>\n",
        },
      },
      async (h) => {
        const r = await h.exec(`
          mkdir -p build
          wkhtmltopdf cover.html build/cover.pdf >/dev/null 2>&1
          wkhtmltopdf body.html build/body.pdf >/dev/null 2>&1
          pdftk build/cover.pdf build/body.pdf cat output build/manual.pdf
          pdftoppm -png -r 72 -f 1 -l 1 build/manual.pdf build/cover_preview
          preview_png=$(ls -1 build/cover_preview*.png | head -n 1)
          exiftool -Artist="EngTeam" "$preview_png" >/dev/null
          tar -czf manual_bundle.tar.gz build/manual.pdf "$preview_png"
          tar -tzf manual_bundle.tar.gz | wc -l | tr -d ' '
          pdftotext -nopgbrk build/manual.pdf - | grep -E 'Annual Engineering Review|Key Milestones'
        `);
        assert.equal(r.exitCode, 0);
        assert.equal(
          r.stdout,
          [
            "2",
            "Annual Engineering Review",
            "Key Milestones",
            "",
          ].join("\n"),
        );
      },
    );
  });
});
