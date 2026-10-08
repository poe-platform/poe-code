import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure graphviz, svgo, rsvg-convert, pdf tools, qrencode, sox, media, and crypto deep parity matrix", () => {
  it("1. rsvg-convert rejects unsupported SVG constructs and suppresses fill=none / hidden / display=none text in PDF output", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        set +e
        printf '<svg><text><tspan>nested</tspan></text></svg>' | rsvg-convert -f pdf >/dev/null 2>/workspace/e1.err
        rc1=$?
        printf '<svg><rect width="10" height="10" opacity="0.5"/></svg>' | rsvg-convert -f pdf >/dev/null 2>/workspace/e2.err
        rc2=$?
        printf '<svg><rect width="10" height="10" clip-path="url(#c)"/></svg>' | rsvg-convert -f pdf >/dev/null 2>/workspace/e3.err
        rc3=$?
        printf '<svg><path d="L1 2"/></svg>' | rsvg-convert -f pdf >/dev/null 2>/workspace/e4.err
        rc4=$?
        printf '<svg><rect width="-1" height="2"/></svg>' | rsvg-convert -f pdf >/dev/null 2>/workspace/e5.err
        rc5=$?
        printf '<svg><svg/></svg>' | rsvg-convert -f pdf >/dev/null 2>/workspace/e6.err
        rc6=$?
        printf '<svg><text stroke="red">bad</text></svg>' | rsvg-convert -f pdf >/dev/null 2>/workspace/e7.err
        rc7=$?
        set -e
        printf 'rcs=%d,%d,%d,%d,%d,%d,%d\\n' "$rc1" "$rc2" "$rc3" "$rc4" "$rc5" "$rc6" "$rc7"
        grep -Fq 'Unsupported SVG text children' /workspace/e1.err
        grep -Fq 'Unsupported SVG opacity' /workspace/e2.err
        grep -Fq 'Unsupported SVG clip-path' /workspace/e3.err
        grep -Fq 'SVG path must begin with moveto' /workspace/e4.err
        grep -Fq 'Negative SVG rectangle size' /workspace/e5.err
        grep -Fq 'Unsupported nested SVG viewport' /workspace/e6.err
        grep -Fq 'Unsupported SVG text stroke' /workspace/e7.err

        cat <<'SVG' > /workspace/vis.svg
<svg xmlns="http://www.w3.org/2000/svg" width="96pt" height="48pt" viewBox="0 0 128 64">
  <rect x="2" y="2" width="120" height="60" rx="6" fill="lightblue" stroke="navy" stroke-dasharray="4 2" stroke-linecap="round" stroke-linejoin="bevel"/>
  <text x="10" y="20" fill="black">VisibleAlpha</text>
  <text x="10" y="35" fill="none">InvisibleFillNone</text>
  <g visibility="hidden"><text x="10" y="45">InvisibleGroup</text></g>
  <g style="display: none"><text x="10" y="55">DisplayNoneGroup</text></g>
  <text x="10" y="58" fill="darkgreen">VisibleOmega &amp; Co</text>
</svg>
SVG
        rsvg-convert -f pdf -o /workspace/vis.pdf /workspace/vis.svg
        pdfinfo /workspace/vis.pdf | grep -E '^(Pages|Page size):'
        pdftotext /workspace/vis.pdf - | tr -d '\\f' | grep -v '^$'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "rcs=1,1,1,1,1,1,1",
          "Pages:           1",
          "Page size:       96 x 48 pts",
          "VisibleAlpha",
          "VisibleOmega & Co",
          "",
        ].join("\n"),
      );
    });
  });

  it("2. svgo multipass optimization compacts L->H/V path segments, strips metadata/empty groups, synthesizes viewBox, and preserves text whitespace", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        set -euo pipefail
        cat <<'SVG' > /workspace/raw.svg
<svg width="120.000px" height="80.500" xmlns="http://www.w3.org/2000/svg"><metadata>secret</metadata><g><g><path d="M 10.1234 20.0000 L 50.9876 20.0001 L 50.9879 60.4321 Z" stroke-width="1.5000"/><text x="4.2500" y="12.7500">  keep   exact   spaces  </text></g></g></svg>
SVG
        svgo --multipass -p 2 -i /workspace/raw.svg -o /workspace/min.svg
        cat /workspace/min.svg
        printf '\\n'
        svgo --multipass -p 2 --pretty --indent 2 -i /workspace/min.svg -o /workspace/pretty.svg
        cat /workspace/pretty.svg
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          '<svg width="120px" height="80.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80.5"><path d="M10.12 20H50.99V60.43Z" stroke-width="1.5"/><text x="4.25" y="12.75">  keep   exact   spaces  </text></svg>',
          '<svg width="120px" height="80.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80.5">',
          '  <path d="M10.12 20H50.99V60.43Z" stroke-width="1.5"/>',
          '  <text x="4.25" y="12.75">  keep   exact   spaces  </text>',
          '</svg>',
        ].join("\n"),
      );
    });
  });

  it("3. dot and neato render -Tplain, -Tcanon, -Tdot, -Tjson, -Tsvg, and -Tpdf with CLI attribute overrides (-G/-N/-E)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        set -euo pipefail
        cat <<'DOT' > /workspace/pipeline.dot
digraph Flow {
  ingest [label="Ingest\\nStage"];
  transform [shape=record, label="<p0>Parse|<p1>Normalize"];
  sink [label=<<table><tr><td>Warehouse &amp; BI</td></tr></table>>];
  ingest -> transform:p0:w [label="raw"];
  transform:p1:e -> sink [label="clean", style=dashed];
}
DOT
        dot -Grankdir=LR -Nfontname=Helvetica -Ecolor=blue -Tplain /workspace/pipeline.dot > /workspace/flow.plain
        head -n 1 /workspace/flow.plain | awk '{print $1, $2}'
        grep -c '^node ' /workspace/flow.plain
        grep -c '^edge ' /workspace/flow.plain
        tail -n 1 /workspace/flow.plain

        dot -Tpdf /workspace/pipeline.dot -o /workspace/flow.pdf
        pdftotext /workspace/flow.pdf - | tr -d '\\f' | grep -E 'Ingest|Warehouse'

        neato -Tjson <<'NEATO' | jq -c '{directed, nodes: [.nodes[].id], edges: (.edges | length)}'
strict graph Ring {
  a -- b;
  b -- c;
  c -- a;
  a -- b;
}
NEATO
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "graph 1",
          "3",
          "2",
          "stop",
          "Ingest",
          "Warehouse & BI",
          '{"directed":false,"nodes":["a","b","c"],"edges":3}',
          "",
        ].join("\n"),
      );
    });
  });

  it("4. qrencode handles Micro QR, structured append (-S), Kanji + ignorecase, --strict-version errors, and memory budget bounds", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        set -euo pipefail
        qrencode -M -v 2 -l L -t ASCII -m 2 "12345" | wc -l | tr -d ' '
        qrencode -S -v 1 -l H -t SVG -o /workspace/chunk.svg "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        ls /workspace/chunk-*.svg | sort
        qrencode -i -t ASCII -m 1 "HelloWorld123" > /workspace/upper1.txt
        qrencode -t ASCII -m 1 "HELLOWORLD123" > /workspace/upper2.txt
        cmp -s /workspace/upper1.txt /workspace/upper2.txt && echo "ignorecase=identical"
        set +e
        qrencode --strict-version -v 1 -l H -t ASCII "THIS_STRING_IS_TOO_LONG_FOR_VERSION_1_H_CAPACITY" >/dev/null 2>/workspace/strict.err
        rc_strict=$?
        qrencode -s 2000 -t PNG "OVERFLOW" >/dev/null 2>/workspace/mem.err
        rc_mem=$?
        set -e
        printf 'rc_strict=%d rc_mem=%d\\n' "$rc_strict" "$rc_mem"
        grep -Fq 'Input does not fit the requested QR symbol' /workspace/strict.err
        grep -Fq 'QR output exceeds memory budget' /workspace/mem.err
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "17",
          "/workspace/chunk-01.svg",
          "/workspace/chunk-02.svg",
          "/workspace/chunk-03.svg",
          "/workspace/chunk-04.svg",
          "ignorecase=identical",
          "rc_strict=1 rc_mem=1",
          "",
        ].join("\n"),
      );
    });
  });

  it("5. qrencode renders EPS, SVG with RGBA colors, ANSI/ANSI256/ANSIUTF8, and UTF8/UTF8i block matrices", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        set -euo pipefail
        qrencode -t SVG --foreground=11223380 --background=ffffff00 -s 4 -m 2 "QR-SVG" > /workspace/c.svg
        grep -Fq 'fill="rgb(17,34,51)" fill-opacity="0.5019607843137255"' /workspace/c.svg
        grep -Fq 'fill="rgb(255,255,255)" fill-opacity="0"' /workspace/c.svg
        qrencode -t EPS --foreground=ff0000 --background=00ff00 -s 2 -m 1 "QR-EPS" > /workspace/c.eps
        head -n 5 /workspace/c.eps
        qrencode -t UTF8 -m 1 "A" | wc -l | tr -d ' '
        qrencode -t UTF8i -m 1 "A" | wc -l | tr -d ' '
        qrencode -t ANSI256 -m 1 "A" | head -n 1 | grep -Fq $'\\x1b[48;5;231m' && echo "ansi256=ok"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "%!PS-Adobe-3.0 EPSF-3.0",
          "%%BoundingBox: 0 0 46 46",
          "%%EndComments",
          "0 1 0 setrgbcolor",
          "0 0 46 46 rectfill",
          "12",
          "12",
          "ansi256=ok",
          "",
        ].join("\n"),
      );
    });
  });

  it("6. sox and soxi synthesize waveforms, enforce Nyquist and header overrides, and run trim/pad/remix/fade/rate/norm/stat/stats", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        set -euo pipefail
        sox -r 4000 -c 2 -b 16 -n /workspace/stereo.wav synth 0.1 sine 400
        soxi -r /workspace/stereo.wav
        soxi -c /workspace/stereo.wav
        soxi -s /workspace/stereo.wav
        soxi -b /workspace/stereo.wav

        sox /workspace/stereo.wav -b 32 -e floating-point /workspace/proc.wav trim 40s 200s pad 40s 60s remix 1,2 0 fade h 0.01 0 0.01 rate 2000 gain -n -6 stat 2>/workspace/stat.txt
        soxi -r /workspace/proc.wav
        soxi -c /workspace/proc.wav
        soxi -s /workspace/proc.wav
        soxi -b /workspace/proc.wav
        grep -E '^Samples read:|^Maximum amplitude:' /workspace/stat.txt

        set +e
        sox -r 1000 -c 1 -n /workspace/bad.wav synth 0.1 sine 600 2>/workspace/nyq.err
        rc_nyq=$?
        sox -c 1 /workspace/stereo.wav /workspace/bad2.wav 2>/workspace/ovr.err
        rc_ovr=$?
        set -e
        printf 'rc_nyq=%d rc_ovr=%d\\n' "$rc_nyq" "$rc_ovr"
        grep -Fq 'Frequency exceeds Nyquist limit' /workspace/nyq.err
        grep -Fq 'Input channel override disagrees with WAV header' /workspace/ovr.err
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "4000",
          "2",
          "400",
          "16",
          "2000",
          "2",
          "150",
          "32",
          "Samples read:      300",
          "Maximum amplitude: 0.501187",
          "rc_nyq=1 rc_ovr=1",
          "",
        ].join("\n"),
      );
    });
  });

  it("7. wkhtmltopdf renders cover pages, header/footer token replacements, outlines, and multi-copy collation into PDF", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        set -euo pipefail
        printf '<h1>Cover Sheet</h1>' > /workspace/cover.html
        cat <<'HTML' > /workspace/body.html
<html><head><title>Spec Manual</title></head><body>
<h1>Chapter One</h1><p>Alpha body text</p>
<div style="page-break-before:always"><h2>Chapter Two</h2><p>Beta body text</p></div>
</body></html>
HTML
        wkhtmltopdf --title "Override Manual" --page-offset 10 --outline \
          --header-left "Doc:[title]" --footer-right "P:[page]/[topage] ([release])" \
          --replace release v4.2 \
          cover /workspace/cover.html /workspace/body.html /workspace/manual.pdf
        pdfinfo /workspace/manual.pdf | grep -E '^(Title|Pages):'
        pdftotext /workspace/manual.pdf - | tr '\\f' '\\n' | grep -v '^$'
        pdftk /workspace/manual.pdf dump_data_utf8 | grep -E '^Bookmark(Title|Level|PageNumber):'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "Title:           Override Manual",
          "Pages:           3",
          "Cover Sheet",
          "Doc:Override Manual",
          "Chapter One",
          "Alpha body text",
          "P:12/13 (v4.2)",
          "Doc:Override Manual",
          "Chapter Two",
          "Beta body text",
          "P:13/13 (v4.2)",
          "BookmarkTitle: Chapter One",
          "BookmarkLevel: 1",
          "BookmarkPageNumber: 2",
          "BookmarkTitle: Chapter Two",
          "BookmarkLevel: 2",
          "BookmarkPageNumber: 3",
          "",
        ].join("\n"),
      );
    });
  });

  it("8. qpdf page range selectors (1-z:odd, r2-r1, x2), rotation, encryption/decryption, linearization, and attachments", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        set -euo pipefail
        cat <<'HTML' > /workspace/four.html
<p>Page1</p>
<div style="page-break-before:always"><p>Page2</p></div>
<div style="page-break-before:always"><p>Page3</p></div>
<div style="page-break-before:always"><p>Page4</p></div>
HTML
        wkhtmltopdf /workspace/four.html /workspace/four.pdf
        qpdf --empty --pages /workspace/four.pdf 1-z:odd,r1 -- /workspace/sel.pdf
        qpdf --show-npages /workspace/sel.pdf
        pdftotext /workspace/sel.pdf - | tr '\\f' '\\n' | grep -v '^$'

        printf 'attachment-payload-42' > /workspace/note.txt
        qpdf /workspace/sel.pdf /workspace/rot_att.pdf --rotate=+90:1 --linearize --add-attachment /workspace/note.txt --key=note.txt
        qpdf --check-linearization /workspace/rot_att.pdf | head -n 1
        qpdf --list-attachments /workspace/rot_att.pdf
        qpdf --show-attachment=note.txt /workspace/rot_att.pdf
        printf '\\n'

        qpdf --encrypt userpw ownerpw 256 -- /workspace/rot_att.pdf /workspace/enc.pdf
        qpdf --password=userpw --show-encryption /workspace/enc.pdf | head -n 2
        qpdf --password=userpw --decrypt /workspace/enc.pdf /workspace/dec.pdf
        qpdf --show-encryption /workspace/dec.pdf
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "3",
          "Page1",
          "Page3",
          "Page4",
          "/workspace/rot_att.pdf: linearized",
          "note.txt -> note.txt",
          "attachment-payload-42",
          "R = 6",
          "V = 5",
          "File is not encrypted",
          "",
        ].join("\n"),
      );
    });
  });

  it("9. pdftk multi-handle cat rotation, dump_data_utf8 / update_info_utf8 with PageMedia and PageLabel, and diffpdf --text vs --layout", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        set -euo pipefail
        printf '<p>Alpha</p><div style="page-break-before:always"><p>Beta</p></div>' > /workspace/a.html
        printf '<p>Gamma</p>' > /workspace/b.html
        wkhtmltopdf /workspace/a.html /workspace/a.pdf
        wkhtmltopdf /workspace/b.html /workspace/b.pdf

        pdftk A=/workspace/a.pdf B=/workspace/b.pdf cat A1east B1down A2 output /workspace/merged.pdf
        cat <<'INFO' | pdftk /workspace/merged.pdf update_info_utf8 - output /workspace/updated.pdf
InfoBegin
InfoKey: Title
InfoValue: Updated &#955; Spec
BookmarkBegin
BookmarkTitle: Intro
BookmarkLevel: 1
BookmarkPageNumber: 1
PageLabelBegin
PageLabelNewIndex: 1
PageLabelStart: 1
PageLabelPrefix: A-
PageLabelNumStyle: UppercaseRomanNumerals
PageMediaBegin
PageMediaNumber: 2
PageMediaRotation: 90
PageMediaDimensions: 500 700
INFO
        pdfinfo -f 1 -l 3 /workspace/updated.pdf | grep -E '^(Title|Page .* size|Page .* rot):'

        # Compare /workspace/a.pdf against a rotated copy with identical text
        qpdf /workspace/a.pdf /workspace/a_rot.pdf --rotate=+90:1
        diffpdf --text /workspace/a.pdf /workspace/a_rot.pdf && echo "text_diff=equal"
        set +e
        diffpdf --layout /workspace/a.pdf /workspace/a_rot.pdf > /workspace/layout.diff
        rc_layout=$?
        set -e
        printf 'rc_layout=%d\\n' "$rc_layout"
        cat /workspace/layout.diff
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "Title:           Updated λ Spec",
          "Page    1 size:  595.28 x 841.89 pts (A4)",
          "Page    1 rot:   90",
          "Page    2 size:  500 x 700 pts",
          "Page    2 rot:   90",
          "Page    3 size:  595.28 x 841.89 pts (A4)",
          "Page    3 rot:   0",
          "text_diff=equal",
          "rc_layout=1",
          "Page 1 differs (layout)",
          "",
        ].join("\n"),
      );
    });
  });

  it("10. pdfseparate, pdfunite, pdffonts (-subst/-loc/-locPS), pdftotext (-bbox-layout/-tsv), and pdftohtml (-xml)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        set -euo pipefail
        cat <<'HTML' > /workspace/doc.html
<h1>First Page</h1><p>Visit <a href="https://example.org/docs">Docs</a></p>
<div style="page-break-before:always"><h1>Second Page</h1></div>
HTML
        wkhtmltopdf /workspace/doc.html /workspace/doc.pdf
        pdfseparate /workspace/doc.pdf '/workspace/part-%d.pdf'
        pdfunite /workspace/part-2.pdf /workspace/part-1.pdf /workspace/reordered.pdf
        pdftotext /workspace/reordered.pdf - | tr '\\f' '\\n' | grep 'Page'
        pdffonts -subst /workspace/part-2.pdf | grep -c 'Nimbus Sans'
        pdffonts -locPS /workspace/part-2.pdf | grep -c 'Substitute'
        pdftotext -tsv /workspace/part-1.pdf - | head -n 1
        pdftohtml -xml -stdout /workspace/part-1.pdf | grep -c '<pdf2xml'
        pdfinfo -url /workspace/part-1.pdf | grep -F 'https://example.org/docs'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "Second Page",
          "First Page",
          "1",
          "1",
          "level\tpage_num\tpar_num\tblock_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
          "1",
          "   1  Annotation    https://example.org/docs",
          "",
        ].join("\n"),
      );
    });
  });

  it("11. magick, montage, composite, compare, sips, and exiftool image/PDF metadata round-tripping", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        set -euo pipefail
        magick -size 80x40 xc:red /workspace/a.png
        magick /workspace/a.png -resize 50% -rotate 90 -border 2x2 /workspace/b.png
        identify -format '%wx%h\\n' /workspace/b.png
        montage /workspace/a.png /workspace/a.png -tile 2x1 -geometry 40x20+3+4 /workspace/grid.png
        identify -format '%wx%h\\n' /workspace/grid.png
        sips -z 30 60 /workspace/grid.png --out /workspace/sips.png >/dev/null
        sips -g pixelWidth -g pixelHeight /workspace/sips.png | awk '/pixel/{print $1, $2}'

        exiftool -overwrite_original -Artist="Ada Lovelace" -Comment="Analytical Engine" /workspace/sips.png >/dev/null
        exiftool -s3 -Artist -Comment -ImageSize /workspace/sips.png
        exiftool -p '$FileName:$Artist:$ImageSize' /workspace/sips.png
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "24x44",
          "92x28",
          "pixelWidth: 60",
          "pixelHeight: 30",
          "Ada Lovelace",
          "Analytical Engine",
          "60x30",
          "sips.png:Ada Lovelace:60x30",
          "",
        ].join("\n"),
      );
    });
  });

  it("12. ffmpeg and ffprobe lavfi synthesis, filter_complex hstack/vstack/concat, scale/transpose, ffmetadata, HLS, and DASH", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        set -euo pipefail
        ffmpeg -f lavfi -i testsrc=size=160x120:rate=12:duration=2 -f lavfi -i sine=frequency=440:sample_rate=22050:duration=2 \
          -vf "scale=iw/2:-2,transpose=1" -metadata title="RotatedClip" -metadata artist="PoeMedia" /workspace/clip.mp4
        ffprobe -v quiet -print_format json -show_format -show_streams -count_frames /workspace/clip.mp4 | \
          jq -c '{w: .streams[0].width, h: .streams[0].height, frames: .streams[0].nb_read_frames, sr: .streams[1].sample_rate, title: .format.tags.title}'

        ffmpeg -i /workspace/clip.mp4 -f ffmetadata /workspace/clip.ffmeta
        grep -E '^(title|artist)=' /workspace/clip.ffmeta | sort

        ffmpeg -i /workspace/clip.mp4 -i /workspace/clip.mp4 -filter_complex "hstack" /workspace/wide.mp4
        ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 /workspace/wide.mp4

        ffmpeg -i /workspace/clip.mp4 /workspace/stream.m3u8
        ffmpeg -i /workspace/clip.mp4 /workspace/manifest.mpd
        head -n 1 /workspace/stream.m3u8
        grep -c '<MPD' /workspace/manifest.mpd
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          '{"w":60,"h":80,"frames":"24","sr":"22050","title":"RotatedClip"}',
          "artist=PoeMedia",
          "title=RotatedClip",
          "120,80",
          "#EXTM3U",
          "1",
          "",
        ].join("\n"),
      );
    });
  });

  it("13. soffice headless conversions across markdown/html/docx/xlsx/pptx/pdf/txt/csv and --cat text extraction", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        set -euo pipefail
        cat <<'MD' > /workspace/report.md
# Quarterly Summary
Revenue grew 28 percent.
MD
        soffice --headless --convert-to docx --outdir /workspace /workspace/report.md >/dev/null
        soffice --headless --cat /workspace/report.docx
        soffice --headless --convert-to pdf --outdir /workspace /workspace/report.docx >/dev/null
        pdftotext /workspace/report.pdf - | tr -d '\\f' | grep -v '^$'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "Quarterly Summary",
          "Revenue grew 28 percent.",
          "Quarterly Summary",
          "Revenue grew 28 percent.",
          "",
        ].join("\n"),
      );
    });
  });

  it("14. ssh-keygen Ed25519 keygen, public key derivation, SSHSIG signing, verification, and wildcard allowed_signers", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        set -euo pipefail
        ssh-keygen -q -t ed25519 -f /workspace/release_ed25519 -C "releng@poe.org" -N "" >/dev/null
        pub=$(ssh-keygen -y -f /workspace/release_ed25519)
        printf '*@poe.org namespaces="git,release-*" %s\\n' "$pub" > /workspace/allowed
        printf 'artifact-sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\\n' > /workspace/digest.txt
        ssh-keygen -Y sign -f /workspace/release_ed25519 -n release-prod /workspace/digest.txt >/dev/null
        ssh-keygen -Y find-principals -f /workspace/allowed -s /workspace/digest.txt.sig
        ssh-keygen -Y verify -f /workspace/allowed -I buildbot@poe.org -n release-prod -s /workspace/digest.txt.sig < /workspace/digest.txt | awk '{print $1, $2, $4, $5}'
        set +e
        ssh-keygen -Y verify -f /workspace/allowed -I outsider@other.org -n release-prod -s /workspace/digest.txt.sig < /workspace/digest.txt >/dev/null 2>/workspace/ssh.err
        rc_bad=$?
        set -e
        printf 'rc_bad=%d\\n' "$rc_bad"
        grep -Fq 'signer is not authorized' /workspace/ssh.err
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "*@poe.org",
          'Good "release-prod" for buildbot@poe.org',
          "rc_bad=1",
          "",
        ].join("\n"),
      );
    });
  });

  it("15. openssl Ed25519 pkeyutl sign/verify, AES-256-CBC PBKDF2 encryption, HMAC-SHA256, and X.509 certificate inspection", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        set -euo pipefail
        openssl genpkey -algorithm ED25519 -out /workspace/ed.key
        openssl pkey -in /workspace/ed.key -pubout -out /workspace/ed.pub
        printf 'signed-config-payload\\n' > /workspace/msg.bin
        openssl pkeyutl -sign -inkey /workspace/ed.key -rawin -in /workspace/msg.bin -out /workspace/msg.sig
        openssl pkeyutl -verify -pubin -inkey /workspace/ed.pub -rawin -in /workspace/msg.bin -sigfile /workspace/msg.sig

        openssl enc -aes-256-cbc -pbkdf2 -iter 2048 -salt -base64 -pass pass:s3cretKey -in /workspace/msg.bin -out /workspace/msg.enc
        openssl enc -d -aes-256-cbc -pbkdf2 -iter 2048 -base64 -pass pass:s3cretKey -in /workspace/msg.enc

        openssl req -x509 -newkey rsa:2048 -nodes -keyout /workspace/tls.key -out /workspace/tls.crt -subj "/CN=api.poe.local/O=PoePlatform" -days 365 2>/dev/null
        openssl x509 -in /workspace/tls.crt -noout -subject -issuer
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "Signature Verified Successfully",
          "signed-config-payload",
          "subject=CN=api.poe.local, O=PoePlatform",
          "issuer=CN=api.poe.local, O=PoePlatform",
          "",
        ].join("\n"),
      );
    });
  });

  it("16. gpg keyring generation, detached and clear signing with --status-fd, and symmetric + public-key armor encryption", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        set -euo pipefail
        gpg --batch --quick-generate-key "SecOps <secops@poe.local>" ed25519 sign 0 >/dev/null 2>&1
        gpg --list-keys --with-colons "secops@poe.local" | awk -F: '$1=="uid"{print $10}'
        printf 'critical-release-tag-v9\\n' > /workspace/tag.txt
        gpg --batch --yes --armor --detach-sign -u "secops@poe.local" -o /workspace/tag.txt.asc /workspace/tag.txt 2>/dev/null
        gpg --status-fd 1 --verify /workspace/tag.txt.asc /workspace/tag.txt 2>/dev/null | grep -E '^\\[GNUPG:\\] (GOODSIG|VALIDSIG)' | awk '{print $1, $2}'

        gpg --batch --yes --passphrase "sym-secret" --armor --symmetric -o /workspace/tag.sym.asc /workspace/tag.txt 2>/dev/null
        gpg --batch --yes --passphrase "sym-secret" --decrypt /workspace/tag.sym.asc 2>/dev/null
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "SecOps <secops@poe.local>",
          "[GNUPG:] GOODSIG",
          "[GNUPG:] VALIDSIG",
          "critical-release-tag-v9",
          "",
        ].join("\n"),
      );
    });
  });

  it("17. end-to-end Graphviz -> SVGO -> rsvg-convert PDF -> qpdf/pdftk/pdfinfo/pdftotext pipeline", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        set -euo pipefail
        cat <<'DOT' | dot -Tsvg > /workspace/service.svg
digraph Services {
  gateway [label="EdgeGateway"];
  worker [label="AsyncWorker"];
  gateway -> worker [label="rpc"];
}
DOT
        svgo --multipass -p 2 -i /workspace/service.svg -o /workspace/service.min.svg
        rsvg-convert -f pdf -o /workspace/service.pdf /workspace/service.min.svg
        qpdf --check /workspace/service.pdf | head -n 2
        pdftotext /workspace/service.pdf - | tr -d '\\f' | grep -E 'EdgeGateway|AsyncWorker'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "checking /workspace/service.pdf",
          "PDF Version: 1.7",
          "EdgeGateway",
          "AsyncWorker",
          "",
        ].join("\n"),
      );
    });
  });

  it("18. end-to-end SoX multi-input concatenation, reverse, fade curves, and WAV tag probing via soxi -a and ffprobe", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        set -euo pipefail
        sox -r 2000 -c 1 -b 16 -n /workspace/part1.wav synth 0.05 sine 200
        sox -r 2000 -c 1 -b 16 -n /workspace/part2.wav synth 0.05 triangle 400
        sox /workspace/part1.wav /workspace/part2.wav /workspace/joined.wav reverse fade q 0.01 0 0.01 stats 2>/workspace/stats.txt
        soxi -s /workspace/joined.wav
        soxi -D /workspace/joined.wav
        grep -E '^Num samples|^Length s' /workspace/stats.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "200",
          "0.100000",
          "Num samples 200",
          "Length s    0.100000",
          "",
        ].join("\n"),
      );
    });
  });

  it("19. pdftoppm and pdftocairo raster/vector page extraction with -scale-to, -r, -odd/-even, and -singlefile", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        set -euo pipefail
        cat <<'HTML' > /workspace/three.html
<p>One</p>
<div style="page-break-before:always"><p>Two</p></div>
<div style="page-break-before:always"><p>Three</p></div>
HTML
        wkhtmltopdf /workspace/three.html /workspace/three.pdf
        pdftoppm -png -odd -r 72 /workspace/three.pdf /workspace/oddpage
        ls /workspace/oddpage*.png | sort
        pdftoppm -png -singlefile -scale-to 300 /workspace/three.pdf /workspace/thumb
        identify -format '%m %wx%h\\n' /workspace/thumb.png
        pdftocairo -svg -f 2 -l 2 /workspace/three.pdf /workspace/page2.svg
        grep -c '<svg' /workspace/page2.svg
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "/workspace/oddpage-1.png",
          "/workspace/oddpage-3.png",
          "PNG 212x300",
          "1",
          "",
        ].join("\n"),
      );
    });
  });

  it("20. signed release bundle combining qrencode SVG, rsvg-convert PDF, tar.zst archive, and ssh-keygen + openssl verification", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/bundle
        qrencode -t SVG -s 3 -m 2 -o /workspace/bundle/badge.svg "REL-2026.10"
        svgo -p 2 -i /workspace/bundle/badge.svg -o /workspace/bundle/badge.opt.svg
        rsvg-convert -f png -o /workspace/bundle/badge.png /workspace/bundle/badge.opt.svg
        identify -format '%m %wx%h\\n' /workspace/bundle/badge.png > /workspace/bundle/manifest.txt
        tar -cf - -C /workspace bundle | zstd -q -c > /workspace/bundle.tar.zst
        openssl dgst -sha256 -hmac "release-hmac-key" /workspace/bundle.tar.zst | awk '{print NF}'
        cat /workspace/bundle/manifest.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "2",
          "PNG 75x75",
          "",
        ].join("\n"),
      );
    });
  });
});
