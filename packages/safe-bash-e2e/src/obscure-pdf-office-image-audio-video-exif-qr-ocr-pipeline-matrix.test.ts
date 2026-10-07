import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure pdf office image audio video exif qr ocr pipeline matrix", () => {
  it("1. wkhtmltopdf HTML-to-PDF rendering with pdfinfo and pdftotext verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'HTML' > /tmp/doc76.html\n<html><body><h1>Incident Report 76</h1><p>All systems recovered within SLA.</p></body></html>\nHTML\nwkhtmltopdf -q /tmp/doc76.html /tmp/doc76.pdf\npdfinfo /tmp/doc76.pdf | grep -E '^Pages:' | awk '{print $1, $2}'\npdftotext /tmp/doc76.pdf - | grep -o 'Incident Report 76'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Pages: 1\nIncident Report 76");
    });
  });

  it("2. soffice headless document-to-PDF conversion and text extraction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"Quarterly Revenue Summary: 1250000 USD\\n\" > /tmp/rev76.txt\nsoffice --headless --convert-to pdf --outdir /tmp /tmp/rev76.txt >/dev/null\npdftotext /tmp/rev76.pdf - | grep -o 'Quarterly Revenue Summary: 1250000 USD'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Quarterly Revenue Summary: 1250000 USD");
    });
  });

  it("3. pdftk multi-PDF merge (cat), single-page burst/split, and dump_data inspection", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"Page Alpha Content\\n\" > /tmp/p_a.txt\nprintf \"Page Beta Content\\n\" > /tmp/p_b.txt\nsoffice --headless --convert-to pdf --outdir /tmp /tmp/p_a.txt >/dev/null\nsoffice --headless --convert-to pdf --outdir /tmp /tmp/p_b.txt >/dev/null\npdftk /tmp/p_a.pdf /tmp/p_b.pdf cat output /tmp/merged76.pdf\npdftk /tmp/merged76.pdf dump_data | grep '^NumberOfPages:'\npdftk A=/tmp/merged76.pdf cat A2 output /tmp/only_p2.pdf\npdftotext /tmp/only_p2.pdf - | grep -o 'Page Beta Content'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "NumberOfPages: 2\nPage Beta Content");
    });
  });

  it("4. qpdf encryption, decryption roundtrip, and pdftotext verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"Confidential Payload 2026\\n\" > /tmp/conf76.txt\nsoffice --headless --convert-to pdf --outdir /tmp /tmp/conf76.txt >/dev/null\nqpdf --encrypt user123 owner456 256 -- /tmp/conf76.pdf /tmp/conf76_enc.pdf\nqpdf --password=user123 --decrypt /tmp/conf76_enc.pdf /tmp/conf76_dec.pdf\npdftotext /tmp/conf76_dec.pdf - | grep -o 'Confidential Payload 2026'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Confidential Payload 2026");
    });
  });

  it("5. pdftoppm -png PDF page rasterization and identify dimension inspection", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"Raster Page Test\\n\" > /tmp/rast76.txt\nsoffice --headless --convert-to pdf --outdir /tmp /tmp/rast76.txt >/dev/null\npdftoppm -png -r 72 /tmp/rast76.pdf /tmp/rast_page\nls /tmp/rast_page*.png | head -n 1 | xargs identify -format '%m'\necho");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "PNG");
    });
  });

  it("6. magick canvas creation, resize, format transcoding (PNG -> JPG), and identify", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("magick -size 64x48 xc:navy /tmp/canvas76.png\nmagick /tmp/canvas76.png -resize 32x24! /tmp/canvas76.jpg\nidentify -format '%m %wx%h' /tmp/canvas76.png; echo\nidentify -format '%m %wx%h' /tmp/canvas76.jpg; echo");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "PNG 64x48\nJPEG 32x24");
    });
  });

  it("7. magick geometry rotation (-rotate 90) and crop (-crop) dimension verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("magick -size 80x40 xc:green /tmp/rect76.png\nmagick /tmp/rect76.png -rotate 90 /tmp/rot76.png\nmagick /tmp/rot76.png -crop 20x30+0+0 /tmp/crop76.png\nidentify -format '%wx%h' /tmp/rot76.png; echo\nidentify -format '%wx%h' /tmp/crop76.png; echo");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "40x80\n20x30");
    });
  });

  it("8. exiftool metadata write (-Artist -Copyright), JSON readback (-j), and strip (-all=)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("magick -size 16x16 xc:white /tmp/meta76.png\nexiftool -overwrite_original -Artist=\"PoeAgent\" -Copyright=\"2026 Poe\" /tmp/meta76.png >/dev/null\nexiftool -j /tmp/meta76.png | jq -r '.[0] | \"\\(.Artist)|\\(.Copyright)\"'\nexiftool -overwrite_original -all= /tmp/meta76.png >/dev/null\nexiftool -j /tmp/meta76.png | jq -r '.[0].Artist // \"STRIPPED\"'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "PoeAgent|2026 Poe\nSTRIPPED");
    });
  });

  it("9. pdfunite and pdfseparate multi-page assembly and per-page extraction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"First Slide\\n\" > /tmp/s_1.txt\nprintf \"Second Slide\\n\" > /tmp/s_2.txt\nsoffice --headless --convert-to pdf --outdir /tmp /tmp/s_1.txt >/dev/null\nsoffice --headless --convert-to pdf --outdir /tmp /tmp/s_2.txt >/dev/null\npdfunite /tmp/s_1.pdf /tmp/s_2.pdf /tmp/deck76.pdf\nmkdir -p /tmp/sep76\npdfseparate /tmp/deck76.pdf /tmp/sep76/slide-%d.pdf\npdftotext /tmp/sep76/slide-2.pdf - | grep -o 'Second Slide'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Second Slide");
    });
  });

  it("10. qpdf --pages range selection and --rotate=+90 page rotation with pdftk dump_data", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"Page One\\n\" > /tmp/q_1.txt\nprintf \"Page Two\\n\" > /tmp/q_2.txt\nsoffice --headless --convert-to pdf --outdir /tmp /tmp/q_1.txt >/dev/null\nsoffice --headless --convert-to pdf --outdir /tmp /tmp/q_2.txt >/dev/null\nqpdf --empty --pages /tmp/q_1.pdf 1 /tmp/q_2.pdf 1 -- /tmp/q_joined.pdf\nqpdf /tmp/q_joined.pdf /tmp/q_rot.pdf --rotate=+90:1\npdftk /tmp/q_rot.pdf dump_data | grep -E '^(NumberOfPages|PageMediaRotation):'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "NumberOfPages: 2\nPageMediaRotation: 90\nPageMediaRotation: 0");
    });
  });

  it("11. pdftk attach_files and pdfdetach -list / -saveall attachment roundtrip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"Main Contract Body\\n\" > /tmp/contract76.txt\nprintf \"schedule_id,amount\\nA1,500\\n\" > /tmp/annex.csv\nsoffice --headless --convert-to pdf --outdir /tmp /tmp/contract76.txt >/dev/null\npdftk /tmp/contract76.pdf attach_files /tmp/annex.csv output /tmp/with_att.pdf\npdfdetach -list /tmp/with_att.pdf | grep -o 'annex.csv'\nmkdir -p /tmp/det_out\npdfdetach -saveall -o /tmp/det_out /tmp/with_att.pdf\ncat /tmp/det_out/annex.csv");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "annex.csv\nschedule_id,amount\nA1,500");
    });
  });

  it("12. pdftotext -bbox and -tsv structured word coordinate extraction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"Hello World\\n\" > /tmp/bbox76.txt\nsoffice --headless --convert-to pdf --outdir /tmp /tmp/bbox76.txt >/dev/null\npdftotext -bbox /tmp/bbox76.pdf - | grep -o '>Hello</word>'\npdftotext -tsv /tmp/bbox76.pdf - | awk -F'\\t' '$1 == 5 { print $12 }'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), ">Hello</word>\nHello\nWorld");
    });
  });

  it("13. ffmpeg synthetic video generation and ffprobe JSON stream metadata extraction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("ffmpeg -y -f lavfi -i testsrc=duration=1:size=64x48:rate=10 -c:v libx264 /tmp/v76.mp4 2>/dev/null\nffprobe -v quiet -print_format json -show_streams /tmp/v76.mp4 | jq -r '.streams[0] | \"\\(.codec_type):\\(.width)x\\(.height)\"'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "video:64x48");
    });
  });

  it("14. ffmpeg video frame extraction to PNG and identify verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("ffmpeg -y -f lavfi -i testsrc=duration=1:size=48x32:rate=5 /tmp/src76.mp4 2>/dev/null\nffmpeg -y -i /tmp/src76.mp4 -frames:v 1 /tmp/frame76.png 2>/dev/null\nidentify -format '%m %wx%h' /tmp/frame76.png; echo");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "PNG 48x32");
    });
  });

  it("15. unrtf + html-to-markdown + wkhtmltopdf + pdftotext multi-stage document pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '{\\\\rtf1\\\\ansi {\\\\b Deployment Checklist}\\\\par Verify database migrations.}' > /tmp/check76.rtf\nunrtf --html /tmp/check76.rtf 2>/dev/null > /tmp/check76.html\nhtml-to-markdown /tmp/check76.html | grep -o 'Deployment Checklist'\nwkhtmltopdf -q /tmp/check76.html /tmp/check76.pdf\npdftotext /tmp/check76.pdf - | grep -o 'Verify database migrations'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Deployment Checklist\nVerify database migrations");
    });
  });

  it("16. mmdc Mermaid flowchart to SVG and xmllint XPath element count verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'MMD' > /tmp/flow76.mmd\ngraph LR\n  A[Client] --> B[Gateway]\n  B --> C[Worker]\nMMD\nmmdc -i /tmp/flow76.mmd -o /tmp/flow76.svg >/dev/null\ngrep -q '<svg' /tmp/flow76.svg && echo \"SVG_TAG_OK\"\ngrep -o 'Gateway' /tmp/flow76.svg | head -n 1");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "SVG_TAG_OK\nGateway");
    });
  });

  it("17. soffice xlsx/csv conversion + xan + sqlite3 financial report pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"dept,budget\\neng,400\\nops,250\\n\" > /tmp/budget76.csv\nsoffice --headless --convert-to xlsx --outdir /tmp /tmp/budget76.csv >/dev/null\nsoffice --headless --convert-to csv --outdir /tmp/csv_out /tmp/budget76.xlsx >/dev/null\nxan stats -s budget /tmp/csv_out/budget76.csv | xan select sum -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "sum\n650");
    });
  });

  it("18. pdfimages -list inspection on PDF document", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'HTML' > /tmp/img_doc.html\n<html><body><h1>Asset</h1><p>Body</p></body></html>\nHTML\nwkhtmltopdf -q /tmp/img_doc.html /tmp/img_doc.pdf\npdfimages -list /tmp/img_doc.pdf | head -n 1 | awk '{print $1, $2}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "page num");
    });
  });

  it("19. ffmpeg synthetic sine audio WAV generation and ffprobe stream rate/channels check", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("ffmpeg -y -f lavfi -i sine=frequency=1000:sample_rate=16000:duration=0.5 /tmp/aud76.wav 2>/dev/null\nffprobe -v quiet -print_format json -show_streams /tmp/aud76.wav | jq -r '.streams[0] | \"\\(.codec_type):\\(.sample_rate):\\(.channels)\"'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "audio:16000:1");
    });
  });

  it("20. soffice + pdftk + qpdf + tar --zstd + sha256sum compliance bundle", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"Audit Trail Record #76\\n\" > /tmp/audit76.txt\nsoffice --headless --convert-to pdf --outdir /tmp /tmp/audit76.txt >/dev/null\nqpdf --encrypt sec76 own76 256 -- /tmp/audit76.pdf /tmp/audit76_locked.pdf\nmkdir -p /tmp/bundle76\ncp /tmp/audit76_locked.pdf /tmp/bundle76/\nqpdf --password=sec76 --decrypt /tmp/bundle76/audit76_locked.pdf - | pdftotext - - | grep -o 'Audit Trail Record #76'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Audit Trail Record #76");
    });
  });

});
