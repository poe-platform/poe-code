import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure pdftohtml/pdftotext + htmlq/mdq/xmllint/xq/html-to-markdown matrix", () => {
  test("1. pdftohtml default file output (.html and -xml .xml) and explicit output stem", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/source.html":
          "<html><head><title>Spec Sheet</title></head><body><h1>Header Alpha</h1><p>Paragraph Beta</p></body></html>",
      },
    });
    const r = await h.exec(`
      set -e
      wkhtmltopdf /workspace/source.html /workspace/report.pdf
      pdftohtml /workspace/report.pdf
      pdftohtml -xml /workspace/report.pdf
      pdftohtml /workspace/report.pdf /workspace/custom-stem
      htmlq -t 'title' -f /workspace/report.html
      htmlq -t '#page1' -f /workspace/custom-stem.html | grep -o 'Header Alpha'
      sed '/^<!DOCTYPE/d' /workspace/report.xml | xmllint --xpath 'string(//page[@number="1"]/fontspec[@id="0"]/@family)' -
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.stdout, "Spec Sheet\nHeader Alpha\nHelvetica\n");
  });

  test("2. pdftohtml -f/-l page range selection, -zoom scaling, and invalid range exit code 99", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/pages.html": [
          "<html><body>",
          "<p>Page 1 Body</p><div style=\"page-break-after:always\"></div>",
          "<p>Page 2 Body</p><div style=\"page-break-after:always\"></div>",
          "<p>Page 3 Body</p>",
          "</body></html>",
        ].join(""),
      },
    });
    const r = await h.exec(`
      set -e
      wkhtmltopdf -s Letter /workspace/pages.html /workspace/pages.pdf
      pdftohtml -xml -stdout -f 2 -l 3 -zoom 1.5 /workspace/pages.pdf | sed '/^<!DOCTYPE/d' > /workspace/sub.xml
      xmllint --xpath 'count(//page)' /workspace/sub.xml
      xmllint --xpath 'string(//page[1]/@number)' /workspace/sub.xml
      xmllint --xpath 'string(//page[1]/@width)' /workspace/sub.xml
      xmllint --xpath 'string(//page[1]/@height)' /workspace/sub.xml
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.stdout, "2\n2\n918\n1188\n");

    const bad = await h.exec(`pdftohtml -f 5 -l 6 /workspace/pages.pdf`);
    assert.equal(bad.exitCode, 99);
    assert.match(bad.stderr, /Wrong page range given/);
  });

  test("3. pdftohtml stdin (-), explicit - output, and -- end-of-options for dash-prefixed PDFs", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/in.html": "<html><head><title>Dash PDF</title></head><body><p>From Dash File</p></body></html>",
      },
    });
    const r = await h.exec(`
      set -e
      cd /workspace
      wkhtmltopdf /workspace/in.html /workspace/-dash.pdf
      cat /workspace/-dash.pdf | pdftohtml -xml - - | sed '/^<!DOCTYPE/d' | xmllint --xpath 'count(//page)' -
      pdftohtml -stdout -- -dash.pdf | htmlq -t 'title'
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.stdout, "1\nDash PDF\n");
  });

  test("4. pdftohtml -v/--version, -h/--help, and -fmt / -enc validation errors (exit 99)", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(`
      set -e
      pdftohtml -v
      pdftohtml --help | head -n 1
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(
      r.stdout,
      "pdftohtml version 24.08.0\nUsage: pdftohtml [options] <PDF-file> [<html-file>|<xml-file>]\n",
    );

    const badFmt = await h.exec(`pdftohtml -fmt bmp /workspace/any.pdf`);
    assert.equal(badFmt.exitCode, 99);
    assert.match(badFmt.stderr, /Command Line Error: Invalid image format 'bmp'/);

    const badEnc = await h.exec(`pdftohtml -enc KOI8-R /workspace/any.pdf`);
    assert.equal(badEnc.exitCode, 99);
    assert.match(badEnc.stderr, /Command Line Error: Unknown encoding 'KOI8-R'/);
  });

  test("5. pdftohtml embedded image extraction (page1_1.png), -dataurls inline base64, and -i suppression", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(`
      set -e
      qrencode -t PNG -s 2 -m 1 -o /workspace/badge.png 'IMG-TEST'
      B64="$(base64 /workspace/badge.png | tr -d '\n')"
      printf '<html><body><p>With Image</p><img src="data:image/png;base64,%s"/></body></html>\n' "$B64" > /workspace/img.html
      wkhtmltopdf /workspace/img.html /workspace/img.pdf
      mkdir -p /workspace/out-files
      pdftohtml /workspace/img.pdf /workspace/out-files/doc.html
      identify -format '%m\n' /workspace/out-files/page1_1.png
      pdftohtml -dataurls -stdout /workspace/img.pdf | htmlq -a src 'img' | grep -c '^data:image/png;base64,'
      pdftohtml -i -stdout /workspace/img.pdf | htmlq 'img' | wc -l | tr -d ' '
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.stdout, "PNG\n1\n0\n");
  });

  test("6. pdftohtml link annotations (<a href>) and PDF outlines/bookmarks in HTML and XML modes", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/linked.html":
          '<html><head><title>Guide</title></head><body><p><a href="https://example.org/docs">Read Docs</a></p></body></html>',
        "/workspace/bookmarks.txt": [
          "BookmarkBegin",
          "BookmarkTitle: Getting Started",
          "BookmarkLevel: 1",
          "BookmarkPageNumber: 1",
        ].join("\n"),
      },
    });
    const r = await h.exec(`
      set -e
      wkhtmltopdf /workspace/linked.html /workspace/raw.pdf
      pdftk /workspace/raw.pdf update_info_utf8 /workspace/bookmarks.txt output /workspace/bookmarked.pdf
      pdftohtml -stdout /workspace/bookmarked.pdf > /workspace/bookmarked.html
      htmlq -a href '.page a' -f /workspace/bookmarked.html
      htmlq -t 'ul li a' -f /workspace/bookmarked.html
      pdftohtml -xml -stdout /workspace/bookmarked.pdf | sed '/^<!DOCTYPE/d' | xmllint --xpath 'string(//outline/item/@page)' -
      pdftohtml -xml -stdout /workspace/bookmarked.pdf | sed '/^<!DOCTYPE/d' | xmllint --xpath 'string(//outline/item)' -
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(
      r.stdout,
      "https://example.org/docs\nGetting Started\n1\nGetting Started\n",
    );
  });

  test("7. pdftotext -bbox and -bbox-layout XHTML output with default .html extension queried via htmlq and xmllint", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/words.html":
          "<html><head><title>BBox Title</title></head><body><p>Alpha Beta Gamma</p></body></html>",
      },
    });
    const r = await h.exec(`
      set -e
      wkhtmltopdf -s Letter /workspace/words.html /workspace/words.pdf
      pdftotext -bbox-layout /workspace/words.pdf
      htmlq -t 'title' -f /workspace/words.html
      htmlq -t 'word' -f /workspace/words.html
      sed -e 's/<!DOCTYPE[^>]*>//' -e 's/ xmlns="[^"]*"//' /workspace/words.html | xmllint --xpath 'count(//flow/block/line/word)' -
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.stdout, "BBox Title\nAlpha\nBeta\nGamma\n3\n");
  });

  test("8. pdftotext -tsv hierarchical TSV output (###PAGE###, ###FLOW###, ###LINE###, words) with default .tsv extension", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/multi.html":
          "<html><body><p>First Page</p><div style=\"page-break-after:always\"></div><p>Second Page</p></body></html>",
      },
    });
    const r = await h.exec(`
      set -e
      wkhtmltopdf /workspace/multi.html /workspace/multi.pdf
      pdftotext -tsv /workspace/multi.pdf
      awk -F'\t' 'NR == 1 { print $1, $2, $12 } $12 == "###PAGE###" { print "PAGE", $2 } $1 == 5 { print "WORD", $2, $12 }' /workspace/multi.tsv
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(
      r.stdout,
      [
        "level page_num text",
        "PAGE 1",
        "WORD 1 First",
        "WORD 1 Page",
        "PAGE 2",
        "WORD 2 Second",
        "WORD 2 Page",
        "",
      ].join("\n"),
    );
  });

  test("9. pdftotext -htmlmeta wraps plain text and -tsv in XHTML <pre> with metadata tags", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/meta.html":
          "<html><head><title>Meta Doc</title></head><body><p>Body Line</p></body></html>",
      },
    });
    const r = await h.exec(`
      set -e
      wkhtmltopdf /workspace/meta.html /workspace/meta.pdf
      pdftotext -htmlmeta -nopgbrk /workspace/meta.pdf - | htmlq -t 'title, pre'
      pdftotext -htmlmeta -tsv /workspace/meta.pdf - | htmlq -t 'pre' | grep -c '###PAGE###'
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.match(r.stdout, /^Meta Doc\n+Body Line/);
    assert.match(r.stdout, /\n1\n$/);
  });

  test("10. pdftotext -urls extracts link annotation URIs and rejects -urls with -htmlmeta/-bbox/-tsv", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/links.html":
          '<html><body><p>Click <a href="https://poe.com/api">here</a></p></body></html>',
      },
    });
    const r = await h.exec(`
      set -e
      wkhtmltopdf /workspace/links.html /workspace/links.pdf
      pdftotext -nopgbrk -urls /workspace/links.pdf -
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.match(r.stdout, /Click here/);
    assert.match(r.stdout, /https:\/\/poe\.com\/api/);

    for (const flag of ["-htmlmeta", "-bbox", "-tsv"]) {
      const bad = await h.exec(`pdftotext -urls ${flag} /workspace/links.pdf -`);
      assert.equal(bad.exitCode, 99);
      assert.match(bad.stderr, /'-urls' is not supported with HTML or TSV output/);
    }
  });

  test("11. pdftotext -eol unix|dos|mac, invalid -eol warning, -listenc, -v, and invalid flag diagnostics", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/eol.html": "<html><body><p>LineA</p><p>LineB</p></body></html>",
      },
    });
    const r = await h.exec(`
      set -e
      wkhtmltopdf /workspace/eol.html /workspace/eol.pdf
      pdftotext -v
      pdftotext -listenc | head -n 4
      pdftotext -nopgbrk -eol mac /workspace/eol.pdf - | tr '\r' '@'
      printf '\n'
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.match(r.stdout, /^pdftotext version 26\.09\.90/);
    assert.match(r.stdout, /Available encodings are:\nASCII7\nLatin1\nUTF-8/);
    assert.match(r.stdout, /LineA@+LineB@+/);

    const warnEol = await h.exec(`pdftotext -nopgbrk -eol bogus /workspace/eol.pdf -`);
    assert.equal(warnEol.exitCode, 0);
    assert.match(warnEol.stderr, /Bad '-eol' value on command line/);

    const badCol = await h.exec(`pdftotext -colspacing 99 /workspace/eol.pdf -`);
    assert.equal(badCol.exitCode, 99);
    assert.match(badCol.stderr, /Invalid column spacing/);
  });

  test("12. htmlq multiple positional selectors, multiple -a attributes, --filename=, --output=, and -w whitespace stripping", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/nav.html": [
          "<html><body>",
          "<h1>Main Title</h1>",
          "<nav>",
          '  <a href="/home" data-role="primary">   Home   \n   Link  </a>',
          '  <a href="/about" data-role="secondary">About</a>',
          "</nav>",
          "<p class=\"lead\">Lead Copy</p>",
          "</body></html>",
        ].join("\n"),
      },
    });
    const r = await h.exec(`
      set -e
      htmlq --filename=/workspace/nav.html --output=/workspace/picked.txt -t 'h1' 'p.lead'
      cat /workspace/picked.txt
      htmlq -f /workspace/nav.html -a href -a data-role 'nav a'
      htmlq -f /workspace/nav.html -tw 'nav'
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(
      r.stdout,
      [
        "Main Title",
        "Lead Copy",
        "/home",
        "primary",
        "/about",
        "secondary",
        "   Home   ",
        "   Link  ",
        "About",
        "",
        "",
      ].join("\n"),
    );
  });

  test("13. htmlq -B/--detect-base and -b/--base relative URL resolution with -r/--remove-nodes pruning", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/page.html": [
          "<html><head><base href=\"https://docs.example.com/v2/guide/\"/></head>",
          "<body>",
          "<div class=\"card\"><span class=\"secret\">redact-me</span><a href=\"../api/auth.html\">Auth API</a></div>",
          "</body></html>",
        ].join(""),
      },
    });
    const r = await h.exec(`
      set -e
      htmlq -B -r '.secret' -f /workspace/page.html '.card'
      htmlq -B -f /workspace/page.html 'a'
      htmlq -B -a href -f /workspace/page.html 'a'
      htmlq --base=https://cdn.example.org/root/ -a href -f /workspace/page.html 'a'
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(
      r.stdout,
      [
        '<div class="card"><a href="../api/auth.html">Auth API</a></div>',
        '<a href="https://docs.example.com/v2/api/auth.html">Auth API</a>',
        "https://docs.example.com/v2/api/auth.html",
        "https://cdn.example.org/api/auth.html",
        "",
      ].join("\n"),
    );
  });

  test("14. html-to-markdown multi-file + - stdin concatenation, -- dash filenames, and option validation", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/part1.html": "<h1>Part One</h1>",
        "/workspace/-part3.html": "<p>Part <strong>Three</strong></p>",
      },
    });
    const r = await h.exec(`
      set -e
      cd /workspace
      printf '<h2>Part Two</h2>' | html-to-markdown -- part1.html - - -part3.html
      html-to-markdown --version
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(
      r.stdout,
      [
        "# Part One",
        "",
        "## Part Two",
        "",
        "Part **Three**",
        "html-to-markdown (safe-bash bounded HTML profile)",
        "",
      ].join("\n"),
    );

    const badOpt = await h.exec(`html-to-markdown --unknown-flag`);
    assert.equal(badOpt.exitCode, 2);
    assert.match(badOpt.stderr, /html-to-markdown: unknown option: --unknown-flag/);
  });

  test("15. wkhtmltopdf -> pdftohtml -stdout -> htmlq -> html-to-markdown -> mdq round-trip", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/article.html":
          '<html><head><title>Architecture</title></head><body><p>Gateway routes to <a href="https://internal.service/v1">Core Service</a></p></body></html>',
      },
    });
    const r = await h.exec(`
      set -e
      wkhtmltopdf /workspace/article.html /workspace/article.pdf
      pdftohtml -stdout /workspace/article.pdf | htmlq '#page1' | html-to-markdown > /workspace/article.md
      mdq -o plain '[Core Service]()' /workspace/article.md
      cat /workspace/article.md | grep -o 'https://internal.service/v1'
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.stdout, "Gateway routes to Core Service\nhttps://internal.service/v1\n");
  });

  test("16. mdq selector queries (# heading, lists, code blocks, tables) with -o json -> jq and -o plain -> less -N", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/runbook.md": [
          "# Incident Runbook",
          "",
          "## Checks",
          "",
          "- Verify DNS",
          "- Verify TLS",
          "",
          "```bash",
          "curl -sf https://status.example.com",
          "```",
          "",
        ].join("\n"),
      },
    });
    const r = await h.exec(`
      set -e
      mdq -o plain -- '- "Verify"' /workspace/runbook.md | less -N
      mdq -o plain '\`\`\`bash' /workspace/runbook.md
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(
      r.stdout,
      [
        "     1  Verify DNS",
        "     2  Verify TLS",
        "curl -sf https://status.example.com",
        "",
      ].join("\n"),
    );
  });

  test("17. xmllint --output/-o, --encode UTF-8, --c14n, and --xpath over pdftohtml -xml output", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/doc.html":
          "<html><body><p>Alpha Row</p><div style=\"page-break-after:always\"></div><p>Beta Row</p></body></html>",
      },
    });
    const r = await h.exec(`
      set -e
      wkhtmltopdf /workspace/doc.html /workspace/doc.pdf
      pdftohtml -xml -stdout /workspace/doc.pdf | sed '/^<!DOCTYPE/d' > /workspace/raw.xml
      xmllint --format --encode UTF-8 --output /workspace/formatted.xml /workspace/raw.xml
      xmllint --noout /workspace/formatted.xml
      xmllint --xpath 'count(//page)' /workspace/formatted.xml
      xmllint --xpath 'string(//page[@number="2"]/text)' /workspace/formatted.xml
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.stdout, "2\nBeta Row\n");
  });

  test("18. pdftohtml -xml -> xq JSON conversion and jq/yq XML queries", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/catalog.html":
          "<html><body><p>Item One</p><div style=\"page-break-after:always\"></div><p>Item Two</p></body></html>",
      },
    });
    const r = await h.exec(`
      set -e
      wkhtmltopdf /workspace/catalog.html /workspace/catalog.pdf
      pdftohtml -xml -stdout /workspace/catalog.pdf | sed '/^<!DOCTYPE/d' > /workspace/catalog.xml
      xq -r '.pdf2xml.page[].text["#text"]' /workspace/catalog.xml
      xq . /workspace/catalog.xml | jq -r '.pdf2xml.page | length'
      xq -r '.pdf2xml.page[1]["@number"]' /workspace/catalog.xml
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.stdout, "Item One\nItem Two\n2\n2\n");
  });

  test("19. unrtf RTF -> htmlq -> html-to-markdown -> wkhtmltopdf -> pdftotext -htmlmeta pipeline", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/memo.rtf":
          "{\\rtf1\\ansi{\\info{\\title Quarterly Memo}}\\b Executive Summary\\b0\\par Revenue grew 42 percent.\\par}",
      },
    });
    const r = await h.exec(`
      set -e
      unrtf --html /workspace/memo.rtf > /workspace/memo.html
      html-to-markdown /workspace/memo.html | less -N
      wkhtmltopdf /workspace/memo.html /workspace/memo.pdf
      pdftotext -htmlmeta -nopgbrk /workspace/memo.pdf - | htmlq -t 'pre' | sed '/^[[:space:]]*$/d'
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.match(r.stdout, /\*\*Executive Summary\*\*/);
    assert.match(r.stdout, /Revenue grew 42 percent\./);
  });

  test("20. 12-stage sqlite3 -> HTML -> wkhtmltopdf -> pdftk bookmarks -> pdftohtml -xml/HTML -> xmllint/htmlq/html-to-markdown/mdq/less pipeline", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/bookmarks.txt": [
          "InfoBegin",
          "InfoKey: Title",
          "InfoValue: Service Catalog v3",
          "BookmarkBegin",
          "BookmarkTitle: Edge Tier",
          "BookmarkLevel: 1",
          "BookmarkPageNumber: 1",
          "BookmarkBegin",
          "BookmarkTitle: Storage Tier",
          "BookmarkLevel: 1",
          "BookmarkPageNumber: 2",
        ].join("\n"),
      },
    });
    const r = await h.exec(`
      set -e
      sqlite3 /workspace/services.db '
        CREATE TABLE svc(tier INT, name TEXT, url TEXT);
        INSERT INTO svc VALUES (1, "Edge-Proxy", "https://edge.internal/health"), (2, "Primary-DB", "https://db.internal/status");
      '
      U1="$(sqlite3 -noheader /workspace/services.db 'SELECT url FROM svc WHERE tier = 1;')"
      N1="$(sqlite3 -noheader /workspace/services.db 'SELECT name FROM svc WHERE tier = 1;')"
      U2="$(sqlite3 -noheader /workspace/services.db 'SELECT url FROM svc WHERE tier = 2;')"
      N2="$(sqlite3 -noheader /workspace/services.db 'SELECT name FROM svc WHERE tier = 2;')"
      printf '<html><body><p><a href="%s">%s</a></p><div style="page-break-after:always"></div><p><a href="%s">%s</a></p></body></html>\n' "$U1" "$N1" "$U2" "$N2" > /workspace/catalog.html
      wkhtmltopdf -s Letter /workspace/catalog.html /workspace/raw.pdf
      pdftk /workspace/raw.pdf update_info_utf8 /workspace/bookmarks.txt output /workspace/final.pdf
      pdftohtml /workspace/final.pdf /workspace/final.html
      pdftohtml -xml /workspace/final.pdf /workspace/final.xml
      sed '/^<!DOCTYPE/d' /workspace/final.xml | xmllint --xpath 'count(//outline/item)' -
      htmlq -t 'title' -f /workspace/final.html
      htmlq -a href '#page1 a, #page2 a' -f /workspace/final.html
      htmlq 'ul' -f /workspace/final.html | html-to-markdown | mdq -o plain '- "Tier"' | less -N
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(
      r.stdout,
      [
        "2",
        "Service Catalog v3",
        "https://edge.internal/health",
        "https://db.internal/status",
        "     1  Edge Tier",
        "     2  Storage Tier",
        "",
      ].join("\n"),
    );
  });
});
