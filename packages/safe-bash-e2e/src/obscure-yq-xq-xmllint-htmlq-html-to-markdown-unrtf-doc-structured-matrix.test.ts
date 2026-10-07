import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure yq, xq, xmllint, htmlq, html-to-markdown, unrtf, jq & sqlite3 structured markup matrix", () => {
  it("01: expands YAML anchors (&base) and merge keys (<<: *base) with overrides via yq explode(.)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'YAML' | yq -o=json 'explode(.) | .prod' | jq -c .
defaults: &base
  timeout: 30
  retries: 3
prod:
  <<: *base
  retries: 5
  region: us-east
YAML
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), '{"timeout":30,"retries":5,"region":"us-east"}');
    });
  });

  it("02: converts multi-document YAML streams into JSON objects and filters enabled services with jq -sc", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'YAML' | yq -o=json '.' | jq -sc 'map(select(.enabled == true) | .name)'
name: svc-a
enabled: true
---
name: svc-b
enabled: false
---
name: svc-c
enabled: true
YAML
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), '["svc-a","svc-c"]');
    });
  });

  it("03: decodes CSV and TSV tabular inputs into structured JSON arrays via yq -p=csv and yq -p=tsv", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        c1=$(printf "id,name\\n1,alice\\n2,bob\\n" | yq -p=csv -o=json '.' | jq -c 'map(.name)')
        c2=$(printf "k\\tv\\nx\\t10\\ny\\t20\\n" | yq -p=tsv -o=json '.' | jq -c 'map(.k)')
        echo "$c1|$c2"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), '["alice","bob"]|["x","y"]');
    });
  });

  it("04: parses TOML sections with yq -p=toml -o=json and re-serializes modified structure to TOML", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'TOML' > /workspace/app.toml
title = "demo"

[server]
host = "127.0.0.1"
port = 8080
TOML
        yq -p=toml -o=json '.server' /workspace/app.toml | jq -r '.host + ":" + (.port | tostring)'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "127.0.0.1:8080");
    });
  });

  it("05: extracts XML attributes and nested child elements into JSON via xq", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'XML' | xq -c '.catalog.book | map({id: ."@id", title: .title})'
<catalog>
  <book id="b1"><title>Rust in Action</title></book>
  <book id="b2"><title>Programming TypeScript</title></book>
</catalog>
XML
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        '[{"id":"b1","title":"Rust in Action"},{"id":"b2","title":"Programming TypeScript"}]',
      );
    });
  });

  it("06: mutates YAML files in-place via yq -i using |=, +=, and del(...)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'YAML' > /workspace/cfg.yaml
version: 1
tags:
  - alpha
debug: true
YAML
        yq -i '.version |= . + 1 | .tags += ["beta"] | del(.debug)' /workspace/cfg.yaml
        yq -o=json '.' /workspace/cfg.yaml | jq -c .
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), '{"version":2,"tags":["alpha","beta"]}');
    });
  });

  it("07: evaluates XPath count(), sum(), string(), and attribute predicates via xmllint --xpath", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'XML' > /workspace/inv.xml
<invoice>
  <item status="paid" price="120">Keyboard</item>
  <item status="pending" price="80">Mouse</item>
  <item status="paid" price="300">Monitor</item>
</invoice>
XML
        cnt=$(xmllint --xpath "count(//item[@status='paid'])" /workspace/inv.xml)
        tot=$(xmllint --xpath "sum(//item[@status='paid']/@price)" /workspace/inv.xml)
        first=$(xmllint --xpath "string(//item[@status='paid'][1])" /workspace/inv.xml)
        echo "cnt=$cnt|tot=$tot|first=$first"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "cnt=2|tot=420|first=Keyboard");
    });
  });

  it("08: validates well-formed vs malformed XML documents using xmllint --noout", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "<root><ok/></root>\\n" > /workspace/good.xml
        printf "<root><unclosed></root>\\n" > /workspace/bad.xml
        xmllint --noout /workspace/good.xml && g="ok"
        if xmllint --noout /workspace/bad.xml 2>/dev/null; then
          b="unexpected"
        else
          b="rejected"
        fi
        echo "good=$g|bad=$b"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "good=ok|bad=rejected");
    });
  });

  it("09: queries HTML DOM nodes with htmlq CSS attribute and child combinators (--text and --attribute)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'HTML' > /workspace/page.html
<div class="nav">
  <a href="https://example.com/docs" data-tier="pro">Documentation</a>
  <a href="https://example.com/blog" data-tier="free">Blog</a>
</div>
HTML
        txt=$(htmlq --text 'a[data-tier="pro"]' < /workspace/page.html)
        href=$(htmlq --attribute href 'div.nav > a[data-tier="pro"]' < /workspace/page.html)
        echo "txt=$txt|href=$href"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "txt=Documentation|href=https://example.com/docs");
    });
  });

  it("10: strips unwanted DOM elements via htmlq --remove-nodes before extracting article text", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'HTML' | htmlq --remove-nodes "script, .ad" --text "article" | tr -s " \\n" " " | sed "s/^ //;s/ $//"
<article>
  <script>alert("xss")</script>
  <p>Clean paragraph one.</p>
  <div class="ad">Buy now!</div>
  <p>Clean paragraph two.</p>
</article>
HTML
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Clean paragraph one. Clean paragraph two.");
    });
  });

  it("11: converts semantic HTML headings, strong emphasis, and hyperlinks into Markdown via html-to-markdown", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'HTML' | html-to-markdown | grep -E "^# |\\*\\*bold\\*\\*|\\[Example\\]" | wc -l | tr -d " "
<h1>Title</h1>
<p>Some <strong>bold</strong> text with <a href="https://example.com">Example</a>.</p>
HTML
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "2");
    });
  });

  it("12: extracts plain text and HTML from RTF documents via unrtf --text and unrtf --html", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'RTF' > /workspace/doc.rtf
{\\rtf1\\ansi\\deff0 {\\b Status:} Ready\\par}
RTF
        t=$(unrtf --text /workspace/doc.rtf | grep "Status:" | tr -s " ")
        h=$(unrtf --html /workspace/doc.rtf | grep -o "Status:" | head -n 1)
        echo "$t|$h"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Status: Ready|Status:");
    });
  });

  it("13: converts XML to JSON via xq and re-encodes to YAML via yq -p=json -o=yaml", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf '<service><name>auth</name><port>9000</port></service>\\n' | xq '.service' | yq -p=json -o=yaml '.' | yq -o=json '.' | jq -c .
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), '{"name":"auth","port":"9000"}');
    });
  });

  it("14: merges layered configuration across YAML, TOML, and JSON via yq and jq -sc", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "host: localhost\\nport: 80\\ntls: false\\n" > /workspace/base.yaml
        printf 'port = 443\\ntls = true\\n' > /workspace/env.toml
        printf '{"region":"eu-west"}\\n' > /workspace/extra.json
        {
          yq -o=json '.' /workspace/base.yaml
          yq -p=toml -o=json '.' /workspace/env.toml
          cat /workspace/extra.json
        } | jq -sc '.[0] * .[1] * .[2]'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), '{"host":"localhost","port":443,"tls":true,"region":"eu-west"}');
    });
  });

  it("15: scrapes HTML table columns with htmlq, joins them with paste, and aggregates in awk", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'HTML' > /workspace/tbl.html
<table>
  <tr><td class="k">cpu</td><td class="v">4</td></tr>
  <tr><td class="k">mem</td><td class="v">16</td></tr>
</table>
HTML
        keys=$(htmlq --text "td.k" < /workspace/tbl.html)
        vals=$(htmlq --text "td.v" < /workspace/tbl.html)
        paste -d "," <(echo "$keys") <(echo "$vals") | awk -F, '{s += $2} END {print NR ":" s}'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "2:20");
    });
  });

  it("16: generates XML from sqlite3 -json + jq and verifies attribute sums via xmllint --xpath", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 -json :memory: "
          CREATE TABLE nodes (id TEXT, weight INT);
          INSERT INTO nodes VALUES ('n1', 15), ('n2', 25), ('n3', 60);
          SELECT id, weight FROM nodes ORDER BY id;
        " | jq -r '"<graph>" + (map("<node id=\\"" + .id + "\\" weight=\\"" + (.weight | tostring) + "\\"/>") | join("")) + "</graph>"' > /workspace/graph.xml
        xmllint --xpath "sum(//node/@weight)" /workspace/graph.xml
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "100");
    });
  });

  it("17: recursively sanitizes sensitive fields across nested objects and arrays via jq del(.. | .secret?)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        jq -nc '{"user":{"name":"alice","secret":"s1"},"items":[{"id":1,"secret":"s2"},{"id":2}]} | del(.. | .secret?)'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), '{"user":{"name":"alice"},"items":[{"id":1},{"id":2}]}');
    });
  });

  it("18: enumerates leaf paths with jq paths(scalars), extracts values with getpath, and updates with setpath", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        jq -nc '{"a":{"b":10,"c":[20,30]}} | [paths(scalars) as $p | {path: ($p | map(tostring) | join(".")), val: getpath($p)}] | setpath([0, "val"]; 99)'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        '[{"path":"a.b","val":99},{"path":"a.c.0","val":20},{"path":"a.c.1","val":30}]',
      );
    });
  });

  it("19: encodes and decodes strings using jq @uri, @html, @base64, @base64d, @csv, and @tsv formatters", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        jq -rn '
          [
            ("a b&c" | @uri),
            ("<b>hi</b>" | @html),
            ("hello" | @base64 | @base64d),
            (["x,y", 10] | @csv),
            (["p", "q"] | @tsv)
          ] | join("|")
        '
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), 'a%20b%26c|&lt;b&gt;hi&lt;/b&gt;|hello|"x,y",10|p\tq');
    });
  });

  it("20: runs end-to-end RTF extraction -> grep -> awk JSONL -> jq merge -> yq YAML serialization", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'RTF' > /workspace/spec.rtf
{\\rtf1\\ansi\\deff0 {\\b ENV=production}\\par {\\b WORKERS=8}\\par}
RTF
        unrtf --text /workspace/spec.rtf | grep -E "^(ENV|WORKERS)=" | awk -F= '{printf "{\\"%s\\":\\"%s\\"}\\n", $1, $2}' | jq -sc 'add' | yq -P -p=json -o=yaml '.' | yq -o=json '.' | jq -c .
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), '{"ENV":"production","WORKERS":"8"}');
    });
  });
});
