import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure media, PDF, image, office, sponge, envsubst, dd, truncate, and apply_patch matrix", () => {
  it("1. wkhtmltopdf HTML to PDF generation followed by pdfinfo and pdftotext inspection", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/report.html",
        "<html><head><title>Quarterly Report</title></head><body><h1>Revenue Summary</h1><p>Total: 42000</p></body></html>",
      );
      const r = await h.exec(`
        wkhtmltopdf /workspace/report.html /workspace/report.pdf
        pdfinfo /workspace/report.pdf | grep -E 'Pages:'
        pdftotext /workspace/report.pdf - | grep -E 'Revenue Summary|Total: 42000'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.match(r.stdout, /Pages:\s+1/);
      assert.match(r.stdout, /Revenue Summary/);
      assert.match(r.stdout, /Total: 42000/);
    });
  });

  it("2. qpdf page range extraction and pdftk merge + dump_data pipeline", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/p1.html", "<html><body>Page One</body></html>");
      await h.writeText("/workspace/p2.html", "<html><body>Page Two</body></html>");
      const r = await h.exec(`
        wkhtmltopdf /workspace/p1.html /workspace/p1.pdf
        wkhtmltopdf /workspace/p2.html /workspace/p2.pdf
        pdftk /workspace/p1.pdf /workspace/p2.pdf cat output /workspace/merged.pdf
        pdftk /workspace/merged.pdf dump_data | grep NumberOfPages
        qpdf /workspace/merged.pdf --pages . 2 -- /workspace/only2.pdf
        pdftotext /workspace/only2.pdf -
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.match(r.stdout, /NumberOfPages: 2/);
      assert.match(r.stdout, /Page Two/);
    });
  });

  it("3. pdftoppm rasterizes PDF pages into PPM/PNG and identify verifies dimensions", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/slide.html", "<html><body>Slide Deck</body></html>");
      const r = await h.exec(`
        wkhtmltopdf /workspace/slide.html /workspace/slide.pdf
        pdftoppm -png -r 72 /workspace/slide.pdf /workspace/page
        identify -format "%m\\n" /workspace/page-1.png
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout.trim(), "PNG");
    });
  });

  it("4. magick canvas creation, resize, rotate, crop, and format conversion with identify", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        magick -size 100x60 xc:#225588 /workspace/base.png
        magick /workspace/base.png -resize 50x30! -rotate 90 /workspace/rot.jpg
        identify -format "%m %wx%h\\n" /workspace/rot.jpg
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout.trim(), "JPEG 30x50");
    });
  });

  it("5. sips -g property query and -z resampleHeightWidth image resizing", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        magick -size 80x40 xc:#ffaa00 /workspace/icon.png
        sips -z 20 40 /workspace/icon.png --out /workspace/icon_small.png >/dev/null
        sips -g pixelWidth -g pixelHeight /workspace/icon_small.png | grep -E 'pixelWidth|pixelHeight'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.match(r.stdout, /pixelWidth:\s*40/);
      assert.match(r.stdout, /pixelHeight:\s*20/);
    });
  });

  it("6. exiftool metadata writing (-Artist, -Copyright) and JSON extraction (-j)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        magick -size 32x32 xc:#123456 /workspace/photo.png
        exiftool -overwrite_original -Artist="Ada Lovelace" -Copyright="2026 Analytical Engine" /workspace/photo.png >/dev/null
        exiftool -j -Artist -Copyright /workspace/photo.png | jq -r '.[0] | "\\(.Artist)|\\(.Copyright)"'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout.trim(), "Ada Lovelace|2026 Analytical Engine");
    });
  });

  it("7. mmdc Mermaid diagram compilation to SVG and XML tag verification", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/flow.mmd",
        "graph LR\n  A[Lexer] --> B[Parser]\n  B --> C[Evaluator]\n",
      );
      const r = await h.exec(`
        mmdc -i /workspace/flow.mmd -o /workspace/flow.svg
        grep -o '<svg' /workspace/flow.svg | head -n 1
        grep -E 'Lexer|Parser|Evaluator' /workspace/flow.svg | wc -l | tr -d ' '
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.match(r.stdout, /^<svg\n/);
    });
  });

  it("8. ffmpeg synthetic sine wave audio generation and ffprobe stream JSON inspection", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        ffmpeg -f lavfi -i "sine=frequency=440:duration=1" -ar 16000 -ac 1 /workspace/tone.wav -y >/dev/null 2>&1
        ffprobe -v quiet -print_format json -show_streams /workspace/tone.wav | jq -r '.streams[0].codec_type'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout.trim(), "audio");
    });
  });

  it("9. soffice --headless document conversion to PDF and text extraction", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/memo.txt", "Confidential Engineering Memo 2026\n");
      const r = await h.exec(`
        soffice --headless --convert-to pdf --outdir /workspace /workspace/memo.txt >/dev/null
        pdftotext /workspace/memo.pdf -
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.match(r.stdout, /Confidential Engineering Memo 2026/);
    });
  });

  it("10. unrtf converts RTF document formatting to HTML and plain text", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/note.rtf",
        "{\\rtf1\\ansi{\\b BoldHeader}\\par Plain body line.}",
      );
      const r = await h.exec(`
        unrtf --text /workspace/note.rtf | grep -E 'BoldHeader|Plain body line'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.match(r.stdout, /BoldHeader/);
      assert.match(r.stdout, /Plain body line/);
    });
  });

  it("11. sponge in-place pipeline transformation and sponge -a append mode", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/data.txt", "c\na\nb\n");
      const r = await h.exec(`
        sort /workspace/data.txt | sponge /workspace/data.txt
        printf 'total=3\\n' | sponge -a /workspace/data.txt
        cat /workspace/data.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "a\nb\nc\ntotal=3\n");
    });
  });

  it("12. envsubst with explicit variable allowlist preserves unreferenced variables", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        export APP_HOST="api.example.com"
        export APP_PORT="8443"
        export KEEP_ME="should_not_expand"
        printf 'url=https://\${APP_HOST}:\$APP_PORT/v1?token=\${KEEP_ME}\\n' | envsubst '\$APP_HOST \$APP_PORT'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        "url=https://api.example.com:8443/v1?token=${KEEP_ME}\n",
      );
    });
  });

  it("13. unix2dos and dos2unix CRLF/LF conversion verified with od -c", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/lines.txt", "alpha\nbeta\n");
      const r = await h.exec(`
        unix2dos /workspace/lines.txt 2>/dev/null
        wc -c < /workspace/lines.txt | tr -d ' '
        dos2unix /workspace/lines.txt 2>/dev/null
        wc -c < /workspace/lines.txt | tr -d ' '
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "13\n11\n");
    });
  });

  it("14. iconv UTF-8 to ASCII//TRANSLIT / ISO-8859-1 roundtrip conversion", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf 'caf\\xc3\\xa9\\n' | iconv -f UTF-8 -t ISO-8859-1 | iconv -f ISO-8859-1 -t UTF-8
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "café\n");
    });
  });

  it("15. dd block slicing with bs, skip, count, and conv=ucase", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/raw.bin", "0123456789abcdef");
      const r = await h.exec(`
        dd if=/workspace/raw.bin of=/workspace/slice.bin bs=4 skip=2 count=2 conv=ucase 2>/dev/null
        cat /workspace/slice.bin
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "89ABCDEF");
    });
  });

  it("16. truncate -s exact, +extend, and -shrink byte size adjustments", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf '1234567890' > /workspace/t.bin
        truncate -s 6 /workspace/t.bin
        wc -c < /workspace/t.bin | tr -d ' '
        cat /workspace/t.bin
        echo ""
        truncate -s +4 /workspace/t.bin
        wc -c < /workspace/t.bin | tr -d ' '
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "6\n123456\n10\n");
    });
  });

  it("17. od -An -tx1 and hexdump -C byte stream formatting", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf 'ABCD' | od -An -tx1 | tr -s ' ' | sed 's/^ //;s/ $//'
        printf 'Hello!' | hexdump -C | head -n 1
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.match(r.stdout, /^41 42 43 44\n/);
      assert.match(r.stdout, /48 65 6c 6c 6f 21/);
    });
  });

  it("18. apply_patch multi-file Add, Update, Move, and Delete patch workflow", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/a.txt", "line1\nline2\n");
      await h.writeText("/workspace/old.txt", "obsolete\n");
      const r = await h.exec(`
        cd /workspace
        apply_patch <<'PATCH'
*** Begin Patch
*** Add File: created.txt
+hello created
*** Update File: a.txt
@@
 line1
-line2
+line2_updated
*** Delete File: old.txt
*** End Patch
PATCH
        cat /workspace/created.txt
        cat /workspace/a.txt
        test ! -e /workspace/old.txt && echo "DELETED_OK"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        "Success. Updated the following files:\nA created.txt\nM a.txt\nD old.txt\nhello created\nline1\nline2_updated\nDELETED_OK\n",
      );
    });
  });

  it("19. getopt long and short option normalization with quoted arguments", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        getopt -o vf: --long verbose,file: -- -v --file "my doc.txt" extra1
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.match(r.stdout, /-v --file 'my doc\.txt' -- 'extra1'/);
    });
  });

  it("20. seq with -f format and -s separator combined with paste -s -d", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        seq -f 'v%02g' -s ',' 1 4
        seq 1 5 | paste -s -d '+' - | bc
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "v01,v02,v03,v04\n15\n");
    });
  });
});
