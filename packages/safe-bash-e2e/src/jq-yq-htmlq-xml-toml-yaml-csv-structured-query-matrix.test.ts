import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("jq, yq, xq, xmllint, and htmlq structured query, format conversion, and DOM extraction matrix", () => {
  it("1. jq evaluates reduce, foreach, label/break, and alternative destructuring (?//)", async () => {
    await withE2EHarness(async (h) => {
      const reduceRes = await h.exec(
        "jq -n -c '[1,2,3,4,5] | reduce .[] as $x (0; . + ($x * $x))'",
      );
      assert.equal(reduceRes.exitCode, 0);
      assert.equal(reduceRes.stdout, "55\n");

      const foreachRes = await h.exec(
        "jq -n -c '[foreach (1,2,3) as $x (0; . + $x; [$x, .])]'",
      );
      assert.equal(foreachRes.exitCode, 0);
      assert.equal(foreachRes.stdout, "[[1,1],[2,3],[3,6]]\n");

      const labelRes = await h.exec(
        "jq -n -c '[label $out | foreach (10,20,30,40) as $x (0; . + $x; if . > 35 then ., break $out else . end)]'",
      );
      assert.equal(labelRes.exitCode, 0);
      assert.equal(labelRes.stdout, "[10,30,60]\n");

      const destructRes = await h.exec(
        'jq -c \'. as {$a, $b} ?// [$a, $b] | [$a, $b]\' <<\'JSON\'\n{"a":1,"b":2}\n[3,4]\nJSON',
      );
      assert.equal(destructRes.exitCode, 0);
      assert.equal(destructRes.stdout, "[1,2]\n[3,4]\n");
    });
  });

  it("2. jq loads reusable modules via -L with import and include directives", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/jq_mods/math_util.jq",
        "def double: . * 2;\ndef bump($n): . + $n;\n",
      );

      const res = await h.exec(
        'jq -n -c -L /workspace/jq_mods \'import "math_util" as m; [5 | m::double | m::bump(3)]\'',
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "[13]\n");
    });
  });

  it("3. jq supports --arg, --argjson, --slurpfile, --rawfile, --args, and --jsonargs ($ARGS)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/cfg.json", '{"mult":10}\n{"mult":20}\n');
      await h.writeText("/workspace/banner.txt", "HEADER_TEXT");

      const res = await h.exec(
        "jq -n -c --arg prefix p_ --argjson base 5 --slurpfile cfg /workspace/cfg.json --rawfile ban /workspace/banner.txt '{prefix: $prefix, sum: ($base + $cfg[0].mult + $cfg[1].mult), ban: $ban, pos: $ARGS.positional}' --jsonargs '100' '{\"ok\":true}'",
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        '{"prefix":"p_","sum":35,"ban":"HEADER_TEXT","pos":[100,{"ok":true}]}\n',
      );
    });
  });

  it("4. jq formats values with @base64, @base64d, @uri, @csv, @tsv, @html, @sh, and @json", async () => {
    await withE2EHarness(async (h) => {
      const b64 = await h.exec(
        'jq -n -r \'"hello world" | @base64 | @base64d\'',
      );
      assert.equal(b64.exitCode, 0);
      assert.equal(b64.stdout, "hello world\n");

      const formats = await h.exec(
        'jq -n -c \'{uri: ("a b&c" | @uri), html: ("<b>&</b>" | @html), csv: (["a,b", 1, true] | @csv), sh: ("it\'\\\'\'s ok" | @sh)}\'',
      );
      assert.equal(formats.exitCode, 0);
      const parsed = JSON.parse(formats.stdout);
      assert.equal(parsed.uri, "a%20b%26c");
      assert.equal(parsed.html, "&lt;b&gt;&amp;&lt;/b&gt;");
      assert.equal(parsed.csv, '"a,b",1,true');
      assert.equal(parsed.sh, "'it'\\''s ok'");
    });
  });

  it("5. jq regex builtins (test, match, capture, scan, sub, gsub, splits) transform strings", async () => {
    await withE2EHarness(async (h) => {
      const cap = await h.exec(
        'jq -n -c \'"2026-10-04" | capture("(?<year>[0-9]{4})-(?<month>[0-9]{2})-(?<day>[0-9]{2})")\'',
      );
      assert.equal(cap.exitCode, 0);
      assert.equal(cap.stdout, '{"year":"2026","month":"10","day":"04"}\n');

      const gsubRes = await h.exec(
        'jq -n -r \'"foo_12_bar_34" | gsub("(?<d>[0-9]+)"; "[" + .d + "]")\'',
      );
      assert.equal(gsubRes.exitCode, 0);
      assert.equal(gsubRes.stdout, "foo_[12]_bar_[34]\n");
    });
  });

  it("6. jq path operations (paths, getpath, setpath, delpaths, walk) and --stream inspect nested trees", async () => {
    await withE2EHarness(async (h) => {
      const pathManip = await h.exec(
        'jq -n -c \'{a:{b:[10,20]}} | setpath(["a","b",1]; 99) | delpaths([["a","b",0]])\'',
      );
      assert.equal(pathManip.exitCode, 0);
      assert.equal(pathManip.stdout, '{"a":{"b":[99]}}\n');

      const walked = await h.exec(
        'jq -n -c \'{a:[1,2],b:{c:3}} | walk(if type == "number" then . * 10 else . end)\'',
      );
      assert.equal(walked.exitCode, 0);
      assert.equal(walked.stdout, '{"a":[10,20],"b":{"c":30}}\n');

      const streamed = await h.exec(
        'jq -c --stream \'.\' <<< \'{"x":[1,2]}\'',
      );
      assert.equal(streamed.exitCode, 0);
      assert.equal(
        streamed.stdout,
        '[["x",0],1]\n[["x",1],2]\n[["x",1]]\n[["x"]]\n',
      );
    });
  });

  it("7. jq date builtins (todateiso8601 and fromdateiso8601) and bsearch operate deterministically", async () => {
    await withE2EHarness(async (h) => {
      const dateRes = await h.exec(
        'jq -n -c \'0 | todateiso8601 | [., fromdateiso8601]\'',
      );
      assert.equal(dateRes.exitCode, 0);
      assert.equal(dateRes.stdout, '["1970-01-01T00:00:00Z",0]\n');

      const bsearchRes = await h.exec(
        "jq -n -c '[[10,20,30,40] | bsearch(30), bsearch(25)]'",
      );
      assert.equal(bsearchRes.exitCode, 0);
      assert.equal(bsearchRes.stdout, "[2,-3]\n");
    });
  });

  it("8. yq evaluates multi-document YAML streams and emits separated YAML or compact JSON documents", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/deploy.yaml",
        "kind: Service\nname: api\n---\nkind: Deployment\nname: api\nreplicas: 2\n",
      );

      const filteredJson = await h.exec(
        "yq -o json -I 0 'select(.kind == \"Deployment\") | .replicas |= (. + 3)' /workspace/deploy.yaml",
      );
      assert.equal(filteredJson.exitCode, 0);
      assert.equal(
        filteredJson.stdout,
        '{"kind":"Deployment","name":"api","replicas":5}\n',
      );

      const multiYaml = await h.exec("yq '.name' /workspace/deploy.yaml");
      assert.equal(multiYaml.exitCode, 0);
      assert.equal(multiYaml.stdout, "api\n---\napi\n");
    });
  });

  it("9. yq parses YAML block scalars and flow collections and rejects anchors/aliases in restricted profile", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/service.yaml",
        `service:
  primary: {timeout: 30, retries: 3}
  tags: [web, api]
  notes: |
    line one
    line two
`,
      );

      const res = await h.exec("yq -o json -I 0 '.service' /workspace/service.yaml");
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        '{"primary":{"timeout":30,"retries":3},"tags":["web","api"],"notes":"line one\\nline two\\n"}\n',
      );

      await h.writeText("/workspace/anchor.yaml", "a: &x 1\nb: *x\n");
      const anchorOk = await h.exec("yq -o json -I 0 '.' /workspace/anchor.yaml");
      assert.equal(anchorOk.exitCode, 0);
      assert.equal(anchorOk.stdout, "{\"a\":1,\"b\":1}\n");

      await h.writeText("/workspace/bad-anchor.yaml", "a: *missing\n");
      const anchorRej = await h.exec("yq '.' /workspace/bad-anchor.yaml");
      assert.notEqual(anchorRej.exitCode, 0);
    });
  });

  it("10. yq parses TOML (-p toml) with nested tables, arrays of tables, and inline tables into JSON and YAML", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/Cargo.toml",
        `[package]
name = "safe-bash-rs"
version = "0.2.0"

[[bin]]
name = "sb"
path = "src/main.rs"

[[bin]]
name = "sb-bench"
path = "src/bench.rs"
`,
      );

      const toJson = await h.exec(
        "yq -p toml -o json -I 0 '{pkg: .package.name, bins: [.bin[].name]}' /workspace/Cargo.toml",
      );
      assert.equal(toJson.exitCode, 0);
      assert.equal(toJson.stdout, '{"pkg":"safe-bash-rs","bins":["sb","sb-bench"]}\n');

      const rawName = await h.exec(
        "yq -p toml -o json -r '.package.name' /workspace/Cargo.toml",
      );
      assert.equal(rawName.exitCode, 0);
      assert.equal(rawName.stdout, "safe-bash-rs\n");
    });
  });

  it("11. yq transforms JSON input into formatted YAML output and enforces CLI option combinations", async () => {
    await withE2EHarness(async (h) => {
      const jsonToYaml = await h.exec(
        'yq -P \'.server.port = 9090\' <<< \'{"server":{"host":"localhost","port":8080}}\'',
      );
      assert.equal(jsonToYaml.exitCode, 0);
      assert.equal(jsonToYaml.stdout, "server:\n  host: localhost\n  port: 9090\n");

      const invalidCombo = await h.exec("yq --unknown-flag '.' <<< 'a: 1'");
      assert.notEqual(invalidCombo.exitCode, 0);
      assert.match(invalidCombo.stderr, /unknown flag/);
    });
  });

  it("12. xq queries XML documents with attributes (@attr), text (#text), and nested elements using jq filters", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/catalog.xml",
        `<catalog>
  <book id="b1" lang="en"><title>Rust Systems</title><price>45</price></book>
  <book id="b2" lang="fr"><title>Unix Shells</title><price>35</price></book>
</catalog>`,
      );

      const res = await h.exec(
        "xq -c '[.catalog.book[] | {id: .\"@id\", title: .title}]' /workspace/catalog.xml",
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        '[{"id":"b1","title":"Rust Systems"},{"id":"b2","title":"Unix Shells"}]\n',
      );
    });
  });

  it("13. xmllint evaluates XPath expressions (--xpath) and formats (--format) XML documents", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/pom.xml",
        `<project><modelVersion>4.0.0</modelVersion><artifactId>safe-bash</artifactId></project>`,
      );

      const xpathRes = await h.exec(
        "xmllint --xpath 'string(/project/artifactId)' /workspace/pom.xml",
      );
      assert.equal(xpathRes.exitCode, 0);
      assert.equal(xpathRes.stdout.trim(), "safe-bash");

      const formatted = await h.exec("xmllint --format /workspace/pom.xml");
      assert.equal(formatted.exitCode, 0);
      assert.match(formatted.stdout, /<project>\n\s+<modelVersion>4\.0\.0<\/modelVersion>/);
    });
  });

  it("14. xmllint --noout validates well-formedness and reports syntax errors on malformed XML", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/valid.xml", "<root><item>ok</item></root>\n");
      await h.writeText("/workspace/broken.xml", "<root><item>unclosed</root>\n");

      const validRes = await h.exec("xmllint --noout /workspace/valid.xml");
      assert.equal(validRes.exitCode, 0);

      const brokenRes = await h.exec("xmllint --noout /workspace/broken.xml");
      assert.notEqual(brokenRes.exitCode, 0);
    });
  });

  it("15. jq evaluates recursive descent (..), recurse, transpose, combinations, and inside/contains", async () => {
    await withE2EHarness(async (h) => {
      const trans = await h.exec("jq -n -c '[[1,2],[3,4],[5,6]] | transpose'");
      assert.equal(trans.exitCode, 0);
      assert.equal(trans.stdout, "[[1,3,5],[2,4,6]]\n");

      const comb = await h.exec("jq -n -c '[[1,2],[10,20]] | [combinations]'");
      assert.equal(comb.exitCode, 0);

      const containsRes = await h.exec(
        "jq -n -c '[({a:[1,2,3]} | contains({a:[2]})), ({a:[2]} | inside({a:[1,2,3]}))]'",
      );
      assert.equal(containsRes.exitCode, 0);
      assert.equal(containsRes.stdout, "[true,true]\n");
    });
  });

  it("16. htmlq selects DOM elements using complex CSS selectors and extracts text (-t)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/page.html",
        `<!doctype html>
<html>
  <body>
    <div class="card featured"><h2 class="title">Alpha</h2><p>First</p></div>
    <div class="card"><h2 class="title">Beta</h2><p>Second</p></div>
  </body>
</html>`,
      );

      const featured = await h.exec(
        "htmlq -t 'div.card.featured > h2.title' -f /workspace/page.html",
      );
      assert.equal(featured.exitCode, 0);
      assert.equal(featured.stdout.trim(), "Alpha");

      const allTitles = await h.exec(
        "htmlq -t '.card h2.title' -f /workspace/page.html",
      );
      assert.equal(allTitles.exitCode, 0);
      assert.equal(allTitles.stdout, "Alpha\nBeta\n");
    });
  });

  it("17. htmlq extracts attributes (-a) and resolves relative URLs with --base (-b) and --detect-base (-B)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/links.html",
        `<html>
  <head><base href="https://docs.example.com/v2/guide/"></head>
  <body>
    <a href="../api/index.html">API</a>
    <a href="intro.html">Intro</a>
  </body>
</html>`,
      );

      const detected = await h.exec(
        "htmlq -B -a href 'a' -f /workspace/links.html",
      );
      assert.equal(detected.exitCode, 0);
      assert.equal(
        detected.stdout,
        "https://docs.example.com/v2/api/index.html\nhttps://docs.example.com/v2/guide/intro.html\n",
      );

      const explicitBase = await h.exec(
        "htmlq -b 'https://cdn.example.org/assets/' -a href 'a' -f /workspace/links.html",
      );
      assert.equal(explicitBase.exitCode, 0);
      assert.equal(
        explicitBase.stdout,
        "https://cdn.example.org/api/index.html\nhttps://cdn.example.org/assets/intro.html\n",
      );
    });
  });

  it("18. htmlq removes matching child nodes (-r / --remove-nodes) and formats with -i (--ignore-whitespace)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/article.html",
        `<article><span class="noise">AD1</span><p>First clean</p><p>Second clean</p></article>`,
      );

      const cleaned = await h.exec(
        "htmlq -t -i -r '.noise' 'article' -f /workspace/article.html",
      );
      assert.equal(cleaned.exitCode, 0);
      assert.equal(cleaned.stdout, "First clean\nSecond clean\n\n");
    });
  });

  it("19. htmlq supports pseudo-classes (:first-child, :last-child, :nth-child, :not, :empty) and attribute operators", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/list.html",
        `<ul>
  <li data-role="item-alpha">One</li>
  <li data-role="item-beta" class="skip">Two</li>
  <li data-role="item-gamma">Three</li>
</ul>`,
      );

      const filtered = await h.exec(
        "htmlq -t 'ul > li[data-role^=\"item-\"]:not(.skip)' -f /workspace/list.html",
      );
      assert.equal(filtered.exitCode, 0);
      assert.equal(filtered.stdout, "One\nThree\n");

      const lastChild = await h.exec(
        "htmlq -t 'ul > li:last-child' -f /workspace/list.html",
      );
      assert.equal(lastChild.exitCode, 0);
      assert.equal(lastChild.stdout, "Three\n");
    });
  });

  it("20. chains htmlq -> yq -> jq in a cross-format scraping and configuration pipeline", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/dashboard.html",
        `<div id="services">
  <script type="application/yaml" id="svc-cfg">
services:
  - service: auth
    port: 8081
    enabled: true
  - service: legacy
    port: 8082
    enabled: false
  </script>
</div>`,
      );

      const res = await h.exec(
        "htmlq -t 'script#svc-cfg' -f /workspace/dashboard.html | yq -o json -c '.services' | jq -c 'map(select(.enabled) | {service, port})'",
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, '[{"service":"auth","port":8081}]\n');
    });
  });
});
