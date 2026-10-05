import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("safe-bash e2e: XML, HTML, Markdown, XPath & document transform pipeline matrix", () => {
  it("1. xmllint --format and --noout well-formedness validation and pretty-printing", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/work/compact.xml", `<catalog><book id="b1"><title>Rust</title><price>42</price></book></catalog>`);
      const valid = await h.exec(`xmllint --noout /work/compact.xml`);
      assert.equal(valid.exitCode, 0);

      const formatted = await h.exec(`xmllint --format /work/compact.xml`);
      assert.equal(formatted.exitCode, 0);
      assert.match(formatted.stdout, /<catalog>\n\s+<book id="b1">/);

      await h.writeText("/work/broken.xml", `<catalog><book></catalog>`);
      const invalid = await h.exec(`xmllint --noout /work/broken.xml`);
      assert.notEqual(invalid.exitCode, 0);
    });
  });

  it("2. xmllint --c14n canonical XML normalization (attribute ordering and empty elements)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/work/raw.xml", `<root z="9" a="1"><empty/></root>`);
      const res = await h.exec(`xmllint --c14n /work/raw.xml`);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), `<root a="1" z="9"><empty></empty></root>`);
    });
  });

  it("3. xmllint --xpath element, attribute, predicate, and XPath function queries", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/work/items.xml",
        `<store><item id="1" cat="tools"><name>Hammer</name><qty>4</qty></item><item id="2" cat="books"><name>Guide</name><qty>10</qty></item><item id="3" cat="tools"><name>Wrench</name><qty>6</qty></item></store>`,
      );
      const countRes = await h.exec(`xmllint --xpath 'count(//item[@cat="tools"])' /work/items.xml`);
      assert.equal(countRes.exitCode, 0);
      assert.equal(countRes.stdout.trim(), "2");

      const strRes = await h.exec(`xmllint --xpath 'string(//item[@id="2"]/name)' /work/items.xml`);
      assert.equal(strRes.exitCode, 0);
      assert.equal(strRes.stdout.trim(), "Guide");

      const lastRes = await h.exec(`xmllint --xpath 'string(//item[last()]/name)' /work/items.xml`);
      assert.equal(lastRes.exitCode, 0);
      assert.equal(lastRes.stdout.trim(), "Wrench");
    });
  });

  it("4. xq XML-to-JSON querying with attributes (@attr) and text (#text)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/work/servers.xml",
        `<cluster region="us-east"><node id="n1" role="leader">10.0.0.1</node><node id="n2" role="follower">10.0.0.2</node></cluster>`,
      );
      const res = await h.exec(
        `xq -c '{ region: .cluster["@region"], nodes: [.cluster.node[] | { id: .["@id"], role: .["@role"], ip: .["#text"] }] }' /work/servers.xml`,
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        `{"region":"us-east","nodes":[{"id":"n1","role":"leader","ip":"10.0.0.1"},{"id":"n2","role":"follower","ip":"10.0.0.2"}]}`,
      );
    });
  });

  it("5. xq Maven POM dependency extraction and version filtering", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/work/pom.xml",
        `<project><modelVersion>4.0.0</modelVersion><groupId>com.example</groupId><artifactId>demo</artifactId><dependencies><dependency><groupId>org.slf4j</groupId><artifactId>slf4j-api</artifactId><version>2.0.9</version></dependency><dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4.13.2</version><scope>test</scope></dependency></dependencies></project>`,
      );
      const res = await h.exec(
        `xq -r '.project.dependencies.dependency[] | "\\(.groupId):\\(.artifactId):\\(.version)"' /work/pom.xml`,
      );
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "org.slf4j:slf4j-api:2.0.9",
        "junit:junit:4.13.2",
      ]);
    });
  });

  it("6. htmlq CSS selector extraction by class, id, descendant, and child combinators", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/work/page.html",
        `<!DOCTYPE html><html><body><header id="top"><h1>Portal</h1></header><main><ul class="nav"><li class="active"><a href="/home">Home</a></li><li><a href="/docs">Docs</a></li></ul></main></body></html>`,
      );
      const title = await h.exec(`htmlq -t '#top > h1' -f /work/page.html`);
      assert.equal(title.exitCode, 0);
      assert.equal(title.stdout.trim(), "Portal");

      const active = await h.exec(`htmlq -t 'ul.nav > li.active a' -f /work/page.html`);
      assert.equal(active.exitCode, 0);
      assert.equal(active.stdout.trim(), "Home");
    });
  });

  it("7. htmlq attribute extraction (-a) and relative link resolution (--base / -b and -B)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/work/links.html",
        `<html><head><base href="https://docs.example.com/v2/"></head><body><a href="guide.html">Guide</a><a href="/root.html">Root</a></body></html>`,
      );
      const detected = await h.exec(`htmlq -B -a href 'a' -f /work/links.html`);
      assert.equal(detected.exitCode, 0);
      assert.deepEqual(detected.stdout.trim().split("\n"), [
        "https://docs.example.com/v2/guide.html",
        "https://docs.example.com/root.html",
      ]);

      const explicit = await h.exec(`htmlq -b https://custom.org/dir/ -a href 'a' -f /work/links.html`);
      assert.equal(explicit.exitCode, 0);
      assert.deepEqual(explicit.stdout.trim().split("\n"), [
        "https://custom.org/dir/guide.html",
        "https://custom.org/root.html",
      ]);
    });
  });

  it("8. htmlq node removal (-r / --remove-nodes) before extracting text (-t -i)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/work/article.html",
        `<article><h2>Headline</h2><div class="ad">BUY NOW</div><p>Main story content.</p><aside class="promo">PROMO</aside></article>`,
      );
      const res = await h.exec(`htmlq -r '.ad' -t -i 'article' -f /work/article.html`);
      assert.equal(res.exitCode, 0);
      assert.match(res.stdout, /Headline/);
      assert.match(res.stdout, /Main story content\./);
      assert.doesNotMatch(res.stdout, /BUY NOW/);
    });
  });

  it("9. htmlq attribute selectors ([attr], [attr=val], [attr^=pre], [attr$=suf], [attr*=sub])", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/work/cards.html",
        `<div><span data-kind="metric-cpu" data-env="prod">CPU</span><span data-kind="metric-mem" data-env="stage">MEM</span><span data-kind="log-disk" data-env="prod">DISK</span></div>`,
      );
      const starts = await h.exec(`htmlq -t 'span[data-kind^="metric-"][data-env="prod"]' -f /work/cards.html`);
      assert.equal(starts.exitCode, 0);
      assert.equal(starts.stdout.trim(), "CPU");

      const ends = await h.exec(`htmlq -t 'span[data-kind$="-disk"]' -f /work/cards.html`);
      assert.equal(ends.exitCode, 0);
      assert.equal(ends.stdout.trim(), "DISK");
    });
  });

  it("10. htmlq pseudo-classes (:first-child, :last-child, :nth-child, :not)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/work/list.html",
        `<ul><li class="skip">one</li><li>two</li><li>three</li><li>four</li></ul>`,
      );
      const first = await h.exec(`htmlq -t 'li:first-child' -f /work/list.html`);
      const last = await h.exec(`htmlq -t 'li:last-child' -f /work/list.html`);
      const notSkip = await h.exec(`htmlq -t 'li:not(.skip)' -f /work/list.html`);
      assert.equal(first.stdout.trim(), "one");
      assert.equal(last.stdout.trim(), "four");
      assert.deepEqual(notSkip.stdout.trim().split("\n"), ["two", "three", "four"]);
    });
  });

  it("11. html-to-markdown conversion of headings, emphasis, links, lists, and blockquotes", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/work/doc.html",
        `<h1>Release Notes</h1><p>Welcome to <strong>v2.0</strong> with <em>zero</em> deps. See <a href="https://example.com/docs">Docs</a>.</p><ul><li>Fast startup</li><li>Pure Rust target</li></ul><blockquote><p>Ship with confidence.</p></blockquote>`,
      );
      const res = await h.exec(`html-to-markdown /work/doc.html`);
      assert.equal(res.exitCode, 0);
      assert.match(res.stdout, /# Release Notes/);
      assert.match(res.stdout, /\*\*v2\\?\.0\*\*/);
      assert.match(res.stdout, /\*zero\*/);
      assert.match(res.stdout, /\[Docs\]\(<https:\/\/example\.com\/docs>\)/);
      assert.match(res.stdout, /- Fast startup/);
      assert.match(res.stdout, /> Ship with confidence\./);
    });
  });

  it("12. html-to-markdown table and fenced code block conversion while stripping script/style", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/work/table.html",
        `<style>body { color: red; }</style><script>alert(1);</script><h2>Benchmarks</h2><table><thead><tr><th>Suite</th><th>Status</th></tr></thead><tbody><tr><td>Core</td><td>PASS</td></tr><tr><td>E2E</td><td>PASS</td></tr></tbody></table><pre><code class="language-sh">npm test</code></pre>`,
      );
      const res = await h.exec(`html-to-markdown /work/table.html`);
      assert.equal(res.exitCode, 0);
      assert.doesNotMatch(res.stdout, /alert\(1\)|color: red/);
      assert.match(res.stdout, /\| Suite \| Status \|/);
      assert.match(res.stdout, /\| Core \| PASS \|/);
      assert.match(res.stdout, /npm test/);
    });
  });

  it("13. htmlq -> html-to-markdown pipeline extracting main content section and rendering Markdown", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/work/fullpage.html",
        `<html><body><nav><a href="/">Nav</a></nav><main id="content"><h1>Guide</h1><p>Step <code>1</code>: install.</p></main><footer>Footer</footer></body></html>`,
      );
      const res = await h.exec(`htmlq '#content' -f /work/fullpage.html | html-to-markdown`);
      assert.equal(res.exitCode, 0);
      assert.doesNotMatch(res.stdout, /Nav|Footer/);
      assert.match(res.stdout, /# Guide/);
      assert.match(res.stdout, /Step `1`: install\./);
    });
  });

  it("14. xq -> yq XML-to-YAML configuration migration pipeline", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/work/service.xml",
        `<service><name>auth-api</name><port>8443</port><tls>true</tls></service>`,
      );
      const res = await h.exec(
        `xq '{ service: { name: .service.name, port: (.service.port | tonumber), tls: (.service.tls == "true") } }' /work/service.xml | yq '.'`,
      );
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        `"service":`,
        `  "name": "auth-api"`,
        `  "port": 8443`,
        `  "tls": true`,
      ]);
    });
  });

  it("15. xmllint --xpath + htmlq + jq RSS/Atom feed aggregation pipeline", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/work/feed.xml",
        `<rss><channel><title>Tech Feed</title><item><title>Post 1</title><link>https://blog.example.com/1</link></item><item><title>Post 2</title><link>https://blog.example.com/2</link></item></channel></rss>`,
      );
      const res = await h.exec(
        `xq -c '{ feed: .rss.channel.title, urls: [.rss.channel.item[] | .link] }' /work/feed.xml`,
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        `{"feed":"Tech Feed","urls":["https://blog.example.com/1","https://blog.example.com/2"]}`,
      );
    });
  });

  it("16. xmllint XPath boolean(), count(), string(), union paths (|), and parent (..) axes", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/work/funcs.xml",
        `<root><pkg name="safe-bash-core" ver="1.2.3"><status>active</status></pkg></root>`,
      );
      const r1 = await h.exec(`xmllint --xpath 'string(//status/../@name)' /work/funcs.xml`);
      const r2 = await h.exec(`xmllint --xpath 'boolean(//pkg[@ver="1.2.3"])' /work/funcs.xml`);
      const r3 = await h.exec(`xmllint --xpath 'count(//pkg | //status)' /work/funcs.xml`);
      assert.equal(r1.stdout.trim(), "safe-bash-core");
      assert.equal(r2.stdout.trim(), "true");
      assert.equal(r3.stdout.trim(), "2");
    });
  });

  it("17. htmlq output to file (-o / --output) and pretty printing (-p / --pretty)", async () => {
    await withE2EHarness(async (h) => {
      await h.exec(`mkdir -p /work`);
      await h.writeText("/work/snippet.html", `<div class="box"><p>Hello</p></div>`);
      const res = await h.exec(`htmlq -p '.box' -f /work/snippet.html -o /work/out.html && cat /work/out.html`);
      assert.equal(res.exitCode, 0);
      assert.match(res.stdout, /<div class="box">/);
      assert.match(res.stdout, /<p>\s*Hello\s*<\/p>/);
    });
  });

  it("18. html-to-markdown HTML entity decoding (named, decimal, and hexadecimal entities)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/work/entities.html",
        `<p>AT&amp;T &mdash; &#65;&#66;&#67; &#x3bb; &copy; 2026</p>`,
      );
      const res = await h.exec(`html-to-markdown /work/entities.html`);
      assert.equal(res.exitCode, 0);
      assert.match(res.stdout, /AT\\?&T/);
      assert.match(res.stdout, /ABC/);
      assert.match(res.stdout, /λ/);
      assert.match(res.stdout, /© 2026/);
    });
  });

  it("19. xq handling of XML namespaces, CDATA sections, and mixed attributes", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/work/cdata.xml",
        `<envelope xmlns:ns="urn:test"><ns:payload encoding="raw"><![CDATA[<tag>&literal</tag>]]></ns:payload></envelope>`,
      );
      const res = await h.exec(`xq -r '.envelope["ns:payload"]["#text"]' /work/cdata.xml`);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "<tag>&literal</tag>");
    });
  });

  it("20. end-to-end HTML table scraping -> Markdown -> awk/jq JSON report pipeline", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/work/report.html",
        `<html><body><table id="metrics"><tr><td class="svc">api</td><td class="lat">14</td></tr><tr><td class="svc">db</td><td class="lat">6</td></tr><tr><td class="svc">cache</td><td class="lat">2</td></tr></table></body></html>`,
      );
      const res = await h.exec(`
        svcs="$(htmlq -t '#metrics td.svc' -f /work/report.html)"
        lats="$(htmlq -t '#metrics td.lat' -f /work/report.html)"
        paste <(printf '%s\\n' "$svcs") <(printf '%s\\n' "$lats") | awk '{ printf "{\\"service\\":\\"%s\\",\\"latency_ms\\":%d}\\n", $1, $2 }' | jq -s -c '{ count: length, total_latency_ms: (map(.latency_ms) | add), services: map(.service) }'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        `{"count":3,"total_latency_ms":22,"services":["api","db","cache"]}`,
      );
    });
  });
});
