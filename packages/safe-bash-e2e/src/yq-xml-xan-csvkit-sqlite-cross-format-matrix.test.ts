import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { xanCommands } from "@poe-platform/safe-bash/commands/xan";
import { withE2EHarness } from "./harness.js";

describe("safe-bash e2e: yq, xml, htmlq, xan, csvkit, jq, and sqlite3 cross-format matrix", () => {
  it("1. evaluates yq YAML anchors, aliases, and multi-document streams", async () => {
    await withE2EHarness(
      {
        files: {
          "/cfg/deploy.yaml": [
            "defaults: &base { retries: 3, timeout_ms: 1500 }",
            "staging:",
            "  policy: *base",
            "  replicas: 2",
            "production:",
            "  policy: *base",
            "  replicas: 8",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.expectOk(
          "yq -o json '{staging: .staging, production: .production}' /cfg/deploy.yaml | jq -c .",
        );
        const parsed = JSON.parse(r.stdout);
        assert.deepEqual(parsed, {
          staging: { policy: { retries: 3, timeout_ms: 1500 }, replicas: 2 },
          production: { policy: { retries: 3, timeout_ms: 1500 }, replicas: 8 },
        });
      },
    );
  });

  it("2. performs YAML config mutations via yq -> jq -> yq + sponge", async () => {
    await withE2EHarness(
      {
        files: {
          "/cfg/app.yaml": [
            "app:",
            "  name: worker",
            "  replicas: 2",
            "  tags:",
            "    - v1",
            "  legacy_flag: true",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        await h.expectOk(
          'yq -o json \'.\' /cfg/app.yaml | jq \'.app.replicas |= . * 3 | .app.tags += ["v2", "prod"] | del(.app.legacy_flag)\' | yq -o yaml \'.\' | sponge /cfg/app.yaml',
        );
        const r = await h.expectOk("yq -o json '.' /cfg/app.yaml | jq -c .");
        assert.deepEqual(JSON.parse(r.stdout), {
          app: {
            name: "worker",
            replicas: 6,
            tags: ["v1", "v2", "prod"],
          },
        });
      },
    );
  });

  it("3. converts TOML to JSON and YAML via yq -p toml across nested tables and array-of-tables", async () => {
    await withE2EHarness(
      {
        files: {
          "/toml/Cargo.toml": [
            "[package]",
            'name = "safe-shell"',
            'version = "0.4.0"',
            "",
            "[[bin]]",
            'name = "sbash"',
            'path = "src/main.rs"',
            "",
            "[[bin]]",
            'name = "sbashd"',
            'path = "src/daemon.rs"',
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.expectOk(
          "yq -p toml -o json '.' /toml/Cargo.toml | jq -r '.package.name + \":\" + (.bin | map(.name) | join(\",\"))'",
        );
        assert.equal(r.stdout, "safe-shell:sbash,sbashd\n");
      },
    );
  });

  it("4. queries XML attributes, nested elements, and text nodes using xq and xmllint --xpath", async () => {
    await withE2EHarness(
      {
        files: {
          "/xml/inventory.xml": [
            '<?xml version="1.0" encoding="UTF-8"?>',
            "<warehouse>",
            '  <item sku="A100" active="true"><name>Keyboard</name><stock>45</stock></item>',
            '  <item sku="B200" active="false"><name>Mouse</name><stock>0</stock></item>',
            '  <item sku="C300" active="true"><name>Monitor</name><stock>12</stock></item>',
            "</warehouse>",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const rXq = await h.expectOk(
          'xq -r \'.warehouse.item[] | select(."@active" == "true") | "\\(."@sku"):\\(.name):\\(.stock)"\' /xml/inventory.xml',
        );
        assert.equal(rXq.stdout, "A100:Keyboard:45\nC300:Monitor:12\n");

        const rXpath = await h.expectOk(
          'xmllint --xpath \'string(//item[@sku="C300"]/name)\' /xml/inventory.xml',
        );
        assert.equal(rXpath.stdout.trim(), "Monitor");
      },
    );
  });

  it("5. extracts structured content and strips nodes from HTML documents using htmlq and html-to-markdown", async () => {
    await withE2EHarness(
      {
        files: {
          "/web/page.html": [
            "<!doctype html>",
            "<html><body>",
            "  <nav class='sidebar'><a href='/ignore'>Skip</a></nav>",
            "  <main>",
            "    <h1>Release Notes</h1>",
            "    <ul class='items'>",
            "      <li data-id='101'><span class='title'>Fast Grep</span><span class='noise'>ad</span></li>",
            "      <li data-id='102'><span class='title'>Zero Dep Tar</span></li>",
            "    </ul>",
            "  </main>",
            "</body></html>",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const rText = await h.expectOk(
          "htmlq --remove-nodes '.noise' --text 'ul.items li' < /web/page.html | tr -s '\\n'",
        );
        assert.equal(rText.stdout.trim(), "Fast Grep\nZero Dep Tar");

        const rAttrs = await h.expectOk(
          "htmlq --attributes data-id 'ul.items li' < /web/page.html",
        );
        assert.equal(rAttrs.stdout, "101\n102\n");

        const rMd = await h.expectOk("htmlq 'main' < /web/page.html | html-to-markdown");
        assert.match(rMd.stdout, /# Release Notes/);
        assert.match(rMd.stdout, /Zero Dep Tar/);
      },
    );
  });

  it("6. inspects headers across CSV, TSV, PSV, and SSV files with xan headers (-j, --csv, -s)", async () => {
    await withE2EHarness(
      {
        files: {
          "/xan/a.csv": "id,user,score\n1,alice,90\n",
          "/xan/b.tsv": "id\tuser\tregion\n1\talice\tus\n",
          "/xan/c.psv": "id|user|active\n1|alice|true\n",
          "/xan/d.ssv": "id;user;role\n1;alice;admin\n",
        },
      },
      async (h) => {
        const rJustNames = await h.expectOk("xan headers -j /xan/b.tsv");
        assert.equal(rJustNames.stdout, "id\nuser\nregion\n");

        const rPsv = await h.expectOk("xan headers -j -s 10 /xan/c.psv");
        assert.equal(rPsv.stdout, "id\nuser\nactive\n");

        const rCsvMulti = await h.expectOk("xan headers --csv /xan/a.csv /xan/d.ssv");
        assert.match(rCsvMulti.stdout, /id/);
        assert.match(rCsvMulti.stdout, /score/);
        assert.match(rCsvMulti.stdout, /role/);
      },
    );
  });

  it("7. counts CSV rows with xan count (-n, -H) and detects misaligned CSV records with -c (--check-alignment)", async () => {
    await withE2EHarness(
      {
        files: {
          "/xan/valid.csv": "a,b,c\n1,2,3\n4,5,6\n7,8,9\n",
          "/xan/jagged.csv": "a,b,c\n1,2,3\n4,5\n7,8,9\n",
        },
      },
      async (h) => {
        const rValid = await h.expectOk("xan count -c /xan/valid.csv");
        assert.equal(rValid.stdout, "3\n");

        const rNoHeaders = await h.expectOk("xan count -n /xan/valid.csv");
        assert.equal(rNoHeaders.stdout, "4\n");

        const rJagged = await h.exec("xan count -c /xan/jagged.csv");
        assert.notEqual(rJagged.exitCode, 0);
        assert.match(rJagged.stderr, /found record with 2 fields, but the previous record has 3 fields/);
      },
    );
  });

  it("8. selects, reorders, and excludes CSV columns with xan select ranges, globs, and numeric indices", async () => {
    await withE2EHarness(
      {
        files: {
          "/xan/metrics.csv": [
            "host,secret_token,metric_cpu,metric_mem,region",
            "web-1,tok_abc,42,68,us-east",
            "web-2,tok_def,19,51,eu-west",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const rGlob = await h.expectOk("xan select 'host,metric_*,region' /xan/metrics.csv");
        assert.equal(
          rGlob.stdout,
          [
            "host,metric_cpu,metric_mem,region",
            "web-1,42,68,us-east",
            "web-2,19,51,eu-west",
            "",
          ].join("\n"),
        );

        const rExclude = await h.expectOk("xan select '!secret_token' /xan/metrics.csv");
        assert.equal(rExclude.stdout, rGlob.stdout);

        const rReverse = await h.expectOk("xan select '4,0' /xan/metrics.csv");
        assert.equal(
          rReverse.stdout,
          [
            "region,host",
            "us-east,web-1",
            "eu-west,web-2",
            "",
          ].join("\n"),
        );
      },
    );
  });

  it("9. slices CSV streams with xan slice (-s, -l, -i, -I, -L ring buffer, and -S/-E start/end conditions)", async () => {
    await withE2EHarness(
      {
        plugins: [xanCommands({ replace: true, limits: { maxLastRows: 100 } })],
        files: {
          "/xan/events.csv": [
            "seq,stage,val",
            "10,init,a",
            "20,warmup,b",
            "30,steady,c",
            "40,steady,d",
            "50,cooldown,e",
            "60,done,f",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const rIndices = await h.expectOk("xan slice -I 0,2,4 /xan/events.csv");
        assert.equal(
          rIndices.stdout,
          [
            "seq,stage,val",
            "10,init,a",
            "30,steady,c",
            "50,cooldown,e",
            "",
          ].join("\n"),
        );

        const rLast = await h.expectOk("xan slice -L 2 /xan/events.csv");
        assert.equal(
          rLast.stdout,
          [
            "seq,stage,val",
            "50,cooldown,e",
            "60,done,f",
            "",
          ].join("\n"),
        );

        const rCond = await h.expectOk(
          "xan slice -S 'stage == \"steady\"' -E 'stage == \"cooldown\"' /xan/events.csv",
        );
        assert.equal(
          rCond.stdout,
          [
            "seq,stage,val",
            "30,steady,c",
            "40,steady,d",
            "",
          ].join("\n"),
        );
      },
    );
  });

  it("10. converts JSON arrays and NDJSON streams into CSV using in2csv", async () => {
    await withE2EHarness(
      {
        files: {
          "/csvkit/users.json": JSON.stringify([
            { id: 1, name: "Alice", active: true },
            { id: 2, name: "Bob", active: false },
          ]),
          "/csvkit/events.ndjson": [
            '{"ts":100,"type":"click","user":"Alice"}',
            '{"ts":200,"type":"purchase","user":"Bob"}',
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const rJson = await h.expectOk("in2csv /csvkit/users.json");
        assert.equal(
          rJson.stdout,
          [
            "id,name,active",
            "1,Alice,True",
            "2,Bob,False",
            "",
          ].join("\n"),
        );

        const rNdjson = await h.expectOk("in2csv -f ndjson /csvkit/events.ndjson");
        assert.equal(
          rNdjson.stdout,
          [
            "ts,type,user",
            "100,click,Alice",
            "200,purchase,Bob",
            "",
          ].join("\n"),
        );
      },
    );
  });

  it("11. filters and projects CSV records with csvgrep (-m, -r regex, -i invert) and csvcut (-c, -C exclude)", async () => {
    await withE2EHarness(
      {
        files: {
          "/csvkit/logs.csv": [
            "req_id,service,status,latency_ms,debug_token",
            "r1,auth-api,200,12,tok1",
            "r2,billing-worker,503,450,tok2",
            "r3,auth-worker,500,310,tok3",
            "r4,edge-proxy,200,4,tok4",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.expectOk(
          "csvgrep -c status -r '^5[0-9]{2}$' /csvkit/logs.csv | csvcut -C debug_token",
        );
        assert.equal(
          r.stdout,
          [
            "req_id,service,status,latency_ms",
            "r2,billing-worker,503,450",
            "r3,auth-worker,500,310",
            "",
          ].join("\n"),
        );
      },
    );
  });

  it("12. joins, stacks, and sorts multi-table CSV datasets with csvjoin, csvstack, and csvsort", async () => {
    await withE2EHarness(
      {
        files: {
          "/csvkit/us.csv": "id,rev\n1,300\n2,150\n",
          "/csvkit/eu.csv": "id,rev\n3,450\n",
          "/csvkit/accounts.csv": "id,owner\n1,Alice\n2,Bob\n3,Clara\n",
        },
      },
      async (h) => {
        const r = await h.expectOk(
          "csvstack -g US,EU -n region /csvkit/us.csv /csvkit/eu.csv | csvjoin -c id - /csvkit/accounts.csv | csvsort -c rev -r",
        );
        assert.equal(
          r.stdout,
          [
            "region,id,rev,owner",
            "EU,3,450,Clara",
            "US,1,300,Alice",
            "US,2,150,Bob",
            "",
          ].join("\n"),
        );
      },
    );
  });

  it("13. converts CSV to keyed JSON objects and NDJSON streams with csvjson (-k, --stream, -i)", async () => {
    await withE2EHarness(
      {
        files: {
          "/csvkit/nodes.csv": "node_id,cores,healthy\nn1,8,true\nn2,16,false\n",
        },
      },
      async (h) => {
        const rKeyed = await h.expectOk("csvjson -k node_id /csvkit/nodes.csv | jq -c .");
        const obj = JSON.parse(rKeyed.stdout);
        assert.equal(obj.n1.cores, 8);
        assert.equal(obj.n1.healthy, true);
        assert.equal(obj.n2.cores, 16);
        assert.equal(obj.n2.healthy, false);

        const rStream = await h.expectOk("csvjson --stream /csvkit/nodes.csv | wc -l");
        assert.equal(rStream.stdout.trim(), "2");
      },
    );
  });

  it("14. computes CSV column statistics with csvstat (--count, --sum, --min, --max, --mean, --median, --csv)", async () => {
    await withE2EHarness(
      {
        files: {
          "/csvkit/scores.csv": "student,score\nA,10\nB,20\nC,30\nD,40\nE,50\n",
        },
      },
      async (h) => {
        const rCount = await h.expectOk("csvstat --count /csvkit/scores.csv");
        assert.match(rCount.stdout, /5/);

        const rCsv = await h.expectOk(
          "csvstat --csv /csvkit/scores.csv | csvgrep -c column_name -m score | csvcut -c min,max,sum,mean,median",
        );
        const lines = rCsv.stdout.trim().split("\n");
        assert.equal(lines[0], "min,max,sum,mean,median");
        assert.match(lines[1]!, /^10(\.0+)?,50(\.0+)?,150(\.0+)?,30(\.0+)?,30(\.0+)?$/);
      },
    );
  });

  it("15. reformats CSV dialects with csvformat (-D, -T, -U) and renders tables with csvlook", async () => {
    await withE2EHarness(
      {
        files: {
          "/csvkit/dialect.csv": "col1,col2\nhello,world\nfoo,bar\n",
        },
      },
      async (h) => {
        const rPipe = await h.expectOk("csvformat -D '|' /csvkit/dialect.csv");
        assert.equal(rPipe.stdout, "col1|col2\nhello|world\nfoo|bar\n");

        const rTab = await h.expectOk("csvformat -T /csvkit/dialect.csv");
        assert.equal(rTab.stdout, "col1\tcol2\nhello\tworld\nfoo\tbar\n");

        const rLook = await h.expectOk("csvlook /csvkit/dialect.csv");
        assert.match(rLook.stdout, /\|\s*col1\s*\|\s*col2\s*\|/);
        assert.match(rLook.stdout, /\|\s*hello\s*\|\s*world\s*\|/);
      },
    );
  });

  it("16. imports CSV into sqlite3, runs analytical window queries, and exports JSON via sqlite3 -json", async () => {
    await withE2EHarness(
      {
        files: {
          "/sql/sales.csv": [
            "region,rep,amount",
            "us,alice,500",
            "us,bob,700",
            "eu,clara,900",
            "eu,dave,300",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const script = [
          "tail -n +2 /sql/sales.csv > /sql/sales_rows.csv",
          "sqlite3 /workspace/analytics.db <<'SQL'",
          "CREATE TABLE sales (region TEXT, rep TEXT, amount INTEGER);",
          ".mode csv",
          ".import /sql/sales_rows.csv sales",
          "SQL",
          "sqlite3 -json /workspace/analytics.db \"SELECT region, rep, CAST(amount AS INTEGER) AS amount, RANK() OVER (PARTITION BY region ORDER BY CAST(amount AS INTEGER) DESC) AS rnk FROM sales ORDER BY region, rnk;\" | jq -c .",
        ].join("\n");
        const r = await h.expectOk(script);
        const rows = JSON.parse(r.stdout);
        assert.deepEqual(rows, [
          { region: "eu", rep: "clara", amount: 900, rnk: 1 },
          { region: "eu", rep: "dave", amount: 300, rnk: 2 },
          { region: "us", rep: "bob", amount: 700, rnk: 1 },
          { region: "us", rep: "alice", amount: 500, rnk: 2 },
        ]);
      },
    );
  });

  it("17. roundtrips YAML -> JSON -> CSV -> JSON -> YAML across yq, in2csv, csvjson, and jq", async () => {
    await withE2EHarness(
      {
        files: {
          "/rt/services.yaml": [
            "- id: s1",
            "  port: 8080",
            "  tier: edge",
            "- id: s2",
            "  port: 9090",
            "  tier: core",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.expectOk(
          "yq -o json '.' /rt/services.yaml | in2csv -f json | csvsort -c port -r | csvjson | yq -o yaml '.'",
        );
        const verify = await h.expectOk(
          `cat <<'EOF' | yq -o json '.' | jq -c .\n${r.stdout}EOF`,
        );
        assert.deepEqual(JSON.parse(verify.stdout), [
          { id: "s2", port: 9090, tier: "core" },
          { id: "s1", port: 8080, tier: "edge" },
        ]);
      },
    );
  });

  it("18. executes jq complex functional queries with def, reduce, map, and sort_by", async () => {
    await withE2EHarness(
      {
        files: {
          "/jq/data.json": JSON.stringify({
            departments: [
              { id: "d1", name: "Platform" },
              { id: "d2", name: "Security" },
            ],
            engineers: [
              { name: "Ada", dept_id: "d1", commits: [12, 8, 15] },
              { name: "Grace", dept_id: "d2", commits: [20, 10] },
              { name: "Linus", dept_id: "d1", commits: [5, 10] },
            ],
          }),
        },
      },
      async (h) => {
        const query = [
          "def sum_list(s): reduce s[] as $x (0; . + $x);",
          "reduce .departments[] as $d ({}; .[$d.id] = $d.name) as $depts",
          "| [ .engineers[] | { engineer: .name, dept: $depts[.dept_id], total_commits: sum_list(.commits) } ]",
          "| sort_by(-.total_commits)",
        ].join(" ");
        const r = await h.expectOk(`jq -c '${query}' /jq/data.json`);
        assert.deepEqual(JSON.parse(r.stdout), [
          { engineer: "Ada", dept: "Platform", total_commits: 35 },
          { engineer: "Grace", dept: "Security", total_commits: 30 },
          { engineer: "Linus", dept: "Platform", total_commits: 15 },
        ]);
      },
    );
  });

  it("19. validates and repairs broken CSV records with csvclean and queries via xan", async () => {
    await withE2EHarness(
      {
        files: {
          "/clean/messy.csv": [
            "id,name,amount",
            "1,Alice,100",
            "2,Bob,200,EXTRA_COL",
            "3,Charlie,300",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const rDryRun = await h.exec("csvclean --length-mismatch -n /clean/messy.csv");
        assert.notEqual(rDryRun.exitCode, 0);

        const rClean = await h.exec(
          "csvclean --length-mismatch --omit-error-rows /clean/messy.csv > /clean/messy_out.csv",
        );
        assert.equal(rClean.exitCode, 1);
        assert.match(rClean.stderr, /Expected 3 columns, found 4 columns/);

        const rCleaned = await h.expectOk("xan select name,amount /clean/messy_out.csv");
        assert.equal(
          rCleaned.stdout,
          [
            "name,amount",
            "Alice,100",
            "Charlie,300",
            "",
          ].join("\n"),
        );
      },
    );
  });

  it("20. executes a 6-format data engineering pipeline: HTML + XML + YAML -> JSON -> CSV -> SQLite -> YAML summary", async () => {
    await withE2EHarness(
      {
        files: {
          "/pipe/quotas.yaml": [
            "tiers:",
            "  critical: 1000",
            "  standard: 250",
            "",
          ].join("\n"),
          "/pipe/services.xml": [
            "<catalog>",
            '  <svc id="auth" tier="critical"><owner>sec-team</owner></svc>',
            '  <svc id="search" tier="standard"><owner>core-team</owner></svc>',
            '  <svc id="payments" tier="critical"><owner>fin-team</owner></svc>',
            "</catalog>",
            "",
          ].join("\n"),
          "/pipe/usage.html": [
            "<ul>",
            '  <li data-svc="auth">820</li>',
            '  <li data-svc="search">190</li>',
            '  <li data-svc="payments">950</li>',
            "</ul>",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const script = [
          "yq -o json '.' /pipe/quotas.yaml > /pipe/quotas.json",
          "xq -c '.catalog.svc[] | {id: .\"@id\", tier: .\"@tier\", owner: .owner}' /pipe/services.xml | in2csv -f ndjson > /pipe/services.csv",
          "paste -d, <(htmlq --attributes data-svc 'li' < /pipe/usage.html) <(htmlq --text 'li' < /pipe/usage.html) | (echo 'id,used' && cat) > /pipe/usage.csv",
          "csvjoin -c id /pipe/services.csv /pipe/usage.csv > /pipe/merged.csv",
          "tail -n +2 /pipe/merged.csv > /pipe/merged_rows.csv",
          "sqlite3 /pipe/report.db <<'SQL'",
          "CREATE TABLE merged (id TEXT, tier TEXT, owner TEXT, used INTEGER);",
          ".mode csv",
          ".import /pipe/merged_rows.csv merged",
          "SQL",
          "sqlite3 -json /pipe/report.db 'SELECT id, tier, owner, CAST(used AS INTEGER) AS used FROM merged ORDER BY CAST(used AS INTEGER) DESC;' \\",
          "  | jq --slurpfile q /pipe/quotas.json 'map(. + {quota: $q[0].tiers[.tier], utilization_pct: ((.used * 100) / $q[0].tiers[.tier])})' \\",
          "  | yq -o yaml '.' > /pipe/final_report.yaml",
          "yq -o json '.' /pipe/final_report.yaml | jq -c .",
        ].join("\n");
        const r = await h.expectOk(script);
        const report = JSON.parse(r.stdout);
        assert.deepEqual(report, [
          { id: "payments", tier: "critical", owner: "fin-team", used: 950, quota: 1000, utilization_pct: 95 },
          { id: "auth", tier: "critical", owner: "sec-team", used: 820, quota: 1000, utilization_pct: 82 },
          { id: "search", tier: "standard", owner: "core-team", used: 190, quota: 250, utilization_pct: 76 },
        ]);
      },
    );
  });
});
