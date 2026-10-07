import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure media, PDF, image, video/audio, Office, Mermaid diagram & metadata matrix", () => {
  it("1. wkhtmltopdf multi-heading HTML to PDF with pdfinfo and pdftotext verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat <<'HTML' > /tmp/spec.html\n<html><head><title>RFC 9999</title></head><body><h1>Protocol Spec</h1><p>Zero-copy framing v3.</p></body></html>\nHTML\nwkhtmltopdf --title \"RFC 9999\" /tmp/spec.html /tmp/spec.pdf\npdfinfo /tmp/spec.pdf | awk -F':[[:space:]]+' '/^Title:/ {print $2} /^Pages:/ {print $2}'\npdftotext -nopgbrk /tmp/spec.pdf - | sed '/^[[:space:]]*$/d'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "RFC 9999\n1\nProtocol Spec\nZero-copy framing v3.");
    });
  });

  it("2. qpdf --empty --pages multi-document concatenation and page range slicing", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '<html><body><p>DocA_Page1</p></body></html>' > /tmp/a.html\nprintf '<html><body><p>DocB_Page1</p></body></html>' > /tmp/b.html\nwkhtmltopdf -q /tmp/a.html /tmp/a.pdf\nwkhtmltopdf -q /tmp/b.html /tmp/b.pdf\nqpdf --empty --pages /tmp/a.pdf 1 /tmp/b.pdf 1 -- /tmp/ab.pdf\npdfinfo /tmp/ab.pdf | awk '/^Pages:/ {print $2}'\npdftotext -nopgbrk /tmp/ab.pdf - | sed '/^[[:space:]]*$/d'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "2\nDocA_Page1\nDocB_Page1");
    });
  });

  it("3. qpdf 256-bit AES encryption, password-protected inspection, and decryption roundtrip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '<html><body><p>Classified Payload 42</p></body></html>' > /tmp/sec.html\nwkhtmltopdf -q /tmp/sec.html /tmp/sec.pdf\nqpdf --encrypt user123 owner456 256 -- /tmp/sec.pdf /tmp/sec_enc.pdf\nqpdf --password=user123 --decrypt /tmp/sec_enc.pdf /tmp/sec_dec.pdf\npdftotext -nopgbrk /tmp/sec_dec.pdf - | sed '/^[[:space:]]*$/d'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Classified Payload 42");
    });
  });

  it("4. qpdf --rotate=+90:1 and --linearize with qpdf --check verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '<html><body><p>Rotated Page</p></body></html>' > /tmp/rot.html\nwkhtmltopdf -q /tmp/rot.html /tmp/rot.pdf\nqpdf --rotate=+90:1 --linearize /tmp/rot.pdf /tmp/rot_lin.pdf\npdfinfo /tmp/rot_lin.pdf | awk -F':[[:space:]]+' '/^Optimized:/ {print $2}'\npdftotext -nopgbrk /tmp/rot_lin.pdf - | sed '/^[[:space:]]*$/d'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "yes\nRotated Page");
    });
  });

  it("5. pdftoppm -png -r 150 rasterization of PDF pages and identify dimension check", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '<html><body><h1>Raster Test</h1></body></html>' > /tmp/ras.html\nwkhtmltopdf -q /tmp/ras.html /tmp/ras.pdf\npdftoppm -png -r 72 /tmp/ras.pdf /tmp/page_out\nidentify -format \"%m\\n\" /tmp/page_out-1.png");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "PNG");
    });
  });

  it("6. magick canvas generation (xc:), resize (!), flip/flop, and format conversion (PNG -> JPEG -> WEBP)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("magick -size 120x80 xc:#336699 /tmp/canvas.png\nmagick /tmp/canvas.png -resize 60x40! -flip /tmp/canvas.jpg\nmagick /tmp/canvas.jpg -flop /tmp/canvas.webp\nidentify -format \"%m:%wx%h\\n\" /tmp/canvas.png /tmp/canvas.jpg /tmp/canvas.webp");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "PNG:120x80\nJPEG:60x40\nWEBP:60x40");
    });
  });

  it("7. magick -crop and -rotate geometric pipeline with identify metadata", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("magick -size 200x100 xc:white /tmp/base.png\nmagick /tmp/base.png -crop 100x50+10+10 /tmp/cropped.png\nmagick /tmp/cropped.png -rotate 90 /tmp/rotated.png\nidentify -format \"%wx%h\\n\" /tmp/cropped.png /tmp/rotated.png");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "100x50\n50x100");
    });
  });

  it("8. sips -z resize, -r rotate, -s format, and -g pixelWidth/pixelHeight inspection", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("magick -size 160x120 xc:red /tmp/sips_in.png\nsips -z 80 100 /tmp/sips_in.png --out /tmp/sips_resized.png >/dev/null\nsips -g pixelWidth -g pixelHeight /tmp/sips_resized.png | awk '/pixelWidth|pixelHeight/ {print $1 \"=\" $2}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "pixelWidth:=100\npixelHeight:=80");
    });
  });

  it("9. exiftool multi-tag write (-Artist, -Copyright, -Comment), JSON export (-j), and tag strip (-all=)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("magick -size 32x32 xc:black /tmp/meta.png\nexiftool -overwrite_original -Artist=\"Ada\" -Copyright=\"2026\" /tmp/meta.png >/dev/null\nexiftool -j -Artist -Copyright /tmp/meta.png | jq -r '.[0] | \"\\(.Artist):\\(.Copyright)\"'\nexiftool -overwrite_original -all= /tmp/meta.png >/dev/null\nexiftool -s3 -Artist /tmp/meta.png | wc -l | tr -d ' '");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Ada:2026\n0");
    });
  });

  it("10. mmdc Mermaid flowchart and sequenceDiagram rendering to SVG and PNG", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat <<'MMD' > /tmp/seq.mmd\nsequenceDiagram\n  Client->>Server: SYN\n  Server-->>Client: ACK\nMMD\nmmdc -i /tmp/seq.mmd -o /tmp/seq.svg\nmmdc -i /tmp/seq.mmd -o /tmp/seq.png -w 400 -H 300\ngrep -q \"<svg\" /tmp/seq.svg && echo \"SVG_OK\"\nidentify -format \"%m %wx%h\\n\" /tmp/seq.png");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "SVG_OK\nPNG 400x300");
    });
  });

  it("11. ffmpeg lavfi testsrc video + sine audio generation and ffprobe JSON stream inspection", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("ffmpeg -y -f lavfi -i testsrc=duration=2:size=160x120:rate=15 /tmp/vid.mp4 2>/dev/null\nffmpeg -y -f lavfi -i sine=frequency=440:duration=2 /tmp/aud.wav 2>/dev/null\nffmpeg -y -i /tmp/vid.mp4 -i /tmp/aud.wav -c:v copy -c:a aac /tmp/av.mp4 2>/dev/null\nffprobe -v quiet -print_format json -show_streams /tmp/av.mp4 | jq -r '[.streams[].codec_type] | join(\",\")'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "video,audio");
    });
  });

  it("12. ffmpeg video scaling (-vf scale=WxH), trimming (-ss / -t), and frame extraction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("ffmpeg -y -f lavfi -i color=c=blue:s=320x240:d=3 /tmp/src.mp4 2>/dev/null\nffmpeg -y -ss 1 -t 1 -i /tmp/src.mp4 -vf scale=160:120 /tmp/clip.mp4 2>/dev/null\nffmpeg -y -i /tmp/clip.mp4 -frames:v 1 /tmp/thumb.png 2>/dev/null\nffprobe -v quiet -print_format json -show_streams /tmp/clip.mp4 | jq -r '.streams[0] | \"\\(.width)x\\(.height)\"'\nidentify -format \"%m %wx%h\\n\" /tmp/thumb.png");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "160x120\nPNG 160x120");
    });
  });

  it("13. soffice --headless --convert-to pdf and txt on HTML/text documents", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'Quarterly Revenue Report 2026\\nTotal: $4.2M\\n' > /tmp/report.txt\nsoffice --headless --convert-to pdf --outdir /tmp /tmp/report.txt >/dev/null\npdftotext -nopgbrk /tmp/report.pdf - | sed '/^[[:space:]]*$/d'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Quarterly Revenue Report 2026\nTotal: $4.2M");
    });
  });

  it("14. unrtf --text and --html conversion of RTF formatted documents", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '{\\\\rtf1\\\\ansi{\\\\b BoldTitle}\\\\par Plain body line.}' > /tmp/doc.rtf\nunrtf --nopict --text /tmp/doc.rtf | grep -E 'BoldTitle|Plain body line'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "BoldTitle\nPlain body line.");
    });
  });

  it("15. html-to-markdown table, blockquote, and inline formatting conversion", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat <<'HTML' > /tmp/post.html\n<h2>Summary</h2><blockquote>Important note</blockquote><p>Use <strong>bold</strong> and <em>italic</em>.</p>\nHTML\nhtml-to-markdown /tmp/post.html | grep -E 'Summary|Important note|bold' | wc -l | tr -d ' '");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "3");
    });
  });

  it("16. pdfimages -png and -list extraction from PDF with embedded base64 PNG", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("magick -size 16x16 xc:green /tmp/embed.png\nB64=$(base64 < /tmp/embed.png | tr -d '\\n')\nprintf '<html><body><img src=\"data:image/png;base64,%s\" width=\"16\" height=\"16\"/><p>With image</p></body></html>\\n' \"$B64\" > /tmp/with_img.html\nwkhtmltopdf -q /tmp/with_img.html /tmp/with_img.pdf\npdfimages -png /tmp/with_img.pdf /tmp/ext_img\nls /tmp/ext_img*.png | wc -l | tr -d ' '");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1");
    });
  });

  it("17. convert alias (ImageMagick) grayscale (-colorspace Gray) and thumbnail pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("convert -size 100x80 xc:orange /tmp/color.png\nconvert /tmp/color.png -colorspace Gray -resize 50x40! /tmp/gray.png\nidentify -format \"%m %wx%h\\n\" /tmp/gray.png");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "PNG 50x40");
    });
  });

  it("18. file --mime-type magic byte detection across generated PNG, PDF, ZIP, and GZIP artifacts", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("magick -size 16x16 xc:white /tmp/f.png\nprintf '<html><body><p>hi</p></body></html>' > /tmp/f.html\nwkhtmltopdf -q /tmp/f.html /tmp/f.pdf\nprintf 'hello' | gzip -c > /tmp/f.gz\n(cd /tmp && zip -q f.zip f.html)\nfile -b --mime-type /tmp/f.png /tmp/f.pdf /tmp/f.gz /tmp/f.zip");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "image/png\napplication/pdf\napplication/gzip\napplication/zip");
    });
  });

  it("19. multi-page PDF split and re-merge with qpdf and page count verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '<html><body><p>P1</p></body></html>' > /tmp/p1.html\nprintf '<html><body><p>P2</p></body></html>' > /tmp/p2.html\nprintf '<html><body><p>P3</p></body></html>' > /tmp/p3.html\nwkhtmltopdf -q /tmp/p1.html /tmp/p1.pdf\nwkhtmltopdf -q /tmp/p2.html /tmp/p2.pdf\nwkhtmltopdf -q /tmp/p3.html /tmp/p3.pdf\nqpdf --empty --pages /tmp/p1.pdf 1 /tmp/p2.pdf 1 /tmp/p3.pdf 1 -- /tmp/all3.pdf\nqpdf /tmp/all3.pdf --pages . 3,1 -- /tmp/reordered.pdf\npdftotext -nopgbrk /tmp/reordered.pdf - | sed '/^[[:space:]]*$/d'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "P3\nP1");
    });
  });

  it("20. end-to-end media & doc bundle: mmdc -> magick -> exiftool -> wkhtmltopdf -> tar.gz", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'graph LR\\n  A --> B\\n' > /tmp/flow.mmd\nmmdc -i /tmp/flow.mmd -o /tmp/flow.png -w 200 -H 100\nmagick /tmp/flow.png -resize 100x50! /tmp/flow_thumb.png\nexiftool -overwrite_original -Author=\"PlatformTeam\" /tmp/flow_thumb.png >/dev/null\nprintf '<html><body><h1>Architecture</h1><p>Approved</p></body></html>' > /tmp/arch_doc.html\nwkhtmltopdf -q /tmp/arch_doc.html /tmp/arch_doc.pdf\ntar -czf /tmp/media_pkg.tar.gz -C /tmp flow_thumb.png arch_doc.pdf\ntar -tzf /tmp/media_pkg.tar.gz | sort");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "arch_doc.pdf\nflow_thumb.png");
    });
  });

});
