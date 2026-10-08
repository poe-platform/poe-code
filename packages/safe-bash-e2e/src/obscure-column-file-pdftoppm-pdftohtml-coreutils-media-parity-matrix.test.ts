import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure column, file, pdftoppm, pdftocairo, pdftohtml, coreutils & media parity matrix", () => {
  test("01. column -t with -N, -R (right-align last visible column), and -H shrinks last column width to data maximum", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "mkdir -p /work",
          "cat <<'CSV' > /work/nodes.csv",
          "node-a,us-east,12,online",
          "node-b,eu-west,140,online",
          "node-c,ap-south,8,maintenance",
          "CSV",
          "column -t -s ',' -o ' | ' -N HOST,REGION,LATENCY,STATE -R LATENCY -H STATE /work/nodes.csv",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "HOST   | REGION   | LATENCY",
          "node-a | us-east  |  12",
          "node-b | eu-west  | 140",
          "node-c | ap-south |   8",
          "",
        ].join("\n")
      );
    });
  });

  test("02. column -J -n serializes named columns with -H hidden and -O reordered columns into JSON", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "printf 'srv1,us,99,hide_me\\nsrv2,eu,42,hide_me\\n'",
          "  | column -J -n servers -s ',' -N HOST,REGION,SCORE,SECRET -H SECRET -O REGION,HOST,SCORE",
          "  | jq -c '.servers'",
        ].join(" ")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        '[{"region":"us","host":"srv1","score":"99"},{"region":"eu","host":"srv2","score":"42"}]\n'
      );
    });
  });

  test("03. column -t with -O column reordering and multiple -R right-aligned columns", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "printf 'api,10,250\\nworker,100,5\\n' > /tmp/svc.csv",
          "column -t -s ',' -o ':' -N SVC,REQS,MS -O MS,SVC,REQS -R MS,REQS /tmp/svc.csv",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [" MS:SVC   :REQS", "250:api   :  10", "  5:worker: 100", ""].join("\n")
      );
    });
  });

  test("04. file classifies WebAssembly (\\x00asm), PNG, PDF, GZIP, SQLite3, and JSON magic signatures", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
mkdir -p /work
convert -size 4x4 xc:#ff0000 /work/a.png
printf '%%PDF-1.7\n1 0 obj\n' > /work/b.pdf
printf '\x00asm\x01\x00\x00\x00' > /work/c.wasm
sqlite3 /work/d.sqlite "CREATE TABLE t(x INT); INSERT INTO t VALUES (1);"
printf '{"ok":true}\n' > /work/e.json
file -b /work/a.png /work/b.pdf /work/c.wasm /work/d.sqlite /work/e.json
file -b --mime-type /work/c.wasm /work/d.sqlite /work/e.json
`
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "PNG image data",
          "PDF document",
          "WebAssembly binary module",
          "SQLite 3.x database",
          "JSON text data",
          "application/wasm",
          "application/vnd.sqlite3",
          "application/json",
          "",
        ].join("\n")
      );
    });
  });

  test("05. pdftoppm -png -singlefile -gray and -mono preserve .png extension and PNG image format", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "mkdir -p /work",
          "echo '<html><body><h1>Gray & Mono Raster</h1></body></html>' > /work/p.html",
          "wkhtmltopdf -q /work/p.html /work/p.pdf",
          "pdftoppm -png -singlefile -gray -r 72 -f 1 -l 1 /work/p.pdf /work/out_gray",
          "pdftoppm -png -singlefile -mono -r 72 -f 1 -l 1 /work/p.pdf /work/out_mono",
          "identify -format '%m %wx%h\\n' /work/out_gray.png /work/out_mono.png",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      const lines = r.stdout.trim().split("\n");
      assert.equal(lines.length, 2);
      assert.match(lines[0]!, /^PNG \d+x\d+$/);
      assert.match(lines[1]!, /^PNG \d+x\d+$/);
    });
  });

  test("06. pdftoppm without -png outputs .pgm for -gray and .pbm for -mono", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "mkdir -p /work",
          "echo '<html><body><h1>Netpbm Modes</h1></body></html>' > /work/p.html",
          "wkhtmltopdf -q /work/p.html /work/p.pdf",
          "pdftoppm -singlefile -gray -r 72 /work/p.pdf /work/raw_gray",
          "pdftoppm -singlefile -mono -r 72 /work/p.pdf /work/raw_mono",
          "ls /work/raw_gray.pgm /work/raw_mono.pbm",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "/work/raw_gray.pgm\n/work/raw_mono.pbm\n");
    });
  });

  test("07. pdftocairo -svg and -jpeg -singlefile render vector SVG and JPEG page outputs", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "mkdir -p /work",
          "echo '<html><body><h1>Cairo Page 1</h1></body></html>' > /work/1.html",
          "echo '<html><body><h1>Cairo Page 2</h1></body></html>' > /work/2.html",
          "wkhtmltopdf -q /work/1.html /work/2.html /work/two.pdf",
          "pdftocairo -svg -f 1 -l 1 /work/two.pdf /work/p1.svg",
          "pdftocairo -jpeg -singlefile -r 72 -f 2 -l 2 /work/two.pdf /work/p2",
          "grep -o '<svg' /work/p1.svg | head -n 1",
          "identify -format '%m\\n' /work/p2.jpg",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "<svg\nJPEG\n");
    });
  });

  test("08. pdftohtml -stdout and -xml -stdout emit queryable #page1 and <page>/<outline> structures", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "mkdir -p /work",
          "echo '<html><body><h1>Order 4410</h1><p>Status: Shipped</p></body></html>' > /work/order.html",
          "wkhtmltopdf -q /work/order.html /work/order.pdf",
          "pdftohtml -stdout /work/order.pdf | htmlq -t '#page1' | grep -o 'Order 4410'",
          "pdftohtml -xml -stdout /work/order.pdf | grep -o '<outline>'",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "Order 4410\n<outline>\n");
    });
  });

  test("09. qpdf page slicing, rotation, 256-bit encryption, and password decryption round-trip", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "mkdir -p /work",
          "echo '<html><body><h1>Page One</h1></body></html>' > /work/1.html",
          "echo '<html><body><h1>Page Two</h1></body></html>' > /work/2.html",
          "echo '<html><body><h1>Page Three</h1></body></html>' > /work/3.html",
          "wkhtmltopdf -q /work/1.html /work/2.html /work/3.html /work/all.pdf",
          "qpdf /work/all.pdf --pages /work/all.pdf 1,3 -- /work/sub.pdf",
          "qpdf --encrypt upass opass 256 -- /work/sub.pdf /work/enc.pdf",
          "qpdf --password=upass --decrypt /work/enc.pdf /work/dec.pdf",
          "echo \"pages=$(qpdf --show-npages /work/dec.pdf)\"",
          "pdftotext /work/dec.pdf - | grep -o 'Page Three'",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "pages=2\nPage Three\n");
    });
  });

  test("10. pdftk cat page ranges, dump_data, and attach_files / pdfdetach extraction", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "mkdir -p /work/out",
          "echo '<html><body><h1>Doc A</h1></body></html>' > /work/a.html",
          "echo '<html><body><h1>Doc B</h1></body></html>' > /work/b.html",
          "printf 'attached-secret-payload\\n' > /work/note.txt",
          "wkhtmltopdf -q /work/a.html /work/a.pdf",
          "wkhtmltopdf -q /work/b.html /work/b.pdf",
          "pdftk A=/work/a.pdf B=/work/b.pdf cat A B output /work/merged.pdf",
          "pdftk /work/merged.pdf attach_files /work/note.txt output /work/with_att.pdf",
          "pdfdetach -saveall -o /work/out /work/with_att.pdf",
          "cat /work/out/note.txt",
          "pdftk /work/with_att.pdf dump_data | grep 'NumberOfPages'",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "attached-secret-payload\nNumberOfPages: 2\n");
    });
  });

  test("11. pdfseparate and pdfunite split and reassemble multi-page PDF documents", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "mkdir -p /work",
          "echo '<html><body><h1>First</h1></body></html>' > /work/1.html",
          "echo '<html><body><h1>Second</h1></body></html>' > /work/2.html",
          "wkhtmltopdf -q /work/1.html /work/2.html /work/full.pdf",
          "pdfseparate /work/full.pdf /work/part-%d.pdf",
          "pdfunite /work/part-2.pdf /work/part-1.pdf /work/reversed.pdf",
          "pdftotext -f 1 -l 1 /work/reversed.pdf - | grep -o 'Second'",
          "pdftotext -f 2 -l 2 /work/reversed.pdf - | grep -o 'First'",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "Second\nFirst\n");
    });
  });

  test("12. ImageMagick convert, mogrify, composite, montage, and compare image pipeline", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "mkdir -p /work",
          "convert -size 40x30 xc:#ff0000 /work/red.png",
          "convert -size 20x15 xc:#00ff00 /work/green.png",
          "composite -gravity center /work/green.png /work/red.png /work/comp.png",
          "montage /work/red.png /work/comp.png -tile 2x1 -geometry 40x30+0+0 /work/grid.png",
          "identify -format '%m %wx%h\\n' /work/comp.png /work/grid.png",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "PNG 40x30\nPNG 80x30\n");
    });
  });

  test("13. sips -g property query, -z resize, and -s format jpeg conversion", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "mkdir -p /work",
          "convert -size 100x80 xc:#112233 /work/orig.png",
          "sips -z 40 60 -s format jpeg /work/orig.png --out /work/resized.jpg >/dev/null",
          "identify -format '%m %wx%h\\n' /work/resized.jpg",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "JPEG 60x40\n");
    });
  });

  test("14. exiftool tag writing, JSON export (-j), and -all= metadata stripping", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "mkdir -p /work",
          "convert -size 32x32 xc:#abcdef /work/photo.png",
          "exiftool -overwrite_original -Artist='Ada Lovelace' -Copyright='2026 Poe' /work/photo.png >/dev/null",
          "exiftool -j /work/photo.png | jq -r '.[0] | \"\\(.Artist)|\\(.Copyright)\"'",
          "exiftool -overwrite_original -all= /work/photo.png >/dev/null",
          "exiftool -j /work/photo.png | jq -r '.[0].Artist // \"STRIPPED\"'",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "Ada Lovelace|2026 Poe\nSTRIPPED\n");
    });
  });

  test("15. qrencode PNG, SVG, and UTF8/ASCII QR code generation", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "mkdir -p /work",
          "qrencode -t PNG -o /work/qr.png 'https://poe.com'",
          "qrencode -t SVG -o /work/qr.svg 'https://poe.com'",
          "identify -format '%m\\n' /work/qr.png",
          "grep -o '<svg' /work/qr.svg | head -n 1",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "PNG\n<svg\n");
    });
  });

  test("16. sox synth WAV generation, trim/fade/norm effects, and soxi inspection", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "mkdir -p /work",
          "sox -n -r 16000 -c 1 -b 16 /work/tone.wav synth 0.5 sine 440",
          "sox /work/tone.wav /work/clip.wav trim 0 0.25",
          "echo \"rate=$(soxi -r /work/clip.wav)\"",
          "echo \"ch=$(soxi -c /work/clip.wav)\"",
          "echo \"samples=$(soxi -s /work/clip.wav)\"",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "rate=16000\nch=1\nsamples=4000\n");
    });
  });

  test("17. svgo optimization and rsvg-convert SVG-to-PNG/PDF rasterization", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "mkdir -p /work",
          "cat <<'SVG' > /work/raw.svg",
          "<!-- comment --><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"50\"><rect width=\"100\" height=\"50\" fill=\"#0055ff\"/></svg>",
          "SVG",
          "svgo -i /work/raw.svg -o /work/min.svg >/dev/null",
          "rsvg-convert -f png -o /work/out.png /work/min.svg",
          "identify -format '%m %wx%h\\n' /work/out.png",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "PNG 100x50\n");
    });
  });

  test("18. graphviz dot and neato render SVG and JSON graph layouts", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "mkdir -p /work",
          "printf 'digraph G { A -> B; B -> C; }\\n' | dot -Tsvg > /work/g.svg",
          "printf 'digraph G { A -> B; B -> C; }\\n' | dot -Tplain | grep -c '^node '",
          "grep -o '<svg' /work/g.svg | head -n 1",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "3\n<svg\n");
    });
  });

  test("19. pr multi-column pagination (-t -2 -s), expand/unexpand tabs, and fold -s line wrapping", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "printf 'a\\nb\\nc\\nd\\n' | pr -t -2 -s'|'",
          "printf 'hello world from safe bash\\n' | fold -s -w 12",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        ["a|c", "b|d", "hello world ", "from safe ", "bash", ""].join("\n")
      );
    });
  });

  test("20. end-to-end HTML -> wkhtmltopdf -> pdftoppm -png -singlefile -gray -> file -> column report", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "mkdir -p /work",
          "echo '<html><body><h1>Audit 77</h1></body></html>' > /work/audit.html",
          "wkhtmltopdf -q /work/audit.html /work/audit.pdf",
          "pdftoppm -png -singlefile -gray -r 72 -f 1 -l 1 /work/audit.pdf /work/audit_gray",
          "pdf_type=$(file -b --mime-type /work/audit.pdf)",
          "png_type=$(file -b --mime-type /work/audit_gray.png)",
          "printf 'audit.pdf,%s,1\\naudit_gray.png,%s,1\\n' \"$pdf_type\" \"$png_type\" | column -t -s ',' -o ' | ' -N FILE,MIME,PAGES -R PAGES",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "FILE           | MIME            | PAGES",
          "audit.pdf      | application/pdf | 1",
          "audit_gray.png | image/png       | 1",
          "",
        ].join("\n")
      );
    });
  });
});
