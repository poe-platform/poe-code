import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure PDF, image, ffmpeg, soffice, mmdc, exiftool & sips media pipeline matrix", () => {
  it("1. qpdf --empty --pages interleaving two PDFs and verifying page order", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        wkhtmltopdf - <<< "<html><body>A1</body></html>" a1.pdf
        wkhtmltopdf - <<< "<html><body>A2</body></html>" a2.pdf
        pdfunite a1.pdf a2.pdf a.pdf
        wkhtmltopdf - <<< "<html><body>B1</body></html>" b1.pdf
        wkhtmltopdf - <<< "<html><body>B2</body></html>" b2.pdf
        pdfunite b1.pdf b2.pdf b.pdf
        qpdf --empty --pages a.pdf 1 b.pdf 2 a.pdf 2 -- mixed.pdf
        qpdf --show-npages mixed.pdf
        pdftotext -nopgbrk mixed.pdf - | sed '/^[[:space:]]*$/d'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), ["3", "A1", "B2", "A2"].join("\n"));
    });
  });

  it("2. qpdf encrypt, decrypt, and non-contiguous page range extraction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        wkhtmltopdf - <<< "<html><body>Confidential One</body></html>" c1.pdf
        wkhtmltopdf - <<< "<html><body>Confidential Two</body></html>" c2.pdf
        wkhtmltopdf - <<< "<html><body>Confidential Three</body></html>" c3.pdf
        pdfunite c1.pdf c2.pdf c3.pdf c_all.pdf
        qpdf --encrypt userpw ownerpw 256 -- c_all.pdf c_enc.pdf
        qpdf --password=userpw --decrypt c_enc.pdf c_dec.pdf
        qpdf c_dec.pdf --pages . 1,3 -- c_13.pdf
        qpdf --show-npages c_13.pdf
        pdftotext -nopgbrk c_13.pdf - | sed '/^[[:space:]]*$/d'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["2", "Confidential One", "Confidential Three"].join("\n"),
      );
    });
  });

  it("3. qpdf multi-attachment embedding and pdfdetach extraction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        printf '{"schema":1}\n' > meta.json
        printf 'alpha=100\n' > notes.txt
        wkhtmltopdf - <<< "<html><body>Carrier PDF</body></html>" carrier.pdf
        qpdf carrier.pdf --add-attachment meta.json --key=meta --filename=meta.json -- step1.pdf
        qpdf step1.pdf --add-attachment notes.txt --key=notes --filename=notes.txt -- step2.pdf
        mkdir -p extracted
        pdfdetach -saveall -o extracted step2.pdf
        jq -r '.schema' extracted/meta.json
        cat extracted/notes.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), ["1", "alpha=100"].join("\n"));
    });
  });

  it("4. pdftk multi-handle cat and burst into individual pages", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        wkhtmltopdf - <<< "<html><body>DocA_P1</body></html>" a1.pdf
        wkhtmltopdf - <<< "<html><body>DocA_P2</body></html>" a2.pdf
        pdfunite a1.pdf a2.pdf docA.pdf
        wkhtmltopdf - <<< "<html><body>DocB_P1</body></html>" docB.pdf
        pdftk A=docA.pdf B=docB.pdf cat A2 B1 A1 output combined.pdf
        pdftk combined.pdf burst output page_%02d.pdf
        pdftotext -nopgbrk page_01.pdf - | sed '/^[[:space:]]*$/d'
        pdftotext -nopgbrk page_02.pdf - | sed '/^[[:space:]]*$/d'
        pdftotext -nopgbrk page_03.pdf - | sed '/^[[:space:]]*$/d'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["DocA_P2", "DocB_P1", "DocA_P1"].join("\n"),
      );
    });
  });

  it("5. pdfseparate range extraction and pdfunite reassembly", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        for i in 1 2 3 4; do
          wkhtmltopdf - <<< "<html><body>Chapter $i</body></html>" "ch$i.pdf"
        done
        pdfunite ch1.pdf ch2.pdf ch3.pdf ch4.pdf book.pdf
        pdfseparate -f 2 -l 4 book.pdf part_%d.pdf
        pdfunite part_4.pdf part_2.pdf custom.pdf
        qpdf --show-npages custom.pdf
        pdftotext -nopgbrk custom.pdf - | sed '/^[[:space:]]*$/d'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["2", "Chapter 4", "Chapter 2"].join("\n"),
      );
    });
  });

  it("6. pdftoppm -png -singlefile and identify/exiftool inspection", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        wkhtmltopdf - <<< "<html><body>Slide 1</body></html>" s1.pdf
        wkhtmltopdf - <<< "<html><body>Slide 2</body></html>" s2.pdf
        pdfunite s1.pdf s2.pdf slides.pdf
        pdftoppm -png -r 36 -f 2 -l 2 -singlefile slides.pdf slide2
        identify -format "%m\n" slide2.png
        exiftool -overwrite_original -Title="SlideTwoThumb" slide2.png >/dev/null
        exiftool -s3 -Title slide2.png
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), ["PNG", "SlideTwoThumb"].join("\n"));
    });
  });

  it("7. magick canvas, crop, flip, flop, and resize geometry pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        magick -size 100x80 xc:#224466 canvas.png
        magick canvas.png -crop 60x40+10+10 -flip -flop cropped.png
        magick cropped.png -resize 30x20! final.png
        identify -format "%m %wx%h\n" canvas.png
        identify -format "%m %wx%h\n" cropped.png
        identify -format "%m %wx%h\n" final.png
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["PNG 100x80", "PNG 60x40", "PNG 30x20"].join("\n"),
      );
    });
  });

  it("8. magick multi-format transcoding chain PNG -> WEBP -> GIF -> BMP -> JPEG", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        magick -size 32x24 xc:#abcdef orig.png
        magick orig.png step.webp
        magick step.webp step.gif
        magick step.gif step.bmp
        magick step.bmp -resize 16x12! final.jpg
        identify -format "%m %wx%h\n" step.webp
        identify -format "%m %wx%h\n" step.gif
        identify -format "%m %wx%h\n" step.bmp
        identify -format "%m %wx%h\n" final.jpg
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["WEBP 32x24", "GIF 32x24", "BMP 32x24", "JPEG 16x12"].join("\n"),
      );
    });
  });

  it("9. mogrify in-place batch resize across multiple images", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        magick -size 64x48 xc:#112233 img1.png
        magick -size 96x72 xc:#445566 img2.png
        mogrify -resize 32x24! img1.png img2.png
        identify -format "%f:%wx%h\n" img1.png img2.png
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["img1.png:32x24", "img2.png:32x24"].join("\n"),
      );
    });
  });

  it("10. sips proportional resize (-Z), rotation (-r), and format conversion (-s format)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        magick -size 160x80 xc:#336699 wide.png
        sips -Z 80 wide.png --out half.png >/dev/null
        sips -r 90 half.png --out rot.png >/dev/null
        sips -s format jpeg rot.png --out rot.jpg >/dev/null
        sips -1 -g pixelWidth -g pixelHeight half.png
        sips -1 -g pixelWidth -g pixelHeight -g format rot.jpg
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "half.png|pixelWidth: 80|pixelHeight: 40|",
          "rot.jpg|pixelWidth: 40|pixelHeight: 80|format: jpeg|",
        ].join("\n"),
      );
    });
  });

  it("11. exiftool multi-tag stamping, JSON export, and selective tag deletion", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        magick -size 40x30 xc:#778899 photo.png
        exiftool -overwrite_original -Artist="Linus" -Copyright="2026 Corp" -Comment="Draft1" photo.png >/dev/null
        exiftool -j photo.png | jq -c '.[0] | {Artist, Copyright, Comment, w: .ImageWidth, h: .ImageHeight}'
        exiftool -overwrite_original -Comment= photo.png >/dev/null
        exiftool -j photo.png | jq -c '.[0] | {Artist, Copyright, Comment}'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          '{"Artist":"Linus","Copyright":"2026 Corp","Comment":"Draft1","w":40,"h":30}',
          '{"Artist":"Linus","Copyright":"2026 Corp","Comment":null}',
        ].join("\n"),
      );
    });
  });

  it("12. mmdc Mermaid stateDiagram compilation to SVG and PNG", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        cat << 'MMD' > state.mmd
stateDiagram-v2
  [*] --> Idle
  Idle --> Active: start
  Active --> [*]
MMD
        mmdc -i state.mmd -o state.svg
        mmdc -i state.mmd -o state.png -w 240 -H 180
        grep -Eo 'Idle|Active' state.svg | sort -u | paste -sd, -
        identify -format "%m %wx%h\n" state.png
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), ["Active,Idle", "PNG 240x180"].join("\n"));
    });
  });

  it("13. ffmpeg video synthesis, scaling, and PNG frame extraction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        ffmpeg -f lavfi -i "testsrc=size=120x90:rate=15:duration=1" raw.mp4 2>/dev/null
        ffmpeg -i raw.mp4 -vf "scale=60:45" resized.mp4 2>/dev/null
        ffmpeg -i resized.mp4 -frames:v 1 frame.png 2>/dev/null
        ffprobe -v quiet -print_format json -show_streams resized.mp4 | jq -r '"\(.streams[0].codec_type)|\(.streams[0].width)x\(.streams[0].height)"'
        identify -format "%m %wx%h\n" frame.png
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), ["video|60x45", "PNG 60x45"].join("\n"));
    });
  });

  it("14. ffmpeg audio synthesis, stereo resampling, and ffprobe stream inspection", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        ffmpeg -f lavfi -i "sine=frequency=440:duration=1" -ar 22050 -ac 2 stereo.wav 2>/dev/null
        ffprobe -v quiet -print_format json -show_streams -show_format stereo.wav | jq -r '"\(.streams[0].codec_type)|\(.streams[0].sample_rate)|\(.streams[0].channels)"'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "audio|22050|2");
    });
  });

  it("15. ffmpeg video and audio muxing into MP4 container", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        ffmpeg -f lavfi -i "testsrc=size=96x72:rate=10:duration=1" v.mp4 2>/dev/null
        ffmpeg -f lavfi -i "sine=frequency=520:duration=1" -ar 16000 -ac 1 a.wav 2>/dev/null
        ffmpeg -i v.mp4 -i a.wav -c:v copy -c:a aac muxed.mp4 2>/dev/null
        ffprobe -v quiet -print_format json -show_streams muxed.mp4 | jq -c '[.streams[] | .codec_type]'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), '["video","audio"]');
    });
  });

  it("16. soffice multi-hop document conversion txt -> docx -> pdf and pdftotext readback", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        printf 'Project Charter\nDeliver zero-dependency portable shell.\n' > charter.txt
        soffice --headless --convert-to docx charter.txt >/dev/null
        soffice --headless --convert-to pdf charter.docx >/dev/null
        soffice --headless --cat charter.docx
        echo "---"
        pdftotext -nopgbrk charter.pdf - | sed '/^[[:space:]]*$/d'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "Project Charter",
          "Deliver zero-dependency portable shell.",
          "---",
          "Project Charter",
          "Deliver zero-dependency portable shell.",
        ].join("\n"),
      );
    });
  });

  it("17. soffice HTML to DOCX conversion and text extraction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        cat << 'HTML' > spec.html
<html><body><h1>Architecture Spec</h1><p>All 56 suites verified.</p></body></html>
HTML
        soffice --headless --convert-to docx spec.html >/dev/null
        soffice --headless --cat spec.docx | grep -E 'Architecture Spec|All 56 suites verified'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["Architecture Spec", "All 56 suites verified."].join("\n"),
      );
    });
  });

  it("18. wkhtmltopdf with --title and HTML body -> pdfinfo + pdftotext", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        cat << 'HTML' > invoice.html
<html>
  <body>
    <h1>Invoice 2026-10</h1>
    <p>Total Due: 450 USD</p>
  </body>
</html>
HTML
        wkhtmltopdf --title "Invoice Oct 2026" invoice.html invoice.pdf
        pdfinfo invoice.pdf | awk -F':[[:space:]]+' '/^(Title|Pages):/ { print $1 "=" $2 }'
        pdftotext -nopgbrk invoice.pdf - | sed '/^[[:space:]]*$/d'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "Title=Invoice Oct 2026",
          "Pages=1",
          "Invoice 2026-10",
          "Total Due: 450 USD",
        ].join("\n"),
      );
    });
  });

  it("19. pdfdetach -list and single-attachment extraction by index", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        printf 'key1=val1\n' > first.cfg
        printf 'key2=val2\n' > second.cfg
        wkhtmltopdf - <<< "<html><body>Bundle</body></html>" base.pdf
        qpdf base.pdf --add-attachment first.cfg --key=a --filename=first.cfg -- b1.pdf
        qpdf b1.pdf --add-attachment second.cfg --key=b --filename=second.cfg -- b2.pdf
        pdfdetach -list b2.pdf | grep -E 'first\.cfg|second\.cfg' | wc -l | tr -d ' '
        pdfdetach -save 2 -o picked.cfg b2.pdf
        cat picked.cfg
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), ["2", "key2=val2"].join("\n"));
    });
  });

  it("20. end-to-end polyglot report pipeline: sqlite3 -> html -> wkhtmltopdf -> qpdf attach -> pdftoppm -> exiftool", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        sqlite3 /tmp/kpi.db "
          CREATE TABLE kpi(region TEXT, rev INT);
          INSERT INTO kpi VALUES ('APAC', 320), ('EMEA', 410), ('AMER', 530);
        "
        sqlite3 /tmp/kpi.db ".mode json" "SELECT * FROM kpi ORDER BY region;" > /tmp/kpi.json
        total=$(jq '[.[].rev] | add' /tmp/kpi.json)
        printf '<html><body><h1>Global Revenue: %s</h1></body></html>\n' "$total" > /tmp/kpi.html
        wkhtmltopdf --title "KPI Summary" /tmp/kpi.html /tmp/kpi_raw.pdf
        qpdf /tmp/kpi_raw.pdf --add-attachment /tmp/kpi.json --key=kpi --filename=kpi.json -- /tmp/kpi_final.pdf
        pdftoppm -png -r 24 -singlefile /tmp/kpi_final.pdf /tmp/kpi_preview
        exiftool -overwrite_original -Artist="AnalyticsEngine" /tmp/kpi_preview.png >/dev/null
        pdftotext -nopgbrk /tmp/kpi_final.pdf - | sed '/^[[:space:]]*$/d'
        exiftool -s3 -Artist /tmp/kpi_preview.png
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["Global Revenue: 1260", "AnalyticsEngine"].join("\n"),
      );
    });
  });
});
