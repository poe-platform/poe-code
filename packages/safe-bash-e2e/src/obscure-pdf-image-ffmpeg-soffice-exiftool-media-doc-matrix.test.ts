import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withE2EHarness } from "./harness.js";

describe("obscure PDF, image, ffmpeg, soffice, exiftool, and media/document matrix", () => {
  it("1. handles wkhtmltopdf -> pdfunite -> pdfseparate -f/-l -> pdfinfo & pdftotext", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        wkhtmltopdf - <<< "<html><body>Page Alpha</body></html>" p1.pdf
        wkhtmltopdf - <<< "<html><body>Page Beta</body></html>" p2.pdf
        wkhtmltopdf - <<< "<html><body>Page Gamma</body></html>" p3.pdf
        pdfunite p1.pdf p2.pdf p3.pdf all.pdf
        pdfinfo all.pdf | grep -E "^Pages:"
        pdfseparate -f 2 -l 3 all.pdf part-%d.pdf
        pdftotext part-2.pdf -
        pdftotext part-3.pdf -
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /Pages:\s+3/);
      assert.match(res.stdout, /Page Beta/);
      assert.match(res.stdout, /Page Gamma/);
    });
  });

  it("2. handles qpdf --encrypt, --is-encrypted, --decrypt, --check, and --show-npages", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        wkhtmltopdf - <<< "<html><body>Secret Doc</body></html>" plain.pdf
        qpdf --show-npages plain.pdf
        if qpdf --is-encrypted plain.pdf; then echo "PLAIN_ENC"; else echo "PLAIN_NOT_ENC"; fi
        qpdf --encrypt userpw ownerpw 256 -- plain.pdf enc.pdf
        if qpdf --is-encrypted enc.pdf; then echo "ENC_OK"; else echo "ENC_FAIL"; fi
        qpdf --password=userpw --decrypt enc.pdf dec.pdf
        pdfinfo dec.pdf | grep -E "^Encrypted:"
        pdftotext -nopgbrk dec.pdf -
        qpdf --check dec.pdf >/dev/null && echo "CHECK_OK"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /^1\nPLAIN_NOT_ENC\nENC_OK\nEncrypted:\s+no\nSecret Doc\n+CHECK_OK\n$/);
    });
  });

  it("3. handles qpdf --rotate and --split-pages with pdfinfo rotation inspection", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        wkhtmltopdf - <<< "<html><body>One</body></html>" p1.pdf
        wkhtmltopdf - <<< "<html><body>Two</body></html>" p2.pdf
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

  it("4. handles qpdf --add-attachment, --list-attachments, --show-attachment, and pdfdetach -list", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf "invoice_total=99.50\n" > meta.txt
        wkhtmltopdf - <<< "<html><body>Invoice</body></html>" base.pdf
        qpdf base.pdf --add-attachment meta.txt --key=inv-meta --filename=meta.txt -- with_att.pdf
        qpdf --list-attachments with_att.pdf
        qpdf --show-attachment=inv-meta with_att.pdf
        pdfdetach -list with_att.pdf
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "inv-meta -> meta.txt\ninvoice_total=99.50\n1 embedded files\n1: meta.txt\n"
      );
    });
  });

  it("5. handles pdftk multi-handle cat with directional rotations (east/south) and shuffle", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        wkhtmltopdf - <<< "<html><body>A1</body></html>" a.pdf
        wkhtmltopdf - <<< "<html><body>B1</body></html>" b.pdf
        pdftk A=a.pdf B=b.pdf cat A1east B1south output cat.pdf
        pdftk cat.pdf dump_data | grep NumberOfPages
        pdfinfo cat.pdf | grep -E "^Page rot:"
        pdftk A=a.pdf B=b.pdf shuffle A B output shuf.pdf
        pdftotext shuf.pdf -
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /NumberOfPages: 2/);
      assert.match(res.stdout, /Page rot:\s+90/);
      assert.match(res.stdout, /A1[\s\S]*B1/);
    });
  });

  it("6. handles pdftk burst and update_info metadata modification", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        wkhtmltopdf - <<< "<html><body>Burst 1</body></html>" p1.pdf
        wkhtmltopdf - <<< "<html><body>Burst 2</body></html>" p2.pdf
        pdfunite p1.pdf p2.pdf combined.pdf
        pdftk combined.pdf burst output page_%02d.pdf
        pdftotext page_02.pdf -
        cat <<'EOF' > info.txt
InfoBegin
InfoKey: Title
InfoValue: Custom Spec Title
InfoBegin
InfoKey: Author
InfoValue: Grace Hopper
EOF
        pdftk combined.pdf update_info info.txt output titled.pdf
        pdfinfo titled.pdf | grep -E "^(Title|Author):"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /Burst 2/);
      assert.match(res.stdout, /Title:\s+Custom Spec Title/);
      assert.match(res.stdout, /Author:\s+Grace Hopper/);
    });
  });

  it("7. handles pdftk attach_files and unpack_files round-trip", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf "attached_payload_123\n" > payload.txt
        wkhtmltopdf - <<< "<html><body>Host PDF</body></html>" host.pdf
        pdftk host.pdf attach_files payload.txt output bundled.pdf
        mkdir -p unpacked
        pdftk bundled.pdf unpack_files output unpacked
        cat unpacked/payload.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "attached_payload_123\n");
    });
  });

  it("8. handles pdftotext (-f, -l, -nopgbrk), pdftohtml -stdout, and pdffonts", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        wkhtmltopdf - <<< "<html><body>First Page</body></html>" p1.pdf
        wkhtmltopdf - <<< "<html><body>Second Page</body></html>" p2.pdf
        pdfunite p1.pdf p2.pdf doc.pdf
        pdftotext -f 2 -l 2 -nopgbrk doc.pdf -
        pdftohtml -stdout doc.pdf | grep -o "Second Page"
        pdffonts doc.pdf | head -n 1
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /Second Page/);
      assert.match(res.stdout, /name\s+type/);
    });
  });

  it("9. handles pdftoppm -png -singlefile, pdftocairo -jpeg, and pdfimages -list / -p", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        magick -size 16x16 xc:red swatch.png
        B64=$(base64 < swatch.png | tr -d '\n')
        printf '<html><body><h1>Visual Page</h1><img src="data:image/png;base64,%s" width="16" height="16"/></body></html>\n' "$B64" > doc.html
        wkhtmltopdf doc.html doc.pdf
        pdftoppm -png -singlefile doc.pdf thumb
        identify -format "%m\n" thumb.png
        pdftocairo -jpeg doc.pdf cairo_out
        identify -format "%m\n" cairo_out-1.jpg
        pdfimages -list doc.pdf | head -n 1
        pdfimages -png -p -print-filenames doc.pdf img_ext
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /^PNG\nJPEG\npage\s+num\s+type/);
      assert.match(res.stdout, /img_ext-001-000\.png/);
    });
  });

  it("10. handles soffice --convert-to docx, --cat text extraction, and --convert-to pdf", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf "First paragraph of contract.\nSecond paragraph of contract.\n" > draft.txt
        soffice --headless --convert-to docx draft.txt >/dev/null
        soffice --headless --cat draft.docx
        soffice --headless --convert-to pdf draft.docx >/dev/null
        pdftotext draft.pdf -
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /First paragraph of contract/);
      assert.match(res.stdout, /Second paragraph of contract/);
    });
  });

  it("11. handles soffice CSV -> XLSX -> CSV round-trip with xan aggregation", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > budget.csv
dept,amount
eng,500
ops,300
eng,200
EOF
        soffice --headless --convert-to xlsx budget.csv >/dev/null
        mkdir -p exported
        soffice --headless --convert-to csv --outdir exported budget.xlsx >/dev/null
        xan groupby dept "sum(amount) as total" exported/budget.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "dept,total\neng,700\nops,300\n");
    });
  });

  it("12. handles magick canvas creation, crop, flip/flop, Gray colorspace, and identify", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        magick -size 120x80 xc:#336699 canvas.png
        magick canvas.png -crop 60x40+10+10 -flip -flop -colorspace Gray gray.png
        identify -format "%m %wx%h %[colorspace]\n" gray.png
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "PNG 60x40 Gray\n");
    });
  });

  it("13. handles mogrify batch in-place resize and format conversion", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
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

  it("14. handles sips -Z proportional resize, -r rotation, -s format, and -1 one-line query", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        magick -size 200x100 xc:#0055ff wide.png
        sips -Z 50 wide.png --out scaled.png >/dev/null
        sips -r 90 scaled.png --out rot.png >/dev/null
        sips -1 -g pixelWidth -g pixelHeight rot.png
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "rot.png|pixelWidth: 25|pixelHeight: 50|");
    });
  });

  it("15. handles exiftool tag writing, _original backup, -tagsFromFile, -csv, and -s3", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        magick -size 32x32 xc:#abcdef img1.png
        magick -size 64x64 xc:#112233 img2.png
        exiftool -Artist="Alan Turing" -Copyright="Bletchley" img1.png >/dev/null
        test -f img1.png_original && echo "BACKUP_CREATED"
        exiftool -overwrite_original -tagsFromFile img1.png img2.png >/dev/null
        exiftool -s3 -Artist img2.png
        exiftool -csv -Artist -Copyright img2.png
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "BACKUP_CREATED\nAlan Turing\nSourceFile,Artist,Copyright\nimg2.png,Alan Turing,Bletchley\n"
      );
    });
  });

  it("16. handles exiftool PDF metadata write and JSON inspection (-j)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        wkhtmltopdf - <<< "<html><head><title>Spec Doc</title></head><body>Page 1</body></html>" spec.pdf
        exiftool -overwrite_original -Author="Ada Lovelace" spec.pdf >/dev/null
        exiftool -j spec.pdf | jq -r '.[0] | "\(.FileTypeExtension)|\(.PageCount)|\(.Title)|\(.Author)"'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "pdf|1|Spec Doc|Ada Lovelace");
    });
  });

  it("17. handles ffmpeg synthetic testsrc video generation, container metadata, and ffprobe JSON stream inspection", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        ffmpeg -f lavfi -i "testsrc=size=160x120:rate=15:duration=2" -metadata title="SynthClip" clip.mp4 2>/dev/null
        ffprobe -v quiet -print_format json -show_format -show_streams clip.mp4 | \
          jq -r '"\(.streams[0].codec_type)|\(.streams[0].width)x\(.streams[0].height)|\(.format.duration)|\(.format.tags.title)"'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "video|160x120|2.000000|SynthClip");
    });
  });

  it("18. handles ffmpeg audio generation, trimming (-ss/-t), and resampling (-ar/-ac)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        ffmpeg -f lavfi -i "sine=frequency=440:duration=3" -ar 44100 -ac 1 raw.wav 2>/dev/null
        ffmpeg -i raw.wav -ss 0.5 -t 1.5 -ar 22050 -ac 2 trimmed.wav 2>/dev/null
        ffprobe -v quiet -print_format json -show_format -show_streams trimmed.wav | \
          jq -r '"\(.streams[0].sample_rate)|\(.streams[0].channels)|\(.format.duration)"'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "22050|2|1.500000");
    });
  });

  it("19. handles ffmpeg video frame extraction to image sequence and identify inspection", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        ffmpeg -f lavfi -i "testsrc=size=128x96:rate=2" -t 1 video.mp4 2>/dev/null
        ffmpeg -i video.mp4 frame_%02d.png 2>/dev/null
        identify -format "%m %wx%h\n" frame_01.png
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "PNG 128x96");
    });
  });

  it("20. executes an end-to-end publishing pipeline: yq -> wkhtmltopdf -> qpdf -> pdftoppm -> exiftool -> tar", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > release.yaml
title: Release 2.5
author: Platform Team
summary: All systems nominal
EOF
        TITLE=$(yq -r '.title' release.yaml)
        SUMMARY=$(yq -r '.summary' release.yaml)
        printf "<html><head><title>%s</title></head><body><h1>%s</h1><p>%s</p></body></html>\n" "$TITLE" "$TITLE" "$SUMMARY" > release.html
        wkhtmltopdf release.html release_raw.pdf
        qpdf release_raw.pdf --add-attachment release.yaml --key=manifest --filename=release.yaml -- release.pdf
        pdftoppm -png -singlefile release.pdf cover
        exiftool -overwrite_original -Artist="Platform Team" cover.png >/dev/null
        tar -czf bundle.tar.gz release.pdf cover.png
        tar -tzf bundle.tar.gz | sort
        qpdf --list-attachments release.pdf
        exiftool -s3 -Artist cover.png
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "cover.png\nrelease.pdf\nmanifest -> release.yaml\nPlatform Team\n"
      );
    });
  });
});
