import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure mmdc, unrtf, soffice, libreoffice, ffmpeg & ffprobe matrix", () => {
  it("01: mmdc supports -V/--version, -h/--help, -I svgId, -b transparent, accTitle/accDescr, and %%{init:...}%% theme directives", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
ver=$(mmdc -V)
mmdc --help | grep -q "Usage: mmdc"

cat <<'MMD' > /workspace/arch.mmd
%%{init: {'theme': 'dark'}}%%
flowchart LR
  accTitle: Edge Gateway Flow
  accDescr: Ingress to worker pool
  A[Ingress] --> B[Worker]
MMD

mmdc -i /workspace/arch.mmd -o /workspace/arch.svg -I custom-diagram -b transparent -q
grep -o 'id="custom-diagram"' /workspace/arch.svg
grep -o 'fill="#1e293b"' /workspace/arch.svg | head -n 1
grep -o '<title>Edge Gateway Flow</title>' /workspace/arch.svg
grep -o '<desc>Ingress to worker pool</desc>' /workspace/arch.svg
if grep -q 'fill="white"' /workspace/arch.svg; then
  echo "UNEXPECTED_BG_RECT"
else
  echo "NO_BG_RECT"
fi
printf "ver=%s\n" "$ver"
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout,
        [
          'id="custom-diagram"',
          'fill="#1e293b"',
          "<title>Edge Gateway Flow</title>",
          "<desc>Ingress to worker pool</desc>",
          "NO_BG_RECT",
          "ver=0.0.1",
          "",
        ].join("\n"),
      );
    });
  });

  it("02: mmdc renders scaled PNG and PDF outputs with -w/-H/-s, default output path, and stdout '-' streaming", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
cat <<'MMD' > /workspace/flow.mmd
graph TD
  Start --> Stop
MMD

# Default output path: /workspace/flow.mmd.svg
mmdc -i /workspace/flow.mmd
grep -o 'class="mmdc-node"' /workspace/flow.mmd.svg | head -n 1

# Scaled PNG output: 400x250 * scale 2 = 800x500
mmdc -i /workspace/flow.mmd -o /workspace/flow.png -w 400 -H 250 -s 2
identify -format "%m %wx%h\n" /workspace/flow.png

# PDF output via stdout '-' with -e pdf and -f (--pdfFit)
cat /workspace/flow.mmd | mmdc -i - -o - -e pdf -f > /workspace/flow.pdf
pdfinfo /workspace/flow.pdf | awk '/^Pages:/ {print "Pages:" $2}'
head -c 5 /workspace/flow.pdf
printf "\n"
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout,
        [
          'class="mmdc-node"',
          "PNG 800x500",
          "Pages:1",
          "%PDF-",
          "",
        ].join("\n"),
      );
    });
  });

  it("03: mmdc validates config JSON (-c), theme names, unsupported extensions, forbidden flags, and input/output path aliasing", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
cat <<'MMD' > /workspace/diag.mmd
graph LR
  A --> B
MMD

echo '{"theme":"dark"}' > /workspace/valid-cfg.json
mmdc -i /workspace/diag.mmd -o /workspace/dark.svg -c /workspace/valid-cfg.json
grep -o 'fill="#1e293b"' /workspace/dark.svg | head -n 1

echo '{broken-json' > /workspace/bad-cfg.json
mmdc -i /workspace/diag.mmd -o /workspace/out.svg -c /workspace/bad-cfg.json 2>/dev/null
rc_bad_cfg=$?

mmdc -i /workspace/diag.mmd -o /workspace/out.svg -c /workspace/missing-cfg.json 2>/dev/null
rc_missing_cfg=$?

mmdc -i /workspace/diag.mmd -o /workspace/out.svg -t neon 2>/dev/null
rc_bad_theme=$?

mmdc -i /workspace/diag.mmd -o /workspace/out.gif 2>/dev/null
rc_bad_ext=$?

cp /workspace/diag.mmd /workspace/same.svg
mmdc -i /workspace/same.svg -o /workspace/same.svg 2>/dev/null
rc_alias=$?

mmdc -i /workspace/diag.mmd -o /workspace/out.svg -p /workspace/puppeteer.json 2>/dev/null
rc_forbidden=$?

printf "bad_cfg=%d missing_cfg=%d bad_theme=%d bad_ext=%d alias=%d forbidden=%d\n" \
  "$rc_bad_cfg" "$rc_missing_cfg" "$rc_bad_theme" "$rc_bad_ext" "$rc_alias" "$rc_forbidden"
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout,
        'fill="#1e293b"\nbad_cfg=2 missing_cfg=1 bad_theme=2 bad_ext=2 alias=1 forbidden=2\n',
      );
    });
  });

  it("04: unrtf converts RTF tables, inline formatting (\\b \\i \\ul \\strike \\plain), and -t html/text/latex with --profile=gnu-0.21.10", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
cat <<'RTF' > /workspace/report.rtf
{\rtf1\ansi{\fonttbl{\f0 Courier;}}
\b Bold\b0  \i Ital\i0  \ul Under\ul0  \strike Gone\plain  Clean\par
\trowd\cellx1000\cellx2000
Alpha\cell Beta\cell\row
\trowd\cellx1000\cellx2000
Gamma\cell Delta\cell\row
}
RTF

unrtf --html --quiet /workspace/report.rtf > /workspace/report.html
grep -o '<!DOCTYPE html>' /workspace/report.html
grep -o '<strong>Bold</strong>' /workspace/report.html
grep -o '<em>Ital</em>' /workspace/report.html
grep -o '<u>Under</u>' /workspace/report.html
grep -o '<s>Gone</s>' /workspace/report.html
grep -o '<table><tbody><tr><td>Alpha</td><td>Beta</td></tr><tr><td>Gamma</td><td>Delta</td></tr></tbody></table>' /workspace/report.html

unrtf -t text /workspace/report.rtf | tr '\t' '|'
echo "---LATEX---"
unrtf --profile=gnu-0.21.10 -t=latex /workspace/report.rtf | grep -o '{\\bf Bold} {\\it Ital}'
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout,
        [
          "<!DOCTYPE html>",
          "<strong>Bold</strong>",
          "<em>Ital</em>",
          "<u>Under</u>",
          "<s>Gone</s>",
          "<table><tbody><tr><td>Alpha</td><td>Beta</td></tr><tr><td>Gamma</td><td>Delta</td></tr></tbody></table>",
          "Bold Ital Under Gone Clean",
          "Alpha|Beta|",
          "Gamma|Delta|",
          "---LATEX---",
          "{\\bf Bold} {\\it Ital}",
          "",
        ].join("\n"),
      );
    });
  });

  it("05: unrtf decodes Windows-1252 hex escapes (\\'80 \\'93 \\'94 \\'99), \\ucN Unicode fallback skips, surrogate pairs, and typography symbols", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
cat <<'RTF' > /workspace/unicode.rtf
{\rtf1\ansi
Price: \'8042 \emdash  \ldblquote Smart\rdblquote\~TM\'99 \bullet  Emoji: \uc2\u-10179??\u-8576?? Done\par
}
RTF

unrtf --text /workspace/unicode.rtf
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout,
        "Price: €42 \u2014 \u201cSmart\u201d\u00a0TM\u2122 \u2022 Emoji: 🚀 Done\n",
      );
    });
  });

  it("06: unrtf enforces strict validation on unsupported profiles, unknown flags, multiple files, and unbalanced braces", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
echo '{\rtf1 Hello}' > /workspace/a.rtf
echo '{\rtf1 World}' > /workspace/b.rtf
echo '{\rtf1 Unclosed' > /workspace/unclosed.rtf

unrtf --profile=invalid-0.1 /workspace/a.rtf >/dev/null 2>/dev/null
rc_profile=$?

unrtf --bogus-flag /workspace/a.rtf >/dev/null 2>/dev/null
rc_flag=$?

unrtf --text /workspace/a.rtf /workspace/b.rtf >/dev/null 2>/dev/null
rc_multi=$?

unrtf --text /workspace/unclosed.rtf >/dev/null 2>/dev/null
rc_unclosed=$?

printf "profile=%d flag=%d multi=%d unclosed=%d\n" "$rc_profile" "$rc_flag" "$rc_multi" "$rc_unclosed"
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(r.stdout, "profile=1 flag=1 multi=1 unclosed=1\n");
    });
  });

  it("07: soffice and libreoffice support --version, --help, --convert-to=..., --outdir=..., and StarCalc CSV filter options with quoting", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
libreoffice --version | grep -o "LibreOffice 24.8.0.0"
soffice --help | grep -q -- "--convert-to"

cat <<'CSV' > /workspace/sales.csv
region,note,amount
NA," semi;colon ",100
EU,"say ""hi""",250
CSV

# Convert CSV -> XLSX, then XLSX -> semicolon CSV with quoteAll=true (59 = ';', 34 = '"')
soffice --headless --convert-to=xlsx --outdir=/workspace/out /workspace/sales.csv > /workspace/conv1.log
grep -q "convert /workspace/sales.csv -> /workspace/out/sales.xlsx using filter : xlsx_Export" /workspace/conv1.log

libreoffice -headless -convert-to="csv:Text - txt - csv (StarCalc):59,34,76,1,,0,true" -outdir=/workspace/out /workspace/out/sales.xlsx > /workspace/conv2.log
cat /workspace/out/sales.csv
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout,
        [
          "LibreOffice 24.8.0.0",
          '"region";"note";"amount"',
          '"NA";" semi;colon ";"100"',
          '"EU";"say ""hi""";"250"',
          "",
        ].join("\n"),
      );
    });
  });

  it("08: soffice extracts stored ZIP .xlsx with xl/sharedStrings.xml, numeric <v> cells, and sparse column refs (A1, C1)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /workspace/xlsx_src/xl/worksheets
cat <<'XML' > /workspace/xlsx_src/xl/sharedStrings.xml
<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2">
  <si><t>Widget</t></si>
  <si><t>Gadget</t></si>
</sst>
XML

cat <<'XML' > /workspace/xlsx_src/xl/worksheets/sheet1.xml
<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="C1"><v>42.5</v></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>1</v></c>
      <c r="B2"><v>10</v></c>
      <c r="C2"><v>99</v></c>
    </row>
  </sheetData>
</worksheet>
XML

(cd /workspace/xlsx_src && zip -rq /workspace/sparse.xlsx xl)
soffice --headless --convert-to csv --outdir /workspace /workspace/sparse.xlsx >/dev/null
cat /workspace/sparse.csv
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout,
        ["Widget,,42.5", "Gadget,10,99", ""].join("\n"),
      );
    });
  });

  it("09: soffice extracts stored ZIP .ods, .odt, and .pptx documents and supports --cat / -cat stdout dumping", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
# 1. Build ODF 1.2 .ods with mimetype, META-INF/manifest.xml, and content.xml
mkdir -p /workspace/ods_src/META-INF
printf "application/vnd.oasis.opendocument.spreadsheet" > /workspace/ods_src/mimetype
cat <<'XML' > /workspace/ods_src/META-INF/manifest.xml
<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>
XML
cat <<'XML' > /workspace/ods_src/content.xml
<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2">
  <office:body>
    <office:spreadsheet>
      <table:table table:name="Sheet1">
        <table:table-row>
          <table:table-cell office:value-type="string"><text:p>Metric</text:p></table:table-cell>
          <table:table-cell office:value-type="string"><text:p>Value</text:p></table:table-cell>
        </table:table-row>
        <table:table-row>
          <table:table-cell office:value-type="string"><text:p>Latency</text:p></table:table-cell>
          <table:table-cell office:value-type="string"><text:p>12ms</text:p></table:table-cell>
        </table:table-row>
      </table:table>
    </office:spreadsheet>
  </office:body>
</office:document-content>
XML
(cd /workspace/ods_src && zip -rq /workspace/metrics.ods mimetype META-INF content.xml)
soffice --headless --convert-to csv --outdir /workspace /workspace/metrics.ods >/dev/null
cat /workspace/metrics.csv

# 2. Build .odt with text:h and text:p
mkdir -p /workspace/odt_src
cat <<'XML' > /workspace/odt_src/content.xml
<office:document-content>
  <office:body>
    <office:text>
      <text:h>Architecture Summary</text:h>
      <text:p>All services nominal.</text:p>
    </office:text>
  </office:body>
</office:document-content>
XML
(cd /workspace/odt_src && zip -rq /workspace/summary.odt content.xml)
echo "---ODT-CAT---"
soffice --headless --cat /workspace/summary.odt

# 3. Build .pptx with ppt/slides/slide1.xml and slide2.xml
mkdir -p /workspace/pptx_src/ppt/slides
cat <<'XML' > /workspace/pptx_src/ppt/slides/slide1.xml
<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide One Title</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>
XML
cat <<'XML' > /workspace/pptx_src/ppt/slides/slide2.xml
<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide Two Takeaway</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>
XML
(cd /workspace/pptx_src && zip -rq /workspace/deck.pptx ppt)
echo "---PPTX-CAT---"
libreoffice -cat /workspace/deck.pptx | sed '/^$/d'
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout,
        [
          "Metric,Value",
          "Latency,12ms",
          "---ODT-CAT---",
          "Architecture Summary",
          "All services nominal.",
          "---PPTX-CAT---",
          "Slide One Title",
          "Slide Two Takeaway",
          "",
        ].join("\n"),
      );
    });
  });

  it("10: soffice converts Markdown pipe tables (.md) to .xlsx and round-trips back to .csv and .pdf", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
cat <<'MD' > /workspace/services.md
| Service | Port | Status |
| :--- | :---: | ---: |
| api-gateway | 8080 | healthy |
| auth-worker | 9090 | degraded |
MD

soffice --headless --convert-to xlsx --outdir /workspace /workspace/services.md >/dev/null
soffice --headless --convert-to csv --outdir /workspace /workspace/services.xlsx >/dev/null
cat /workspace/services.csv

soffice --headless --convert-to pdf --outdir /workspace /workspace/services.xlsx >/dev/null
pdftotext /workspace/services.pdf - | grep -o "api-gateway"
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout,
        [
          "Service,Port,Status",
          "api-gateway,8080,healthy",
          "auth-worker,9090,degraded",
          "api-gateway",
          "",
        ].join("\n"),
      );
    });
  });

  it("11: ffmpeg supports introspection flags (-version, -formats, -demuxers, -muxers, -codecs, -decoders, -encoders, -protocols, -filters)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
ffmpeg -version | head -n 1
ffmpeg -formats | grep -o "mp4" | head -n 1
ffmpeg -demuxers | grep -o "mov" | head -n 1
ffmpeg -muxers | grep -o "webm" | head -n 1
ffmpeg -codecs | grep -o "h264" | head -n 1
ffmpeg -decoders | grep -o "aac" | head -n 1
ffmpeg -encoders | grep -o "pcm_s16le" | head -n 1
ffmpeg -protocols | grep -o "pipe" | head -n 1
ffmpeg -filters | grep -o "hstack" | head -n 1
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout,
        [
          "ffmpeg version 7.1-safe-bash Copyright (c) 2000-2025 the FFmpeg developers",
          "mp4",
          "mov",
          "webm",
          "h264",
          "aac",
          "pcm_s16le",
          "pipe",
          "hstack",
          "",
        ].join("\n"),
      );
    });
  });

  it("12: ffmpeg parses flexible timestamps (HH:MM:SS.mmm, ms, s), -ss/-to trimming, -frames:v, and -n no-overwrite enforcement", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
ffmpeg -f lavfi -i testsrc=size=160x120:rate=20:duration=4 -f lavfi -i sine=frequency=440:sample_rate=48000:duration=4 /workspace/source.mp4

# Trim from 500ms to 00:00:02.000 => duration 1.5s, 30 frames at 20fps
ffmpeg -ss 500ms -to 00:00:02.000 -i /workspace/source.mp4 /workspace/trimmed.mp4
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 /workspace/trimmed.mp4
ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=nb_read_frames -of default=noprint_wrappers=1:nokey=1 /workspace/trimmed.mp4

# Cap frames with -frames:v 10 -an at 20fps => duration 0.5s
ffmpeg -i /workspace/source.mp4 -an -frames:v 10 /workspace/tenframes.mp4
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 /workspace/tenframes.mp4

# -n refuses to overwrite existing output
ffmpeg -n -i /workspace/source.mp4 /workspace/tenframes.mp4 2>/dev/null && rc_no_overwrite=0 || rc_no_overwrite=$?
printf "no_overwrite=%d\n" "$rc_no_overwrite"
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout,
        ["1.500000", "30", "0.500000", "no_overwrite=1", ""].join("\n"),
      );
    });
  });

  it("13: ffmpeg applies -vf video filters (scale=iw/2:ih/2, scale=-1:H, scale=W:-2, crop, pad, transpose=1, fps)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
ffmpeg -f lavfi -i testsrc=size=200x100:rate=24:duration=2 /workspace/base.mp4

# 1. scale=iw/2:ih/2 -> 100x50
ffmpeg -i /workspace/base.mp4 -vf "scale=iw/2:ih/2" /workspace/half.mp4
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 /workspace/half.mp4

# 2. scale=-1:50 -> 100x50
ffmpeg -i /workspace/base.mp4 -vf "scale=-1:50" /workspace/aspect_h.mp4
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 /workspace/aspect_h.mp4

# 3. crop=120:80:10:10,pad=160:120:20:20,transpose=1,fps=15 -> 120x160 @ 15fps
ffmpeg -i /workspace/base.mp4 -vf "crop=120:80:10:10,pad=160:120:20:20,transpose=1,fps=15" /workspace/chain.mp4
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate -of csv=p=0 /workspace/chain.mp4
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout,
        ["100,50", "100,50", "120,160,15/1", ""].join("\n"),
      );
    });
  });

  it("14: ffmpeg executes -filter_complex hstack, vstack, and concat across multiple video inputs", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
ffmpeg -f lavfi -i color=c=red:s=80x60:r=10:d=1 /workspace/clip1.mp4
ffmpeg -f lavfi -i color=c=blue:s=80x60:r=10:d=2 /workspace/clip2.mp4

# hstack -> 160x60
ffmpeg -i /workspace/clip1.mp4 -i /workspace/clip2.mp4 -filter_complex "[0:v][1:v]hstack=inputs=2" /workspace/hstacked.mp4
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 /workspace/hstacked.mp4

# vstack -> 80x120
ffmpeg -i /workspace/clip1.mp4 -i /workspace/clip2.mp4 -filter_complex "[0:v][1:v]vstack=inputs=2" /workspace/vstacked.mp4
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 /workspace/vstacked.mp4

# concat -> duration 1 + 2 = 3s
ffmpeg -i /workspace/clip1.mp4 -i /workspace/clip2.mp4 -filter_complex "[0:v][1:v]concat=n=2:v=1:a=0" /workspace/concat.mp4
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 /workspace/concat.mp4
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout,
        ["160,60", "80,120", "3.000000", ""].join("\n"),
      );
    });
  });

  it("15: ffmpeg supports -an (strip audio), -vn (strip video), .mpd DASH manifest, and .ffmeta metadata export", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
ffmpeg -f lavfi -i testsrc=size=128x72:rate=12:duration=2 -f lavfi -i sine=frequency=880:sample_rate=44100:duration=2 -metadata title="TelemetryStream" -metadata artist="SafeBash" /workspace/av.mp4

# Strip audio with -an
ffmpeg -i /workspace/av.mp4 -an /workspace/video_only.mp4
ffprobe -v error -show_entries stream=codec_type -of csv=p=0 /workspace/video_only.mp4

# Strip video with -vn
ffmpeg -i /workspace/av.mp4 -vn /workspace/audio_only.mp4
ffprobe -v error -show_entries stream=codec_type -of csv=p=0 /workspace/audio_only.mp4

# Export DASH .mpd and .ffmeta
ffmpeg -i /workspace/av.mp4 /workspace/stream.mpd
grep -o '<MPD' /workspace/stream.mpd

ffmpeg -i /workspace/av.mp4 /workspace/meta.ffmeta
head -n 1 /workspace/meta.ffmeta
grep -E "^(title|artist)=" /workspace/meta.ffmeta | sort
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout,
        [
          "video",
          "audio",
          "<MPD",
          ";FFMETADATA1",
          "artist=SafeBash",
          "title=TelemetryStream",
          "",
        ].join("\n"),
      );
    });
  });

  it("16: ffprobe formats multi-field -show_entries across json, default, csv, compact, and flat outputs with -i and -select_streams", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
ffmpeg -f lavfi -i testsrc=size=320x180:rate=30:duration=2.5 -f lavfi -i sine=frequency=440:sample_rate=48000:duration=2.5 /workspace/probe.mp4

# 1. default=noprint_wrappers=1 (with keys)
ffprobe -v error -i /workspace/probe.mp4 -select_streams v:0 -show_entries stream=codec_name,width,height -of default=noprint_wrappers=1

# 2. csv=p=0
ffprobe -v error -select_streams a:0 -show_entries stream=codec_type,sample_rate,channels -of csv=p=0 /workspace/probe.mp4

# 3. compact
ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height -of compact /workspace/probe.mp4

# 4. flat
ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width -of flat /workspace/probe.mp4

# 5. JSON format + streams
ffprobe -v error -show_format -show_streams -of json /workspace/probe.mp4 | jq -r '[(.format.format_name | contains("mp4")), (.streams | length), .streams[0].width, .streams[1].sample_rate] | @csv'

# 6. Missing file returns exit code 1
ffprobe /workspace/does-not-exist.mp4 2>/dev/null && rc_missing=0 || rc_missing=$?
printf "missing=%d\n" "$rc_missing"
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout,
        [
          "codec_name=h264",
          "width=320",
          "height=180",
          "audio,48000,1",
          "stream|codec_name=h264|width=320|height=180",
          'streams.stream.0.codec_name="h264"',
          "streams.stream.0.width=320",
          'true,2,320,"48000"',
          "missing=1",
          "",
        ].join("\n"),
      );
    });
  });

  it("17: end-to-end diagram and document pipeline: mmdc SVG/PNG -> soffice HTML/XLSX/PDF -> pdfinfo/pdftotext/identify", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
cat <<'MMD' > /workspace/pipeline.mmd
flowchart LR
  accTitle: Checkout Sequence
  Client[Client] --> API[API]
MMD

mmdc -i /workspace/pipeline.mmd -o /workspace/pipeline.svg -t neutral
mmdc -i /workspace/pipeline.mmd -o /workspace/pipeline.png -w 500 -H 300

grep -o '<title>Checkout Sequence</title>' /workspace/pipeline.svg
identify -format "%m %wx%h\n" /workspace/pipeline.png

cat <<'RTF' > /workspace/spec.rtf
{\rtf1\ansi
\b Order Service Specification\b0\par
\trowd\cellx1000\cellx2000
Endpoint\cell LatencySLA\cell\row
\trowd\cellx1000\cellx2000
POST /orders\cell 45ms\cell\row
}
RTF

unrtf --html --quiet /workspace/spec.rtf > /workspace/spec.html
htmlq --text "table tr td" -f /workspace/spec.html | tr '\n' ',' | sed 's/,$//'
printf "\n"
soffice --headless --convert-to pdf --outdir /workspace /workspace/spec.html >/dev/null
pdftotext /workspace/spec.pdf - | grep -o "Order Service Specification"
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout,
        [
          "<title>Checkout Sequence</title>",
          "PNG 500x300",
          "Endpoint,LatencySLA,POST /orders,45ms",
          "Order Service Specification",
          "",
        ].join("\n"),
      );
    });
  });

  it("18: end-to-end video frame extraction and montage pipeline: ffmpeg lavfi -> frame PNGs -> magick montage -> ffprobe verification", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
ffmpeg -f lavfi -i testsrc=size=120x90:rate=10:duration=2 /workspace/raw.mp4
ffmpeg -ss 0.5 -i /workspace/raw.mp4 -vf "scale=80:60" -frames:v 1 /workspace/frame1.png
ffmpeg -ss 1.2 -i /workspace/raw.mp4 -vf "scale=80:60,transpose=1" -frames:v 1 /workspace/frame2.png

identify -format "%f:%wx%h\n" /workspace/frame1.png /workspace/frame2.png
ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height -of csv=p=0 /workspace/frame1.png
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout,
        ["frame1.png:80x60", "frame2.png:60x80", "png,80,60", ""].join("\n"),
      );
    });
  });

  it("19: end-to-end audio synthesis and analysis pipeline: ffmpeg sine -> wav -> soxi/ffprobe -> trimmed wav", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
ffmpeg -f lavfi -i sine=frequency=660:sample_rate=22050:duration=3 /workspace/tone.wav
soxi -r /workspace/tone.wav
soxi -c /workspace/tone.wav

ffmpeg -ss 0.5 -to 2.0 -i /workspace/tone.wav -ar 44100 -ac 2 /workspace/sub.wav
ffprobe -v error -select_streams a:0 -show_entries stream=sample_rate,channels -of csv=p=0 /workspace/sub.wav
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 /workspace/sub.wav
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout,
        ["22050", "1", "44100,2", "1.500000", ""].join("\n"),
      );
    });
  });

  it("20: end-to-end executive bundle: RTF table -> unrtf -> CSV -> soffice XLSX/PDF + mmdc diagram + ffmpeg preview -> zip archive", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /workspace/bundle

cat <<'RTF' > /workspace/bundle/kpi.rtf
{\rtf1\ansi
\trowd\cellx1000\cellx2000\cellx3000
Quarter\cell Revenue\cell Margin\cell\row
\trowd\cellx1000\cellx2000\cellx3000
Q1\cell 1200\cell 22.5\cell\row
\trowd\cellx1000\cellx2000\cellx3000
Q2\cell 1550\cell 26.0\cell\row
}
RTF

unrtf -t text /workspace/bundle/kpi.rtf | tr '\t' ',' | sed 's/,$//' > /workspace/bundle/kpi.csv
soffice --headless --convert-to xlsx --outdir /workspace/bundle /workspace/bundle/kpi.csv >/dev/null
soffice --headless --convert-to pdf --outdir /workspace/bundle /workspace/bundle/kpi.xlsx >/dev/null

cat <<'MMD' > /workspace/bundle/topology.mmd
graph LR
  Ingest --> Warehouse --> BI
MMD
mmdc -i /workspace/bundle/topology.mmd -o /workspace/bundle/topology.svg -I bi-topo

ffmpeg -f lavfi -i testsrc=size=160x90:rate=15:duration=2 /workspace/bundle/demo.mp4
ffprobe -v error -show_format -show_streams -of json /workspace/bundle/demo.mp4 > /workspace/bundle/demo-probe.json

(cd /workspace/bundle && zip -rq /workspace/executive-bundle.zip kpi.csv kpi.xlsx kpi.pdf topology.svg demo.mp4 demo-probe.json)
unzip -l /workspace/executive-bundle.zip | grep -E "kpi\.xlsx|kpi\.pdf|topology\.svg|demo-probe\.json" | wc -l | tr -d ' '
jq -r '.streams[0].width' /workspace/bundle/demo-probe.json
xan stats -s Revenue /workspace/bundle/kpi.csv | xan select field,sum,mean | tail -n +2
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout,
        ["4", "160", "Revenue,2750,1375", ""].join("\n"),
      );
    });
  });
});
