import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure PDF, image, ffmpeg, soffice, mmdc, and exiftool media/document pipeline matrix", () => {
  test("1. wkhtmltopdf multi-page merge with pdfunite, pdfseparate -f/-l range split, and pdftotext", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(String.raw`
        wkhtmltopdf - <<< "<html><body>Alpha Section</body></html>" p1.pdf
        wkhtmltopdf - <<< "<html><body>Beta Section</body></html>" p2.pdf
        wkhtmltopdf - <<< "<html><body>Gamma Section</body></html>" p3.pdf
        pdfunite p1.pdf p2.pdf p3.pdf all.pdf
        pdfinfo all.pdf | grep -E "^Pages:"
        pdfseparate -f 2 -l 3 all.pdf part-%d.pdf
        pdftotext -nopgbrk part-2.pdf -
        pdftotext -nopgbrk part-3.pdf -
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /Pages:\s+3/);
      assert.match(res.stdout, /Beta Section/);
      assert.match(res.stdout, /Gamma Section/);
    });
  });

  test("2. qpdf 256-bit encryption, --is-encrypted verification, password decryption, and --check", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(String.raw`
        wkhtmltopdf - <<< "<html><body>Confidential Payload</body></html>" plain.pdf
        qpdf --show-npages plain.pdf
        qpdf --encrypt u_secret o_secret 256 -- plain.pdf enc.pdf
        if qpdf --is-encrypted enc.pdf; then echo "ENC_OK"; else echo "ENC_FAIL"; fi
        qpdf --password=u_secret --decrypt enc.pdf dec.pdf
        pdftotext -nopgbrk dec.pdf -
        qpdf --check dec.pdf >/dev/null && echo "CHECK_OK"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /^1\nENC_OK\nConfidential Payload\n+CHECK_OK\n$/);
    });
  });

  test("3. qpdf per-page rotation (--rotate=+90:1 --rotate=180:2) and --split-pages=1", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(String.raw`
        wkhtmltopdf - <<< "<html><body>Page 1</body></html>" p1.pdf
        wkhtmltopdf - <<< "<html><body>Page 2</body></html>" p2.pdf
        pdfunite p1.pdf p2.pdf two.pdf
        qpdf two.pdf --rotate=+90:1 --rotate=180:2 rot.pdf
        qpdf rot.pdf --split-pages=1 split-%d.pdf
        pdfinfo split-1.pdf | grep -E "^Page rot:"
        pdfinfo split-2.pdf | grep -E "^Page rot:"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /Page rot:\s+90[\s\S]*Page rot:\s+180/);
    });
  });

  test("4. qpdf --add-attachment, --list-attachments, --show-attachment, and pdfdetach -list", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(String.raw`
        printf "checksum=sha256:abcd1234\n" > manifest.txt
        wkhtmltopdf - <<< "<html><body>Signed PDF</body></html>" base.pdf
        qpdf base.pdf --add-attachment manifest.txt --key=sig-meta --filename=manifest.txt -- with_att.pdf
        qpdf --list-attachments with_att.pdf
        qpdf --show-attachment=sig-meta with_att.pdf
        pdfdetach -list with_att.pdf
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "sig-meta -> manifest.txt\nchecksum=sha256:abcd1234\n1 embedded files\n1: manifest.txt\n"
      );
    });
  });

  test("5. pdftk multi-handle cat with directional rotations (east/south) and shuffle", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(String.raw`
        wkhtmltopdf - <<< "<html><body>LeftH</body></html>" a.pdf
        wkhtmltopdf - <<< "<html><body>RightH</body></html>" b.pdf
        pdftk A=a.pdf B=b.pdf cat A1east B1south output cat.pdf
        pdftk cat.pdf dump_data | grep NumberOfPages
        pdfinfo cat.pdf | grep -E "^Page rot:"
        pdftk A=a.pdf B=b.pdf shuffle A B output shuf.pdf
        pdftotext shuf.pdf -
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /NumberOfPages: 2/);
      assert.match(res.stdout, /Page rot:\s+90/);
      assert.match(res.stdout, /LeftH[\s\S]*RightH/);
    });
  });

  test("6. pdftk burst into numbered pages and update_info metadata injection", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(String.raw`
        wkhtmltopdf - <<< "<html><body>Ch 1</body></html>" p1.pdf
        wkhtmltopdf - <<< "<html><body>Ch 2</body></html>" p2.pdf
        pdfunite p1.pdf p2.pdf combined.pdf
        pdftk combined.pdf burst output page_%02d.pdf
        pdftotext -nopgbrk page_02.pdf -
        cat <<'INFO' > info.txt
InfoBegin
InfoKey: Title
InfoValue: Architecture Handbook
InfoBegin
InfoKey: Author
InfoValue: Barbara Liskov
INFO
        pdftk combined.pdf update_info info.txt output titled.pdf
        pdfinfo titled.pdf | grep -E "^(Title|Author):"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /Ch 2/);
      assert.match(res.stdout, /Title:\s+Architecture Handbook/);
      assert.match(res.stdout, /Author:\s+Barbara Liskov/);
    });
  });

  test("7. pdftk attach_files and unpack_files binary/text round-trip", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(String.raw`
        printf "embedded_secret_payload_42\n" > payload.txt
        wkhtmltopdf - <<< "<html><body>Carrier PDF</body></html>" host.pdf
        pdftk host.pdf attach_files payload.txt output bundled.pdf
        mkdir -p unpacked
        pdftk bundled.pdf unpack_files output unpacked
        cat unpacked/payload.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "embedded_secret_payload_42\n");
    });
  });

  test("8. pdftotext page range (-f 2 -l 2 -nopgbrk), pdftohtml -stdout, and pdffonts", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(String.raw`
        wkhtmltopdf - <<< "<html><body>Intro Page</body></html>" p1.pdf
        wkhtmltopdf - <<< "<html><body>Appendix Page</body></html>" p2.pdf
        pdfunite p1.pdf p2.pdf doc.pdf
        pdftotext -f 2 -l 2 -nopgbrk doc.pdf -
        pdftohtml -stdout doc.pdf | grep -o "Appendix Page"
        pdffonts doc.pdf | head -n 1
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /Appendix Page/);
      assert.match(res.stdout, /name\s+type/);
    });
  });

  test("9. pdftoppm -png -singlefile, pdftocairo -jpeg, and pdfimages -list / -png extraction", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(String.raw`
        magick -size 16x16 xc:blue swatch.png
        B64=$(base64 < swatch.png | tr -d '\n')
        printf '<html><body><h1>Figure</h1><img src="data:image/png;base64,%s" width="16" height="16"/></body></html>\n' "$B64" > doc.html
        wkhtmltopdf doc.html doc.pdf
        pdftoppm -png -r 18 -singlefile doc.pdf thumb
        identify -format "%m\n" thumb.png
        pdftocairo -jpeg -r 18 doc.pdf cairo_out
        identify -format "%m\n" cairo_out-1.jpg
        pdfimages -list doc.pdf | head -n 1
        pdfimages -png -p -print-filenames doc.pdf img_ext
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /^PNG\nJPEG\npage\s+num\s+type/);
      assert.match(res.stdout, /img_ext-001-000\.png/);
    });
  });

  test("10. soffice --headless TXT -> DOCX -> --cat and DOCX -> PDF -> pdftotext pipeline", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(String.raw`
        printf "Clause 1: Service Level Agreement.\nClause 2: Zero Downtime.\n" > draft.txt
        soffice --headless --convert-to docx draft.txt >/dev/null
        soffice --headless --cat draft.docx
        soffice --headless --convert-to pdf draft.docx >/dev/null
        pdftotext draft.pdf -
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /Clause 1: Service Level Agreement/);
      assert.match(res.stdout, /Clause 2: Zero Downtime/);
    });
  });

  test("11. soffice CSV -> XLSX -> CSV round-trip piped into xan groupby aggregation", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(String.raw`
        cat <<'CSV' > ledger.csv
team,spend
core,450
infra,250
core,150
CSV
        soffice --headless --convert-to xlsx ledger.csv >/dev/null
        mkdir -p exported
        soffice --headless --convert-to csv --outdir exported ledger.xlsx >/dev/null
        xan groupby team "sum(spend) as total" exported/ledger.csv | xan sort -s team
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "team,total\ncore,600\ninfra,250\n");
    });
  });

  test("12. magick canvas generation, crop, flip/flop, Gray colorspace conversion, and identify", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(String.raw`
        magick -size 120x80 xc:#224466 canvas.png
        magick canvas.png -crop 60x40+10+10 -flip -flop -colorspace Gray gray.png
        identify -format "%m %wx%h %[colorspace]\n" gray.png
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "PNG 60x40 Gray\n");
    });
  });

  test("13. mogrify batch in-place exact resize (-resize 40x20!) across multiple images", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(String.raw`
        magick -size 100x100 xc:#ff0000 a.png
        magick -size 200x100 xc:#00ff00 b.png
        mogrify -resize 40x20! a.png b.png
        identify -format "%wx%h\n" a.png
        identify -format "%wx%h\n" b.png
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "40x20\n40x20\n");
    });
  });

  test("14. sips -Z proportional resize, -r 90 rotation, and -1 single-line property query", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(String.raw`
        magick -size 200x100 xc:#0055ff wide.png
        sips -Z 50 wide.png --out scaled.png >/dev/null
        sips -r 90 scaled.png --out rot.png >/dev/null
        sips -1 -g pixelWidth -g pixelHeight rot.png
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "rot.png|pixelWidth: 25|pixelHeight: 50|");
    });
  });

  test("15. exiftool metadata tag writing, _original backup creation, -tagsFromFile copy, and -csv export", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(String.raw`
        magick -size 32x32 xc:#abcdef img1.png
        magick -size 64x64 xc:#112233 img2.png
        exiftool -Artist="Margaret Hamilton" -Copyright="Apollo" img1.png >/dev/null
        test -f img1.png_original && echo "BACKUP_CREATED"
        exiftool -overwrite_original -tagsFromFile img1.png img2.png >/dev/null
        exiftool -s3 -Artist img2.png
        exiftool -csv -Artist -Copyright img2.png
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "BACKUP_CREATED\nMargaret Hamilton\nSourceFile,Artist,Copyright\nimg2.png,Margaret Hamilton,Apollo\n"
      );
    });
  });

  test("16. exiftool PDF metadata mutation and JSON (-j) inspection piped to jq", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(String.raw`
        wkhtmltopdf - <<< "<html><head><title>RFC 9999</title></head><body>Page 1</body></html>" spec.pdf
        exiftool -overwrite_original -Author="Donald Knuth" spec.pdf >/dev/null
        exiftool -j spec.pdf | jq -r '.[0] | "\(.FileTypeExtension)|\(.PageCount)|\(.Title)|\(.Author)"'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "pdf|1|RFC 9999|Donald Knuth");
    });
  });

  test("17. mmdc Mermaid diagram compilation to SVG and xmllint / grep verification", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(String.raw`
        cat <<'MMD' > arch.mmd
graph LR
  Shell[Bash Parser] --> AST[AST Evaluator]
  AST --> Wasm[Rust Wasm Engine]
MMD
        mmdc -i arch.mmd -o arch.svg
        grep -o '<svg' arch.svg | head -n 1
        grep -Eo 'Bash Parser|AST Evaluator|Rust Wasm Engine' arch.svg | sort -u | paste -sd, -
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "<svg\nAST Evaluator,Bash Parser,Rust Wasm Engine\n");
    });
  });

  test("18. ffmpeg synthetic testsrc video generation and ffprobe JSON stream/format inspection", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(String.raw`
        ffmpeg -f lavfi -i "testsrc=size=160x120:rate=15:duration=2" -metadata title="DemoVideo" clip.mp4 2>/dev/null
        ffprobe -v quiet -print_format json -show_format -show_streams clip.mp4 | \
          jq -r '"\(.streams[0].codec_type)|\(.streams[0].width)x\(.streams[0].height)|\(.format.duration)|\(.format.tags.title)"'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "video|160x120|2.000000|DemoVideo");
    });
  });

  test("19. ffmpeg sine audio synthesis, trimming (-ss/-t), stereo resampling (-ar/-ac), and frame extraction", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(String.raw`
        ffmpeg -f lavfi -i "sine=frequency=440:duration=3" -ar 44100 -ac 1 raw.wav 2>/dev/null
        ffmpeg -i raw.wav -ss 0.5 -t 1.5 -ar 22050 -ac 2 trimmed.wav 2>/dev/null
        ffprobe -v quiet -print_format json -show_format -show_streams trimmed.wav | \
          jq -r '"\(.streams[0].sample_rate)|\(.streams[0].channels)|\(.format.duration)"'
        ffmpeg -f lavfi -i "testsrc=size=128x96:rate=2" -t 1 video.mp4 2>/dev/null
        ffmpeg -i video.mp4 frame_%02d.png 2>/dev/null
        identify -format "%m %wx%h\n" frame_01.png
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "22050|2|1.500000\nPNG 128x96\n");
    });
  });

  test("20. end-to-end publishing workflow: yq -> wkhtmltopdf -> qpdf -> pdftoppm -> exiftool -> tar", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(String.raw`
        cat <<'YAML' > release.yaml
title: Release 3.0
author: Core Runtime Team
summary: All 620 obscure tests green
YAML
        TITLE=$(yq -r '.title' release.yaml)
        SUMMARY=$(yq -r '.summary' release.yaml)
        printf "<html><head><title>%s</title></head><body><h1>%s</h1><p>%s</p></body></html>\n" "$TITLE" "$TITLE" "$SUMMARY" > release.html
        wkhtmltopdf release.html release_raw.pdf
        qpdf release_raw.pdf --add-attachment release.yaml --key=manifest --filename=release.yaml -- release.pdf
        pdftoppm -png -r 18 -singlefile release.pdf cover
        exiftool -overwrite_original -Artist="Core Runtime Team" cover.png >/dev/null
        tar -czf bundle.tar.gz release.pdf cover.png
        tar -tzf bundle.tar.gz | sort
        qpdf --list-attachments release.pdf
        exiftool -s3 -Artist cover.png
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "cover.png\nrelease.pdf\nmanifest -> release.yaml\nCore Runtime Team\n"
      );
    });
  });
});
