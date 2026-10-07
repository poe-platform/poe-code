import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withE2EHarness } from "./harness.js";

describe("obscure yq, xq, xmllint, htmlq, csvkit, and xan structured data matrix", () => {
  it("1. handles yq YAML anchors (&), aliases (*), merge keys (<<), and explode(.)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > config.yaml
defaults: &base
  timeout: 30
  retries: 3
  env: prod
service_a:
  <<: *base
  port: 8080
service_b:
  <<: *base
  retries: 5
  env: staging
EOF
        yq -o=json -c 'explode(.) | {a: .service_a, b: .service_b}' config.yaml
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.deepEqual(JSON.parse(res.stdout.trim()), {
        a: { timeout: 30, retries: 3, env: "prod", port: 8080 },
        b: { timeout: 30, retries: 5, env: "staging" },
      });
    });
  });

  it("2. handles yq cross-format TOML -> YAML -> in-place mutation -> JSON pipeline", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > Cargo.toml
[package]
name = "demo"
version = "0.1.0"

[dependencies]
serde = "1.0"
EOF
        yq -p=toml -o=yaml '.package.version = "0.2.0" | .dependencies.tokio = "1.38"' Cargo.toml > out.yaml
        yq -i '.package.edition = "2024"' out.yaml
        yq -o=json -c '.' out.yaml
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.deepEqual(JSON.parse(res.stdout.trim()), {
        package: { name: "demo", version: "0.2.0", edition: "2024" },
        dependencies: { serde: "1.0", tokio: "1.38" },
      });
    });
  });

  it("3. handles yq CSV input (-p=csv) and CSV output (-o=csv) round-trip with filtering", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > items.csv
name,qty,price
apple,10,2
banana,5,3
cherry,20,4
EOF
        yq -p=csv -o=csv 'map(select(.qty >= 10))' items.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "name,qty,price\napple,10,2\ncherry,20,4");
    });
  });

  it("4. handles xq XML-to-JSON querying over attributes, nested elements, and CDATA", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > catalog.xml
<catalog>
  <item id="101"><name>Widget</name><note><![CDATA[raw <tag> & text]]></note></item>
  <item id="102"><name>Gadget</name><note>plain</note></item>
</catalog>
EOF
        xq -c '.catalog.item | map({id: ."@id", name: .name, note: .note})' catalog.xml
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.deepEqual(JSON.parse(res.stdout.trim()), [
        { id: "101", name: "Widget", note: "raw <tag> & text" },
        { id: "102", name: "Gadget", note: "plain" },
      ]);
    });
  });

  it("5. handles xmllint --xpath predicates, --c14n canonicalization, and --noout validation", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > books.xml
<library>
  <book id="b1" category="tech"><title>Rust</title><price>45</price></book>
  <book id="b2" category="fiction"><title>Dune</title><price>20</price></book>
  <book id="b3" category="tech"><title>Systems</title><price>60</price></book>
</library>
EOF
        xmllint --xpath "//book[@category='tech']/title/text()" books.xml
        xmllint --xpath "count(//book)" books.xml
        xmllint --noout books.xml && echo "valid_ok"
        if xmllint --noout <<< "<broken><unclosed></broken>" 2>/dev/null; then
          echo "should_have_failed"
        else
          echo "invalid_caught"
        fi
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /Rust/);
      assert.match(res.stdout, /Systems/);
      assert.match(res.stdout, /3\nvalid_ok\ninvalid_caught\n$/);
    });
  });

  it("6. handles htmlq CSS selectors (-t, -a, -r remove-nodes, -b base URL resolution)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > page.html
<html>
  <body>
    <div class="content">
      <p class="keep">Hello <b>World</b></p>
      <p class="ad">Buy Now!</p>
      <a class="nav" href="/docs/intro">Intro</a>
      <a class="nav" href="https://other.org/x">External</a>
    </div>
  </body>
</html>
EOF
        htmlq -t -r .ad ".content" -f page.html | tr -s " \n" " " | sed "s/^ //; s/ $//"
        echo ""
        htmlq -a href -b https://example.com "a.nav" -f page.html
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "Hello World Intro External\nhttps://example.com/docs/intro\nhttps://other.org/x\n"
      );
    });
  });

  it("7. handles html-to-markdown, unrtf, and mmdc Mermaid SVG generation", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        html-to-markdown <<< "<h1>Title</h1><p>Some <strong>bold</strong> and <a href=\"https://example.com\">link</a>.</p>" | grep -E "Title|bold"
        cat <<'EOF' > doc.rtf
{\rtf1\ansi\deff0 Hello {\b RTF} World!\par Second line}
EOF
        unrtf --text doc.rtf | grep -F "Hello"
        cat <<'EOF' > flow.mmd
graph TD
  A[Start] --> B[Finish]
EOF
        mmdc -i flow.mmd -o flow.svg
        grep -o "<svg" flow.svg | head -n 1
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /Title/);
      assert.match(res.stdout, /Hello/);
      assert.match(res.stdout, /<svg/);
    });
  });

  it("8. handles csvcut (-c, -C, -n) and csvgrep (-c, -m, -r, -i) on quoted CSV fields", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > emp.csv
id,name,role,notes
1,"Ada, Lovelace",engineer,"first, programmer"
2,"Grace Hopper",admiral,"cobol, compiler"
3,"Alan Turing",mathematician,"enigma, logic"
EOF
        csvcut -n emp.csv
        echo "---"
        csvgrep -c role -r "^(engineer|mathematician)$" emp.csv | csvcut -C notes
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "  1: id\n  2: name\n  3: role\n  4: notes\n---\nid,name,role\n1,\"Ada, Lovelace\",engineer\n3,Alan Turing,mathematician\n"
      );
    });
  });

  it("9. handles csvsort (-c, -r, -I), csvformat (-D), and csvlook table rendering", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > scores.csv
user,score
bob,9
alice,100
carol,25
EOF
        csvsort -c score scores.csv | csvformat -D "|"
        echo "---"
        csvsort -c score -I scores.csv | csvformat -D "|"
        echo "---"
        csvlook scores.csv | head -n 2
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      const parts = res.stdout.split("---\n");
      assert.equal(parts[0], "user|score\nbob|9\ncarol|25\nalice|100\n");
      assert.equal(parts[1], "user|score\nalice|100\ncarol|25\nbob|9\n");
      assert.match(parts[2], /\| user\s+\| score \|/);
    });
  });

  it("10. handles csvjoin (-c, --left) and csvstack (-g, -n) across multiple CSV files", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > users.csv
id,name
1,alice
2,bob
3,carol
EOF
        cat <<'EOF' > depts.csv
id,dept
1,eng
3,sales
EOF
        csvjoin -c id --left users.csv depts.csv
        echo "---"
        csvstack -g "u,d" -n src users.csv depts.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "id,name,dept\n1,alice,eng\n2,bob,\n3,carol,sales\n---\nsrc,id,name,dept\nu,1,alice,\nu,2,bob,\nu,3,carol,\nd,1,,eng\nd,3,,sales\n"
      );
    });
  });

  it("11. handles csvjson (-k keyed object, --stream NDJSON) and in2csv (-f json / ndjson)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > items.csv
sku,qty,active
A1,10,true
B2,0,false
EOF
        csvjson -k sku items.csv | jq -c '.A1'
        csvjson --stream items.csv | in2csv -f ndjson
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      const lines = res.stdout.trim().split("\n");
      const a1 = JSON.parse(lines[0]);
      assert.equal(a1.qty, 10);
      assert.equal(a1.active, true);
      assert.equal(lines.slice(1).join("\n"), "sku,qty,active\nA1,10.0,True\nB2,0.0,False");
    });
  });

  it("12. handles csvsql --query multi-table SQL joins and csvstat summary metrics", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > orders.csv
order_id,cust_id,amount
10,1,120
11,2,80
12,1,180
EOF
        cat <<'EOF' > custs.csv
cust_id,tier
1,gold
2,silver
EOF
        csvsql --query "SELECT c.tier, SUM(CAST(o.amount AS INTEGER)) AS total FROM orders o JOIN custs c ON o.cust_id = c.cust_id GROUP BY c.tier ORDER BY total DESC" orders.csv custs.csv
        echo "---"
        csvstat --sum -c amount orders.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "tier,total\ngold,300\nsilver,80\n---\n380\n");
    });
  });

  it("13. handles csvclean --length-mismatch --omit-error-rows and --fill-short-rows on jagged CSVs", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > dirty.csv
a,b,c
1,2,3
4,5
6,7,8,9
10,11,12
EOF
        csvclean --length-mismatch --omit-error-rows dirty.csv 2>err.txt || true
        grep -c "Expected 3 columns" err.txt
        echo "---"
        csvclean --fill-short-rows --fillvalue NA dirty.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "a,b,c\n1,2,3\n10,11,12\n2\n---\na,b,c\n1,2,3\n4,5,NA\n6,7,8,9\n10,11,12\n"
      );
    });
  });

  it("14. handles xan count, headers -j, select, drop, and rename", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > data.csv
id,first_name,role,secret
1,alice,eng,xxx
2,bob,ops,yyy
EOF
        xan count data.csv
        xan headers -j data.csv | paste -sd "," -
        xan drop secret data.csv | xan rename user_id,name -s id,first_name | xan select name,role,user_id
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "2\nid,first_name,role,secret\nname,role,user_id\nalice,eng,1\nbob,ops,2\n"
      );
    });
  });

  it("15. handles xan filter, search (-i, -v), slice (-s, -l), enum, and dedup (-l)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > events.csv
user,score
alice,10
bob,50
alice,30
carol,40
bob,20
EOF
        xan filter "score >= 20" events.csv | xan dedup -s user -l | xan enum -c row_num
        echo "---"
        xan search -s user -i "ALICE" events.csv | xan slice -s 1 -l 1
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "row_num,user,score\n0,bob,20\n1,alice,30\n2,carol,40\n---\nuser,score\nalice,30\n"
      );
    });
  });

  it("16. handles xan sort (-s, -N, -R), top (-l), reverse, and transpose", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > metrics.csv
host,latency
h1,120
h2,15
h3,300
h4,45
EOF
        xan top latency -l 2 metrics.csv
        echo "---"
        xan sort -s latency -N metrics.csv | xan reverse | head -n 3
        echo "---"
        xan slice -l 2 metrics.csv | xan transpose
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "host,latency\nh3,300\nh1,120\n---\nhost,latency\nh3,300\nh1,120\n---\nhost,h1,h2\nlatency,120,15\n"
      );
    });
  });

  it("17. handles xan map computed columns, groupby aggregations, and agg", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > sales.csv
dept,qty,price
eng,2,100
sales,5,40
eng,3,200
sales,1,50
EOF
        xan map "qty * price" revenue sales.csv > rev.csv
        xan groupby dept "count() as n, sum(revenue) as total, max(revenue) as peak" rev.csv
        echo "---"
        xan agg "sum(revenue) as grand_total, mean(revenue) as avg_rev" rev.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "dept,n,total,peak\neng,2,800,600\nsales,2,250,200\n---\ngrand_total,avg_rev\n1050,262.5\n"
      );
    });
  });

  it("18. handles xan join (inner, --left, --semi, --anti) across keyed CSV files", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > left.csv
id,name
1,alice
2,bob
3,carol
EOF
        cat <<'EOF' > right.csv
id,badge
1,gold
3,silver
EOF
        xan join id left.csv id right.csv
        echo "---"
        xan join --semi id left.csv id right.csv
        echo "---"
        xan join --anti id left.csv id right.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "id,name,badge\n1,alice,gold\n3,carol,silver\n---\nid,name\n1,alice\n3,carol\n---\nid,name\n2,bob\n"
      );
    });
  });

  it("19. handles xan freq, stats, to json, and from -f json --sort-keys", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > items.csv
cat,val
a,10
b,20
a,30
a,20
b,40
EOF
        xan freq -s cat items.csv
        echo "---"
        xan to json items.csv | xan from -f json --sort-keys | head -n 3
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "field,value,count\ncat,a,3\ncat,b,2\n---\ncat,val\na,10\nb,20\n"
      );
    });
  });

  it("20. executes an end-to-end poly-format pipeline: htmlq -> jq -> in2csv -> xan -> yq -> xmllint", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > page.html
<ul id="items">
  <li data-dept="eng" data-cost="150">Server</li>
  <li data-dept="eng" data-cost="250">Cluster</li>
  <li data-dept="ops" data-cost="100">Monitor</li>
</ul>
EOF
        paste -d "," <(htmlq -a data-dept "#items li" -f page.html) <(htmlq -a data-cost "#items li" -f page.html) <(htmlq -t "#items li" -f page.html) | \
          sed "1i dept,cost,item" | \
          xan groupby dept "sum(cost) as total_cost, count() as items" | \
          yq -p=csv -o=xml '{report: {row: .}}' | \
          xmllint --xpath "string(//row[dept='eng']/total_cost)" -
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "400");
    });
  });
});
