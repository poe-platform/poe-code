import assert from "node:assert/strict";
import test from "node:test";
import { withE2EHarness } from "./harness.js";

const SAMPLE_PORTAL_HTML = [
  "<!DOCTYPE html>",
  "<html>",
  "<head><title>Acme Cloud Portal &amp; Docs</title></head>",
  "<body>",
  '  <nav id="main-nav">',
  '    <a class="nav-link active" href="/docs/intro">Introduction</a>',
  '    <a class="nav-link" href="https://api.acme.dev/v2">API Reference</a>',
  '    <a class="nav-link disabled" href="/legacy">Legacy</a>',
  "  </nav>",
  '  <main id="content">',
  '    <article class="card" data-tier="enterprise" data-id="101">',
  "      <h2>Zero-Dependency Rust Shell</h2>",
  '      <p class="summary">Deterministic virtual execution &mdash; fast &amp; safe.</p>',
  '      <span class="price">$499</span>',
  "    </article>",
  '    <article class="card" data-tier="pro" data-id="102">',
  "      <h2>Observability Pipeline</h2>",
  '      <p class="summary">Real-time log analytics.</p>',
  '      <span class="price">$99</span>',
  "    </article>",
  '    <article class="card draft" data-tier="free" data-id="103">',
  "      <h2>Community Starter</h2>",
  '      <p class="summary">Free forever tier.</p>',
  '      <span class="price">$0</span>',
  "    </article>",
  '    <div class="noise"><script>alert(1)</script><span>ad_banner</span></div>',
  "  </main>",
  "</body>",
  "</html>",
  "",
].join("\n");

test("htmlq extracts text (-t) using ID, class, and descendant CSS selectors", async () => {
  await withE2EHarness({ files: { "/workspace/portal.html": SAMPLE_PORTAL_HTML } }, async (h) => {
    const script = [
      "htmlq -t 'title' -f /workspace/portal.html",
      "htmlq -t '#content article.card h2' -f /workspace/portal.html",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "Acme Cloud Portal & Docs",
        "Zero-Dependency Rust Shell",
        "Observability Pipeline",
        "Community Starter",
        "",
      ].join("\n"),
    );
  });
});

test("htmlq extracts attribute values (-a) with attribute prefix/exact selectors and :not() pseudo-class", async () => {
  await withE2EHarness({ files: { "/workspace/portal.html": SAMPLE_PORTAL_HTML } }, async (h) => {
    const script = [
      "htmlq -a href '#main-nav a.nav-link:not(.disabled)' -f /workspace/portal.html",
      "htmlq -a data-id 'article[data-tier=\"enterprise\"]' -f /workspace/portal.html",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "/docs/intro",
        "https://api.acme.dev/v2",
        "101",
        "",
      ].join("\n"),
    );
  });
});

test("htmlq --remove-nodes (-r) strips unwanted DOM subtrees before text extraction", async () => {
  await withE2EHarness({ files: { "/workspace/portal.html": SAMPLE_PORTAL_HTML } }, async (h) => {
    const script = [
      "htmlq -r '.draft' -f /workspace/portal.html | htmlq -t -r '.noise' '#content h2'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "Zero-Dependency Rust Shell",
        "Observability Pipeline",
        "",
      ].join("\n"),
    );
  });
});

test("htmlq --base (-b) and --detect-base (-B) resolve relative link URLs against base URL", async () => {
  await withE2EHarness({ files: { "/workspace/portal.html": SAMPLE_PORTAL_HTML } }, async (h) => {
    const script = [
      "htmlq -b 'https://portal.acme.dev' -a href '#main-nav a.active' -f /workspace/portal.html",
    ].join("\n");

    await h.expectOk(script, "https://portal.acme.dev/docs/intro\n");
  });
});

test("htmlq child (>), adjacent sibling (+), and :first-child / :last-child / :nth-child combinators", async () => {
  await withE2EHarness({ files: { "/workspace/portal.html": SAMPLE_PORTAL_HTML } }, async (h) => {
    const script = [
      "htmlq -t '#content > article:first-child > h2 + p.summary' -f /workspace/portal.html",
      "htmlq -t '#content > article:nth-child(2) .price' -f /workspace/portal.html",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "Deterministic virtual execution \u2014 fast & safe.",
        "$99",
        "",
      ].join("\n"),
    );
  });
});

test("htmlq --pretty (-p) formats extracted HTML fragments with clean indentation", async () => {
  await withE2EHarness({ files: { "/workspace/portal.html": SAMPLE_PORTAL_HTML } }, async (h) => {
    const res = await h.exec(
      "htmlq -p 'article[data-id=\"102\"]' -f /workspace/portal.html",
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /<article class="card" data-tier="pro" data-id="102">/);
    assert.match(res.stdout, /<h2>\s*Observability Pipeline\s*<\/h2>/);
  });
});

test("html-to-markdown converts headings, emphasis, links, lists, and code blocks to clean Markdown", async () => {
  const htmlDoc = [
    "<article>",
    "  <h1>Release Notes v2.4</h1>",
    '  <p>Read the <a href="https://acme.dev/guide">migration guide</a> for <strong>critical</strong> updates.</p>',
    "  <ul>",
    "    <li>Zero external dependencies</li>",
    "    <li>Deterministic VFS quotas</li>",
    "  </ul>",
    "  <pre><code>cargo test --workspace</code></pre>",
    "</article>",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/notes.html": htmlDoc } }, async (h) => {
    const res = await h.exec("html-to-markdown /workspace/notes.html");
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /# Release Notes v2\\?\.4/);
    assert.match(res.stdout, /\[migration guide\]\((?:<https:\/\/acme\.dev\/guide>|https:\/\/acme\.dev\/guide)\)/);
    assert.match(res.stdout, /\*\*critical\*\*/);
    assert.match(res.stdout, /Zero external dependencies/);
    assert.match(res.stdout, /cargo test --workspace/);
  });
});

test("html-to-markdown converts HTML tables into pipe-delimited Markdown tables", async () => {
  const tableHtml = [
    "<table>",
    "  <thead><tr><th>Crate</th><th>Status</th></tr></thead>",
    "  <tbody>",
    "    <tr><td>safe-fs-core</td><td>ready</td></tr>",
    "    <tr><td>safe-bash-eval</td><td>active</td></tr>",
    "  </tbody>",
    "</table>",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/table.html": tableHtml } }, async (h) => {
    const res = await h.exec("html-to-markdown /workspace/table.html");
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /safe\\?-fs\\?-core/);
    assert.match(res.stdout, /safe\\?-bash\\?-eval/);
    assert.match(res.stdout, /\|/);
  });
});

test("htmlq piped into html-to-markdown extracts article body and converts to Markdown", async () => {
  await withE2EHarness({ files: { "/workspace/portal.html": SAMPLE_PORTAL_HTML } }, async (h) => {
    const res = await h.exec(
      "htmlq -r '.noise' '#content' -f /workspace/portal.html | html-to-markdown",
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /## Zero\\?-Dependency Rust Shell/);
    assert.match(res.stdout, /## Observability Pipeline/);
    assert.doesNotMatch(res.stdout, /ad_banner/);
  });
});

test("xmllint --xpath queries JUnit XML test suites for failure counts and test case names", async () => {
  const junitXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<testsuites tests="4" failures="1">',
    '  <testsuite name="parser" tests="2" failures="0">',
    '    <testcase name="lex_tokens" time="0.004"/>',
    '    <testcase name="parse_pipeline" time="0.009"/>',
    "  </testsuite>",
    '  <testsuite name="eval" tests="2" failures="1">',
    '    <testcase name="expand_vars" time="0.003"/>',
    '    <testcase name="noclobber_dev_null" status="failed" time="0.012">',
    '      <failure message="EEXIST on /dev/null"/>',
    "    </testcase>",
    "  </testsuite>",
    "</testsuites>",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/junit.xml": junitXml } }, async (h) => {
    const script = [
      "xmllint --xpath 'string(/testsuites/@failures)' /workspace/junit.xml",
      "xmllint --xpath 'string(//testcase[@status=\"failed\"]/@name)' /workspace/junit.xml",
      "xmllint --xpath 'string(//testcase/failure/@message)' /workspace/junit.xml",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "1",
        "noclobber_dev_null",
        "EEXIST on /dev/null",
        "",
      ].join("\n"),
    );
  });
});

test("xmllint --noout validates well-formed XML and rejects malformed XML with non-zero exit code", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/good.xml": "<root><item id=\"1\">ok</item></root>\n",
        "/workspace/bad.xml": "<root><item id=\"1\">unclosed</root>\n",
      },
    },
    async (h) => {
      await h.expectOk("xmllint --noout /workspace/good.xml && echo 'valid:yes'", "valid:yes\n");
      await h.expectFail("xmllint --noout /workspace/bad.xml");
    },
  );
});

test("xmllint --format pretty-prints compact single-line XML", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/compact.xml": "<catalog><book id=\"b1\"><title>Rust Systems</title></book></catalog>",
      },
    },
    async (h) => {
      const res = await h.exec("xmllint --format /workspace/compact.xml");
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /<catalog>\n\s+<book id="b1">\n\s+<title>Rust Systems<\/title>/);
    },
  );
});

test("xq command evaluates jq expressions over RSS/Atom XML feeds", async () => {
  const rssXml = [
    '<?xml version="1.0"?>',
    '<rss version="2.0">',
    "  <channel>",
    "    <title>Poe Engineering Blog</title>",
    "    <item><title>Safe-Bash in Rust</title><category>systems</category></item>",
    "    <item><title>Zero-Dep Parsers</title><category>systems</category></item>",
    "    <item><title>UI Polish</title><category>frontend</category></item>",
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/feed.xml": rssXml } }, async (h) => {
    const res = await h.exec(
      "xq -r '.rss.channel.item | map(select(.category == \"systems\")) | length' /workspace/feed.xml",
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout.trim(), /^2$/);
  });
});

test("SVG XML inspection and viewBox/path extraction via xmllint --xpath", async () => {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40" width="120" height="40">',
    '  <g id="icon-layer">',
    '    <rect id="bg" x="0" y="0" width="120" height="40" fill="#111"/>',
    '    <circle id="dot" cx="20" cy="20" r="8" fill="#0f0"/>',
    "  </g>",
    "</svg>",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/badge.svg": svg } }, async (h) => {
    const script = [
      "xmllint --xpath 'string(/*/@viewBox)' /workspace/badge.svg",
      "xmllint --xpath 'string(//*[@id=\"dot\"]/@r)' /workspace/badge.svg",
    ].join("\n");

    await h.expectOk(script, ["0 0 120 40", "8", ""].join("\n"));
  });
});

test("HTML table scraping pipeline: htmlq extracts rows -> sed/paste -> csvcut/csvjson -> jq", async () => {
  const htmlTable = [
    "<table>",
    "  <tr class=\"row\"><td class=\"host\">api-01</td><td class=\"rps\">1420</td></tr>",
    "  <tr class=\"row\"><td class=\"host\">api-02</td><td class=\"rps\">1850</td></tr>",
    "  <tr class=\"row\"><td class=\"host\">api-03</td><td class=\"rps\">930</td></tr>",
    "</table>",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/hosts.html": htmlTable } }, async (h) => {
    const script = [
      "htmlq -t -i 'tr.row td' -f /workspace/hosts.html | grep -v '^$' | paste -d ',' - - > /workspace/hosts_noheader.csv",
      "printf 'host,rps\\n' | cat - /workspace/hosts_noheader.csv > /workspace/hosts.csv",
      "csvjson /workspace/hosts.csv | jq 'map(.rps) | add'",
    ].join("\n");

    const res = await h.exec(script);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout.trim(), /^4200(?:\.0)?$/);
  });
});

test("htmlq handles unclosed HTML tags, void elements (<br>, <img>, <input>), and numeric entities", async () => {
  const messyHtml = [
    "<div>",
    '  <img src="/logo.png" alt="Logo">',
    '  <input type="text" name="query" value="rust&#x2d;shell">',
    "  <p>First paragraph<br>Second line",
    "  <p>Unclosed second paragraph",
    "</div>",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/messy.html": messyHtml } }, async (h) => {
    const script = [
      "htmlq -a src 'img' -f /workspace/messy.html",
      "htmlq -a value 'input[name=\"query\"]' -f /workspace/messy.html",
      "htmlq -t -i 'p' -f /workspace/messy.html | grep -c 'paragraph'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "/logo.png",
        "rust-shell",
        "2",
        "",
      ].join("\n"),
    );
  });
});

test("htmlq attribute selectors: $= (ends with), *= (contains), |= (dash-prefix), ~= (word)", async () => {
  const html = [
    "<ul>",
    '  <li data-file="archive.tar.gz" lang="en-US" class="pkg core featured">A</li>',
    '  <li data-file="notes.txt" lang="fr-CA" class="pkg docs">B</li>',
    '  <li data-file="bundle.tar.gz" lang="en-GB" class="pkg extra">C</li>',
    "</ul>",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/attrs.html": html } }, async (h) => {
    const script = [
      "htmlq -t -i 'li[data-file$=\".tar.gz\"]' -f /workspace/attrs.html | grep -v '^$' | paste -sd ',' -",
      "htmlq -t -i 'li[lang|=\"en\"]' -f /workspace/attrs.html | grep -v '^$' | paste -sd ',' -",
      "htmlq -t -i 'li[class~=\"featured\"]' -f /workspace/attrs.html | grep -v '^$'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "A,C",
        "A,C",
        "A",
        "",
      ].join("\n"),
    );
  });
});

test("html-to-markdown strips script and style tags while preserving semantic content", async () => {
  const html = [
    "<html>",
    "<head><style>body { color: red; }</style><script>window.pwn = 1;</script></head>",
    "<body><h2>Clean Heading</h2><p>Visible paragraph text.</p></body>",
    "</html>",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/page.html": html } }, async (h) => {
    const res = await h.exec("html-to-markdown /workspace/page.html");
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /## Clean Heading/);
    assert.match(res.stdout, /Visible paragraph text\./);
    assert.doesNotMatch(res.stdout, /window\.pwn/);
    assert.doesNotMatch(res.stdout, /color: red/);
  });
});

test("Maven pom.xml dependency version audit via xmllint --xpath and awk", async () => {
  const pomXml = [
    "<project>",
    "  <modelVersion>4.0.0</modelVersion>",
    "  <groupId>com.acme</groupId>",
    "  <artifactId>gateway</artifactId>",
    "  <version>1.2.0</version>",
    "  <dependencies>",
    "    <dependency><artifactId>netty</artifactId><version>4.1.100</version></dependency>",
    "    <dependency><artifactId>jackson</artifactId><version>2.17.0</version></dependency>",
    "  </dependencies>",
    "</project>",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/pom.xml": pomXml } }, async (h) => {
    const script = [
      "g=$(xmllint --xpath 'string(/project/groupId)' /workspace/pom.xml)",
      "a=$(xmllint --xpath 'string(/project/artifactId)' /workspace/pom.xml)",
      "v=$(xmllint --xpath 'string(/project/version)' /workspace/pom.xml)",
      "printf '%s:%s:%s\\n' \"$g\" \"$a\" \"$v\"",
      "xmllint --xpath 'count(/project/dependencies/dependency)' /workspace/pom.xml",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "com.acme:gateway:1.2.0",
        "2",
        "",
      ].join("\n"),
    );
  });
});

test("end-to-end documentation indexing pipeline: htmlq -> html-to-markdown -> sqlite3 FTS/table query", async () => {
  await withE2EHarness({ files: { "/workspace/portal.html": SAMPLE_PORTAL_HTML } }, async (h) => {
    const script = [
      "titles=$(htmlq -t -i 'article.card h2' -f /workspace/portal.html | grep -v '^$')",
      "prices=$(htmlq -t -i 'article.card .price' -f /workspace/portal.html | grep -v '^$' | tr -d '$')",
      "paste <(printf '%s\\n' \"$titles\") <(printf '%s\\n' \"$prices\") > /workspace/catalog.tsv",
      "awk -F'\\t' '$2 > 0 { print $1 \":$\" $2 }' /workspace/catalog.tsv",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "Zero-Dependency Rust Shell:$499",
        "Observability Pipeline:$99",
        "",
      ].join("\n"),
    );
  });
});
