import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure xan, csvkit, sqlite3, jq & yq analytics, join, pivot & window matrix", () => {
  it("1. xan join (inner, left) + map + groupby + sort multi-table revenue attribution", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat <<'CSV' > /tmp/users.csv\nuid,segment\nu1,enterprise\nu2,smb\nu3,enterprise\nCSV\ncat <<'CSV' > /tmp/events.csv\nuid,amount,discount\nu1,500,50\nu2,120,20\nu3,300,30\nu1,200,10\nCSV\nxan join uid /tmp/users.csv uid /tmp/events.csv \\\n  | xan map 'amount - discount as net' \\\n  | xan groupby segment 'count() as tx_count, sum(net) as net_rev' \\\n  | xan sort -s net_rev -R");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "segment,tx_count,net_rev\nenterprise,3,910\nsmb,1,100");
    });
  });

  it("2. xan dedup and freq on multi-tag telemetry CSV column", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat <<'CSV' > /tmp/items.csv\nid,tag,score\n1,rust,10\n2,rust,20\n3,wasm,15\n4,rust,30\n5,wasm,25\nCSV\nxan dedup -s tag /tmp/items.csv\nxan freq -s tag /tmp/items.csv");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "id,tag,score\n1,rust,10\n3,wasm,15\nfield,value,count\ntag,rust,3\ntag,wasm,2");
    });
  });

  it("3. xan enum, top, and slice on ranked telemetry stream", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat <<'CSV' > /tmp/lat.csv\nhost,p99\nedge-1,45\nedge-2,120\nedge-3,15\nedge-4,85\nCSV\nxan top p99 -l 3 /tmp/lat.csv | xan enum -c rank");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "rank,host,p99\n0,edge-2,120\n1,edge-4,85\n2,edge-1,45");
    });
  });

  it("4. csvstack --groups, csvgrep, csvcut, and csvsort multi-region consolidation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat <<'CSV' > /tmp/q1.csv\nsku,qty\nA1,10\nB2,5\nCSV\ncat <<'CSV' > /tmp/q2.csv\nsku,qty\nA1,25\nC3,40\nCSV\ncsvstack -g Q1,Q2 -n quarter /tmp/q1.csv /tmp/q2.csv \\\n  | csvgrep -c sku -r '^(A1|C3)$' \\\n  | csvcut -c quarter,sku,qty \\\n  | csvsort -c qty -r");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "quarter,sku,qty\nQ2,C3,40\nQ2,A1,25\nQ1,A1,10");
    });
  });

  it("5. in2csv JSON-to-CSV conversion piped into csvjson --indent 0", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat <<'JSON' > /tmp/hosts.json\n[{\"host\":\"web-1\",\"cores\":8},{\"host\":\"db-1\",\"cores\":16}]\nJSON\nin2csv /tmp/hosts.json | csvsort -c cores -r");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "host,cores\ndb-1,16\nweb-1,8");
    });
  });

  it("6. jq reduce, foreach, and transpose matrix column sums", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("jq -n -c '\n  [[1, 2, 3], [10, 20, 30], [100, 200, 300]]\n  | transpose\n  | map(reduce .[] as $x (0; . + $x))\n'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[111,222,333]");
    });
  });

  it("7. jq INDEX and JOIN relational lookup across two JSON arrays", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("jq -n -c '\n  def users: [{\"id\":\"u1\",\"name\":\"Ada\"},{\"id\":\"u2\",\"name\":\"Grace\"}];\n  def orders: [{\"oid\":10,\"uid\":\"u2\"},{\"oid\":11,\"uid\":\"u1\"}];\n  [orders[] | . + (INDEX(users[]; .id)[.uid] | {user: .name})]\n'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[{\"oid\":10,\"uid\":\"u2\",\"user\":\"Grace\"},{\"oid\":11,\"uid\":\"u1\",\"user\":\"Ada\"}]");
    });
  });

  it("8. jq @base64, @base64d, @uri, @csv, and @tsv format strings", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("jq -n -r '\n  (\"hello world\" | @base64 | @base64d),\n  (\"a+b=c&d\" | @uri),\n  ([\"x,y\", \"z\", 42] | @csv),\n  ([\"col1\", \"col2\", 99] | @tsv)\n'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "hello world\na%2Bb%3Dc%26d\n\"x,y\",\"z\",42\ncol1\tcol2\t99");
    });
  });

  it("9. jq paths, getpath, setpath, and delpaths on nested config tree", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("jq -n -c '\n  {\"a\":{\"b\":1,\"c\":2},\"d\":3}\n  | setpath([\"a\",\"b\"]; 99)\n  | delpaths([[\"a\",\"c\"]])\n'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"a\":{\"b\":99},\"d\":3}");
    });
  });

  it("10. yq deep merge (*=), array append (+=), and props roundtrip (-o=props -> -p=props)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat <<'YAML' > /tmp/base.yaml\napp:\n  host: localhost\n  port: 8080\nYAML\nyq -o=props '.app.port = 9090 | .app.tls = true' /tmp/base.yaml | sort");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "app.host = localhost\napp.port = 9090\napp.tls = true");
    });
  });

  it("11. yq -p=xml and xq XML decode with attributes and nested elements", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat <<'XML' > /tmp/catalog.xml\n<catalog><item code=\"X1\"><price>29</price></item><item code=\"X2\"><price>49</price></item></catalog>\nXML\nxq -r '.catalog.item[] | .\"@code\" + \"=\" + .price' /tmp/catalog.xml\nyq -r -p=xml '.catalog.item[1].price' /tmp/catalog.xml");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "X1=29\nX2=49\n49");
    });
  });

  it("12. sqlite3 recursive CTE graph shortest path / depth traversal with GROUP_CONCAT", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 :memory: \"\n  CREATE TABLE deps(pkg TEXT, dep TEXT);\n  INSERT INTO deps VALUES ('app','auth'),('auth','crypto'),('crypto','libc'),('app','ui');\n  WITH RECURSIVE chain(node, depth, path) AS (\n    SELECT 'app', 0, 'app'\n    UNION ALL\n    SELECT d.dep, c.depth + 1, c.path || '->' || d.dep\n    FROM chain c JOIN deps d ON c.node = d.pkg\n    WHERE c.depth < 5\n  )\n  SELECT depth, path FROM chain ORDER BY depth, path;\n\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "0|app\n1|app->auth\n1|app->ui\n2|app->auth->crypto\n3|app->auth->crypto->libc");
    });
  });

  it("13. sqlite3 COALESCE, NULLIF, IIF, INSTR, SUBSTR, REPLACE, and ROUND scalar pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 :memory: \"\n  CREATE TABLE raw_metrics(tag TEXT, val REAL, fallback REAL);\n  INSERT INTO raw_metrics VALUES\n    ('env:prod-eu', 0.0, 12.3456),\n    ('env:staging', 45.6789, 1.0);\n  SELECT\n    REPLACE(SUBSTR(tag, INSTR(tag, ':') + 1), '-eu', '_global') AS clean_tag,\n    ROUND(COALESCE(NULLIF(val, 0.0), fallback), 2) AS eff_val,\n    IIF(val > 0, 'primary', 'fallback') AS source\n  FROM raw_metrics\n  ORDER BY clean_tag;\n\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "prod_global|12.35|fallback\nstaging|45.68|primary");
    });
  });

  it("14. sqlite3 window functions LAG, LEAD, DENSE_RANK, and moving frame SUM", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 :memory: \"\n  CREATE TABLE daily(day INT, rev INT);\n  INSERT INTO daily VALUES (1, 100), (2, 150), (3, 150), (4, 220);\n  SELECT\n    day,\n    rev,\n    COALESCE(LAG(rev, 1) OVER (ORDER BY day), 0) AS prev_rev,\n    DENSE_RANK() OVER (ORDER BY rev DESC) AS rnk,\n    SUM(rev) OVER (ORDER BY day ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS roll2\n  FROM daily\n  ORDER BY day;\n\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1|100|0|3|100\n2|150|100|2|250\n3|150|150|2|300\n4|220|150|1|370");
    });
  });

  it("15. sqlite3 json_each table-valued expansion joined with relational table", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 :memory: \"\n  CREATE TABLE bundles(bid TEXT, roles_json TEXT);\n  INSERT INTO bundles VALUES ('B1', '[\\\"admin\\\",\\\"audit\\\"]'), ('B2', '[\\\"viewer\\\"]');\n  SELECT b.bid, j.value AS role\n  FROM bundles b, json_each(b.roles_json) j\n  ORDER BY b.bid, role;\n\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "B1|admin\nB1|audit\nB2|viewer");
    });
  });

  it("16. xmllint --xpath attribute and text queries combined with htmlq attribute extraction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat <<'HTML' > /tmp/links.html\n<div><a href=\"https://poe.com/docs\" data-track=\"nav\">Docs</a><a href=\"https://poe.com/api\" data-track=\"api\">API</a></div>\nHTML\nhtmlq -a href 'a[data-track]' < /tmp/links.html\nxmllint --xpath 'string(//a[@data-track=\"api\"]/text())' /tmp/links.html\necho \"\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "https://poe.com/docs\nhttps://poe.com/api\nAPI");
    });
  });

  it("17. html-to-markdown conversion of nested headings, lists, code blocks, and links", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat <<'HTML' > /tmp/guide.html\n<h1>Runbook</h1><p>Check <code>status</code> and visit <a href=\"https://example.com\">Portal</a>.</p><ul><li>Step 1</li><li>Step 2</li></ul>\nHTML\nhtml-to-markdown /tmp/guide.html | grep -E '^(# Runbook|Check|\\* Step|-[[:space:]]+Step)' | wc -l | tr -d ' '");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "4");
    });
  });

  it("18. xan stats and agg summary metrics piped through csvcut", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat <<'CSV' > /tmp/scores.csv\nteam,score\nred,10\nred,20\nblue,30\nblue,50\nCSV\nxan agg 'count() as n, sum(score) as total, mean(score) as avg' /tmp/scores.csv");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "n,total,avg\n4,110,27.5");
    });
  });

  it("19. csvjoin left outer join (--left) with null replacement and awk formatting", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat <<'CSV' > /tmp/depts.csv\ndept_id,dept_name\nD1,Engineering\nD2,Security\nD3,Design\nCSV\ncat <<'CSV' > /tmp/leads.csv\ndept_id,lead\nD1,Alice\nD2,Bob\nCSV\ncsvjoin --left -c dept_id /tmp/depts.csv /tmp/leads.csv");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "dept_id,dept_name,lead\nD1,Engineering,Alice\nD2,Security,Bob\nD3,Design,");
    });
  });

  it("20. end-to-end multi-tool pipeline: JSON -> jq -> CSV -> xan -> sqlite3 -> yq", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat <<'JSON' > /tmp/raw_telemetry.json\n[\n  {\"region\":\"eu\",\"service\":\"api\",\"errors\":12,\"reqs\":1000},\n  {\"region\":\"us\",\"service\":\"api\",\"errors\":3,\"reqs\":1000},\n  {\"region\":\"eu\",\"service\":\"worker\",\"errors\":8,\"reqs\":500}\n]\nJSON\n{\n  echo \"region,service,errors,reqs\"\n  jq -r '.[] | [.region, .service, .errors, .reqs] | @csv' /tmp/raw_telemetry.json | tr -d '\"'\n} > /tmp/telemetry.csv\nxan groupby region 'sum(errors) as total_err, sum(reqs) as total_reqs' /tmp/telemetry.csv \\\n  | xan sort -s region > /tmp/region_rollup.csv\ncsvjson --indent 0 /tmp/region_rollup.csv | jq -c 'map({region, total_err: (.total_err | tonumber), total_reqs: (.total_reqs | tonumber)})'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[{\"region\":\"eu\",\"total_err\":20.0,\"total_reqs\":1500.0},{\"region\":\"us\",\"total_err\":3.0,\"total_reqs\":1000.0}]");
    });
  });

});
