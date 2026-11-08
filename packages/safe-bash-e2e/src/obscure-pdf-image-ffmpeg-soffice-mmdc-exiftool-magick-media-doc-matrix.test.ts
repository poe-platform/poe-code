import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure PDF, image, ffmpeg, soffice, mmdc, exiftool & magick media/document matrix", () => {
  it("01: selects an interior page range with qpdf --pages . 2-3 -- and verifies with pdftotext", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        wkhtmltopdf - <<< "<html><body>Page One</body></html>" p1.pdf
        wkhtmltopdf - <<< "<html><body>Page Two</body></html>" p2.pdf
        wkhtmltopdf - <<< "<html><body>Page Three</body></html>" p3.pdf
        wkhtmltopdf - <<< "<html><body>Page Four</body></html>" p4.pdf
        pdfunite p1.pdf p2.pdf p3.pdf p4.pdf four.pdf
        qpdf four.pdf --pages . 2-3 -- middle.pdf
        qpdf --show-npages middle.pdf
        pdftotext -nopgbrk middle.pdf - | sed '/^[[:space:]]*$/d'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "2\nPage Two\nPage Three\n");
    });
  });

  it("02: encrypts a multi-page PDF with qpdf --encrypt and extracts a page after --decrypt", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        wkhtmltopdf - <<< "<html><body>Secret Alpha</body></html>" s1.pdf
        wkhtmltopdf - <<< "<html><body>Secret Beta</body></html>" s2.pdf
        pdfunite s1.pdf s2.pdf both.pdf
        qpdf --encrypt pass1 pass2 256 -- both.pdf locked.pdf
        qpdf --password=pass1 --decrypt locked.pdf unlocked.pdf
        pdfseparate -f 2 -l 2 unlocked.pdf only2-%d.pdf
        pdftotext -nopgbrk only2-2.pdf - | sed '/^[[:space:]]*$/d'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "Secret Beta\n");
    });
  });

  it("03: extracts all embedded PDF attachments to a directory via pdfdetach -saveall -o", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        printf 'config_v1=enabled\n' > cfg.ini
        wkhtmltopdf - <<< "<html><body>Doc with attachment</body></html>" host.pdf
        qpdf host.pdf --add-attachment cfg.ini --key=cfg --filename=cfg.ini -- attached.pdf
        mkdir -p saved_all
        pdfdetach -saveall -o saved_all attached.pdf
        cat saved_all/cfg.ini
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "config_v1=enabled\n");
    });
  });

  it("04: reverses PDF page order with pdftk cat 3 2 1 and extracts first and last pages", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        wkhtmltopdf - <<< "<html><body>FirstSlide</body></html>" s1.pdf
        wkhtmltopdf - <<< "<html><body>SecondSlide</body></html>" s2.pdf
        wkhtmltopdf - <<< "<html><body>ThirdSlide</body></html>" s3.pdf
        pdfunite s1.pdf s2.pdf s3.pdf deck.pdf
        pdftk deck.pdf cat 3 2 1 output rev.pdf
        pdftotext -f 1 -l 1 -nopgbrk rev.pdf - | sed '/^[[:space:]]*$/d'
        pdftotext -f 3 -l 3 -nopgbrk rev.pdf - | sed '/^[[:space:]]*$/d'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "ThirdSlide\nFirstSlide\n");
    });
  });

  it("05: converts PNG to resized JPEG with magick and verifies format and geometry via identify", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        magick -size 80x60 xc:#336699 base.png
        magick base.png -resize 40x30! out.jpg
        identify -format "%m %wx%h\n" base.png
        identify -format "%m %wx%h\n" out.jpg
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "PNG 80x60\nJPEG 40x30\n");
    });
  });

  it("06: rotates and negates an image using convert -rotate 90 -negate", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        convert -size 50x20 xc:#112233 rect.png
        convert rect.png -rotate 90 -negate rotated.png
        identify -format "%m %wx%h\n" rotated.png
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "PNG 20x50\n");
    });
  });

  it("07: resizes height and width explicitly with sips -z and queries dimensions via sips -1", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        magick -size 120x90 xc:#4488cc src.png
        sips -z 30 45 src.png --out resized.png >/dev/null
        sips -1 -g pixelWidth -g pixelHeight resized.png
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "resized.png|pixelWidth: 45|pixelHeight: 30|");
    });
  });

  it("08: queries multi-file image metadata in JSON mode with exiftool -j piped into jq", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        magick -size 24x24 xc:#aa0000 r.png
        magick -size 48x48 xc:#00aa00 g.png
        exiftool -overwrite_original -Artist="Ada" r.png >/dev/null
        exiftool -overwrite_original -Artist="Grace" g.png >/dev/null
        exiftool -j r.png g.png | jq -c 'map({file: .SourceFile, artist: .Artist, w: .ImageWidth})'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        '[{"file":"r.png","artist":"Ada","w":24},{"file":"g.png","artist":"Grace","w":48}]',
      );
    });
  });

  it("09: strips all custom image metadata tags using exiftool -overwrite_original -all=", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        magick -size 20x20 xc:#ffffff tag.png
        exiftool -overwrite_original -Artist="SecretAuthor" -Comment="InternalNote" tag.png >/dev/null
        exiftool -s3 -Artist tag.png
        exiftool -overwrite_original -all= tag.png >/dev/null
        after=$(exiftool -s3 -Artist tag.png)
        printf 'AFTER=[%s]\n' "$after"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "SecretAuthor\nAFTER=[]\n");
    });
  });

  it("10: compiles a Mermaid sequenceDiagram to SVG with mmdc and validates participants", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        cat << 'MMD' > seq.mmd
sequenceDiagram
  Client->>Server: SYN
  Server-->>Client: SYN-ACK
MMD
        mmdc -i seq.mmd -o seq.svg
        grep -Eo 'Client|Server|SYN-ACK' seq.svg | sort -u | paste -sd: -
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "Client:SYN-ACK:Server\n");
    });
  });

  it("11: rasterizes a Mermaid flowchart to PNG with custom dimensions (-w / -H) via mmdc", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        cat << 'MMD' > flow.mmd
graph TD
  A[Start] --> B[End]
MMD
        mmdc -i flow.mmd -o flow.png -w 320 -H 200
        identify -format "%m %wx%h\n" flow.png
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "PNG 320x200\n");
    });
  });

  it("12: transcodes synthetic video with ffmpeg -vf scale=80:60 and verifies dimensions via ffprobe", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        ffmpeg -f lavfi -i "testsrc=size=160x120:rate=20:duration=1" src.mp4 2>/dev/null
        ffmpeg -i src.mp4 -vf "scale=80:60" -r 10 scaled.mp4 2>/dev/null
        ffprobe -v quiet -print_format json -show_streams scaled.mp4 | jq -r '"\(.streams[0].width)x\(.streams[0].height)"'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "80x60\n");
    });
  });

  it("13: synthesizes mono 16kHz WAV audio with ffmpeg and inspects stream metadata via ffprobe", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        ffmpeg -f lavfi -i "sine=frequency=880:duration=2" -ar 16000 -ac 1 tone.wav 2>/dev/null
        ffprobe -v quiet -print_format json -show_streams -show_format tone.wav | jq -r '"\(.streams[0].codec_type)|\(.streams[0].sample_rate)|\(.streams[0].channels)"'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "audio|16000|1\n");
    });
  });

  it("14: converts HTML to PDF with soffice --headless --convert-to pdf and extracts text with pdftotext", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        printf '<html><body><h1>Quarterly Review</h1><p>Revenue grew 42 percent.</p></body></html>\n' > report.html
        soffice --headless --convert-to pdf report.html >/dev/null
        pdftotext -nopgbrk report.pdf - | sed '/^[[:space:]]*$/d'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "Quarterly Review\nRevenue grew 42 percent.\n");
    });
  });

  it("15: converts TXT to DOCX in an output directory (--outdir) and reads back via soffice --cat", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        mkdir -p out_docs
        printf 'Memo Line 1\nMemo Line 2\n' > memo.txt
        soffice --headless --convert-to docx --outdir out_docs memo.txt >/dev/null
        soffice --headless --cat out_docs/memo.docx
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "Memo Line 1\nMemo Line 2\n");
    });
  });

  it("16: sets PDF document title with wkhtmltopdf --title and queries via pdfinfo", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        wkhtmltopdf --title "Custom Spec Title" - <<< "<html><body>Spec Body</body></html>" titled_spec.pdf
        pdfinfo titled_spec.pdf | awk -F':[[:space:]]+' '/^(Title|Pages):/ { print $1 "=" $2 }'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "Title=Custom Spec Title\nPages=1\n");
    });
  });

  it("17: renders a multi-page PDF to numbered PNG files with pdftoppm -png and verifies with identify", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        wkhtmltopdf - <<< "<html><body>P1</body></html>" p1.pdf
        wkhtmltopdf - <<< "<html><body>P2</body></html>" p2.pdf
        pdfunite p1.pdf p2.pdf two.pdf
        pdftoppm -png -r 18 two.pdf pg
        ls pg-*.png | sort | wc -l | tr -d ' '
        identify -format "%m\n" pg-1.png
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "2\nPNG\n");
    });
  });

  it("18: converts RTF to plain text with unrtf --text and cleans up headers", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        printf '{\\rtf1\\ansi\\b Security Advisory\\b0 : Patch immediately.}' | unrtf --text | grep -v '^###' | sed '/^[[:space:]]*$/d'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "Security Advisory: Patch immediately.\n");
    });
  });

  it("19: converts HTML tables and links to Markdown via html-to-markdown and extracts headings", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        cat << 'HTML' | html-to-markdown | sed 's/^[*+-][[:space:]]\+/* /' | grep -E '^(# |\* )'
<h1>Release Notes</h1>
<ul>
  <li>Fast Rust backend</li>
  <li>Full TypeScript parity</li>
</ul>
HTML
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "# Release Notes\n* Fast Rust backend\n* Full TypeScript parity\n",
      );
    });
  });

  it("20: runs end-to-end media pipeline (mmdc -> magick -> identify -> exiftool)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        cat << 'MMD' > diag.mmd
graph LR
  Ingest --> Transform
  Transform --> Publish
MMD
        mmdc -i diag.mmd -o diag.png -w 200 -H 100
        magick diag.png -resize 100x50! thumb.png
        identify -format "%m %wx%h\n" thumb.png
        exiftool -overwrite_original -Artist="PipelineBot" thumb.png >/dev/null
        exiftool -s3 -Artist thumb.png
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "PNG 100x50\nPipelineBot\n");
    });
  });
});
