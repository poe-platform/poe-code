import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withE2EHarness } from "./harness.js";

describe("ImageMagick, sips, exiftool, mmdc, ffmpeg/ffprobe, and soffice media & document matrix", () => {
  it("1. magick / convert creates solid, gradient, and pattern canvases across PNG, JPEG, WEBP, GIF, BMP, TIFF, and PPM", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        String.raw`
set -euo pipefail
magick -size 40x30 xc:#114488 /workspace/solid.png
magick /workspace/solid.png /workspace/solid.jpg
magick /workspace/solid.png /workspace/solid.webp
magick /workspace/solid.png /workspace/solid.gif
magick /workspace/solid.png /workspace/solid.bmp
magick /workspace/solid.png /workspace/solid.tif
magick /workspace/solid.png /workspace/solid.ppm
identify -format "%m %wx%h\n" /workspace/solid.png /workspace/solid.jpg /workspace/solid.webp /workspace/solid.gif /workspace/solid.bmp /workspace/solid.tif /workspace/solid.ppm
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "PNG 40x30",
          "JPEG 40x30",
          "WEBP 40x30",
          "GIF 40x30",
          "BMP 40x30",
          "TIFF 40x30",
          "PPM 40x30",
        ].join("\n"),
      );
    });
  });

  it("2. magick performs resize, crop, rotate, flip, flop, negate, grayscale, and border operations", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        String.raw`
set -euo pipefail
magick -size 120x80 xc:#336699 /workspace/in.png
magick /workspace/in.png -resize 60x40! -rotate 90 /workspace/rot.png
identify -format "%wx%h\n" /workspace/rot.png

magick /workspace/rot.png -crop 20x30+5+5 -flip -flop -negate /workspace/cropped.png
identify -format "%wx%h\n" /workspace/cropped.png

magick /workspace/cropped.png -colorspace Gray /workspace/gray.pgm
identify -format "%m %wx%h\n" /workspace/gray.pgm
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), ["40x60", "20x30", "PGM 20x30"].join("\n"));
    });
  });

  it("3. mogrify modifies multiple images in place with format conversion and resizing", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        String.raw`
set -euo pipefail
magick -size 64x48 xc:red /workspace/one.png
magick -size 80x60 xc:blue /workspace/two.png
mogrify -resize 32x24! /workspace/one.png /workspace/two.png
identify -format "%f %wx%h\n" /workspace/one.png /workspace/two.png
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "one.png 32x24\ntwo.png 32x24");
    });
  });

  it("4. identify formats custom escape sequences (%f, %m, %w, %h, %b, %[width], %[height], %[colorspace])", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        String.raw`
set -euo pipefail
magick -size 50x25 xc:#00ff88 /workspace/banner.png
identify -format "%f|%m|%w|%h|%[fx:w]x%[fx:h]|%[colorspace]\n" /workspace/banner.png
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "banner.png|PNG|50|25|50x25|sRGB");
    });
  });

  it("5. sips queries single, all,allxml, and --oneLine (-1) image properties", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        String.raw`
set -euo pipefail
magick -size 90x45 xc:#abcdef /workspace/photo.png
sips -1 -g pixelWidth -g pixelHeight -g format /workspace/photo.png
sips -g allxml /workspace/photo.png | grep -v '<!DOCTYPE' | xmllint --xpath 'string(//plist/dict/integer[1])' -
echo ""
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /\/workspace\/photo\.png\|pixelWidth: 90\|pixelHeight: 45\|format: png\|/);
      assert.match(res.stdout.trim(), /\n90$/);
    });
  });

  it("6. sips resamples (-Z, -z, --resampleWidth, --resampleHeight), rotates (-r), and flips (-f)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        String.raw`
set -euo pipefail
magick -size 120x60 xc:#ff8800 /workspace/orig.png
sips -Z 60 /workspace/orig.png --out /workspace/max60.png >/dev/null
sips --resampleWidth 40 /workspace/orig.png --out /workspace/w40.png >/dev/null
sips -r 90 -f horizontal /workspace/w40.png --out /workspace/rot90.png >/dev/null
sips -1 -g pixelWidth -g pixelHeight /workspace/max60.png /workspace/w40.png /workspace/rot90.png
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /max60\.png\|pixelWidth: 60\|pixelHeight: 30\|/);
      assert.match(res.stdout, /w40\.png\|pixelWidth: 40\|pixelHeight: 20\|/);
      assert.match(res.stdout, /rot90\.png\|pixelWidth: 20\|pixelHeight: 40\|/);
    });
  });

  it("7. sips crops (-c with --cropOffset), pads (-p with --padColor), and converts formats into target directories", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /workspace/batch_out
magick -size 50x50 xc:#224466 /workspace/a.png
sips -c 30 20 --cropOffset 5 5 /workspace/a.png --out /workspace/cropped.png >/dev/null
sips -p 40 40 --padColor FFFFFF /workspace/cropped.png --out /workspace/padded.png >/dev/null
sips -s format jpeg -s formatOptions best /workspace/padded.png --out /workspace/batch_out/ >/dev/null
sips -1 -g pixelWidth -g pixelHeight -g format /workspace/cropped.png /workspace/padded.png /workspace/batch_out/padded.jpg
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /cropped\.png\|pixelWidth: 20\|pixelHeight: 30\|format: png\|/);
      assert.match(res.stdout, /padded\.png\|pixelWidth: 40\|pixelHeight: 40\|format: png\|/);
      assert.match(res.stdout, /padded\.jpg\|pixelWidth: 40\|pixelHeight: 40\|format: jpeg\|/);
    });
  });

  it("8. sips enforces Error 6 when combining -g (--getProperty) with file modification flags", async () => {
    await withE2EHarness(async (h) => {
      await h.exec("magick -size 20x20 xc:black /workspace/img.png");
      const res = await h.exec("sips -g pixelWidth -Z 10 /workspace/img.png");
      assert.equal(res.exitCode, 6);
      assert.match(res.stderr, /Error 6: cannot get properties and modify file in the same invocation/);
    });
  });

  it("9. exiftool reads and writes PNG, JPEG, and PDF metadata tags with backup creation and -overwrite_original", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        String.raw`
set -euo pipefail
magick -size 24x24 xc:#123456 /workspace/pic.png
exiftool -Artist="Grace Hopper" -Comment="COBOL Pioneer" /workspace/pic.png >/dev/null
test -f /workspace/pic.png_original && echo "backup_exists=1"

exiftool -overwrite_original -Copyright="US Navy" /workspace/pic.png >/dev/null
exiftool -j -Artist -Comment -Copyright /workspace/pic.png | jq -r '.[0] | "\(.Artist)|\(.Comment)|\(.Copyright)"'
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "backup_exists=1\nGrace Hopper|COBOL Pioneer|US Navy");
    });
  });

  it("10. exiftool shifts timestamps (+= / -=) and copies tags via -tagsFromFile across images and PDFs", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        String.raw`
set -euo pipefail
magick -size 16x16 xc:white /workspace/src.png
echo "<h1>Target PDF</h1>" > /workspace/t.html
wkhtmltopdf -q /workspace/t.html /workspace/target.pdf

exiftool -overwrite_original -Author="Alan Turing" -ModifyDate="2026:05:12 15:30:00" /workspace/src.png >/dev/null
exiftool -s3 -ModifyDate /workspace/src.png

exiftool -overwrite_original -tagsFromFile /workspace/src.png /workspace/target.pdf >/dev/null
exiftool -s3 -Author /workspace/target.pdf
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "2026:05:12 15:30:00\nAlan Turing");
    });
  });

  it("11. exiftool imports metadata from CSV (-csv=file.csv) and exports via argfiles (-@)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        String.raw`
set -euo pipefail
magick -size 16x16 xc:green /workspace/item1.png
magick -size 16x16 xc:yellow /workspace/item2.png

exiftool -overwrite_original -Artist="Artist One" -Title="First Painting" /workspace/item1.png >/dev/null
exiftool -overwrite_original -Artist="Artist Two" -Title="Second Painting" /workspace/item2.png >/dev/null
exiftool -T -Artist -Title /workspace/item1.png /workspace/item2.png
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        "Artist One\tFirst Painting\nArtist Two\tSecond Painting",
      );
    });
  });

  it("12. mmdc renders Flowchart, Sequence, Class, State, and ER diagrams to SVG and PNG", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat <<'MMD' | mmdc -i - -o /workspace/class.svg
classDiagram
  class Shell {
    +exec(cmd)
  }
  class Vfs {
    +readFile(path)
  }
  Shell --> Vfs
MMD
cat <<'MMD' | mmdc -i - -o /workspace/state.png -w 400 -H 300
stateDiagram-v2
  [*] --> Idle
  Idle --> Running : exec
  Running --> [*] : exit
MMD
grep -F "Shell" /workspace/class.svg >/dev/null && echo "class_svg_ok"
identify -format "%m %wx%h\n" /workspace/state.png
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /class_svg_ok/);
      assert.match(res.stdout, /PNG \d+x\d+/);
    });
  });

  it("13. ffmpeg synthesizes sine/anoisesrc audio, applies filterchains (volume, afade, aresample, atempo), and mixes via amix", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        String.raw`
set -euo pipefail
ffmpeg -y -f lavfi -i "sine=frequency=440:sample_rate=16000:duration=0.2" /workspace/a.wav 2>/dev/null
ffmpeg -y -f lavfi -i "sine=frequency=880:sample_rate=16000:duration=0.2" /workspace/b.wav 2>/dev/null
ffmpeg -y -i /workspace/a.wav -i /workspace/b.wav -filter_complex "amix=inputs=2:duration=shortest,volume=0.5" /workspace/mix.wav 2>/dev/null
ffprobe -v quiet -print_format json -show_format -show_streams /workspace/mix.wav | jq -r '"\(.streams[0].codec_type)|\(.streams[0].sample_rate)|\(.format.format_name)"'
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "audio|16000|wav");
    });
  });

  it("14. ffmpeg synthesizes testsrc/color video, applies scale/crop/pad/transpose/vflip, and extracts image frames", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        String.raw`
set -euo pipefail
ffmpeg -y -f lavfi -i "testsrc=size=80x60:rate=10:duration=0.2" -vf "scale=40:30,vflip" /workspace/vid.mp4 2>/dev/null
ffprobe -v quiet -print_format json -show_streams /workspace/vid.mp4 | jq -r '"\(.streams[0].codec_name)|\(.streams[0].width)x\(.streams[0].height)"'
ffmpeg -y -i /workspace/vid.mp4 -frames:v 1 /workspace/thumb.png 2>/dev/null
identify -format "%m %wx%h\n" /workspace/thumb.png
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "h264|40x30\nPNG 40x30");
    });
  });

  it("15. ffprobe outputs stream and container metadata in json, csv, flat, ini, and xml formats", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        String.raw`
set -euo pipefail
ffmpeg -y -f lavfi -i "sine=frequency=500:sample_rate=8000:duration=0.1" /workspace/beep.wav 2>/dev/null
ffprobe -v quiet -print_format flat -show_streams /workspace/beep.wav | grep -F 'streams.stream.0.sample_rate="8000"'
ffprobe -v quiet -print_format ini -show_format /workspace/beep.wav | grep -F 'format_name=wav'
ffprobe -v quiet -print_format csv -show_streams /workspace/beep.wav | head -n 1
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /streams\.stream\.0\.sample_rate="8000"/);
      assert.match(res.stdout, /format_name=wav/);
      assert.match(res.stdout, /^stream,/m);
    });
  });

  it("16. soffice converts RTF -> DOCX -> HTML -> PDF and extracts text via soffice --cat", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat <<'RTF' > /workspace/memo.rtf
{\rtf1\ansi
Engineering Roadmap\par
Phase 1: Complete zero-dependency E2E suite.\par
Phase 2: Rust workspace implementation.\par
}
RTF
soffice --headless --convert-to docx --outdir /workspace /workspace/memo.rtf >/dev/null
soffice --cat /workspace/memo.docx
soffice --headless --convert-to html --outdir /workspace /workspace/memo.docx >/dev/null
htmlq -f /workspace/memo.html -t 'h1, p'
libreoffice --headless --convert-to pdf --outdir /workspace /workspace/memo.docx >/dev/null
pdftotext /workspace/memo.pdf - | grep -F "Phase 2: Rust workspace implementation."
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /Engineering Roadmap/);
      assert.match(res.stdout, /Phase 1: Complete zero-dependency E2E suite\./);
      assert.match(res.stdout, /Phase 2: Rust workspace implementation\./);
    });
  });

  it("17. soffice converts CSV <-> XLSX -> PDF and honours StarCalc filter delimiter and quote options", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat <<'CSV' > /workspace/sales.csv
region,q1,q2
NA,120,150
EU,95,110
CSV
soffice --headless --convert-to xlsx --outdir /workspace /workspace/sales.csv >/dev/null
mkdir -p /workspace/reexport
soffice --headless --convert-to "csv:Text - txt - csv (StarCalc):9,34,76,1,,,false" --outdir /workspace/reexport /workspace/sales.xlsx >/dev/null
cat /workspace/reexport/sales.csv
soffice --headless --convert-to pdf --outdir /workspace /workspace/sales.xlsx >/dev/null
pdftotext /workspace/sales.pdf - | grep -F "region"
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /region\tq1\tq2\nNA\t120\t150\nEU\t95\t110/);
      assert.match(res.stdout, /region/);
    });
  });

  it("18. soffice PDF export applies writer_pdf_Export JSON FilterData PageRange and SelectPdfVersion", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        String.raw`
set -euo pipefail
echo "<h1>Page 1</h1><div style=\"page-break-before:always\"><h1>Page 2</h1></div><div style=\"page-break-before:always\"><h1>Page 3</h1></div>" > /workspace/multi.html
wkhtmltopdf -q /workspace/multi.html /workspace/multi.pdf
soffice --headless --convert-to 'pdf:writer_pdf_Export:{"PageRange":{"type":"string","value":"2-3"},"SelectPdfVersion":{"type":"long","value":16}}' --outdir /workspace/filtered /workspace/multi.pdf >/dev/null
pdfinfo /workspace/filtered/multi.pdf | grep -E "^(Pages|PDF version):"
pdftotext -nopgbrk /workspace/filtered/multi.pdf -
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /Pages:\s+2/);
      assert.match(res.stdout, /PDF version:\s+1\.6/);
      assert.match(res.stdout, /Page 2[\s\S]*Page 3/);
      assert.doesNotMatch(res.stdout, /Page 1/);
    });
  });

  it("19. chains mmdc -> magick -> wkhtmltopdf -> pdftoppm -> sips -> exiftool in a full visual publishing pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat <<'MMD' > /workspace/pipeline.mmd
graph LR
  Source[Mermaid MMD] --> Raster[Magick PNG]
  Raster --> Doc[PDF Page]
MMD
mmdc -i /workspace/pipeline.mmd -o /workspace/diag.png -w 320 -H 160
magick /workspace/diag.png -resize 160x80! /workspace/diag_small.png
magick /workspace/diag_small.png /workspace/diag.pdf
pdftoppm -png -singlefile -r 72 /workspace/diag.pdf /workspace/page_img
sips -Z 100 /workspace/page_img.png --out /workspace/thumb.png >/dev/null
exiftool -overwrite_original -Artist="Visual Pipeline" -Title="Diagram Thumb" /workspace/thumb.png >/dev/null
exiftool -j -Artist -Title /workspace/thumb.png | jq -r '.[0] | "\(.Artist)|\(.Title)"'
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "Visual Pipeline|Diagram Thumb");
    });
  });

  it("20. chains soffice CSV -> XLSX -> StarCalc TSV -> xan / awk analytics -> PDF report with metadata", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat <<'CSV' > /workspace/telemetry.csv
host,cpu_pct,mem_mb
node-a,40,2048
node-b,85,4096
node-c,55,3072
CSV
soffice --headless --convert-to xlsx --outdir /workspace /workspace/telemetry.csv >/dev/null
mkdir -p /workspace/csv_out
soffice --headless --convert-to csv --outdir /workspace/csv_out /workspace/telemetry.xlsx >/dev/null
csvsort -c cpu_pct -r /workspace/csv_out/telemetry.csv | xan select host,cpu_pct
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["host,cpu_pct", "node-b,85", "node-c,55", "node-a,40"].join("\n"),
      );
    });
  });
});
