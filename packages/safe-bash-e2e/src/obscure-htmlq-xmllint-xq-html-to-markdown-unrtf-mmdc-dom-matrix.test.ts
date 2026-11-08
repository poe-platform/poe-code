import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure htmlq xmllint xq html-to-markdown unrtf mmdc dom matrix", () => {
  it("1. htmlq CSS attribute prefix/suffix/substring selectors and --attribute extraction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > /tmp/links.html\n<nav>\n  <a class=\"ext\" href=\"https://api.example.com/v1/users\">Users</a>\n  <a class=\"int\" href=\"/docs/guide.pdf\">Guide</a>\n  <a class=\"ext\" href=\"https://api.example.com/v2/metrics\">Metrics</a>\n</nav>\nEOF\nhtmlq -f /tmp/links.html 'a[href^=\"https://\"]' -a href\nhtmlq -f /tmp/links.html 'a[href$=\".pdf\"]' -t");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "https://api.example.com/v1/users\nhttps://api.example.com/v2/metrics\nGuide");
    });
  });

  it("2. htmlq --remove-nodes script,style with --text and --ignore-whitespace", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > /tmp/page.html\n<html><body><div id=\"content\"><style>.x{color:red}</style><p>Clean</p><script>alert(1)</script><p>Body</p></div></body></html>\nEOF\nhtmlq -f /tmp/page.html -r script -r style -t -i '#content p'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Clean\n\nBody");
    });
  });

  it("3. htmlq --detect-base and relative URL resolution on anchor hrefs", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > /tmp/base.html\n<html><head><base href=\"https://cdn.example.org/assets/\"></head><body><a href=\"app.js\">App</a></body></html>\nEOF\nhtmlq -f /tmp/base.html -B -a href 'a'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "https://cdn.example.org/assets/app.js");
    });
  });

  it("4. htmlq pseudo-classes :first-child, :last-child, and :nth-child", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > /tmp/list.html\n<ul><li>alpha</li><li>beta</li><li>gamma</li><li>delta</li></ul>\nEOF\nhtmlq -f /tmp/list.html -t 'li:first-child'\nhtmlq -f /tmp/list.html -t 'li:last-child'\nhtmlq -f /tmp/list.html -t 'li:nth-child(2)'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "alpha\ndelta\nbeta");
    });
  });

  it("5. xmllint --xpath count(), sum(), string(), and boolean() XPath functions", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > /tmp/inv.xml\n<inventory version=\"3.1\">\n  <item id=\"a\" tier=\"gold\"><price>120</price></item>\n  <item id=\"b\" tier=\"silver\"><price>80</price></item>\n  <item id=\"c\" tier=\"gold\"><price>200</price></item>\n</inventory>\nEOF\nxmllint --xpath 'count(//item[@tier=\"gold\"])' /tmp/inv.xml\nxmllint --xpath 'sum(//item/price)' /tmp/inv.xml\nxmllint --xpath 'string(/inventory/@version)' /tmp/inv.xml\nxmllint --xpath 'boolean(//item[@id=\"c\"])' /tmp/inv.xml");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "2\n400\n3.1\ntrue");
    });
  });

  it("6. xmllint --xpath union operator (|) and attribute extraction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > /tmp/nodes.xml\n<cluster><primary><host>db-01</host></primary><replica><node>db-02</node></replica></cluster>\nEOF\nxmllint --xpath '//primary/host/text() | //replica/node/text()' /tmp/nodes.xml");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "db-01\ndb-02");
    });
  });

  it("7. xmllint --format pretty-printing and --noout validation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '<root><child id=\"1\"><name>alpha</name></child></root>' > /tmp/compact.xml\nxmllint --noout /tmp/compact.xml && echo VALID\nxmllint --format /tmp/compact.xml");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "VALID\n<?xml version=\"1.0\"?>\n<root>\n  <child id=\"1\">\n    <name>alpha</name>\n  </child>\n</root>");
    });
  });

  it("8. xmllint --c14n canonical XML serialization", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '<doc b=\"2\" a=\"1\"><empty/></doc>' | xmllint --c14n -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "<doc a=\"1\" b=\"2\"><empty></empty></doc>");
    });
  });

  it("9. xq XML-to-JSON query and yq XML reconstruction with attribute mutations", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > /tmp/svc.xml\n<service name=\"auth\" port=\"8080\"><env>staging</env></service>\nEOF\nxq -r '.service | \"\\(.[\"@name\"]):\\(.[\"@port\"]):\\(.env)\"' /tmp/svc.xml\nxq -c '.service.env = \"production\" | .service[\"@port\"] = \"9090\"' /tmp/svc.xml");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "auth:8080:staging\n{\"service\":{\"@name\":\"auth\",\"@port\":\"9090\",\"env\":\"production\"}}");
    });
  });

  it("10. html-to-markdown conversion of headings, emphasis, links, lists, and code blocks", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > /tmp/article.html\n<h1>Release Notes</h1>\n<p>Welcome to <strong>ReleaseTwo</strong> with <em>zero</em> regressions and <a href=\"https://example.com\">Docs</a>.</p>\n<ul><li>Fast startup</li><li>Pure Rust</li></ul>\nEOF\nhtml-to-markdown /tmp/article.html");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "# Release Notes\n\nWelcome to **ReleaseTwo** with *zero* regressions and [Docs](<https://example.com>).\n\n- Fast startup\n- Pure Rust");
    });
  });

  it("11. html-to-markdown table and blockquote rendering", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > /tmp/tbl.html\n<blockquote><p>Important notice</p></blockquote>\n<table><thead><tr><th>Name</th><th>Score</th></tr></thead><tbody><tr><td>Alice</td><td>98</td></tr><tr><td>Bob</td><td>91</td></tr></tbody></table>\nEOF\nhtml-to-markdown /tmp/tbl.html");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "> Important notice\n\n| Name | Score |\n| --- | --- |\n| Alice | 98 |\n| Bob | 91 |");
    });
  });

  it("12. unrtf --text and --html extraction with formatting groups, Unicode, and hex escapes", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '{\\\\rtf1\\\\ansi{\\\\fonttbl{\\\\f0 Times;}}\\\\b Bold\\\\b0  and {\\\\i Italic} \\\\\\x2741\\\\par Second line\\par}' > /tmp/doc.rtf\nunrtf --text --quiet /tmp/doc.rtf\nunrtf --html --quiet /tmp/doc.rtf | htmlq -t 'strong'\nunrtf --html --quiet /tmp/doc.rtf | htmlq -t 'em'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Bold and Italic A\nSecond line\nBold\nItalic");
    });
  });

  it("13. unrtf --latex output mode and --profile=gnu-0.21.10 formatting", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '{\\\\rtf1\\\\ansi {\\\\b Alert}: {\\\\i Ready}}' > /tmp/alert.rtf\nunrtf --profile=gnu-0.21.10 --latex --quiet /tmp/alert.rtf | grep -o '{\\\\bf Alert}: {\\\\it Ready}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\\bf Alert}: {\\it Ready}");
    });
  });

  it("14. mmdc Mermaid flowchart compilation to SVG and XPath inspection via xmllint", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > /tmp/flow.mmd\ngraph TD\n  A[Gateway] --> B[AuthService]\n  B --> C[Database]\nEOF\nmmdc -i /tmp/flow.mmd -o /tmp/flow.svg\nxmllint --noout /tmp/flow.svg && echo SVG_VALID\ngrep -o 'Gateway\\|AuthService\\|Database' /tmp/flow.svg | sort -u | paste -sd, -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "SVG_VALID\nAuthService,Database,Gateway");
    });
  });

  it("15. mmdc Mermaid sequenceDiagram compilation to PNG and dimension inspection", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > /tmp/seq.mmd\nsequenceDiagram\n  Client->>API: POST /login\n  API-->>Client: 200 OK\nEOF\nmmdc -i /tmp/seq.mmd -o /tmp/seq.png -w 640 -H 480\nidentify -format '%m %wx%h' /tmp/seq.png");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "PNG 640x480");
    });
  });

  it("16. htmlq + html-to-markdown pipeline: extract article main body and convert to Markdown", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > /tmp/fullpage.html\n<html><body><header><h1>Site Banner</h1></header><main class=\"post\"><h2>Guide</h2><p>Run <code>poe-code</code> now.</p></main><footer>Copyright</footer></body></html>\nEOF\nhtmlq -f /tmp/fullpage.html 'main.post' | html-to-markdown");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "## Guide\n\nRun `poe-code` now.");
    });
  });

  it("17. xmllint + xq + jq + sqlite3 pipeline: ingest XML catalog into SQLite and aggregate", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > /tmp/catalog.xml\n<catalog>\n  <book id=\"b1\" cat=\"sys\"><title>Rust</title><price>45</price></book>\n  <book id=\"b2\" cat=\"web\"><title>TS</title><price>35</price></book>\n  <book id=\"b3\" cat=\"sys\"><title>Wasm</title><price>50</price></book>\n</catalog>\nEOF\nxq -r '.catalog.book[] | [\"\\(.[\"@id\"])\", \"\\(.[\"@cat\"])\", \"\\(.title)\", \"\\(.price)\"] | @csv' /tmp/catalog.xml > /tmp/books.csv\nsqlite3 /tmp/cat.db \"CREATE TABLE books(id TEXT, cat TEXT, title TEXT, price INT);\" \".mode csv\" \".import /tmp/books.csv books\"\nsqlite3 /tmp/cat.db \"SELECT cat, COUNT(*), SUM(CAST(price AS INT)) FROM books GROUP BY cat ORDER BY cat;\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "sys|2|95\nweb|1|35");
    });
  });

  it("18. yq XML-to-YAML and YAML-to-XML roundtrip with xmllint verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > /tmp/app.yaml\ncluster:\n  name: prod-eu\n  replicas: 3\nEOF\nyq -p=yaml -o=xml '.' /tmp/app.yaml > /tmp/app.xml\nxmllint --xpath 'string(//cluster/name)' /tmp/app.xml\nxmllint --xpath 'string(//cluster/replicas)' /tmp/app.xml");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "prod-eu\n3");
    });
  });

  it("19. htmlq table cell extraction piped into xan and csvstat", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > /tmp/metrics.html\n<table id=\"m\">\n  <tr><td class=\"row\">host,lat</td></tr>\n  <tr><td class=\"row\">h1,12</td></tr>\n  <tr><td class=\"row\">h2,28</td></tr>\n  <tr><td class=\"row\">h3,20</td></tr>\n</table>\nEOF\nhtmlq -f /tmp/metrics.html -t '#m td.row' | xan stats -s lat - | xan select mean,sum -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "mean,sum\n20,60");
    });
  });

  it("20. unrtf -> htmlq -> html-to-markdown multi-stage rich document conversion", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '{\\\\rtf1\\\\ansi {\\\\b Title}: Visit {\\\\i portal} now.}' | unrtf --html --quiet | html-to-markdown");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "**Title**: Visit *portal* now.");
    });
  });

});
