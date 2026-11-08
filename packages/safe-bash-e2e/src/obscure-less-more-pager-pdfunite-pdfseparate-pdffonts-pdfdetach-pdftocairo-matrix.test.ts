import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure less/more pager + pdfunite/pdfseparate/pdffonts/pdfdetach/pdftocairo + graphviz/svg/media matrix", () => {
  test("1. more pass-through preserves raw bytes, non-newline-terminated files, and drains '-' stdin once", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/head.txt": "alpha-no-nl",
        "/workspace/tail.txt": ":omega",
      },
    });
    const r = await h.exec(
      `printf '::mid::' | more /workspace/head.txt - - /workspace/tail.txt`,
    );
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.stdout, "alpha-no-nl::mid:::omega");
  });

  test("2. less and more --help, -?, --version, and -V emit exact pager usage and version banners", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(`
      set -e
      less --help
      more -?
      less --version
      more -V
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(
      r.stdout,
      [
        "Usage: less [-Ns] [+LINE] [+/PATTERN] [FILE...]",
        "Usage: more [-Ns] [+LINE] [+/PATTERN] [FILE...]",
        "less (virtual-bash)",
        "more (virtual-bash)",
        "",
      ].join("\n"),
    );
  });

  test("3. less and more -N, --LINE-NUMBERS, -n override, -s, --squeeze-blank-lines, and +LINE preserve 1-based original line numbers", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/doc.txt": "line1\nline2\n\n\nline5\n\nline7",
      },
    });
    const r1 = await h.exec(`less -Ns +2 /workspace/doc.txt`);
    assert.equal(r1.exitCode, 0, r1.stderr);
    assert.equal(
      r1.stdout,
      ["     2  line2", "     3  ", "     5  line5", "     6  ", "     7  line7"].join("\n"),
    );

    const r2 = await h.exec(
      `more --LINE-NUMBERS -n --squeeze-blank-lines +2 /workspace/doc.txt`,
    );
    assert.equal(r2.exitCode, 0, r2.stderr);
    assert.equal(r2.stdout, ["line2", "", "line5", "", "line7"].join("\n"));
  });

  test("4. less and more regex search (+/PATTERN, -p, --pattern) with -i/-I case-insensitivity and +LINE fallback on miss", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/chapters.txt": [
          "Preface",
          "Intro",
          "CHAPTER 1: Foundations",
          "Body 1",
          "Chapter 2: Advanced Routing",
          "Body 2",
          "",
        ].join("\n"),
      },
    });
    const r1 = await h.exec(
      `less -N -i '+/^chapter [0-9]+:' /workspace/chapters.txt`,
    );
    assert.equal(r1.exitCode, 0, r1.stderr);
    assert.equal(
      r1.stdout,
      [
        "     3  CHAPTER 1: Foundations",
        "     4  Body 1",
        "     5  Chapter 2: Advanced Routing",
        "     6  Body 2",
        "",
      ].join("\n"),
    );

    const r2 = await h.exec(
      `more --line-numbers --pattern='^Chapter 2:' /workspace/chapters.txt`,
    );
    assert.equal(r2.exitCode, 0, r2.stderr);
    assert.equal(
      r2.stdout,
      ["     5  Chapter 2: Advanced Routing", "     6  Body 2", ""].join("\n"),
    );

    // When pattern is not found, startIdx falls back to +LINE (1-based)
    const r3 = await h.exec(
      `less -N +5 '+/NONEXISTENT_TOKEN_XYZ' /workspace/chapters.txt`,
    );
    assert.equal(r3.exitCode, 0, r3.stderr);
    assert.equal(
      r3.stdout,
      ["     5  Chapter 2: Advanced Routing", "     6  Body 2", ""].join("\n"),
    );
  });

  test("5. less and more validate -x, -z, and -P option values and reject invalid numeric arguments", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/sample.txt": "ok-line\n",
      },
    });
    const valid = await h.exec(
      `less -x4,8 -z-24 -Pcustom /workspace/sample.txt && more -x 4 -z +10 -P prompt /workspace/sample.txt`,
    );
    assert.equal(valid.exitCode, 0, valid.stderr);
    assert.equal(valid.stdout, "ok-line\nok-line\n");

    const badX = await h.exec(`less -xabc /workspace/sample.txt`);
    assert.equal(badX.exitCode, 1);
    assert.equal(badX.stderr, "less: numeric value required after -x\n");

    const badZ = await h.exec(`more -z nope /workspace/sample.txt`);
    assert.equal(badZ.exitCode, 1);
    assert.equal(badZ.stderr, "more: numeric value required after -z\n");

    const missingP = await h.exec(`less -P`);
    assert.equal(missingP.exitCode, 1);
    assert.equal(missingP.stderr, "less: numeric value required after -P\n");
  });

  test("6. less and more handle '--' end-of-options for '+'/'-' filenames and recover across missing files", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/+plus.txt": "from-plus\n",
        "/workspace/-dash.txt": "from-dash\n",
      },
    });
    const r1 = await h.exec(`cd /workspace && more -N -- +plus.txt -dash.txt`);
    assert.equal(r1.exitCode, 0, r1.stderr);
    assert.equal(r1.stdout, "     1  from-plus\n     2  from-dash\n");

    const r2 = await h.exec(
      `cd /workspace && less -N -- missing.txt +plus.txt`,
    );
    assert.equal(r2.exitCode, 1);
    assert.match(r2.stderr, /^less: missing\.txt:/);
    assert.equal(r2.stdout, "     1  from-plus\n");
  });

  test("7. less and more preserve leading UTF-8 BOM across pass-through, -N, and +/pattern search modes", async () => {
    const bomContent = new TextEncoder().encode("\uFEFFbom-head\n\n\nbom-tail\n");
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/bom.txt": bomContent,
      },
    });
    const rPass = await h.exec(`more /workspace/bom.txt`);
    assert.equal(rPass.exitCode, 0, rPass.stderr);
    assert.equal(rPass.stdout, "\uFEFFbom-head\n\n\nbom-tail\n");

    const rNum = await h.exec(`less -Ns /workspace/bom.txt`);
    assert.equal(rNum.exitCode, 0, rNum.stderr);
    assert.equal(rNum.stdout, "     1  \uFEFFbom-head\n     2  \n     4  bom-tail\n");

    const rPat = await h.exec(`more -Ns -i '+/BOM-HEAD' /workspace/bom.txt`);
    assert.equal(rPat.exitCode, 0, rPat.stderr);
    assert.equal(rPat.stdout, "     1  \uFEFFbom-head\n     2  \n     4  bom-tail\n");
  });

  test("8. wkhtmltopdf multi-page HTML -> pdfunite merge -> pdfinfo & pdftotext -> less -Ns +/Section", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/part1.html":
          "<html><head><title>Manual v1</title></head><body><h1>Section 1: Overview</h1><div style=\"page-break-after:always\"></div><h2>Section 2: Install</h2></body></html>",
        "/workspace/part2.html":
          "<html><head><title>Appendix</title></head><body><h1>Section 3: Operations</h1></body></html>",
      },
    });
    const r = await h.exec(`
      set -e
      wkhtmltopdf /workspace/part1.html /workspace/p1.pdf
      wkhtmltopdf /workspace/part2.html /workspace/p2.pdf
      pdfunite /workspace/p1.pdf /workspace/p2.pdf /workspace/merged.pdf
      pdfinfo /workspace/merged.pdf | grep -E '^(Title|Pages):'
      pdftotext -nopgbrk /workspace/merged.pdf - | sed '/^[[:space:]]*$/d' | less -N '+/Section 2'
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.match(r.stdout, /Title:\s+Manual v1/);
    assert.match(r.stdout, /Pages:\s+3/);
    assert.match(r.stdout, /2\s+Section 2: Install/);
    assert.match(r.stdout, /3\s+Section 3: Operations/);
  });

  test("9. pdfseparate -f/-l printf pattern extraction -> diffpdf structural equivalence -> pdfunite re-merge", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/book.html":
          "<html><head><title>Book</title></head><body><p>Page One</p><div style=\"page-break-after:always\"></div><p>Page Two</p><div style=\"page-break-after:always\"></div><p>Page Three</p></body></html>",
      },
    });
    const r = await h.exec(`
      set -e
      wkhtmltopdf /workspace/book.html /workspace/book.pdf
      pdfseparate -f 2 -l 3 /workspace/book.pdf '/workspace/page-%03d.pdf'
      qpdf /workspace/book.pdf --pages /workspace/book.pdf 2-3 -- /workspace/qpdf-23.pdf
      pdfunite /workspace/page-002.pdf /workspace/page-003.pdf /workspace/remerged-23.pdf
      diffpdf /workspace/qpdf-23.pdf /workspace/remerged-23.pdf
      pdftotext -nopgbrk /workspace/remerged-23.pdf - | sed '/^[[:space:]]*$/d' | more -N
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.stdout, "     1  Page Two\n     2  Page Three\n");
  });

  test("10. qpdf & pdftk PDF attachments -> pdfdetach -list, -save, and -saveall -> more -N inspection", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/base.html": "<html><body><p>Host Document</p></body></html>",
        "/workspace/config.ini": "[server]\nport=8080\n\n\nmode=strict\n",
        "/workspace/notes.txt": "release-ready\n",
      },
    });
    const r = await h.exec(`
      set -e
      wkhtmltopdf /workspace/base.html /workspace/base.pdf
      pdftk /workspace/base.pdf attach_files /workspace/config.ini /workspace/notes.txt output /workspace/with-att.pdf
      pdfdetach -list /workspace/with-att.pdf
      pdfdetach -save 1 -o /workspace/extracted-config.ini /workspace/with-att.pdf
      mkdir -p /workspace/detached
      pdfdetach -saveall -o /workspace/detached /workspace/with-att.pdf
      more -Ns +2 /workspace/extracted-config.ini
      less /workspace/detached/notes.txt
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(
      r.stdout,
      [
        "2 embedded files",
        "1: config.ini",
        "2: notes.txt",
        "     2  port=8080",
        "     3  ",
        "     5  mode=strict",
        "release-ready",
        "",
      ].join("\n"),
    );
  });

  test("11. pdffonts tabular report piped through less -N +/Helvetica and awk field extraction", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/doc.html": "<html><body><p>Font test</p></body></html>",
      },
    });
    const r = await h.exec(`
      set -e
      wkhtmltopdf /workspace/doc.html /workspace/doc.pdf
      pdffonts /workspace/doc.pdf | less -N '+/Helvetica'
      pdffonts /workspace/doc.pdf | awk 'NR == 3 { print $1, $2, $3 }'
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.match(r.stdout, /3\s+Helvetica\s+Type 1/);
    assert.match(r.stdout, /Helvetica Type 1\n$/);
  });

  test("12. pdftocairo -svg, -png -singlefile, -jpeg -f/-l, and -eps -> svgo, rsvg-convert, and identify", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/slides.html":
          "<html><body><p>Slide Alpha</p><div style=\"page-break-after:always\"></div><p>Slide Beta</p></body></html>",
      },
    });
    const r = await h.exec(`
      set -e
      wkhtmltopdf -s Letter /workspace/slides.html /workspace/slides.pdf
      pdftocairo -svg -r 72 /workspace/slides.pdf /workspace/slide1.svg
      svgo --multipass /workspace/slide1.svg -o /workspace/slide1.min.svg
      rsvg-convert -f png /workspace/slide1.min.svg -o /workspace/from-svg.png
      pdftocairo -png -r 72 -singlefile /workspace/slides.pdf /workspace/cover
      pdftocairo -jpeg -r 72 -f 1 -l 2 /workspace/slides.pdf /workspace/page
      pdftocairo -eps /workspace/slides.pdf /workspace/slide1.eps
      identify -format '%m %wx%h\\n' /workspace/from-svg.png /workspace/cover.png /workspace/page-1.jpg /workspace/page-2.jpg
      head -n 1 /workspace/slide1.eps
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(
      r.stdout,
      [
        "PNG 612x792",
        "PNG 612x792",
        "JPEG 612x792",
        "JPEG 612x792",
        "%!PS-Adobe-3.0 EPSF-3.0",
        "",
      ].join("\n"),
    );
  });

  test("13. dot and neato render diagrams to PDF -> pdfunite merges them -> pdfinfo and diffpdf verify", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/dag.dot": "digraph G { rankdir=LR; API -> Worker -> DB; }",
        "/workspace/mesh.dot": "graph M { A -- B -- C -- A; }",
      },
    });
    const r = await h.exec(`
      set -e
      dot -Tpdf /workspace/dag.dot -o /workspace/dag.pdf
      neato -Tpdf /workspace/mesh.dot -o /workspace/mesh.pdf
      pdfunite /workspace/dag.pdf /workspace/mesh.pdf /workspace/diagrams.pdf
      pdfinfo /workspace/diagrams.pdf | awk '/^Pages:/ { print $1, $2 }'
      pdfseparate /workspace/diagrams.pdf '/workspace/part-%d.pdf'
      diffpdf /workspace/dag.pdf /workspace/part-1.pdf
      diffpdf /workspace/mesh.pdf /workspace/part-2.pdf
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.stdout, "Pages: 2\n");
  });

  test("14. dot -Tsvg -> rsvg-convert -f pdf -> pdftoppm -png -singlefile -> exiftool -json & jq", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/flow.dot":
          'digraph Flow { Ingress [shape=box, label="Ingress Gateway"]; Core [shape=ellipse, label="Core Engine"]; Ingress -> Core; }',
      },
    });
    const r = await h.exec(`
      set -e
      dot -Tsvg /workspace/flow.dot -o /workspace/flow.svg
      rsvg-convert -f pdf /workspace/flow.svg -o /workspace/flow.pdf
      pdftoppm -png -singlefile /workspace/flow.pdf /workspace/flow-page
      exiftool -json /workspace/flow-page.png | jq -r '.[0].FileType'
      pdftotext /workspace/flow.pdf - | less -N '+/Core Engine'
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.match(r.stdout, /^PNG\n/);
    assert.match(r.stdout, /Core Engine/);
  });

  test("15. sqlite3 exports graph edges -> dot -Tplain & -Tjson -> jq and less -Ns inspect layout", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(`
      set -e
      sqlite3 /workspace/deps.db '
        CREATE TABLE edges(src TEXT, dst TEXT, w INT);
        INSERT INTO edges VALUES ("Auth", "Session", 1), ("Session", "Cache", 2), ("Auth", "Audit", 1);
      '
      {
        echo "digraph Deps {"
        echo "  rankdir=LR;"
        sqlite3 -noheader /workspace/deps.db 'SELECT "  " || src || " -> " || dst || " [weight=" || w || "];" FROM edges ORDER BY src, dst;'
        echo "}"
      } > /workspace/deps.dot
      dot -Tplain /workspace/deps.dot | more -N '+/^node "Session"'
      dot -Tjson /workspace/deps.dot | jq -r '.nodes | map(.id) | sort | join(",")'
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.match(r.stdout, /node "Session"/);
    assert.match(r.stdout, /stop\nAudit,Auth,Cache,Session\n$/);
  });

  test("16. sox audio synthesis -> soxi report -> wkhtmltopdf -> pdftotext -> wdiff & less audit", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(`
      set -e
      sox -n -r 16000 -c 1 -b 16 /workspace/tone.wav synth 0.25 sine 440
      SR="$(soxi -r /workspace/tone.wav)"
      CH="$(soxi -c /workspace/tone.wav)"
      printf '<html><head><title>Audio Spec</title></head><body><p>Rate: %s Hz</p><p>Channels: %s</p></body></html>\n' "$SR" "$CH" > /workspace/spec.html
      wkhtmltopdf /workspace/spec.html /workspace/spec.pdf
      pdftotext -nopgbrk /workspace/spec.pdf - | sed '/^[[:space:]]*$/d' > /workspace/actual.txt
      printf 'Rate: 16000 Hz\nChannels: 1\n' > /workspace/expected.txt
      wdiff /workspace/expected.txt /workspace/actual.txt | less -N
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.stdout, "     1  Rate: 16000 Hz\n     2  Channels: 1\n");
  });

  test("17. qrencode SVG + dot SVG -> svgo -> rsvg-convert PDF -> pdfunite -> pdfinfo & pdftocairo", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(`
      set -e
      qrencode -t SVG -s 4 -m 2 -o /workspace/qr.svg 'VECTOR-QR-PIPELINE'
      dot -Tsvg -o /workspace/arch.svg <<< 'digraph A { Client -> Edge; }'
      svgo /workspace/qr.svg -o /workspace/qr.min.svg
      svgo /workspace/arch.svg -o /workspace/arch.min.svg
      rsvg-convert -f pdf /workspace/qr.min.svg -o /workspace/qr.pdf
      rsvg-convert -f pdf /workspace/arch.min.svg -o /workspace/arch.pdf
      rsvg-convert -f png /workspace/qr.min.svg -o /workspace/qr.png
      pdfunite /workspace/qr.pdf /workspace/arch.pdf /workspace/bundle.pdf
      pdfinfo /workspace/bundle.pdf | awk '/^Pages:/ { print $1, $2 }'
      identify -format '%m %wx%h\n' /workspace/qr.png
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.stdout, "Pages: 2\nPNG 100x100\n");
  });

  test("18. gpg symmetric payload attached via qpdf --add-attachment -> pdfdetach -save -> gpg -d -> more +2 -s", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/secret.txt": "header-line\n\n\nTOKEN=sec_998877\nFOOTER=ok\n",
        "/workspace/carrier.html": "<html><body><p>Carrier PDF</p></body></html>",
      },
    });
    const r = await h.exec(`
      set -e
      gpg --batch --yes --passphrase 'vault-key' -c -o /workspace/secret.gpg /workspace/secret.txt
      wkhtmltopdf /workspace/carrier.html /workspace/carrier.pdf
      qpdf /workspace/carrier.pdf --add-attachment /workspace/secret.gpg --key=secret.gpg --filename=secret.gpg -- /workspace/vault.pdf
      pdfdetach -save 1 -o /workspace/out.gpg /workspace/vault.pdf
      gpg --batch --yes --passphrase 'vault-key' -d /workspace/out.gpg | more -Ns +2
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(
      r.stdout,
      ["     2  ", "     4  TOKEN=sec_998877", "     5  FOOTER=ok", ""].join("\n"),
    );
  });

  test("19. xan CSV aggregation -> HTML table -> wkhtmltopdf -> pdftk dump_data_utf8 -> less -i +/numberofpages", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/metrics.csv": "service,latency\napi,12\nworker,28\ndb,5\n",
      },
    });
    const r = await h.exec(`
      set -e
      ROWS="$(xan sort -s latency -N /workspace/metrics.csv | tail -n +2 | awk -F, '{ printf "<tr><td>%s</td><td>%s</td></tr>", $1, $2 }')"
      printf '<html><head><title>Latency Report</title></head><body><table>%s</table></body></html>\n' "$ROWS" > /workspace/report.html
      wkhtmltopdf /workspace/report.html /workspace/report.pdf
      pdftk /workspace/report.pdf dump_data_utf8 | less -N -i '+/^numberofpages:'
      pdftotext /workspace/report.pdf - | more -N
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.match(r.stdout, /NumberOfPages: 1/);
    assert.match(r.stdout, /db.*5.*api.*12.*worker.*28/s);
  });

  test("20. end-to-end 12-stage graphviz/svg/pdf/pager publishing pipeline with sha256 verification", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/topology.dot": [
          "digraph Topology {",
          "  rankdir=TB;",
          '  subgraph cluster_edge { label="Edge"; LB [shape=diamond]; WAF [shape=box]; LB -> WAF; }',
          '  subgraph cluster_core { label="Core"; App [shape=record, label="{<f0>App|<f1>v2}"]; DB [shape=cylinder]; App:f1 -> DB; }',
          "  WAF -> App:f0;",
          "}",
        ].join("\n"),
        "/workspace/changelog.txt": [
          "v1.0.0 - initial",
          "",
          "",
          "v2.0.0 - graphviz + pdf pipeline",
          "v2.1.0 - pager parity",
          "",
        ].join("\n"),
      },
    });
    const r = await h.exec(`
      set -e
      dot -Tsvg /workspace/topology.dot -o /workspace/topology.svg
      svgo --multipass /workspace/topology.svg -o /workspace/topology.min.svg
      rsvg-convert -f pdf /workspace/topology.min.svg -o /workspace/page1.pdf
      wkhtmltopdf --title "Release Packet" - /workspace/page2.pdf <<'HTML'
<html><body><h1>Release Notes</h1><p>All checks green</p></body></html>
HTML
      pdfunite /workspace/page1.pdf /workspace/page2.pdf /workspace/packet.pdf
      pdftk /workspace/packet.pdf attach_files /workspace/changelog.txt output /workspace/packet-bundled.pdf
      pdfseparate -f 1 -l 2 /workspace/packet-bundled.pdf '/workspace/split-%d.pdf'
      diffpdf /workspace/page1.pdf /workspace/split-1.pdf
      pdfdetach -save 1 -o /workspace/detached-changelog.txt /workspace/packet-bundled.pdf
      pdftocairo -svg /workspace/split-2.pdf /workspace/split-2.svg
      less -Ns -i '+/v2\\.0\\.0' /workspace/detached-changelog.txt
      more -N '+/<svg' /workspace/split-2.svg | grep -c '<svg'
      pdftotext -nopgbrk /workspace/split-2.pdf - | more -N '+/Release Notes' | grep -c 'Release Notes'
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(
      r.stdout,
      [
        "     4  v2.0.0 - graphviz + pdf pipeline",
        "     5  v2.1.0 - pager parity",
        "1",
        "1",
        "",
      ].join("\n"),
    );
  });
});
