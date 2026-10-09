import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

const createEnv = () => ({
  exec: (script: string) => withE2EHarness((h) => h.exec(script)),
});

describe("obscure poppler pdffonts, pdfinfo, qpdf, pdftk, magick, exiftool, sips, mmdc, and unrtf parity matrix", () => {
  it("1. pdffonts -loc, -locPS, -subst, and out-of-range -f/-l page range validation", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf '<p>Hello Fonts</p>' > f.html
      wkhtmltopdf f.html f.pdf
      pdffonts -loc f.pdf | awk 'NR==3{print $1 ":" $10}'
      pdffonts -locPS f.pdf | awk 'NR==3{print $1 ":" $10 ":" $11}'
      pdffonts -subst f.pdf | awk 'NR==3{print $1 ":" $4 ":" $5}'
      pdffonts -f 5 f.pdf 2>range.err; rc1=$?
      pdffonts -f 2 -l 1 f.pdf 2>>range.err; rc2=$?
      grep -q 'Wrong page range given' range.err && echo "rc1=$rc1 rc2=$rc2"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "Helvetica:Substitute",
        "Helvetica:Substitute:(Helvetica)",
        "Helvetica:Nimbus:Sans",
        "rc1=99 rc2=99",
        "",
      ].join("\n")
    );
  });

  it("2. pdfinfo -isodates, -rawdates, -custom, -url, -box, and -listenc inspection", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf '<p>Go to <a href="https://poe.com/docs">Docs</a></p>' > u.html
      wkhtmltopdf -s Letter u.html u.pdf
      cat <<'EOF' > meta.info
InfoBegin
InfoKey: CreationDate
InfoValue: D:20260410120000Z
InfoBegin
InfoKey: Team
InfoValue: CoreRuntime
EOF
      pdftk u.pdf update_info meta.info output tagged.pdf
      pdfinfo -isodates -custom tagged.pdf | grep -E '^(CreationDate|Custom Metadata|Team):'
      pdfinfo -url tagged.pdf | grep -o 'https://poe.com/docs'
      pdfinfo -listenc | grep -o 'UTF-8'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "CreationDate:    2026-04-10T12:00:00Z",
        "Team:            CoreRuntime",
        "Custom Metadata: yes",
        "https://poe.com/docs",
        "UTF-8",
        "",
      ].join("\n")
    );
  });

  it("3. qpdf --json inspection, even page selection (1-z:even), and --rotate=-90:1", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > four.html
<p>One</p>
<div style="page-break-before:always"><p>Two</p></div>
<div style="page-break-before:always"><p>Three</p></div>
<div style="page-break-before:always"><p>Four</p></div>
EOF
      wkhtmltopdf four.html four.pdf
      qpdf --empty --pages four.pdf 1-z:even -- even.pdf
      qpdf even.pdf rot.pdf --rotate=-90:1
      echo "npages=$(qpdf --show-npages rot.pdf) rot=$(pdfinfo -f 1 -l 1 rot.pdf | awk '/Page.*rot:/{print $4}')"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "npages=2 rot=270\n");
  });

  it("4. pdftk burst into individual pages and dump_data_utf8 bookmark inspection", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > book.html
<h1>Chapter Alpha</h1><p>Body A</p>
<div style="page-break-before:always"><h2>Chapter Beta</h2><p>Body B</p></div>
EOF
      wkhtmltopdf --outline book.html book.pdf
      pdftk book.pdf burst output 'burst_%02d.pdf'
      pdftotext burst_01.pdf - | grep -o 'Chapter Alpha'
      pdftotext burst_02.pdf - | grep -o 'Chapter Beta'
      pdftk book.pdf dump_data_utf8 | grep '^BookmarkTitle:'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "Chapter Alpha",
        "Chapter Beta",
        "BookmarkTitle: Chapter Alpha",
        "BookmarkTitle: Chapter Beta",
        "",
      ].join("\n")
    );
  });

  it("5. pdftotext -f/-l page slicing, -tsv, -bbox, and -htmlmeta extraction", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > doc.html
<html><head><title>MetaTitle</title></head><body>
<p>AlphaToken</p>
<div style="page-break-before:always"><p>BetaToken</p></div>
</body></html>
EOF
      wkhtmltopdf --title "MetaTitle" doc.html doc.pdf
      pdftotext -f 2 -l 2 doc.pdf - | tr -d '\\f' | grep -v '^$'
      pdftotext -tsv doc.pdf - | head -n 1 | awk '{print $1, $12}'
      pdftotext -htmlmeta doc.pdf - | grep -o '<title>MetaTitle</title>'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "BetaToken",
        "level text",
        "<title>MetaTitle</title>",
        "",
      ].join("\n")
    );
  });

  it("6. pdftohtml -xml -stdout and single-file HTML extraction", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf '<p>XmlPayload</p>' > x.html
      wkhtmltopdf x.html x.pdf
      pdftohtml -xml -stdout x.pdf | grep -o 'XmlPayload'
      pdftohtml -s -noframes x.pdf out_html >/dev/null
      grep -o 'XmlPayload' out_html.html | head -n 1
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "XmlPayload",
        "XmlPayload",
        "",
      ].join("\n")
    );
  });

  it("7. pdftoppm -png -singlefile and pdftocairo -svg / -png rendering", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf '<p>CairoRender</p>' > c.html
      wkhtmltopdf c.html c.pdf
      pdftoppm -png -r 72 -singlefile c.pdf single_out
      identify single_out.png | awk '{print $2}'
      pdftocairo -svg c.pdf cairo_out.svg
      grep -c '<svg' cairo_out.svg
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "PNG",
        "1",
        "",
      ].join("\n")
    );
  });

  it("8. diffpdf --text and --layout comparison across identical, rotated, and modified PDFs", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf '<p>Hello Diff</p>' > d1.html
      printf '<p>Hello Changed</p>' > d2.html
      wkhtmltopdf d1.html d1.pdf
      wkhtmltopdf d2.html d2.pdf
      qpdf d1.pdf d1_rot.pdf --rotate=+90:1
      diffpdf --text d1.pdf d1.pdf; rc_same=$?
      diffpdf --text d1.pdf d1_rot.pdf; rc_rot_txt=$?
      diffpdf --layout d1.pdf d1_rot.pdf >/dev/null; rc_rot_lay=$?
      diffpdf --text d1.pdf d2.pdf >/dev/null; rc_diff=$?
      echo "same=$rc_same rot_txt=$rc_rot_txt rot_lay=$rc_rot_lay diff=$rc_diff"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "same=0 rot_txt=0 rot_lay=1 diff=1\n");
  });

  it("9. dot and neato Graphviz cluster subgraphs, record shapes, and -Tcanon/-Tplain/-Tjson", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > cluster.dot
digraph G {
  gateway -> primary;
  primary -> replica;
}
EOF
      dot -Tjson cluster.dot | jq -c '{directed, n: (.nodes | length), e: (.edges | length)}'
      dot -Tplain cluster.dot | awk '$1=="node"{gsub(/"/, "", $2); print $2}' | sort | tr '\\n' ':'
      echo ""
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        '{"directed":true,"n":3,"e":2}',
        "gateway:primary:replica:",
        "",
      ].join("\n")
    );
  });

  it("10. svgo --multipass optimization removing comments, metadata, and redundant groups", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > raw.svg
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
  <!-- drop comment -->
  <metadata>secret</metadata>
  <g><g><rect width="50" height="50" fill="#ff0000"/></g></g>
</svg>
EOF
      svgo --multipass raw.svg -o min.svg >/dev/null
      grep -Ec 'comment|metadata' min.svg || true
      grep -c '<rect' min.svg
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "0",
        "1",
        "",
      ].join("\n")
    );
  });

  it("11. rsvg-convert custom dimensions (-w/-h) to PNG and PDF", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="green"/></svg>' > box.svg
      rsvg-convert -f png -o box.png box.svg
      identify box.png | awk '{print $2, $3}'
      rsvg-convert -f pdf -o box.pdf box.svg
      pdfinfo box.pdf | awk '/^Pages:/{print $2}'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "PNG 40x20",
        "1",
        "",
      ].join("\n")
    );
  });

  it("12. qrencode QR generation with error correction levels (-l H) across SVG, EPS, UTF8, and PNG", async () => {
    const env = createEnv();
    const res = await env.exec(`
      qrencode -l H -t SVG -o qr.svg "poe-code-2026"
      qrencode -l H -t PNG -s 4 -m 2 -o qr.png "poe-code-2026"
      grep -c '<svg' qr.svg
      identify qr.png | awk '{print $2}'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "1",
        "PNG",
        "",
      ].join("\n")
    );
  });

  it("13. magick canvas generation, resize, rotate, flip/flop, and format string inspection", async () => {
    const env = createEnv();
    const res = await env.exec(`
      magick -size 80x40 xc:navy base.png
      magick base.png -rotate 90 rot.png
      identify -format '%m %wx%h\\n' rot.png
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "PNG 40x80\n");
  });

  it("14. mogrify in-place resize, composite overlay, montage grid, and compare AE metric", async () => {
    const env = createEnv();
    const res = await env.exec(`
      magick -size 40x40 xc:red a.png
      magick -size 40x40 xc:blue b.png
      montage a.png b.png -tile 2x1 -geometry +0+0 grid.png
      identify grid.png | awk '{print $2, $3}'
      mogrify -resize 20x20! a.png
      identify a.png | awk '{print $2, $3}'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "PNG 80x40",
        "PNG 20x20",
        "",
      ].join("\n")
    );
  });

  it("15. sips -z resize and -g property queries", async () => {
    const env = createEnv();
    const res = await env.exec(`
      magick -size 100x50 xc:white s.png
      sips -z 30 60 s.png --out s_out.png >/dev/null
      sips -g pixelWidth -g pixelHeight s_out.png | awk '/pixel/{print $1 $2}'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "pixelWidth:60",
        "pixelHeight:30",
        "",
      ].join("\n")
    );
  });

  it("16. exiftool tag assignment, -s3 values, -p template formatting, and -all= tag removal", async () => {
    const env = createEnv();
    const res = await env.exec(`
      magick -size 16x16 xc:black tag.png
      exiftool -overwrite_original -Artist="Ada" -Copyright="2026" tag.png >/dev/null
      exiftool -p '$Artist:$Copyright' tag.png
      exiftool -overwrite_original -all= tag.png >/dev/null
      exiftool -s3 -Artist tag.png
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "Ada:2026\n");
  });

  it("17. sox multi-tone synthesis, concatenation, and DSP chain with soxi inspection", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sox -r 8000 -c 1 -b 16 -n p1.wav synth 0.05 sine 440
      sox -r 8000 -c 1 -b 16 -n p2.wav synth 0.05 sine 880
      sox p1.wav p2.wav joined.wav
      echo "rate=$(soxi -r joined.wav) ch=$(soxi -c joined.wav) samples=$(soxi -s joined.wav)"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "rate=8000 ch=1 samples=800\n");
  });

  it("18. ffmpeg lavfi testsrc + sine synthesis, video scaling, and ffprobe JSON stream inspection", async () => {
    const env = createEnv();
    const res = await env.exec(`
      ffmpeg -f lavfi -i testsrc=size=160x120:rate=10:duration=1 -vf "scale=80:60" -metadata comment="RustParity" out.mp4
      ffprobe -v quiet -print_format json -show_format -show_streams out.mp4 | \
        jq -c '{w: .streams[0].width, h: .streams[0].height, comment: .format.tags.comment}'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, '{"w":80,"h":60,"comment":"RustParity"}\n');
  });

  it("19. mmdc Mermaid diagram rendering to SVG and PDF", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > diag.mmd
flowchart LR
  Client --> Gateway --> Engine
EOF
      mmdc -i diag.mmd -o diag.svg
      mmdc -i diag.mmd -o diag.pdf
      grep -o 'Gateway' diag.svg | head -n 1
      pdfinfo diag.pdf | awk '/^Pages:/{print $2}'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "Gateway",
        "1",
        "",
      ].join("\n")
    );
  });

  it("20. soffice headless conversion, pandoc Markdown-to-HTML, and unrtf RTF-to-HTML", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf '# Heading One\nParagraph text.\n' > input.md
      pandoc -f markdown -t html input.md | grep -o 'Heading One'
      soffice --headless --convert-to pdf --outdir . input.md >/dev/null
      pdftotext input.pdf - | grep -o 'Heading One'
      cat <<'EOF' > note.rtf
{\\rtf1\\ansi {\\i ItalicText}}
EOF
      unrtf --html note.rtf | grep -o 'ItalicText'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "Heading One",
        "Heading One",
        "ItalicText",
        "",
      ].join("\n")
    );
  });
});
