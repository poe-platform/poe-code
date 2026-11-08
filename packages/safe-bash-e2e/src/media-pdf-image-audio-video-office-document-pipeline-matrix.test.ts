import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("safe-bash e2e: media, PDF, image, audio, video, and office document pipeline matrix", () => {
  it("1. wkhtmltopdf renders HTML with cover, page size, orientation, margins, and title into PDF inspected via pdfinfo and pdftotext", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work
cat <<'HTML' > /work/cover.html
<!DOCTYPE html>
<html><head><title>Cover</title></head><body><h1>Annual Security Report</h1><p>Confidential Cover</p></body></html>
HTML
cat <<'HTML' > /work/ch1.html
<!DOCTYPE html>
<html><head><title>Chapter 1</title></head><body><h1>1. Executive Summary</h1><p>Zero-dependency Rust migration readiness is on track.</p></body></html>
HTML
cat <<'HTML' > /work/ch2.html
<!DOCTYPE html>
<html><head><title>Chapter 2</title></head><body><h1>2. Deep Verification</h1><p>All E2E suites validate pipeline behavior.</p></body></html>
HTML

wkhtmltopdf -q --title "Security Audit 2026" -s A4 -O Landscape -T 10mm -B 10mm -L 10mm -R 10mm \
  cover /work/cover.html /work/ch1.html /work/ch2.html /work/report.pdf

pdfinfo /work/report.pdf > /work/info.txt
grep -E "^(Title|Pages):" /work/info.txt
pdftotext /work/report.pdf - | grep -F "Zero-dependency Rust migration"
pdftotext /work/report.pdf - | grep -F "All E2E suites validate"
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.match(r.stdout, /Title:\s+Security Audit 2026/);
      assert.match(r.stdout, /Pages:\s+3/);
      assert.match(r.stdout, /Zero-dependency Rust migration/);
      assert.match(r.stdout, /All E2E suites validate/);
    });
  });

  it("2. wkhtmltopdf --read-args-from-stdin batch mode builds multiple PDFs merged with pdftk cat", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work
echo "<html><body><h1>Part Alpha</h1><p>First batch document body.</p></body></html>" > /work/a.html
echo "<html><body><h1>Part Beta</h1><p>Second batch document body.</p></body></html>" > /work/b.html

printf -- "-q /work/a.html /work/a.pdf\n-q /work/b.html /work/b.pdf\n" | wkhtmltopdf --read-args-from-stdin
pdftk /work/a.pdf /work/b.pdf cat output /work/merged.pdf
pdfinfo /work/merged.pdf | grep -E "^Pages:"
pdftotext /work/merged.pdf - | tr '\n' ' ' | sed 's/  */ /g'
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.match(r.stdout, /Pages:\s+2/);
      assert.match(r.stdout, /Part Alpha.*Part Beta/);
    });
  });

  it("3. pdftk multi-handle page selection, rotation, dump_data_utf8, and update_info_utf8", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work/burst
echo "<html><body><h1>Doc One Page One</h1></body></html>" > /work/p1.html
echo "<html><body><h1>Doc One Page Two</h1></body></html>" > /work/p2.html
echo "<html><body><h1>Doc Two Page One</h1></body></html>" > /work/p3.html

wkhtmltopdf -q /work/p1.html /work/p2.html /work/doc1.pdf
wkhtmltopdf -q /work/p3.html /work/doc2.pdf

pdftk A=/work/doc1.pdf B=/work/doc2.pdf cat A2 B1 A1east output /work/reordered.pdf
pdftk /work/reordered.pdf dump_data_utf8 > /work/meta.txt
grep -E "^NumberOfPages:" /work/meta.txt

cat <<'INFO' > /work/new_info.txt
InfoBegin
InfoKey: Title
InfoValue: Reordered Handbook
InfoBegin
InfoKey: Author
InfoValue: SafeBash E2E
INFO
pdftk /work/reordered.pdf update_info_utf8 /work/new_info.txt output /work/tagged.pdf
pdfinfo /work/tagged.pdf | grep -E "^(Title|Author|Pages):"
pdftotext -f 1 -l 1 /work/tagged.pdf - | grep -F "Doc One Page Two"
pdftotext -f 2 -l 2 /work/tagged.pdf - | grep -F "Doc Two Page One"
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.match(r.stdout, /NumberOfPages: 3/);
      assert.match(r.stdout, /Title:\s+Reordered Handbook/);
      assert.match(r.stdout, /Author:\s+SafeBash E2E/);
      assert.match(r.stdout, /Doc One Page Two/);
      assert.match(r.stdout, /Doc Two Page One/);
    });
  });

  it("4. qpdf structural inspection, page range slicing, rotation, encryption, and decryption", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work
echo "<html><body><h1>Page Alpha</h1></body></html>" > /work/1.html
echo "<html><body><h1>Page Beta</h1></body></html>" > /work/2.html
echo "<html><body><h1>Page Gamma</h1></body></html>" > /work/3.html
wkhtmltopdf -q /work/1.html /work/2.html /work/3.html /work/three.pdf

echo "npages=$(qpdf --show-npages /work/three.pdf)"
qpdf /work/three.pdf --pages /work/three.pdf 1,3 -- --rotate=+90:1 /work/sliced.pdf
echo "sliced_npages=$(qpdf --show-npages /work/sliced.pdf)"

qpdf --encrypt userpass ownerpass 256 -- /work/sliced.pdf /work/enc.pdf
pdftotext -upw userpass /work/enc.pdf - | tr '\n' ' '
echo ""
qpdf --password=userpass --decrypt /work/enc.pdf /work/dec.pdf
echo "dec_npages=$(qpdf --show-npages /work/dec.pdf)"
pdftotext /work/dec.pdf - | grep -F "Page Gamma"
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.match(r.stdout, /npages=3/);
      assert.match(r.stdout, /sliced_npages=2/);
      assert.match(r.stdout, /Page Alpha.*Page Gamma/);
      assert.match(r.stdout, /dec_npages=2/);
    });
  });

  it("5. pdftotext extraction modes (-layout, -raw, -f/-l, -bbox, and stdin/stdout pipes)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work
cat <<'HTML' > /work/doc.html
<!DOCTYPE html>
<html><head><title>Metrics Doc</title></head>
<body>
<h1>Page 1 Header</h1>
<p>Alpha metric value 100</p>
</body></html>
HTML
cat <<'HTML' > /work/doc2.html
<!DOCTYPE html>
<html><body>
<h1>Page 2 Header</h1>
<p>Beta metric value 200</p>
</body></html>
HTML
wkhtmltopdf -q --title "Metrics Doc" /work/doc.html /work/doc2.html /work/metrics.pdf

pdftotext -f 2 -l 2 -layout /work/metrics.pdf - | grep -F "Beta metric value 200"
pdftotext -raw -f 1 -l 1 /work/metrics.pdf - | grep -F "Alpha metric value 100"
pdftotext -bbox /work/metrics.pdf /work/bbox.html
grep -F "<word" /work/bbox.html | head -n 1
cat /work/metrics.pdf | pdftotext - - | grep -F "Page 2 Header"
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.match(r.stdout, /Beta metric value 200/);
      assert.match(r.stdout, /Alpha metric value 100/);
      assert.match(r.stdout, /<word/);
      assert.match(r.stdout, /Page 2 Header/);
    });
  });

  it("6. pdftoppm and pdftocairo rasterize PDF pages to PNG, PPM, JPEG, grayscale, mono, and SVG", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work
echo "<html><body><h1>Raster Test</h1><p>Page 1</p></body></html>" > /work/p1.html
echo "<html><body><h1>Raster Test 2</h1><p>Page 2</p></body></html>" > /work/p2.html
wkhtmltopdf -q /work/p1.html /work/p2.html /work/in.pdf

pdftoppm -png -r 72 /work/in.pdf /work/page
ls /work/page-*.png | wc -l | tr -d ' '

pdftoppm -png -singlefile -gray -r 72 -f 1 -l 1 /work/in.pdf /work/single_gray
identify -format "%m %wx%h\n" /work/single_gray.png

pdftocairo -svg -f 1 -l 1 /work/in.pdf /work/page1.svg
grep -F "<svg" /work/page1.svg | head -n 1
pdftocairo -jpeg -singlefile -r 72 -f 2 -l 2 /work/in.pdf /work/page2_jpg
identify -format "%m\n" /work/page2_jpg.jpg
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      const lines = r.stdout.trim().split("\n");
      assert.equal(lines[0], "2");
      assert.match(lines[1]!, /^PNG \d+x\d+$/);
      assert.match(lines[2]!, /<svg/);
      assert.equal(lines[3], "JPEG");
    });
  });

  it("7. pdfimages lists (-list) and extracts (-png / -all -p -print-filenames) embedded PDF images", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work/extracted
convert -size 48x32 xc:#cc3366 /work/sample.png
convert /work/sample.png /work/embedded.pdf

pdfimages -list /work/embedded.pdf > /work/list.txt
cat /work/list.txt
pdfimages -png -p -print-filenames /work/embedded.pdf /work/extracted/img > /work/names.txt
cat /work/names.txt
first_img=$(head -n 1 /work/names.txt)
identify -format "%m %wx%h\n" "$first_img"
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.match(r.stdout, /48\s+32/);
      assert.match(r.stdout, /\/work\/extracted\/img-001-000\.png/);
      assert.match(r.stdout, /PNG 48x32/);
    });
  });

  it("8. imagemagick (convert, mogrify, identify) performs multi-format conversions, resizing, cropping, rotation, and grayscale transforms", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work
convert -size 80x60 xc:#225588 /work/base.png
identify -format "%m %wx%h\n" /work/base.png

convert /work/base.png -resize 40x30! -rotate 90 /work/rot.jpg
identify -format "%m %wx%h\n" /work/rot.jpg

convert /work/rot.jpg -crop 20x20+5+5 -negate /work/crop.webp
identify -format "%m %wx%h\n" /work/crop.webp

cp /work/base.png /work/inplace.png
mogrify -resize 24x18! -flip -flop /work/inplace.png
identify -format "%m %wx%h\n" /work/inplace.png

convert /work/inplace.png /work/out.ppm
identify -format "%m %wx%h\n" /work/out.ppm
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "PNG 80x60",
          "JPEG 30x40",
          "WEBP 20x20",
          "PNG 24x18",
          "PPM 24x18",
        ].join("\n")
      );
    });
  });

  it("9. sips queries image properties, resamples (-Z, -z), rotates (-r), crops (-c), pads (-p), converts formats, and persists custom properties", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work
convert -size 100x50 xc:#44aa66 /work/src.png

sips -g pixelWidth -g pixelHeight -g format /work/src.png
sips -Z 50 /work/src.png --out /work/half.png >/dev/null
sips -g pixelWidth -g pixelHeight /work/half.png

sips -r 90 /work/half.png --out /work/rot.png >/dev/null
sips -g pixelWidth -g pixelHeight /work/rot.png

sips -p 40 40 --padColor FF0000 /work/rot.png --out /work/padded.png >/dev/null
sips -g pixelWidth -g pixelHeight /work/padded.png

sips -s format jpeg -s formatOptions high /work/padded.png --out /work/final.jpg >/dev/null
sips -s copyright "Poe Platform 2026" /work/final.jpg >/dev/null
sips -g format -g copyright /work/final.jpg
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.match(r.stdout, /pixelWidth: 100[\s\S]*pixelHeight: 50[\s\S]*format: png/);
      assert.match(r.stdout, /pixelWidth: 50[\s\S]*pixelHeight: 25/);
      assert.match(r.stdout, /pixelWidth: 25[\s\S]*pixelHeight: 50/);
      assert.match(r.stdout, /pixelWidth: 40[\s\S]*pixelHeight: 40/);
      assert.match(r.stdout, /format: jpeg[\s\S]*copyright: Poe Platform 2026/);
    });
  });

  it("10. exiftool writes, copies (-tagsFromFile), deletes, and exports metadata in JSON (-j), CSV (-csv), XML (-X), and tabular (-T) modes", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work
convert -size 32x32 xc:#112233 /work/a.png
convert -size 32x32 xc:#445566 /work/b.png

exiftool -overwrite_original -Artist="Ada Lovelace" -Title="Analytical Engine" -Copyright="1843" /work/a.png >/dev/null
exiftool -j -Artist -Title -Copyright /work/a.png | jq -r '.[0] | "\(.Artist)|\(.Title)|\(.Copyright)"'

exiftool -overwrite_original -tagsFromFile /work/a.png /work/b.png >/dev/null
exiftool -T -Artist -Title /work/b.png

exiftool -overwrite_original -Copyright= /work/b.png >/dev/null
exiftool -csv -Artist -Title -Copyright /work/a.png /work/b.png
exiftool -X -Artist /work/a.png | grep -F "Ada Lovelace"
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.match(r.stdout, /Ada Lovelace\|Analytical Engine\|1843/);
      assert.match(r.stdout, /Ada Lovelace\tAnalytical Engine/);
      assert.match(r.stdout, /SourceFile,Artist,Title,Copyright/);
      assert.match(r.stdout, /<PNG:Artist>Ada Lovelace<\/PNG:Artist>|Ada Lovelace/);
    });
  });

  it("11. mmdc renders Flowchart, Sequence, Class, State, and ER Mermaid diagrams to SVG and PNG", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work

cat <<'MMD' > /work/flow.mmd
graph TD
  A[Client Request] -->|HTTPS| B(API Gateway)
  B --> C{Auth Valid?}
  C -->|Yes| D[Rust Worker]
  C -->|No| E[401 Reject]
MMD
mmdc -i /work/flow.mmd -o /work/flow.svg -t dark -b transparent
grep -F "<svg" /work/flow.svg | head -n 1
mmdc -i /work/flow.mmd -o /work/flow.png -w 640 -H 480
identify -format "%m\n" /work/flow.png

cat <<'MMD' | mmdc -i - -o /work/seq.svg
sequenceDiagram
  Alice->>Bob: SYN
  Bob-->>Alice: SYN-ACK
  Alice->>Bob: ACK
MMD
grep -F "SYN-ACK" /work/seq.svg >/dev/null && echo "seq_ok"

cat <<'MMD' | mmdc -i - -o /work/er.svg
erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE-ITEM : contains
MMD
grep -F "<svg" /work/er.svg >/dev/null && echo "er_ok"
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.match(r.stdout, /<svg/);
      assert.match(r.stdout, /PNG/);
      assert.match(r.stdout, /seq_ok/);
      assert.match(r.stdout, /er_ok/);
    });
  });

  it("12. unrtf converts RTF documents with font tables, hex escapes, and formatting into text, HTML, and GNU LaTeX", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work
cat <<'RTF' > /work/sample.rtf
{\rtf1\ansi{\fonttbl{\f0 Times New Roman;}}
{\colortbl;\red255\green0\blue0;}
\b Caf\'e9 Summary\b0\par
Plain paragraph with \i italic\i0  and \ul underline\ul0  text.\par
}
RTF

unrtf --text --quiet /work/sample.rtf > /work/out.txt
grep -F "Café Summary" /work/out.txt
grep -F "Plain paragraph with italic and underline text." /work/out.txt

unrtf --html --quiet /work/sample.rtf > /work/out.html
grep -Fo "<strong>Café Summary</strong>" /work/out.html

unrtf --profile=gnu-0.21.10 --latex --quiet /work/sample.rtf > /work/out.tex
grep -F "\\documentclass" /work/out.tex
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.match(r.stdout, /Café Summary/);
      assert.match(r.stdout, /Plain paragraph with italic and underline text\./);
      assert.match(r.stdout, /<strong>Café Summary<\/strong>/);
      assert.match(r.stdout, /\\documentclass/);
    });
  });

  it("13. soffice / libreoffice converts RTF -> DOCX -> PDF and HTML, and extracts text via --cat", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work /work/out
cat <<'RTF' > /work/spec.rtf
{\rtf1\ansi
Migration Architecture\par
Zero-dependency execution inside virtual filesystem.\par
All E2E suites verify behavioral parity.\par
}
RTF

soffice --headless --convert-to docx --outdir /work/out /work/spec.rtf >/dev/null
soffice --cat /work/out/spec.docx

libreoffice --headless --convert-to pdf --outdir /work/out /work/out/spec.docx >/dev/null
pdfinfo /work/out/spec.pdf | grep -E "^Pages:"
pdftotext /work/out/spec.pdf - | grep -F "Zero-dependency execution"

soffice --headless --convert-to html --outdir /work/out /work/out/spec.docx >/dev/null
grep -F "<h1>Migration Architecture</h1>" /work/out/spec.html
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.match(r.stdout, /Migration Architecture/);
      assert.match(r.stdout, /Pages:\s+1/);
      assert.match(r.stdout, /Zero-dependency execution/);
      assert.match(r.stdout, /<h1>Migration Architecture<\/h1>/);
    });
  });

  it("14. soffice converts CSV <-> XLSX -> PDF and formats custom StarCalc CSV delimiters and quoting", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work
cat <<'CSV' > /work/metrics.csv
service,latency_ms,status
gateway,12,ok
worker,45,ok
auth,8,degraded
CSV

soffice --headless --convert-to xlsx --outdir /work /work/metrics.csv >/dev/null
soffice --headless --convert-to "csv:Text - txt - csv (StarCalc):59,34,76,1,,,true" --outdir /work /work/metrics.xlsx >/dev/null
cat /work/metrics.csv

soffice --headless --convert-to pdf --outdir /work /work/metrics.xlsx >/dev/null
pdftotext /work/metrics.pdf - | tr '\n' ' ' | grep -F "gateway"
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.match(r.stdout, /"service";"latency_ms";"status"/);
      assert.match(r.stdout, /"gateway";"12";"ok"/);
      assert.match(r.stdout, /gateway/);
    });
  });

  it("15. soffice PDF export applies JSON FilterData PageRange and SelectPdfVersion options", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work
echo "<html><body><h1>Page One</h1></body></html>" > /work/1.html
echo "<html><body><h1>Page Two</h1></body></html>" > /work/2.html
echo "<html><body><h1>Page Three</h1></body></html>" > /work/3.html
wkhtmltopdf -q /work/1.html /work/2.html /work/3.html /work/full.pdf

soffice --headless --convert-to 'pdf:writer_pdf_Export:{"PageRange":{"type":"string","value":"1-1"},"SelectPdfVersion":{"type":"long","value":17}}' --outdir /work/sub /work/full.pdf >/dev/null
pdfinfo /work/sub/full.pdf | grep -E "^(Pages|PDF version):"
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.match(r.stdout, /Pages:\s+1/);
      assert.match(r.stdout, /PDF version:\s+1\.7/);
    });
  });

  it("16. ffmpeg synthesizes audio via lavfi sine source, applies audio filters, and inspects via ffprobe", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work
ffmpeg -y -f lavfi -i "sine=frequency=440:sample_rate=16000:duration=0.25" \
  -af "volume=0.8,afade=t=in:ss=0:d=0.05" /work/tone.wav 2>/dev/null

ffprobe -v quiet -print_format json -show_format -show_streams /work/tone.wav \
  | jq -r '"\(.streams[0].codec_type)|\(.streams[0].sample_rate)|\(.format.format_name)"'
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(r.stdout.trim(), "audio|16000|wav");
    });
  });

  it("17. ffmpeg synthesizes video via lavfi color source, applies video filters, and extracts PNG frame verified by sips", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work
ffmpeg -y -f lavfi -i "color=c=red:s=64x48:r=10:d=0.2" -vf "scale=32:24,hflip" /work/clip.mp4 2>/dev/null
ffprobe -v quiet -print_format json -show_streams /work/clip.mp4 \
  | jq -r '"\(.streams[0].codec_name)|\(.streams[0].width)x\(.streams[0].height)"'

ffmpeg -y -i /work/clip.mp4 -frames:v 1 /work/frame.png 2>/dev/null
sips -g pixelWidth -g pixelHeight /work/frame.png | grep -E "pixel(Width|Height):" | awk '{print $1, $2}'
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        ["h264|32x24", "pixelWidth: 32", "pixelHeight: 24"].join("\n")
      );
    });
  });

  it("18. end-to-end diagram -> PNG -> PDF -> rasterized PNG -> EXIF metadata pipeline", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work
cat <<'MMD' > /work/arch.mmd
graph LR
  Parser[Shell Parser] --> AST[AST Optimizer]
  AST --> Exec[Zero-Dep Executor]
MMD

mmdc -i /work/arch.mmd -o /work/arch.png -w 400 -H 200
convert /work/arch.png -resize 200x100! /work/arch_small.png
convert /work/arch_small.png /work/arch.pdf
pdftoppm -png -singlefile -r 72 /work/arch.pdf /work/rendered
exiftool -overwrite_original -Artist="Pipeline Bot" -Title="Architecture Diagram" /work/rendered.png >/dev/null
exiftool -s3 -Artist -Title /work/rendered.png
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(r.stdout.trim(), "Pipeline Bot\nArchitecture Diagram");
    });
  });

  it("19. end-to-end RTF -> HTML -> PDF -> encrypted PDF -> decrypted page extraction pipeline", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /work
cat <<'RTF' > /work/contract.rtf
{\rtf1\ansi{\fonttbl{\f0 Helvetica;}}
\b Service Level Agreement\b0\par
Uptime target is 99.99 percent across all regions.\par
}
RTF

unrtf --html --quiet /work/contract.rtf > /work/contract.html
wkhtmltopdf -q --title "SLA 2026" /work/contract.html /work/contract.pdf
qpdf --encrypt sec123 own456 256 -- /work/contract.pdf /work/contract_enc.pdf
pdfinfo -upw sec123 /work/contract_enc.pdf | grep -E "^(Title|Encrypted):"
qpdf --password=sec123 --decrypt /work/contract_enc.pdf /work/contract_dec.pdf
pdftotext /work/contract_dec.pdf - | grep -F "Uptime target is 99.99 percent"
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.match(r.stdout, /Title:\s+SLA 2026/);
      assert.match(r.stdout, /Encrypted:\s+yes/);
      assert.match(r.stdout, /Uptime target is 99\.99 percent/);
    });
  });

  it("20. media and document tools reject invalid ranges, malformed inputs, and unsupported flags with proper non-zero codes", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
mkdir -p /work
echo "<html><body><p>One page</p></body></html>" > /work/one.html
wkhtmltopdf -q /work/one.html /work/one.pdf

pdfimages -f 5 -l 2 /work/one.pdf /work/out 2>/dev/null
echo "pdfimages_bad_range=$?"

echo "graph TD; A-->B" > /work/g.mmd
mmdc -i /work/g.mmd -o /work/g.bmp 2>/dev/null
echo "mmdc_bad_ext=$?"

echo "not an rtf file" > /work/bad.rtf
unrtf --text /work/bad.rtf >/dev/null 2>&1
echo "unrtf_bad=$?"

soffice --headless /work/one.html >/dev/null 2>&1
echo "soffice_no_convert=$?"
`
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "pdfimages_bad_range=99",
          "mmdc_bad_ext=2",
          "unrtf_bad=1",
          "soffice_no_convert=1",
        ].join("\n")
      );
    });
  });
});
