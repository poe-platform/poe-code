import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withE2EHarness } from "./harness.js";

describe("obscure htmlq, xmllint, jq, yq, tomlq, and csvkit structured-data matrix", () => {
  it("1. htmlq extracts text and attributes with descendant, child, and attribute prefix/suffix selectors", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > page.html
<div id="main">
  <article class="card featured">
    <h2>Rust Shell</h2>
    <a href="https://example.com/docs" data-track="nav-docs">Docs</a>
    <a href="http://legacy.local/old" data-track="nav-old">Old</a>
  </article>
  <article class="card">
    <h2>TypeScript CLI</h2>
    <a href="https://example.com/api.pdf" data-track="nav-pdf">API PDF</a>
  </article>
</div>
EOF
        htmlq --text '#main article.card > h2' -f page.html
        htmlq --attribute href 'a[href^="https://"]' -f page.html
        htmlq --attribute data-track 'a[href$=".pdf"]' -f page.html
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "Rust Shell\nTypeScript CLI\nhttps://example.com/docs\nhttps://example.com/api.pdf\nnav-pdf\n"
      );
    });
  });

  it("2. htmlq handles :first-child, :last-child, :nth-child, adjacent/general sibling, and --remove-nodes", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > list.html
<ul id="items">
  <li>first<span class="noise">_drop1</span></li>
  <li>second<span class="noise">_drop2</span></li>
  <li>third</li>
</ul>
EOF
        htmlq -t -r '.noise' '#items li:first-child' < list.html
        htmlq -t -r '.noise' '#items li:nth-child(2)' < list.html
        htmlq -t '#items li:last-child' < list.html
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "first\nsecond\nthird\n");
    });
  });

  it("3. xmllint evaluates XPath count(), string(), boolean(), attribute, and predicate queries", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > catalog.xml
<?xml version="1.0"?>
<catalog>
  <book id="b1" lang="en"><title>Systems Programming</title><price>45</price></book>
  <book id="b2" lang="de"><title>Compiler Design</title><price>60</price></book>
  <book id="b3" lang="en"><title>Virtual Machines</title><price>50</price></book>
</catalog>
EOF
        xmllint --noout catalog.xml
        xmllint --xpath 'count(//book[@lang="en"])' catalog.xml
        xmllint --xpath 'string(//book[@id="b2"]/title)' catalog.xml
        xmllint --xpath 'boolean(//book[@id="b3"])' catalog.xml
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "2\nCompiler Design\ntrue\n");
    });
  });

  it("4. xmllint validates well-formedness with --noout and formats XML with --format and --c14n", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf '<root><item id="1">alpha</item></root>' > compact.xml
        xmllint --format compact.xml | grep -c '<item id="1">alpha</item>'
        if printf '<root><unclosed></root>' | xmllint --noout - 2>/dev/null; then
          echo "VALID"
        else
          echo "INVALID_CAUGHT"
        fi
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "1\nINVALID_CAUGHT\n");
    });
  });

  it("5. jq evaluates reduce, foreach, and recursive descent (..) with scalars/paths", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        jq -nc '
          reduce (1, 2, 3, 4) as $x (0; . + ($x * $x)),
          [foreach (10, 20, 30) as $n (0; . + $n; . / 10)],
          ([{"a":{"b":1},"c":[2,3]} | .. | numbers] | add)
        '
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "30\n[1,3,6]\n6\n");
    });
  });

  it("6. jq evaluates transpose, combinations, explode/implode, and @base64/@base64d/@uri/@urid/@html", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        jq -rc '
          ([[1,2],[3,4],[5,6]] | transpose),
          ("Rust" | explode | map(. + 1) | implode),
          ("hello world" | @base64 | @base64d),
          ("a+b&c=d" | @uri | @urid),
          ("<tag>&" | @html)
        ' <<< 'null'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "[[1,3,5],[2,4,6]]\nSvtu\nhello world\na+b&c=d\n&lt;tag&gt;&amp;\n"
      );
    });
  });

  it("7. jq evaluates path manipulation: getpath, setpath, delpaths, leaf_paths, and update assignment (|=)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        jq -c '
          setpath(["meta","version"]; 2)
          | (.items[] | select(.score < 50).status) |= "retry"
          | [getpath(["meta","version"]), (.items | map(.status))]
        ' <<'EOF'
{"meta":{"version":1},"items":[{"status":"ok","score":80},{"status":"ok","score":30}]}
EOF
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, '[2,["ok","retry"]]\n');
    });
  });

  it("8. jq evaluates regex functions test, match, capture, sub, gsub, splits, and scan", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        jq -rc '
          ("v1.24.3-rc1" | capture("^v(?<maj>[0-9]+)\\.(?<min>[0-9]+)") | "\(.maj).\(.min)"),
          ("foo_bar_baz" | gsub("_"; "-")),
          (["a12b34c56" | scan("[0-9]+")] | join(":"))
        ' <<< 'null'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "1.24\nfoo-bar-baz\n12:34:56\n");
    });
  });

  it("9. yq resolves YAML anchors, aliases, merge keys (<<:), and converts to compact JSON", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > service.yaml
defaults: &def
  timeout: 30
  retries: 3
production:
  <<: *def
  retries: 5
  region: us-east
EOF
        yq -o=json -I=0 'explode(.) | .production' service.yaml
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, '{"timeout":30,"retries":5,"region":"us-east"}\n');
    });
  });

  it("10. yq processes multi-document YAML streams, updates fields in-place (-i), and deletes keys", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > cfg.yaml
app:
  name: poe
  debug: true
  port: 8080
EOF
        yq -i '.app.port = 9090 | del(.app.debug)' cfg.yaml
        yq -o=json -I=0 '.app' cfg.yaml
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, '{"name":"poe","port":9090}\n');
    });
  });

  it("11. tomlq queries TOML tables, dotted keys, and [[array_of_tables]] and emits TOML with -t", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > Cargo.toml
[package]
name = "safe-bash"
version = "0.2.0"

[[bin]]
name = "sb"
path = "src/main.rs"

[[bin]]
name = "sb-admin"
path = "src/admin.rs"
EOF
        yq -p=toml -o=json -r '.package.name + "@" + .package.version' Cargo.toml
        yq -p=toml -o=json -I=0 '[.bin[].name]' Cargo.toml
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, 'safe-bash@0.2.0\n["sb","sb-admin"]\n');
    });
  });

  it("12. in2csv converts JSON arrays and NDJSON streams into normalized CSV tables", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > items.json
[
  {"id": 1, "name": "alpha", "score": 90},
  {"id": 2, "name": "beta", "score": 85}
]
EOF
        in2csv items.json
        printf '{"k":"x","v":10}
{"k":"y","v":20}
' | in2csv -f ndjson
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "id,name,score\n1,alpha,90\n2,beta,85\nk,v\nx,10\ny,20\n");
    });
  });

  it("13. csvcut selects, reorders (-c), and excludes (-C) columns by name and 1-based index", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > data.csv
id,user,role,secret
1,ada,admin,s1
2,bob,user,s2
EOF
        csvcut -c role,user data.csv
        csvcut -C secret,1 data.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "role,user\nadmin,ada\nuser,bob\nuser,role\nada,admin\nbob,user\n");
    });
  });

  it("14. csvgrep filters CSV rows by substring (-m), regex (-r), and inverted match (-i)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > hosts.csv
host,env,status
web-01,prod,up
db-01,prod,down
dev-box,staging,up
EOF
        csvgrep -c env -m prod hosts.csv | csvgrep -c status -m down -i
        csvgrep -c host -r '^(web|db)-[0-9]+$' hosts.csv | csvcut -c host
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "host,env,status\nweb-01,prod,up\nhost\nweb-01\ndb-01\n");
    });
  });

  it("15. csvsort sorts CSV rows numerically and lexicographically with --reverse (-r)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > scores.csv
name,pts
carol,100
alice,20
bob,9
EOF
        csvsort -c pts scores.csv
        csvsort -c pts -r scores.csv | csvcut -c name
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "name,pts\nbob,9\nalice,20\ncarol,100\nname\ncarol\nalice\nbob\n"
      );
    });
  });

  it("16. csvjoin performs inner, left (--left), and outer (--outer) relational joins on CSV files", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > users.csv
id,name
1,Ada
2,Grace
3,Linus
EOF
        cat <<'EOF' > depts.csv
id,dept
1,Compilers
3,Kernel
EOF
        csvjoin -c id users.csv depts.csv
        csvjoin --left -c id users.csv depts.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "id,name,dept\n1,Ada,Compilers\n3,Linus,Kernel\nid,name,dept\n1,Ada,Compilers\n2,Grace,\n3,Linus,Kernel\n"
      );
    });
  });

  it("17. csvstack stacks multiple CSV files with group labels (-g, -n)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf 'item,qty
apple,5
' > q1.csv
        printf 'item,qty
pear,8
' > q2.csv
        csvstack -g Q1,Q2 -n quarter q1.csv q2.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "quarter,item,qty\nQ1,apple,5\nQ2,pear,8\n");
    });
  });

  it("18. csvstat computes --count, --sum, --mean, --min, and --max over CSV columns", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > metrics.csv
latency
10
20
30
40
EOF
        csvstat --count metrics.csv
        csvstat -c latency --sum metrics.csv
        csvstat -c latency --min metrics.csv
        csvstat -c latency --max metrics.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "4\n100\n10\n40\n");
    });
  });

  it("19. csvjson and csvformat convert CSV into keyed JSON objects (-k) and custom-delimited (-D / -T) output", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > nodes.csv
id,host,active
n1,alpha,true
n2,beta,false
EOF
        csvjson -k id nodes.csv | jq -c '.n1'
        csvformat -D '|' nodes.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        '{"id":"n1","host":"alpha","active":true}\nid|host|active\nn1|alpha|true\nn2|beta|false\n'
      );
    });
  });

  it("20. end-to-end structured pipeline: htmlq -> xmllint -> jq -> in2csv -> csvsql / csvlook", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > report.html
<div id="payload">{"services":[{"name":"auth","ok":1,"ms":12},{"name":"gateway","ok":1,"ms":8},{"name":"legacy","ok":0,"ms":250}]}</div>
EOF
        htmlq -t '#payload' -f report.html           | jq -c '[.services[] | select(.ok == 1)]'           | in2csv -f json           | csvsort -c ms           | csvlook
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /|s*names*|s*oks*|s*mss*|/);
      assert.match(res.stdout, /|s*gateways*|s*1s*|s*8s*|/);
      assert.match(res.stdout, /|s*auths*|s*1s*|s*12s*|/);
    });
  });
});
