import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure xan, csvkit, jq, yq, xq, xmllint, htmlq, html-to-markdown & unrtf structured document matrix", () => {
  it("1. xan select, filter, map, dedup, sort, enum, and slice pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'CSV' > /tmp/emp.csv
id,name,dept,salary,bonus
1,alice,eng,120,20
2,bob,sales,90,15
3,carol,eng,135,25
4,dave,eng,120,20
5,erin,ops,105,10
CSV
        xan filter 'salary >= 100' /tmp/emp.csv \
          | xan map 'salary + bonus as total' \
          | xan dedup -s dept,total \
          | xan sort -s total -R \
          | xan enum -c rank \
          | xan select rank,name,dept,total \
          | xan slice -l 3
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "rank,name,dept,total",
          "0,carol,eng,160",
          "1,alice,eng,140",
          "2,erin,ops,115",
        ].join("\n"),
      );
    });
  });

  it("2. xan groupby multi-aggregation with count, sum, mean, min, and max", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'CSV' > /tmp/sales.csv
region,rep,amount
north,a,100
north,b,200
north,c,300
south,d,50
south,e,150
CSV
        xan groupby region 'count() as n, sum(amount) as total, mean(amount) as avg, min(amount) as lo, max(amount) as hi' /tmp/sales.csv \
          | xan sort -s region
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "region,n,total,avg,lo,hi",
          "north,3,600,200,100,300",
          "south,2,200,100,50,150",
        ].join("\n"),
      );
    });
  });

  it("3. xan inner and --left join with rename and drop", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'CSV' > /tmp/users.csv
uid,uname,dept_id
1,alice,10
2,bob,20
3,carol,99
CSV
        cat <<'CSV' > /tmp/depts.csv
did,dname,budget
10,engineering,500
20,design,300
CSV
        xan join dept_id /tmp/users.csv did /tmp/depts.csv \
          | xan rename team -s dname \
          | xan drop did,budget \
          | xan sort -s uid
        echo "---"
        xan join --left dept_id /tmp/users.csv did /tmp/depts.csv \
          | xan select uid,uname,dname \
          | xan sort -s uid
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "uid,uname,dept_id,team",
          "1,alice,10,engineering",
          "2,bob,20,design",
          "---",
          "uid,uname,dname",
          "1,alice,engineering",
          "2,bob,design",
          "3,carol,",
        ].join("\n"),
      );
    });
  });

  it("4. xan agg global aggregations and xan transpose matrix pivot", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'CSV' > /tmp/kpis.csv
metric,q1,q2
rev,100,150
cost,40,60
CSV
        xan agg 'sum(q1) as total_q1, sum(q2) as total_q2, mean(q2) as avg_q2' /tmp/kpis.csv
        echo "---"
        xan transpose /tmp/kpis.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "total_q1,total_q2,avg_q2",
          "140,210,105",
          "---",
          "metric,rev,cost",
          "q1,100,40",
          "q2,150,60",
        ].join("\n"),
      );
    });
  });

  it("5. xan freq, xan top, and xan reverse", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'CSV' > /tmp/events.csv
status,latency
200,12
500,95
200,18
404,31
200,15
500,82
CSV
        xan freq -s status /tmp/events.csv | xan select value,count
        echo "---"
        xan top latency -l 2 /tmp/events.csv | xan reverse | xan select status,latency
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "value,count",
          "200,3",
          "500,2",
          "404,1",
          "---",
          "status,latency",
          "500,82",
          "500,95",
        ].join("\n"),
      );
    });
  });

  it("6. xan cat rows, count, headers -j, head, and tail", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'CSV' > /tmp/p1.csv
cat,sku,price
hw,A1,10
sw,B1,20
CSV
        cat <<'CSV' > /tmp/p2.csv
cat,sku,price
hw,A2,30
sw,B2,40
CSV
        xan cat rows /tmp/p1.csv /tmp/p2.csv > /tmp/all.csv
        xan count /tmp/all.csv
        xan headers -j /tmp/all.csv
        xan head -l 1 /tmp/all.csv | xan select sku,price
        xan tail -l 1 /tmp/all.csv | xan select sku,price
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "4",
          "cat",
          "sku",
          "price",
          "sku,price",
          "A1,10",
          "sku,price",
          "B2,40",
        ].join("\n"),
      );
    });
  });

  it("7. csvcut inverse selection, csvgrep regex and invert, and csvsort reverse", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'CSV' > /tmp/hosts.csv
host,env,cpu,secret
web-01,prod,72,xxx
db-01,prod,85,yyy
dev-01,staging,19,zzz
api-02,prod,64,www
CSV
        csvcut -C secret /tmp/hosts.csv \
          | csvgrep -c env -m prod \
          | csvgrep -c host -r '^db-' -i \
          | csvsort -c cpu -r
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["host,env,cpu", "web-01,prod,72", "api-02,prod,64"].join("\n"),
      );
    });
  });

  it("8. csvstack with group labels and csvjoin --left", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'CSV' > /tmp/q1.csv
sku,qty
A1,10
B2,20
CSV
        cat <<'CSV' > /tmp/q2.csv
sku,qty
A1,15
C3,30
CSV
        csvstack -g Q1,Q2 -n quarter /tmp/q1.csv /tmp/q2.csv > /tmp/stacked.csv
        cat /tmp/stacked.csv
        echo "---"
        csvjoin -c sku --left /tmp/q1.csv /tmp/q2.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "quarter,sku,qty",
          "Q1,A1,10",
          "Q1,B2,20",
          "Q2,A1,15",
          "Q2,C3,30",
          "---",
          "sku,qty,qty2",
          "A1,10,15",
          "B2,20,",
        ].join("\n"),
      );
    });
  });

  it("9. csvstat summary metrics and csvjson keyed object + in2csv roundtrip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'CSV' > /tmp/metrics.csv
service,rps
auth,100
billing,200
search,300
CSV
        csvstat --sum /tmp/metrics.csv
        csvstat --mean /tmp/metrics.csv
        csvjson -k service /tmp/metrics.csv | jq -c '.billing.rps'
        csvjson /tmp/metrics.csv | in2csv -f json | csvsort -c service
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "1. service: None",
          "  2. rps: 600",
          "  1. service: None",
          "  2. rps: 200",
          "200.0",
          "service,rps",
          "auth,100.0",
          "billing,200.0",
          "search,300.0",
        ].join("\n"),
      );
    });
  });

  it("10. csvsql multi-table SQL join and csvlook ASCII table rendering with sed BRE literal pipe", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'CSV' > /tmp/authors.csv
id,author
1,Ada
2,Grace
CSV
        cat <<'CSV' > /tmp/books.csv
book_id,author_id,title,pages
10,1,Notes,120
11,2,Compiler,240
12,1,Engine,180
CSV
        csvsql --query "
          SELECT a.author, COUNT(b.book_id) AS books, CAST(SUM(b.pages) AS INT) AS total_pages
          FROM authors a JOIN books b ON a.id = b.author_id
          GROUP BY a.author ORDER BY a.author
        " /tmp/authors.csv /tmp/books.csv | tee /tmp/author_stats.csv
        echo "---"
        csvlook /tmp/author_stats.csv | grep -E 'Ada|Grace' | sed 's/[[:space:]]*|[[:space:]]*/|/g'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "author,books,total_pages",
          "Ada,2,300",
          "Grace,1,240",
          "---",
          "|Ada|2|300|",
          "|Grace|1|240|",
        ].join("\n"),
      );
    });
  });

  it("11. jq paths(scalars), getpath, setpath, and delpaths", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'JSON' > /tmp/cfg.json
{"a":{"b":[10,20],"c":"keep"},"drop":true}
JSON
        jq -c '[paths(scalars)]' /tmp/cfg.json
        jq -c 'setpath(["a","b",1]; 99) | delpaths([["drop"]]) | [getpath(["a","b",1]), .drop]' /tmp/cfg.json
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          '[["a","b",0],["a","b",1],["a","c"],["drop"]]',
          "[99,null]",
        ].join("\n"),
      );
    });
  });

  it("12. jq reduce, foreach, transpose, bsearch, and INDEX", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        jq -nc '
          {
            reduced: (reduce (1,2,3,4) as $x (0; . + ($x * $x))),
            running: [foreach (10,20,30) as $x (0; . + $x; .)],
            transposed: ([[1,2,3],[4,5,6]] | transpose),
            found_idx: ([10,20,30,40] | bsearch(30)),
            indexed: ([{id:"a",v:1},{id:"b",v:2}] | INDEX(.id) | .b.v)
          }
        '
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        '{"reduced":30,"running":[10,30,60],"transposed":[[1,4],[2,5],[3,6]],"found_idx":2,"indexed":2}',
      );
    });
  });

  it("13. jq format strings @csv, @tsv, @uri, @html, @base64, @base64d and regex capture/gsub", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        jq -nr '
          (["a,b", "c", 42] | @csv),
          (["x", "y", 9] | @tsv),
          ("a b+c" | @uri),
          ("<b>hi & bye</b>" | @html),
          ("safe-bash" | @base64 | @base64d),
          ("2026-10-06" | capture("(?<y>[0-9]{4})-(?<m>[0-9]{2})-(?<d>[0-9]{2})") | "\\(.y)/\\(.m)/\\(.d)"),
          ("foo_bar_baz" | gsub("_"; "-"))
        '
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          '"a,b","c",42',
          "x\ty\t9",
          "a%20b%2Bc",
          "&lt;b&gt;hi &amp; bye&lt;/b&gt;",
          "safe-bash",
          "2026/10/06",
          "foo-bar-baz",
        ].join("\n"),
      );
    });
  });

  it("14. yq YAML multi-format conversion to json, props, shell, and csv", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'YAML' > /tmp/app.yaml
app:
  name: gateway
  port: 8080
items:
  - sku: A1
    qty: 5
  - sku: B2
    qty: 9
YAML
        yq -o=json '.app' /tmp/app.yaml | jq -c .
        yq -o=props '.app' /tmp/app.yaml | sort
        yq -o=shell '.app' /tmp/app.yaml | sort
        yq -o=csv '.items' /tmp/app.yaml | tr -d '\\r'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          '{"name":"gateway","port":8080}',
          "name = gateway",
          "port = 8080",
          "name=gateway",
          "port=8080",
          "sku,qty",
          "A1,5",
          "B2,9",
        ].join("\n"),
      );
    });
  });

  it("15. yq TOML table and array-of-tables query and JSON transform", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'TOML' > /tmp/Cargo.toml
[package]
name = "demo-crate"
version = "0.2.0"

[[bin]]
name = "cli-a"
path = "src/a.rs"

[[bin]]
name = "cli-b"
path = "src/b.rs"
TOML
        yq -p=toml -r '.package.name + "@" + .package.version' /tmp/Cargo.toml
        yq -p=toml -o=json -I=0 '[.bin[] | .name]' /tmp/Cargo.toml
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["demo-crate@0.2.0", '["cli-a","cli-b"]'].join("\n"),
      );
    });
  });

  it("16. xq XML attribute and element extraction with jq filters", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'XML' > /tmp/catalog.xml
<catalog region="eu">
  <product id="p1" active="true"><name>Router</name><price>120</price></product>
  <product id="p2" active="false"><name>Switch</name><price>80</price></product>
  <product id="p3" active="true"><name>Firewall</name><price>250</price></product>
</catalog>
XML
        xq -c '.catalog.product | map(select(."@active" == "true") | {id: ."@id", name: .name, price: (.price | tonumber)})' /tmp/catalog.xml
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        '[{"id":"p1","name":"Router","price":120},{"id":"p3","name":"Firewall","price":250}]',
      );
    });
  });

  it("17. xmllint --xpath scalar functions count, sum, and attribute predicates", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'XML' > /tmp/inv.xml
<inventory>
  <item tier="gold"><sku>G1</sku><stock>15</stock></item>
  <item tier="silver"><sku>S1</sku><stock>8</stock></item>
  <item tier="gold"><sku>G2</sku><stock>25</stock></item>
</inventory>
XML
        xmllint --xpath 'count(//item[@tier="gold"])' /tmp/inv.xml
        echo ""
        xmllint --xpath 'sum(//item[@tier="gold"]/stock)' /tmp/inv.xml
        echo ""
        xmllint --xpath '//item[@tier="gold"]/sku/text()' /tmp/inv.xml
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["2", "", "40", "", "G1", "G2"].join("\n"),
      );
    });
  });

  it("18. htmlq CSS selectors, --attribute, --text, and --remove-nodes", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'HTML' > /tmp/page.html
<html>
  <body>
    <nav class="noise">skip me</nav>
    <main>
      <article data-id="101"><h2>First Post</h2><p class="summary">Alpha content</p><span class="draft">WIP</span></article>
      <article data-id="102"><h2>Second Post</h2><p class="summary">Beta content</p></article>
    </main>
  </body>
</html>
HTML
        htmlq --attribute data-id 'main article' < /tmp/page.html
        htmlq --text --remove-nodes '.draft' 'main article h2, main article p.summary' < /tmp/page.html | grep -v '^$'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "101",
          "102",
          "First Post",
          "Alpha content",
          "Second Post",
          "Beta content",
        ].join("\n"),
      );
    });
  });

  it("19. html-to-markdown conversion of headings, links, and lists", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'HTML' > /tmp/doc.html
<h1>Release Notes</h1>
<p>Visit <a href="https://example.com/docs">Docs</a> for details.</p>
<ul>
  <li>Fast startup</li>
  <li>Zero deps</li>
</ul>
HTML
        html-to-markdown /tmp/doc.html | grep -E 'Release Notes|https://example.com/docs|Fast startup|Zero deps' | wc -l | tr -d ' '
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "4");
    });
  });

  it("20. unrtf RTF document conversion to plain text", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'RTF' > /tmp/memo.rtf
{\\rtf1\\ansi\\deff0
{\\b Project Update}\\par
Status is {\\i green} for milestone 42.\\par
}
RTF
        unrtf --text /tmp/memo.rtf | grep -E 'Project Update|milestone 42' | sed 's/^[[:space:]]*//'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["Project Update", "Status is green for milestone 42."].join("\n"),
      );
    });
  });
});
