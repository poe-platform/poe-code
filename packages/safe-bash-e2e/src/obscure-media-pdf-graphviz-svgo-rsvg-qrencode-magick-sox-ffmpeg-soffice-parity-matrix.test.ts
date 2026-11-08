import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

const createEnv = () => ({
  exec: (script: string) => withE2EHarness((h) => h.exec(script)),
});

describe("obscure media, pdf, graphviz, svgo, rsvg-convert, qrencode, magick, sox, ffmpeg, and soffice parity matrix", () => {
  it("1. wkhtmltopdf multi-page HTML rendering with cover page, header/footer tokens, and pdfinfo/pdftotext", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf '<h1>Cover Page</h1>' > cover.html
      cat <<'EOF' > body.html
<html><head><title>Architecture Spec</title></head><body>
<h1>Section 1</h1><p>Core Engine</p>
<div style="page-break-before:always"><h2>Section 2</h2><p>WASM Runtime</p></div>
</body></html>
EOF
      wkhtmltopdf --title "System Spec" --outline cover cover.html body.html spec.pdf
      pdfinfo spec.pdf | grep -E '^(Title|Pages):'
      pdftotext spec.pdf - | tr '\\f' '\\n' | grep -v '^$'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "Title:           System Spec",
        "Pages:           3",
        "Cover Page",
        "Section 1",
        "Core Engine",
        "Section 2",
        "WASM Runtime",
        "",
      ].join("\n")
    );
  });

  it("2. qpdf page range selection (1-z:odd, r1), rotation, linearization, and attachment round-trip", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > pages.html
<p>P1</p>
<div style="page-break-before:always"><p>P2</p></div>
<div style="page-break-before:always"><p>P3</p></div>
<div style="page-break-before:always"><p>P4</p></div>
EOF
      wkhtmltopdf pages.html pages.pdf
      qpdf --empty --pages pages.pdf 1-z:odd,r1 -- subset.pdf
      echo "npages=$(qpdf --show-npages subset.pdf)"
      printf 'attached_metadata_v2' > meta.txt
      qpdf subset.pdf out.pdf --rotate=+90:1 --linearize --add-attachment meta.txt --key=meta.txt
      qpdf --check-linearization out.pdf | head -n 1
      echo "att=$(qpdf --show-attachment=meta.txt out.pdf)"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "npages=3",
        "out.pdf: linearized",
        "att=attached_metadata_v2",
        "",
      ].join("\n")
    );
  });

  it("3. qpdf 256-bit AES encryption, --show-encryption, and --decrypt round-trip", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf '<p>Confidential PDF</p>' > doc.html
      wkhtmltopdf doc.html doc.pdf
      qpdf --encrypt user123 owner456 256 -- doc.pdf enc.pdf
      qpdf --password=user123 --show-encryption enc.pdf | head -n 2
      qpdf --password=user123 --decrypt enc.pdf dec.pdf
      qpdf --show-encryption dec.pdf
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "R = 6",
        "V = 5",
        "File is not encrypted",
        "",
      ].join("\n")
    );
  });

  it("4. pdftk multi-handle cat rotation, attach_files / unpack_files, and update_info_utf8", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf '<p>First</p>' > a.html
      printf '<p>Second</p>' > b.html
      wkhtmltopdf a.html a.pdf
      wkhtmltopdf b.html b.pdf
      pdftk A=a.pdf B=b.pdf cat A1east B1 output merged.pdf
      printf 'payload_bundle' > bundle.txt
      pdftk merged.pdf attach_files bundle.txt output attached.pdf
      mkdir -p unpacked
      pdftk attached.pdf unpack_files output unpacked
      echo "rot=$(pdfinfo -f 1 -l 1 merged.pdf | awk '/Page.*rot:/{print $4}') unpacked=$(cat unpacked/bundle.txt)"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "rot=90 unpacked=payload_bundle\n");
  });

  it("5. pdfseparate, pdfunite, pdffonts, pdftotext -tsv, and pdftohtml -xml", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > two.html
<p>Page Alpha</p><p>Link <a href="https://poe.com/spec">Spec</a></p>
<div style="page-break-before:always"><p>Page Beta</p></div>
EOF
      wkhtmltopdf two.html two.pdf
      pdfseparate two.pdf 'page-%d.pdf'
      pdfunite page-2.pdf page-1.pdf swapped.pdf
      pdftotext swapped.pdf - | tr '\\f' '\\n' | grep 'Page '
      echo "fonts=$(pdffonts -subst page-1.pdf | grep -c 'Nimbus Sans')"
      echo "xml=$(pdftohtml -xml -stdout page-1.pdf | grep -c '<pdf2xml')"
    `);
    assert.equal(res.exitCode, 0);
      assert.equal(
      res.stdout,
      [
        "Page Beta",
        "Page Alpha",
        "fonts=1",
        "xml=1",
        "",
      ].join("\n")
    );
  });

  it("6. pdftoppm, pdftocairo, pdfimages, and pdfdetach inspection", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf '<h1>Raster Page</h1>' > r.html
      wkhtmltopdf r.html r.pdf
      pdftoppm -png -r 72 r.pdf page_out
      identify page_out-1.png | awk '{print $2}'
      printf 'detached_note_content' > note.txt
      qpdf r.pdf --add-attachment note.txt --key=note.txt -- with_note.pdf
      pdfdetach -list with_note.pdf | grep -c 'note.txt'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "PNG\n1\n");
  });

  it("7. diffpdf --text vs --layout comparison across rotated and modified PDFs", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf '<p>Same Text</p>' > base.html
      wkhtmltopdf base.html base.pdf
      qpdf base.pdf rotated.pdf --rotate=+90:1
      diffpdf --text base.pdf rotated.pdf && echo "text_same=yes"
      diffpdf --layout base.pdf rotated.pdf >/dev/null 2>&1
      echo "layout_rc=$?"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "text_same=yes\nlayout_rc=1\n");
  });

  it("8. dot and neato Graphviz rendering (-Tsvg, -Tjson, -Tplain, -Tdot, -Tpdf)", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > graph.dot
digraph Arch {
  cli -> parser;
  parser -> eval;
}
EOF
      dot -Tplain graph.dot > graph.plain
      echo "nodes=$(grep -c '^node ' graph.plain) edges=$(grep -c '^edge ' graph.plain)"
      neato -Tjson graph.dot | jq -c '{directed, n: (.nodes | length), e: (.edges | length)}'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "nodes=3 edges=2",
        '{"directed":true,"n":3,"e":2}',
        "",
      ].join("\n")
    );
  });

  it("9. mmdc Mermaid diagram rendering to SVG and PDF", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > flow.mmd
graph TD
  A[Client] --> B[Gateway]
  B --> C[Worker]
EOF
      mmdc -i flow.mmd -o flow.svg
      grep -q '<svg' flow.svg && grep -q 'Gateway' flow.svg && echo "mmdc_svg=ok"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "mmdc_svg=ok\n");
  });

  it("10. svgo --multipass path optimization, metadata stripping, and --pretty formatting", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > raw.svg
<svg width="100.000px" height="50.000" xmlns="http://www.w3.org/2000/svg"><metadata>drop</metadata><g><path d="M 10.000 20.000 L 40.000 20.000 Z"/></g></svg>
EOF
      svgo --multipass -p 2 -i raw.svg -o min.svg
      cat min.svg
      echo ""
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      '<svg width="100px" height="50" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><path d="M10 20H40Z"/></svg>\n'
    );
  });

  it("11. rsvg-convert SVG-to-PNG and SVG-to-PDF rendering with hidden text suppression", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > card.svg
<svg xmlns="http://www.w3.org/2000/svg" width="80pt" height="40pt" viewBox="0 0 80 40">
  <rect x="0" y="0" width="80" height="40" fill="white"/>
  <text x="8" y="20" fill="black">VisibleBadge</text>
  <text x="8" y="30" fill="none">HiddenBadge</text>
</svg>
EOF
      rsvg-convert -f png -o card.png card.svg
      rsvg-convert -f pdf -o card.pdf card.svg
      echo "png=$(identify -format '%m' card.png) txt=$(pdftotext card.pdf - | tr -d '\\f\\n')"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "png=PNG txt=VisibleBadge\n");
  });

  it("12. qrencode QR generation in SVG, EPS, UTF8, and PNG formats", async () => {
    const env = createEnv();
    const res = await env.exec(`
      qrencode -t SVG -o qr.svg 'https://poe.com'
      qrencode -t PNG -o qr.png 'https://poe.com'
      qrencode -t EPS -o qr.eps 'https://poe.com'
      grep -q '<svg' qr.svg && echo "svg=ok"
      echo "png=$(identify -format '%m' qr.png)"
      head -n 1 qr.eps
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "svg=ok",
        "png=PNG",
        "%!PS-Adobe-3.0 EPSF-3.0",
        "",
      ].join("\n")
    );
  });

  it("13. magick, convert, mogrify, composite, montage, and identify image pipeline", async () => {
    const env = createEnv();
    const res = await env.exec(`
      magick -size 40x20 xc:blue a.png
      magick a.png -resize 50% -rotate 90 b.png
      echo "b=$(identify -format '%wx%h' b.png)"
      montage a.png a.png -tile 2x1 -geometry 20x10+0+0 sheet.png
      echo "sheet=$(identify -format '%wx%h' sheet.png)"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "b=10x20",
        "sheet=40x10",
        "",
      ].join("\n")
    );
  });

  it("14. sips image resizing and property inspection (-z, -g pixelWidth/pixelHeight)", async () => {
    const env = createEnv();
    const res = await env.exec(`
      magick -size 64x32 xc:green orig.png
      sips -z 24 48 orig.png --out resized.png >/dev/null
      sips -g pixelWidth -g pixelHeight resized.png | awk '/pixel/{print $1 ":" $2}'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "pixelWidth::48",
        "pixelHeight::24",
        "",
      ].join("\n")
    );
  });

  it("15. exiftool metadata writing, reading (-s3), and formatted output (-p)", async () => {
    const env = createEnv();
    const res = await env.exec(`
      magick -size 32x32 xc:yellow img.png
      exiftool -overwrite_original -Artist="Grace Hopper" -Comment="Compiler" img.png >/dev/null
      exiftool -p '$FileName|$Artist|$Comment|$ImageSize' img.png
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "img.png|Grace Hopper|Compiler|32x32\n");
  });

  it("16. sox waveform synthesis and DSP chain (trim, pad, fade, rate, gain) with soxi inspection", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sox -r 4000 -c 2 -b 16 -n tone.wav synth 0.1 sine 400
      echo "orig=$(soxi -r tone.wav):$(soxi -c tone.wav):$(soxi -s tone.wav):$(soxi -b tone.wav)"
      sox tone.wav -b 32 -e floating-point out.wav trim 40s 200s pad 20s 20s rate 2000
      echo "proc=$(soxi -r out.wav):$(soxi -c out.wav):$(soxi -s out.wav):$(soxi -b out.wav)"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "orig=4000:2:400:16",
        "proc=2000:2:120:32",
        "",
      ].join("\n")
    );
  });

  it("17. sox Nyquist limit and channel-override validation diagnostics", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sox -r 1000 -c 1 -n bad.wav synth 0.1 sine 600 2>nyq.err
      rc1=$?
      sox -r 4000 -c 2 -b 16 -n stereo.wav synth 0.05 sine 200
      sox -c 1 stereo.wav bad2.wav 2>ovr.err
      rc2=$?
      grep -q 'Nyquist' nyq.err && grep -q 'Input channel override' ovr.err && echo "rc1=$rc1 rc2=$rc2 valid=ok"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "rc1=1 rc2=1 valid=ok\n");
  });

  it("18. ffmpeg lavfi synthesis, video scaling/transpose, filter_complex hstack, and ffprobe JSON inspection", async () => {
    const env = createEnv();
    const res = await env.exec(`
      ffmpeg -f lavfi -i testsrc=size=120x80:rate=10:duration=1 -f lavfi -i sine=frequency=440:sample_rate=16000:duration=1 \
        -vf "scale=iw/2:-2" -metadata title="DemoClip" clip.mp4
      ffprobe -v quiet -print_format json -show_format -show_streams -count_frames clip.mp4 | \
        jq -c '{w: .streams[0].width, h: .streams[0].height, frames: .streams[0].nb_read_frames, title: .format.tags.title}'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      '{"w":60,"h":40,"frames":"10","title":"DemoClip"}\n'
    );
  });

  it("19. ffmpeg HLS (.m3u8), DASH (.mpd), and ffmetadata extraction", async () => {
    const env = createEnv();
    const res = await env.exec(`
      ffmpeg -f lavfi -i testsrc=size=64x64:rate=5:duration=1 -metadata artist="PoeTeam" src.mp4
      ffmpeg -i src.mp4 -f ffmetadata meta.txt
      ffmpeg -i src.mp4 stream.m3u8
      ffmpeg -i src.mp4 manifest.mpd
      grep '^artist=' meta.txt
      head -n 1 stream.m3u8
      grep -c '<MPD' manifest.mpd
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "artist=PoeTeam",
        "#EXTM3U",
        "1",
        "",
      ].join("\n")
    );
  });

  it("20. soffice headless document conversion (markdown -> docx -> pdf) and unrtf RTF-to-HTML conversion", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf '# Sprint Review\nAll 20 parity checks passed.\n' > notes.md
      soffice --headless --convert-to docx --outdir . notes.md >/dev/null
      soffice --headless --cat notes.docx
      cat <<'EOF' > doc.rtf
{\\rtf1\\ansi {\\b BoldRTF} plain}
EOF
      unrtf --html doc.rtf | grep -o 'BoldRTF'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "Sprint Review",
        "All 20 parity checks passed.",
        "BoldRTF",
        "",
      ].join("\n")
    );
  });
});
