import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withE2EHarness } from "./harness.js";

describe("htmlq, html-to-markdown, xmllint, and xq/yq web & XML document matrix", () => {
  it("1. htmlq selects nested elements with CSS combinators (>, +, ~), classes, IDs, and --text", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/web/page.html",
        [
          "<!doctype html>",
          "<html><body>",
          "  <main id=\"content\">",
          "    <article class=\"post featured\"><h2>First Post</h2><p>Intro A</p><p>Body A</p></article>",
          "    <article class=\"post\"><h2>Second Post</h2><p>Intro B</p></article>",
          "  </main>",
          "</body></html>",
        ].join("\n")
      );

      const titles = await h.exec("htmlq --text '#content > article.post > h2' -f /web/page.html");
      assert.equal(titles.exitCode, 0, titles.stderr);
      assert.deepEqual(titles.stdout.trim().split("\n"), ["First Post", "Second Post"]);

      const adj = await h.exec("htmlq --text 'article.featured h2 + p' -f /web/page.html");
      assert.equal(adj.exitCode, 0, adj.stderr);
      assert.equal(adj.stdout.trim(), "Intro A");
    });
  });

  it("2. htmlq extracts attributes (-a) and resolves relative links with --base and --detect-base", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/web/links.html",
        [
          "<html>",
          "<head><base href=\"https://docs.example.com/v2/\"></head>",
          "<body>",
          "  <a href=\"guide/start.html\">Start</a>",
          "  <a href=\"/api/ref.html\">API</a>",
          "  <a href=\"https://external.example.org/x\">External</a>",
          "</body></html>",
        ].join("\n")
      );

      const detected = await h.exec("htmlq -B -a href 'a' -f /web/links.html");
      assert.equal(detected.exitCode, 0, detected.stderr);
      assert.deepEqual(detected.stdout.trim().split("\n"), [
        "https://docs.example.com/v2/guide/start.html",
        "https://docs.example.com/api/ref.html",
        "https://external.example.org/x",
      ]);

      const overridden = await h.exec("htmlq -b https://mirror.example.net/root/ -a href 'a' -f /web/links.html");
      assert.equal(overridden.exitCode, 0, overridden.stderr);
      assert.deepEqual(overridden.stdout.trim().split("\n"), [
        "https://mirror.example.net/root/guide/start.html",
        "https://mirror.example.net/api/ref.html",
        "https://external.example.org/x",
      ]);
    });
  });

  it("3. htmlq strips unwanted child node with -r (--remove-nodes) and pretty-prints (-p) cleaned HTML", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/web/dirty.html",
        [
          "<div class=\"card\">",
          "  <span class=\"ad\">Sponsored</span>",
          "  <h3>Clean Title</h3>",
          "  <p>Clean summary.</p>",
          "</div>",
        ].join("\n")
      );

      const cleaned = await h.exec("htmlq -r '.ad' -t '.card' -f /web/dirty.html");
      assert.equal(cleaned.exitCode, 0, cleaned.stderr);
      assert.ok(cleaned.stdout.includes("Clean Title"));
      assert.ok(cleaned.stdout.includes("Clean summary."));
      assert.ok(!cleaned.stdout.includes("Sponsored"));
    });
  });

  it("4. htmlq attribute selectors ([attr], [attr=val], [attr^=prefix], [attr*=sub], [attr$=suffix])", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/web/catalog.html",
        [
          "<ul>",
          "  <li data-sku=\"PRO-100\" data-tier=\"gold\">Alpha</li>",
          "  <li data-sku=\"PRO-200\" data-tier=\"silver\">Beta</li>",
          "  <li data-sku=\"STD-300\" data-tier=\"gold\">Gamma</li>",
          "</ul>",
        ].join("\n")
      );

      const proGold = await h.exec(
        "htmlq -t 'li[data-sku^=\"PRO-\"][data-tier=\"gold\"]' -f /web/catalog.html"
      );
      assert.equal(proGold.exitCode, 0, proGold.stderr);
      assert.equal(proGold.stdout.trim(), "Alpha");

      const ends200 = await h.exec("htmlq -t 'li[data-sku$=\"200\"]' -f /web/catalog.html");
      assert.equal(ends200.exitCode, 0, ends200.stderr);
      assert.equal(ends200.stdout.trim(), "Beta");
    });
  });

  it("5. htmlq structural pseudo-classes (:first-child, :last-child, :nth-child, :not)", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/web/list.html",
        [
          "<ol>",
          "  <li class=\"skip\">Zero</li>",
          "  <li>One</li>",
          "  <li>Two</li>",
          "  <li>Three</li>",
          "</ol>",
        ].join("\n")
      );

      const first = await h.exec("htmlq -t 'ol > li:first-child' -f /web/list.html");
      assert.equal(first.exitCode, 0, first.stderr);
      assert.equal(first.stdout.trim(), "Zero");

      const last = await h.exec("htmlq -t 'ol > li:last-child' -f /web/list.html");
      assert.equal(last.exitCode, 0, last.stderr);
      assert.equal(last.stdout.trim(), "Three");

      const notSkip = await h.exec("htmlq -t 'ol > li:not(.skip)' -f /web/list.html");
      assert.equal(notSkip.exitCode, 0, notSkip.stderr);
      assert.deepEqual(notSkip.stdout.trim().split("\n"), ["One", "Two", "Three"]);
    });
  });

  it("6. html-to-markdown converts headings, inline formatting (em, strong, del, code), links, and images", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/md/article.html",
        [
          "<h1>Release Notes</h1>",
          "<p>Welcome to <strong>NextGen</strong> with <em>faster</em> <code>safe-bash</code> and <del>legacy</del> support.</p>",
          "<p>Read the <a href=\"https://example.com/docs\">Documentation</a> or view <img src=\"https://example.com/logo.png\" alt=\"Logo\">.</p>",
        ].join("\n")
      );

      const res = await h.exec("html-to-markdown /md/article.html");
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /^# Release Notes/m);
      assert.match(res.stdout, /\*\*NextGen\*\*/);
      assert.match(res.stdout, /\*faster\*/);
      assert.match(res.stdout, /`safe-bash`/);
      assert.match(res.stdout, /~~legacy~~/);
      assert.match(res.stdout, /\[Documentation\]\(<https:\/\/example\.com\/docs>\)/);
      assert.match(res.stdout, /!\[Logo\]\(<https:\/\/example\.com\/logo\.png>\)/);
    });
  });

  it("7. html-to-markdown converts nested ordered/unordered lists, blockquotes, and fenced code blocks with language", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/md/complex.html",
        [
          "<blockquote><p>Quote line 1</p><p>Quote line 2</p></blockquote>",
          "<ul>",
          "  <li>Item A<ol><li>Sub 1</li><li>Sub 2</li></ol></li>",
          "  <li>Item B</li>",
          "</ul>",
          "<pre><code class=\"language-rust\">fn main() {\n    println!(\"hi\");\n}</code></pre>",
        ].join("\n")
      );

      const res = await h.exec("html-to-markdown /md/complex.html");
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /> Quote line 1/);
      assert.match(res.stdout, /- Item A/);
      assert.match(res.stdout, /1\. Sub 1/);
      assert.match(res.stdout, /```rust\nfn main\(\)/);
    });
  });

  it("8. html-to-markdown renders HTML tables into GFM pipe tables and escapes embedded pipes", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/md/table.html",
        [
          "<table>",
          "  <thead><tr><th>Command</th><th>Syntax</th></tr></thead>",
          "  <tbody>",
          "    <tr><td>grep</td><td>a | b</td></tr>",
          "    <tr><td>awk</td><td>{ print $1 }</td></tr>",
          "  </tbody>",
          "</table>",
        ].join("\n")
      );

      const res = await h.exec("html-to-markdown /md/table.html");
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /\| Command \| Syntax \|/);
      assert.match(res.stdout, /\| --- \| --- \|/);
      assert.match(res.stdout, /\| grep \| a \\\| b \|/);
    });
  });

  it("9. htmlq + html-to-markdown pipeline extracts main article body, strips sidebar, and generates clean Markdown", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/md/site.html",
        [
          "<html><body>",
          "  <nav><a href=\"/home\">Home</a></nav>",
          "  <main class=\"doc\">",
          "    <div class=\"sidebar\">Sidebar TOC</div>",
          "    <h2>Architecture Overview</h2>",
          "    <p>Sandboxed execution in memory.</p>",
          "  </main>",
          "  <footer>Copyright 2026</footer>",
          "</body></html>",
        ].join("\n")
      );

      const res = await h.exec(
        "htmlq -r '.sidebar' 'main.doc' -f /md/site.html | html-to-markdown"
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.ok(res.stdout.includes("## Architecture Overview"));
      assert.ok(res.stdout.includes("Sandboxed execution in memory."));
      assert.ok(!res.stdout.includes("Sidebar TOC"));
      assert.ok(!res.stdout.includes("Copyright"));
    });
  });

  it("10. xmllint --noout validates well-formed XML and rejects malformed XML with non-zero exit code", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/xml/good.xml", "<?xml version=\"1.0\"?><root><item id=\"1\">ok</item></root>\n");
      await h.writeText("/xml/bad.xml", "<root><item>unclosed</root>\n");

      const okRes = await h.exec("xmllint --noout /xml/good.xml");
      assert.equal(okRes.exitCode, 0, okRes.stderr);

      const badRes = await h.exec("xmllint --noout /xml/bad.xml");
      assert.notEqual(badRes.exitCode, 0);
    });
  });

  it("11. xmllint --xpath evaluates element, attribute, position/last predicates, union (|), string(), count(), and boolean()", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/xml/books.xml",
        [
          "<library>",
          "  <book id=\"b1\" lang=\"en\"><title>Systems Programming</title><price>45</price></book>",
          "  <book id=\"b2\" lang=\"fr\"><title>Compilers</title><price>60</price></book>",
          "  <book id=\"b3\" lang=\"en\"><title>Operating Systems</title><price>55</price></book>",
          "</library>",
        ].join("\n")
      );

      const countEn = await h.exec("xmllint --xpath 'count(//book[@lang=\"en\"])' /xml/books.xml");
      assert.equal(countEn.exitCode, 0, countEn.stderr);
      assert.equal(countEn.stdout.trim(), "2");

      const titleB3 = await h.exec("xmllint --xpath 'string(//book[@id=\"b3\"]/title)' /xml/books.xml");
      assert.equal(titleB3.exitCode, 0, titleB3.stderr);
      assert.equal(titleB3.stdout.trim(), "Operating Systems");

      const lastTitle = await h.exec("xmllint --xpath 'string(/library/book[last()]/title)' /xml/books.xml");
      assert.equal(lastTitle.exitCode, 0, lastTitle.stderr);
      assert.equal(lastTitle.stdout.trim(), "Operating Systems");

      const hasFr = await h.exec("xmllint --xpath 'boolean(//book[@lang=\"fr\"])' /xml/books.xml");
      assert.equal(hasFr.exitCode, 0, hasFr.stderr);
      assert.equal(hasFr.stdout.trim(), "true");
    });
  });

  it("12. xmllint --format pretty-prints compact XML", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/xml/compact.xml", "<config><server><host>localhost</host><port>8080</port></server></config>");

      const formatted = await h.exec("xmllint --format /xml/compact.xml");
      assert.equal(formatted.exitCode, 0, formatted.stderr);
      assert.ok(formatted.stdout.split("\n").length >= 5);
      assert.match(formatted.stdout, /<host>localhost<\/host>/);
    });
  });

  it("13. xmllint --c14n canonicalizes XML attributes and empty elements deterministically", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/xml/attr.xml",
        "<root z=\"last\" a=\"first\"><empty/></root>\n"
      );

      const c14n = await h.exec("xmllint --c14n /xml/attr.xml");
      assert.equal(c14n.exitCode, 0, c14n.stderr);
      assert.match(c14n.stdout, /<root a="first" z="last"><empty><\/empty><\/root>/);
    });
  });

  it("14. xq queries XML documents as JSON and extracts nested fields and attributes", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/xml/pom.xml",
        [
          "<project>",
          "  <groupId>com.example</groupId>",
          "  <artifactId>demo</artifactId>",
          "  <version>1.0.0</version>",
          "</project>",
        ].join("\n")
      );

      const ver = await h.exec("xq -r '.project.version' /xml/pom.xml");
      assert.equal(ver.exitCode, 0, ver.stderr);
      assert.equal(ver.stdout.trim(), "1.0.0");

      const coord = await h.exec("xq -r '.project | \"\\(.groupId):\\(.artifactId):\\(.version)\"' /xml/pom.xml");
      assert.equal(coord.exitCode, 0, coord.stderr);
      assert.equal(coord.stdout.trim(), "com.example:demo:1.0.0");
    });
  });

  it("15. xq converts XML elements with attributes and CDATA/text into structured JSON for yq YAML export", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/xml/cluster.xml",
        "<cluster><service name=\"auth\"><port>9000</port></service></cluster>\n"
      );

      const res = await h.exec("xq '.' /xml/cluster.xml | yq -o yaml '.'");
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /"cluster":/);
      assert.match(res.stdout, /"@name": "auth"/);
      assert.match(res.stdout, /"port": "9000"/);
    });
  });

  it("16. HTML table scraping pipeline: htmlq extracts rows -> xq converts to JSON -> in2csv -> csvsort", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/web/metrics.html",
        [
          "<html><body>",
          "  <table id=\"perf\">",
          "    <tr><td class=\"svc\">api</td><td class=\"lat\">20</td></tr>",
          "    <tr><td class=\"svc\">db</td><td class=\"lat\">45</td></tr>",
          "    <tr><td class=\"svc\">cache</td><td class=\"lat\">5</td></tr>",
          "  </table>",
          "</body></html>",
        ].join("\n")
      );

      const res = await h.exec(
        [
          "htmlq '#perf' -f /web/metrics.html \\",
          "  | xq -c '.table.tbody.tr[] | {service: .td[0].\"#text\", latency: (.td[1].\"#text\" | tonumber)}' \\",
          "  | in2csv -f ndjson \\",
          "  | csvsort -c latency -r",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "service,latency",
        "db,45",
        "api,20",
        "cache,5",
      ]);
    });
  });

  it("17. RSS/Atom XML feed ingestion with xmllint + xq + html-to-markdown produces Markdown digest", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/xml/feed.xml",
        [
          "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
          "<rss version=\"2.0\"><channel>",
          "  <title>Engineering Blog</title>",
          "  <item><title>Post One</title><link>https://blog.example.com/1</link></item>",
          "  <item><title>Post Two</title><link>https://blog.example.com/2</link></item>",
          "</channel></rss>",
        ].join("\n")
      );

      const res = await h.exec(
        [
          "xmllint --noout /xml/feed.xml",
          "xq -r '\"<h1>\" + .rss.channel.title + \"</h1><ul>\" + ([.rss.channel.item[] | \"<li><a href=\\\"\" + .link + \"\\\">\" + .title + \"</a></li>\"] | join(\"\")) + \"</ul>\"' /xml/feed.xml \\",
          "  | html-to-markdown",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /^# Engineering Blog/m);
      assert.match(res.stdout, /- \[Post One\]\(<https:\/\/blog\.example\.com\/1>\)/);
      assert.match(res.stdout, /- \[Post Two\]\(<https:\/\/blog\.example\.com\/2>\)/);
    });
  });

  it("18. htmlq handles HTML character entities (named, decimal, hexadecimal) accurately", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/web/entities.html",
        "<p class=\"msg\">5 &lt; 10 &amp; 10 &gt; 5 &#8212; &#x2713;</p>\n"
      );

      const res = await h.exec("htmlq -t '.msg' -f /web/entities.html");
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "5 < 10 & 10 > 5 — ✓");
    });
  });

  it("19. html-to-markdown escapes Markdown control characters in plain text to prevent injection", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/md/escape.html",
        "<p># Not a heading and *not italic* and [not a link](url)</p>\n"
      );

      const res = await h.exec("html-to-markdown /md/escape.html");
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /\\# Not a heading/);
      assert.match(res.stdout, /\\\*not italic\\\*/);
    });
  });

  it("20. JUnit XML test report aggregation using xmllint XPath and xq summary metrics", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/xml/junit.xml",
        [
          "<testsuites>",
          "  <testsuite name=\"auth\" tests=\"3\" failures=\"1\">",
          "    <testcase classname=\"auth\" name=\"login_ok\" time=\"0.12\"/>",
          "    <testcase classname=\"auth\" name=\"token_refresh\" time=\"0.08\"/>",
          "    <testcase classname=\"auth\" name=\"expired_token\" time=\"0.25\">",
          "      <failure message=\"Expected 401\">failed</failure>",
          "    </testcase>",
          "  </testsuite>",
          "</testsuites>",
        ].join("\n")
      );

      const failedName = await h.exec(
        "xmllint --xpath 'string(//testcase[failure=\"failed\"]/@name)' /xml/junit.xml"
      );
      assert.equal(failedName.exitCode, 0, failedName.stderr);
      assert.equal(failedName.stdout.trim(), "expired_token");

      const totalTime = await h.exec(
        "xq -r '[.testsuites.testsuite.testcase[].\"@time\" | tonumber] | add' /xml/junit.xml"
      );
      assert.equal(totalTime.exitCode, 0, totalTime.stderr);
      assert.equal(Number(totalTime.stdout.trim()).toFixed(2), "0.45");
    });
  });
});
