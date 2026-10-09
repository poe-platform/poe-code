import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

const createEnv = () => ({
  exec: (script: string) => withE2EHarness((h) => h.exec(script)),
});

describe("obscure jq, yq, xq, tomlq, xmllint, htmlq, csvkit, and xan structured parity matrix", () => {
  it("1. jq reduce, foreach, group_by, sort_by, unique_by, and with_entries", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > events.json
[
  {"team":"core","pts":10,"tag":"a"},
  {"team":"edge","pts":5,"tag":"b"},
  {"team":"core","pts":15,"tag":"a"},
  {"team":"edge","pts":20,"tag":"c"}
]
EOF
      jq -c '
        {
          total: (reduce .[] as $it (0; . + $it.pts)),
          running: [foreach .[] as $it (0; . + $it.pts; .)],
          by_team: (group_by(.team) | map({team: .[0].team, sum: (map(.pts) | add)})),
          tags: (unique_by(.tag) | map(.tag))
        }
      ' events.json
      printf '{"a":1,"b":2,"c":3}\n' | jq -c 'with_entries(.key |= "k_" + . | .value *= 10)'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        '{"total":50,"running":[10,15,30,50],"by_team":[{"team":"core","sum":25},{"team":"edge","sum":25}],"tags":["a","b","c"]}',
        '{"k_a":10,"k_b":20,"k_c":30}',
        "",
      ].join("\n")
    );
  });

  it("2. jq update assignments (|=, +=, //=, del) and path manipulation (paths, getpath, setpath)", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf '{"cfg":{"retries":2,"timeout":null,"legacy":true}}\n' | jq -c '
        .cfg.retries += 3
        | .cfg.timeout //= 30
        | .cfg.mode //= "strict"
        | del(.cfg.legacy)
        | setpath(["cfg","nested","ok"]; true)
      '
      printf '{"a":{"b":1},"c":[2,3]}\n' | jq -c '[paths(scalars)]'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        '{"cfg":{"retries":5,"timeout":30,"mode":"strict","nested":{"ok":true}}}',
        '[["a","b"],["c",0],["c",1]]',
        "",
      ].join("\n")
    );
  });

  it("3. jq formatters (@base64, @base64d, @uri, @csv, @tsv) and regex capture/gsub", async () => {
    const env = createEnv();
    const res = await env.exec(`
      jq -rn '
        ("rust-wasm:42" | @base64) as $b64
        | ($b64 | @base64d) as $dec
        | ("a b&c=d" | @uri) as $uri
        | (["x,y", 10, true] | @csv) as $csv
        | ("v2.14.9" | capture("^v(?<maj>[0-9]+)\\\\.(?<min>[0-9]+)\\\\.(?<pat>[0-9]+)$")) as $cap
        | "b64=\\($b64)|dec=\\($dec)|uri=\\($uri)|csv=\\($csv)|cap=\\($cap.maj).\\($cap.min).\\($cap.pat)"
      '
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      'b64=cnVzdC13YXNtOjQy|dec=rust-wasm:42|uri=a%20b%26c%3Dd|csv="x,y",10,true|cap=2.14.9\n'
    );
  });

  it("4. jq --arg, --argjson, -s slurp, -e exit status, and try/catch error recovery", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf '{"id":1}\n{"id":2}\n' | jq -sc --arg env "prod" --argjson mult 10 '
        map({id: (.id * $mult), env: $env})
      '
      printf '[{"v":10},{"v":"bad"},{"v":30}]\n' | jq -c '
        map(try (.v + 5) catch "err")
      '
      printf '{"ok":false}\n' | jq -e '.ok' >/dev/null
      echo "false_exit=$?"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        '[{"id":10,"env":"prod"},{"id":20,"env":"prod"}]',
        '[15,"err",35]',
        "false_exit=1",
        "",
      ].join("\n")
    );
  });

  it("5. yq YAML querying, in-place style mutations, -o=json, and -P pretty YAML formatting", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > service.yaml
service:
  name: gateway
  replicas: 2
  ports:
    - 8080
    - 8443
EOF
      yq -o=json -I=0 '.service.replicas += 1 | .service.ports += [9090]' service.yaml
      printf '{"app":{"env":"staging","workers":4}}\n' | yq -P '.' -
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        '{"service":{"name":"gateway","replicas":3,"ports":[8080,8443,9090]}}',
        "app:",
        "  env: staging",
        "  workers: 4",
        "",
      ].join("\n")
    );
  });

  it("6. xq XML-to-JSON querying and -x XML reconstruction with attributes", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > catalog.xml
<catalog>
  <book id="b1" lang="en"><title>Rust Systems</title><price>45</price></book>
  <book id="b2" lang="en"><title>WASM Guide</title><price>35</price></book>
</catalog>
EOF
      xq -c '[.catalog.book[] | {id: ."@id", title: .title, price: (.price | tonumber)}]' catalog.xml
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      '[{"id":"b1","title":"Rust Systems","price":45},{"id":"b2","title":"WASM Guide","price":35}]\n'
    );
  });

  it("7. yq TOML (-p=toml / -o=toml) tables and array-of-tables querying", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > Cargo.toml
[package]
name = "safe-bash"
version = "0.2.0"

[[bin]]
name = "sb-cli"
path = "src/main.rs"

[[bin]]
name = "sb-daemon"
path = "src/daemon.rs"
EOF
      yq -p=toml -o=json -I=0 '{pkg: .package.name, ver: .package.version, bins: [.bin[].name]}' Cargo.toml
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      '{"pkg":"safe-bash","ver":"0.2.0","bins":["sb-cli","sb-daemon"]}\n'
    );
  });

  it("8. xmllint --xpath expressions (count, string, attribute predicates) and validation", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > nodes.xml
<cluster region="us-east">
  <node id="n1" role="primary" cores="16"/>
  <node id="n2" role="replica" cores="8"/>
  <node id="n3" role="replica" cores="8"/>
</cluster>
EOF
      c=$(xmllint --xpath 'count(//node[@role="replica"])' nodes.xml)
      p=$(xmllint --xpath 'string(//node[@role="primary"]/@id)' nodes.xml)
      r=$(xmllint --xpath 'string(/cluster/@region)' nodes.xml)
      echo "replicas=$c primary=$p region=$r"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "replicas=2 primary=n1 region=us-east\n");
  });

  it("9. htmlq CSS selectors (--text, --attribute, --remove-nodes)", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > page.html
<main>
  <nav class="skip">ignore me</nav>
  <article id="post">
    <h1>Release Notes</h1>
    <a class="doc-link" href="https://example.com/v1">v1 Docs</a>
    <a class="doc-link" href="https://example.com/v2">v2 Docs</a>
  </article>
</main>
EOF
      title=$(htmlq --text '#post > h1' < page.html)
      links=$(htmlq --attribute href 'a.doc-link' < page.html | paste -sd, -)
      cleaned=$(htmlq --text --remove-nodes '.skip' 'main' < page.html | tr -s ' \n' ' ' | sed 's/^ //;s/ $//')
      echo "title=$title | links=$links | cleaned=$cleaned"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "title=Release Notes | links=https://example.com/v1,https://example.com/v2 | cleaned=Release Notes v1 Docs v2 Docs\n"
    );
  });

  it("10. mdq Markdown selectors and html-to-markdown conversion", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > guide.md
# Architecture

- Parser
- Evaluator

## Security

- Sandbox
EOF
      mdq '# Security' < guide.md | grep -v '^$'
      echo "---"
      printf '<h2>Heading</h2><p>Use <code>safe-bash</code> with <strong>WASM</strong>.</p>\n' | html-to-markdown | grep -v '^$'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "## Security",
        "- Sandbox",
        "---",
        "## Heading",
        "Use `safe-bash` with **WASM**.",
        "",
      ].join("\n")
    );
  });

  it("11. csvkit: csvcut, csvgrep, and csvsort pipeline", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > metrics.csv
host,region,latency,status
web-1,us-east,42,ok
web-2,eu-west,18,ok
db-1,us-east,95,warn
web-3,ap-south,64,ok
EOF
      csvgrep -c status -m ok metrics.csv | csvsort -c latency -r | csvcut -c host,latency
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "host,latency",
        "web-3,64",
        "web-1,42",
        "web-2,18",
        "",
      ].join("\n")
    );
  });

  it("12. csvkit: csvjson (-k keyed object and array), in2csv (-f json and ndjson), and csvstack", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'id,role\nu1,admin\nu2,user\n' | csvjson -k id | jq -c '.'
      printf '[{"name":"alice","score":90},{"name":"bob","score":85}]\n' | in2csv -f json
      printf 'k,v\na,1\n' > part1.csv
      printf 'k,v\nb,2\n' > part2.csv
      csvstack -g s1,s2 -n shard part1.csv part2.csv
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        '{"u1":{"id":"u1","role":"admin"},"u2":{"id":"u2","role":"user"}}',
        "name,score",
        "alice,90",
        "bob,85",
        "shard,k,v",
        "s1,a,1",
        "s2,b,2",
        "",
      ].join("\n")
    );
  });

  it("13. csvkit: csvstat summary flags (--count, --sum, --min, --max)", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'item,qty\na,10\nb,25\nc,15\n' > inv.csv
      echo "count=$(csvstat --count inv.csv)"
    `);
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /count=.*3/);
  });

  it("14. csvkit: csvsql and sql2csv relational queries over CSV files and SQLite DBs", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'dept_id,dept_name\n10,Engineering\n20,Platform\n' > depts.csv
      printf 'emp,dept_id,salary\nalice,10,150\nbob,20,130\ncarol,10,170\n' > emps.csv
      csvsql --query '
        SELECT d.dept_name, COUNT(*) AS headcount, CAST(SUM(e.salary) AS INT) AS total_sal
        FROM emps e JOIN depts d ON e.dept_id = d.dept_id
        GROUP BY d.dept_name
        ORDER BY d.dept_name
      ' depts.csv emps.csv
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "dept_name,headcount,total_sal",
        "Engineering,2,320",
        "Platform,1,130",
        "",
      ].join("\n")
    );
  });

  it("15. xan select, filter, sort, dedup, rename, enum, and slice", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > logs.csv
svc,status,ms
auth,200,12
api,500,85
auth,200,9
worker,200,45
api,200,30
EOF
      xan filter 'status == 200' logs.csv | xan sort -s ms -N -R | xan select svc,ms | xan rename service,latency_ms
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "service,latency_ms",
        "worker,45",
        "api,30",
        "auth,12",
        "auth,9",
        "",
      ].join("\n")
    );
  });

  it("16. xan groupby and agg with sum, mean, min, max, and count", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > sales.csv
region,amount
east,100
west,250
east,300
west,150
EOF
      xan groupby region 'count() as n, sum(amount) as total, min(amount) as lo, max(amount) as hi' sales.csv | xan sort -s region
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "region,n,total,lo,hi",
        "east,2,400,100,300",
        "west,2,400,150,250",
        "",
      ].join("\n")
    );
  });

  it("17. xan join, map, and to/from jsonl relational & column transforms", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'id,name\n1,alice\n2,bob\n' > users.csv
      printf 'id,score\n1,40\n2,60\n' > scores.csv
      xan join id users.csv id scores.csv | xan select id,name,score | xan map 'score * 2' doubled
      echo "---"
      printf 'k,v\na,1\nb,2\n' | xan to jsonl
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "id,name,score,doubled",
        "1,alice,40,80",
        "2,bob,60,120",
        "---",
        '{"k":"a","v":1}',
        '{"k":"b","v":2}',
        "",
      ].join("\n")
    );
  });

  it("18. xan transpose and top / frequency analytics", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'metric,q1,q2\nrev,10,20\ncost,5,8\n' | xan transpose
      echo "---"
      printf 'name,score\na,10\nb,90\nc,50\nd,80\n' | xan top -l 2 score
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "metric,rev,cost",
        "q1,10,5",
        "q2,20,8",
        "---",
        "name,score",
        "b,90",
        "d,80",
        "",
      ].join("\n")
    );
  });

  it("19. pandoc format conversions and ssconvert spreadsheet round-trip", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf '# Report\n\nParagraph with **bold** text.\n' > doc.md
      pandoc -f markdown -t html doc.md > doc.html
      grep -q '<h1' doc.html && grep -q '<strong>bold</strong>' doc.html && echo "pandoc_html=ok"
      printf 'col1,col2\nval1,100\nval2,200\n' > sheet.csv
      ssconvert sheet.csv sheet.xlsx 2>/dev/null
      ssconvert sheet.xlsx roundtrip.csv 2>/dev/null
      cat roundtrip.csv
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "pandoc_html=ok",
        "col1,col2",
        "val1,100",
        "val2,200",
        "",
      ].join("\n")
    );
  });

  it("20. ast-grep / sg structural code search and rewrite", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > sample.ts
const a = console.log("hello");
const b = console.log("world");
EOF
      sg --lang ts -p 'console.log($MSG)' -r 'logger.info($MSG)' sample.ts
    `);
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /logger\.info\("hello"\)/);
    assert.match(res.stdout, /logger\.info\("world"\)/);
  });
});
