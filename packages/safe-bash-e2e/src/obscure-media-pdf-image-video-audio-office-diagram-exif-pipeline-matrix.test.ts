import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure media pdf image video audio office diagram exif pipeline matrix", () => {
  it("01 wkhtmltopdf pdfinfo and pdftotext", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '<h1>Invoice #401</h1><p>Total: $950</p>\\n' > inv.html\nwkhtmltopdf -q inv.html inv.pdf\npdfinfo inv.pdf | grep -E '^Pages:' | awk '{print $1, $2}'\npdftotext inv.pdf - | grep -o 'Invoice #401'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Pages: 1\nInvoice #401");
    });
  });

  it("02 qpdf encrypt and decrypt stdin stdout pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '<h1>Secret Plan</h1>\\n' > sec.html\nwkhtmltopdf -q sec.html sec.pdf\nqpdf --encrypt u_pass o_pass 256 -- sec.pdf enc.pdf\nqpdf --password=u_pass --decrypt enc.pdf - | pdftotext - - | grep -o 'Secret Plan'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Secret Plan");
    });
  });

  it("03 qpdf merge pages and linearize pdfinfo", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '<p>Page One</p>\\n' > p1.html\nprintf '<p>Page Two</p>\\n' > p2.html\nwkhtmltopdf -q p1.html p1.pdf\nwkhtmltopdf -q p2.html p2.pdf\nqpdf --empty --pages p1.pdf 1 p2.pdf 1 -- merged.pdf\nqpdf --linearize merged.pdf lin.pdf\npdfinfo lin.pdf | grep -E '^(Pages|Optimized):' | awk '{print $1, $2}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Pages: 2\nOptimized: yes");
    });
  });

  it("04 pdftoppm render pdf to png and identify", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '<p>Render Test</p>\\n' > r.html\nwkhtmltopdf -q r.html r.pdf\npdftoppm -png -r 72 r.pdf page_out\nls page_out*.png | wc -l | tr -d ' '\nidentify -format '%m' page_out-1.png\necho \"\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1\nPNG");
    });
  });

  it("05 soffice headless convert txt to pdf and pdftotext", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'Quarterly Summary Line 1\\n' > summary.txt\nsoffice --headless --convert-to pdf summary.txt >/dev/null\npdftotext summary.pdf - | grep -o 'Quarterly Summary Line 1'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Quarterly Summary Line 1");
    });
  });

  it("06 soffice headless convert txt to docx and html", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'Architecture Overview\\n' > arch.txt\nsoffice --headless --convert-to docx arch.txt >/dev/null\nsoffice --headless --convert-to html arch.docx >/dev/null\nhtml-to-markdown arch.html | grep -o 'Architecture Overview'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Architecture Overview");
    });
  });

  it("07 unrtf text extraction from rtf document", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '{\\\\rtf1\\\\ansi\\\\b Alert:\\\\b0  System nominal\\\\par}\\n' > doc.rtf\nunrtf --text doc.rtf | grep 'Alert:'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Alert: System nominal");
    });
  });

  it("08 mmdc mermaid diagram to svg and png", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'MMD' > flow.mmd\ngraph LR\n  A[Client] --> B[Gateway]\nMMD\nmmdc -i flow.mmd -o flow.svg >/dev/null\nmmdc -i flow.mmd -o flow.png >/dev/null\ngrep -o 'Gateway' flow.svg | head -n 1\nidentify -format '%m' flow.png\necho \"\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Gateway\nPNG");
    });
  });

  it("09 magick canvas creation resize and identify format", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("magick -size 120x80 xc:navy canvas.png\nmagick canvas.png -resize 60x40 small.jpg\nidentify -format '%m %wx%h' small.jpg\necho \"\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "JPEG 60x40");
    });
  });

  it("10 convert format chain png to webp and gif with file mime", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("convert -size 40x30 xc:coral src.png\nconvert src.png out.webp\nconvert out.webp out.gif\nidentify -format '%m %wx%h\\n' out.webp out.gif\nfile --brief --mime-type out.gif");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "WEBP 40x30\nGIF 40x30\nimage/gif");
    });
  });

  it("11 sips resize and property query", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("magick -size 100x80 xc:white base.png\nsips -z 40 50 base.png --out sips_out.png >/dev/null\nsips -g pixelWidth -g pixelHeight sips_out.png | grep -E 'pixel(Width|Height):' | awk '{print $1, $2}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "pixelWidth: 50\npixelHeight: 40");
    });
  });

  it("12 exiftool write json read and delete tag", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("magick -size 32x32 xc:black meta.jpg\nexiftool -overwrite_original -Artist=\"Ada Lovelace\" -Copyright=\"2026\" meta.jpg >/dev/null\nexiftool -j meta.jpg | jq -r '.[0] | \"\\(.Artist)|\\(.Copyright)\"'\nexiftool -overwrite_original -Artist= meta.jpg >/dev/null\nexiftool -s3 -Artist meta.jpg\necho \"done\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Ada Lovelace|2026\ndone");
    });
  });

  it("13 ffmpeg synthetic video and audio mux and ffprobe", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("ffmpeg -y -f lavfi -i testsrc=duration=1:size=64x48:rate=10 -f lavfi -i sine=frequency=440:duration=1 -shortest mux.mp4 2>/dev/null\nffprobe -v error -show_entries stream=codec_type,width,height -of csv=p=0 mux.mp4");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "video,64,48\naudio");
    });
  });

  it("14 ffmpeg extract frame png and audio wav", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("ffmpeg -y -f lavfi -i testsrc=duration=1:size=80x60:rate=5 -f lavfi -i sine=frequency=440:sample_rate=16000:duration=1 clip.mp4 2>/dev/null\nffmpeg -y -i clip.mp4 -frames:v 1 frame.png 2>/dev/null\nffmpeg -y -i clip.mp4 -vn audio.wav 2>/dev/null\nidentify -format '%m %wx%h' frame.png\necho \"\"\nffprobe -v quiet -print_format json -show_streams audio.wav | jq -r '.streams[0].codec_type'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "PNG 80x60\naudio");
    });
  });

  it("15 pdftk merge dump_data and page extraction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'First Page Data\\n' > f1.txt\nprintf 'Second Page Data\\n' > f2.txt\nsoffice --headless --convert-to pdf f1.txt >/dev/null\nsoffice --headless --convert-to pdf f2.txt >/dev/null\npdftk f1.pdf f2.pdf cat output both.pdf\npdftk both.pdf dump_data | grep '^NumberOfPages:'\npdftk A=both.pdf cat A2 output p2_only.pdf\npdftotext p2_only.pdf - | grep -o 'Second Page Data'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "NumberOfPages: 2\nSecond Page Data");
    });
  });

  it("16 qpdf add-attachment and pdfdetach round-trip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '<p>Host PDF</p>\\n' > host.html\nwkhtmltopdf -q host.html host.pdf\nprintf 'embedded_payload_99\\n' > secret.txt\nqpdf host.pdf --add-attachment secret.txt -- attached.pdf\npdfdetach -list attached.pdf | grep -o 'secret.txt'\nmkdir -p unpacked\npdfdetach -saveall -o unpacked attached.pdf\ncat unpacked/secret.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "secret.txt\nembedded_payload_99");
    });
  });

  it("17 sponge in-place pipeline transformation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'status: DRAFT\\nowner: ops\\n' > state.txt\nsed 's/DRAFT/APPROVED/' state.txt | sponge state.txt\ncat state.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "status: APPROVED\nowner: ops");
    });
  });

  it("18 envsubst selective variable substitution", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("export APP_NAME=\"safe-bash\" APP_VER=\"2.0\" SECRET_KEY=\"keep_literal\"\nprintf 'app=$APP_NAME ver=$APP_VER sec=$SECRET_KEY\\n' | envsubst '$APP_NAME $APP_VER'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "app=safe-bash ver=2.0 sec=$SECRET_KEY");
    });
  });

  it("19 pdftotext bbox and tsv coordinate extraction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'Alpha Beta\\n' > words.txt\nsoffice --headless --convert-to pdf words.txt >/dev/null\npdftotext -bbox words.pdf - | grep -o '>Alpha</word>'\npdftotext -tsv words.pdf - | awk -F'\\t' '$1 == 5 { print $12 }'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), ">Alpha</word>\nAlpha\nBeta");
    });
  });

  it("20 end-to-end sqlite3 jq wkhtmltopdf qpdf exiftool pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 audit.db \"CREATE TABLE checks (name TEXT, pass INT); INSERT INTO checks VALUES ('auth',1),('tls',1);\"\nrows=$(sqlite3 -json audit.db \"SELECT * FROM checks ORDER BY name;\" | jq -r '.[] | \"<p>\\(.name)=\\(.pass)</p>\"' | tr '\\n' ' ')\nprintf \"<html><body>%s</body></html>\\n\" \"$rows\" > audit.html\nwkhtmltopdf -q audit.html audit.pdf\nqpdf --linearize audit.pdf audit_opt.pdf\nexiftool -overwrite_original -Title=\"SecAudit\" audit_opt.pdf >/dev/null\nexiftool -s3 -Title audit_opt.pdf\npdftotext audit_opt.pdf - | grep -Eo '(auth|tls)=1'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "SecAudit\nauth=1\ntls=1");
    });
  });

});
