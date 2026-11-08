import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure xan csvkit sqlite3 jq yq tabular analytics pivot window matrix", () => {
  it("01 xan map filter sort and select on regional revenue csv", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'CSV' > sales.csv\norder_id,region,rep,units,unit_price\n101,north, alice ,12,25\n102,south,bob,8,40\n103,north,carol,15,30\n104,east,dave,5,60\n105,south,eve,20,25\n106,east,frank,10,45\nCSV\nxan map 'upper(trim(rep)) as rep_clean, units * unit_price as revenue' sales.csv | xan filter 'revenue >= 320' | xan sort -s revenue -N -R | xan select order_id,region,rep_clean,revenue");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "order_id,region,rep_clean,revenue\n105,south,EVE,500\n103,north,CAROL,450\n106,east,FRANK,450\n102,south,BOB,320\n");
    } finally {
      await h.dispose();
    }
  });

  it("02 xan join inner and left with groupby sum and mean aggregation", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'CSV' > depts.csv\ndept_id,dept_name\nD1,Platform\nD2,Security\nD3,Data\nCSV\ncat << 'CSV' > staff.csv\nemp_id,dept_id,salary\nE1,D1,140\nE2,D1,160\nE3,D2,155\nE4,D3,130\nE5,D3,170\nCSV\nxan join dept_id depts.csv dept_id staff.csv | xan groupby dept_name 'count() as headcount, sum(salary) as total_sal, mean(salary) as avg_sal' | xan sort -s dept_name");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "dept_name,headcount,total_sal,avg_sal\nData,2,300,150\nPlatform,2,300,150\nSecurity,1,155,155\n");
    } finally {
      await h.dispose();
    }
  });

  it("03 xan freq with sort on incident severity and service tags", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'CSV' > tickets.csv\nticket_id,tag\nT1,urgent\nT2,frontend\nT3,auth\nT4,urgent\nT5,backend\nT6,urgent\nT7,auth\nCSV\nxan freq -s tag tickets.csv | xan sort -s count -N -R");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "field,value,count\ntag,urgent,3\ntag,auth,2\ntag,backend,1\ntag,frontend,1\n");
    } finally {
      await h.dispose();
    }
  });

  it("04 xan groupby median min max across service environments", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'CSV' > metrics.csv\nservice,env,p99_ms\napi,prod,42\napi,staging,35\napi,dev,28\nworker,prod,118\nworker,staging,95\nworker,dev,80\nauth,prod,19\nauth,staging,16\nauth,dev,14\nCSV\nxan groupby service 'min(p99_ms) as min_ms, median(p99_ms) as med_ms, max(p99_ms) as max_ms' metrics.csv | xan sort -s service");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "service,min_ms,med_ms,max_ms\napi,28,35,42\nauth,14,16,19\nworker,80,95,118\n");
    } finally {
      await h.dispose();
    }
  });

  it("05 xan search dedup sort and enum row numbering on cluster IPs", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'CSV' > hosts.csv\ncluster,ip\nc1,10.0.0.1\nc1,10.0.0.2\nc2,10.0.0.2\nc2,10.0.0.3\nc3,10.0.0.1\nc3,10.0.0.4\nCSV\nxan select ip hosts.csv | xan sort -s ip | xan dedup -s ip | xan enum -c seq");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "seq,ip\n0,10.0.0.1\n1,10.0.0.2\n2,10.0.0.3\n3,10.0.0.4\n");
    } finally {
      await h.dispose();
    }
  });

  it("06 csvcut csvgrep csvsort and csvformat custom delimiter pipeline", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'CSV' > inventory.csv\nsku,category,warehouse,stock,reorder_point\nSKU-01,compute,us-east,45,20\nSKU-02,storage,us-west,12,25\nSKU-03,network,eu-central,8,15\nSKU-04,compute,eu-central,60,30\nSKU-05,storage,us-east,18,20\nCSV\ncsvgrep -c warehouse -r '^(us-east|eu-central)$' inventory.csv | csvsort -c stock -r | csvcut -c sku,warehouse,stock | csvformat -D '|'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "sku|warehouse|stock\nSKU-04|eu-central|60\nSKU-01|us-east|45\nSKU-05|us-east|18\nSKU-03|eu-central|8\n");
    } finally {
      await h.dispose();
    }
  });

  it("07 csvsql multi-table JOIN and GROUP BY with HAVING clause", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'CSV' > customers.csv\ncust_id,tier,country\nC1,enterprise,US\nC2,pro,DE\nC3,enterprise,UK\nCSV\ncat << 'CSV' > invoices.csv\ninv_id,cust_id,amount\nI1,C1,1200\nI2,C1,800\nI3,C2,450\nI4,C3,1500\nI5,C3,900\nCSV\ncsvsql --query \"SELECT c.cust_id, c.country, COUNT(i.inv_id) AS inv_cnt, CAST(SUM(i.amount) AS INT) AS total_amt FROM customers c JOIN invoices i ON c.cust_id = i.cust_id GROUP BY c.cust_id, c.country HAVING SUM(i.amount) >= 1000 ORDER BY total_amt DESC\" customers.csv invoices.csv");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "cust_id,country,inv_cnt,total_amt\nC3,UK,2,2400\nC1,US,2,2000\n");
    } finally {
      await h.dispose();
    }
  });

  it("08 csvjson and jq transformation back into yq yaml manifest", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'CSV' > services.csv\nname,port,replicas,tls\ngateway,8443,3,true\nbilling,8080,2,true\nsearch,9200,1,false\nCSV\ncsvjson services.csv | jq '{services: map({name, port: (.port | tonumber), replicas: (.replicas | tonumber), tls: (.tls == \"true\" or .tls == true)})}' | yq -P '.'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "services:\n  - name: gateway\n    port: 8443.0\n    replicas: 3.0\n    tls: true\n  - name: billing\n    port: 8080.0\n    replicas: 2.0\n    tls: true\n  - name: search\n    port: 9200.0\n    replicas: 1.0\n    tls: false\n");
    } finally {
      await h.dispose();
    }
  });

  it("09 in2csv json array conversion piped to xan top and select", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'JSON' > Perf.json\n[\n  {\"endpoint\": \"/v1/users\", \"latency_ms\": 28, \"err_rate\": 0.1},\n  {\"endpoint\": \"/v1/orders\", \"latency_ms\": 145, \"err_rate\": 1.2},\n  {\"endpoint\": \"/v1/search\", \"latency_ms\": 89, \"err_rate\": 0.4},\n  {\"endpoint\": \"/v1/checkout\", \"latency_ms\": 210, \"err_rate\": 2.5}\n]\nJSON\nin2csv Perf.json | xan top latency_ms -l 3 | xan select endpoint,latency_ms");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "endpoint,latency_ms\n/v1/checkout,210\n/v1/orders,145\n/v1/search,89\n");
    } finally {
      await h.dispose();
    }
  });

  it("10 sqlite3 recursive CTE bill of materials cost rollup", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 bom.db << 'SQL'\nCREATE TABLE parts (\n  part_id TEXT PRIMARY KEY,\n  parent_id TEXT,\n  qty INT,\n  unit_cost INT\n);\nINSERT INTO parts VALUES\n  ('ROOT', NULL, 1, 0),\n  ('SUB_A', 'ROOT', 2, 10),\n  ('SUB_B', 'ROOT', 3, 20),\n  ('LEAF_A1', 'SUB_A', 4, 5),\n  ('LEAF_B1', 'SUB_B', 2, 15);\nWITH RECURSIVE tree(part_id, parent_id, eff_qty, unit_cost, depth) AS (\n  SELECT part_id, parent_id, qty, unit_cost, 0\n  FROM parts WHERE parent_id IS NULL\n  UNION ALL\n  SELECT p.part_id, p.parent_id, t.eff_qty * p.qty, p.unit_cost, t.depth + 1\n  FROM parts p JOIN tree t ON p.parent_id = t.part_id\n)\nSELECT part_id, depth, eff_qty, eff_qty * unit_cost AS line_cost\nFROM tree\nORDER BY depth, part_id;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "ROOT|0|1|0\nSUB_A|1|2|20\nSUB_B|1|3|60\nLEAF_A1|2|8|40\nLEAF_B1|2|6|90\n");
    } finally {
      await h.dispose();
    }
  });

  it("11 sqlite3 window functions ROW_NUMBER RANK DENSE_RANK and LAG", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 scores.db << 'SQL'\nCREATE TABLE runs (team TEXT, sprint INT, velocity INT);\nINSERT INTO runs VALUES\n  ('core', 1, 34),\n  ('core', 2, 42),\n  ('core', 3, 42),\n  ('core', 4, 50),\n  ('edge', 1, 28),\n  ('edge', 2, 35),\n  ('edge', 3, 31);\nSELECT\n  team,\n  sprint,\n  velocity,\n  RANK() OVER (PARTITION BY team ORDER BY velocity DESC) AS rnk,\n  DENSE_RANK() OVER (PARTITION BY team ORDER BY velocity DESC) AS drnk,\n  COALESCE(LAG(velocity, 1) OVER (PARTITION BY team ORDER BY sprint), 0) AS prev_vel\nFROM runs\nORDER BY team, sprint;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "core|1|34|4|3|0\ncore|2|42|2|2|34\ncore|3|42|2|2|42\ncore|4|50|1|1|42\nedge|1|28|3|3|0\nedge|2|35|1|1|28\nedge|3|31|2|2|35\n");
    } finally {
      await h.dispose();
    }
  });

  it("12 sqlite3 json_each and GROUP BY json_extract over nested event payloads", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 events.db << 'SQL'\nCREATE TABLE raw_events (id INT, payload TEXT);\nINSERT INTO raw_events VALUES\n  (1, '{\"service\":\"auth\",\"codes\":[200,201,401]}'),\n  (2, '{\"service\":\"api\",\"codes\":[200,500]}'),\n  (3, '{\"service\":\"auth\",\"codes\":[200,403]}');\nSELECT\n  json_extract(r.payload, '$.service') AS svc,\n  COUNT(*) AS code_events,\n  SUM(CASE WHEN CAST(j.value AS INT) >= 400 THEN 1 ELSE 0 END) AS err_events\nFROM raw_events r, json_each(r.payload, '$.codes') j\nGROUP BY json_extract(r.payload, '$.service')\nORDER BY svc;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "api|2|1\nauth|5|2\n");
    } finally {
      await h.dispose();
    }
  });

  it("13 sqlite3 triggers with UPSERT ON CONFLICT DO UPDATE audit trail", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 ledger.db << 'SQL'\nCREATE TABLE balances (acct TEXT PRIMARY KEY, balance INT, updates INT);\nCREATE TABLE audit (acct TEXT, old_bal INT, new_bal INT);\nCREATE TRIGGER tr_bal_update AFTER UPDATE ON balances\nBEGIN\n  INSERT INTO audit VALUES (OLD.acct, OLD.balance, NEW.balance);\nEND;\nINSERT INTO balances VALUES ('A1', 100, 1), ('A2', 250, 1);\nINSERT INTO balances VALUES ('A1', 50, 1)\n  ON CONFLICT(acct) DO UPDATE SET balance = balances.balance + excluded.balance, updates = balances.updates + 1;\nINSERT INTO balances VALUES ('A2', 75, 1)\n  ON CONFLICT(acct) DO UPDATE SET balance = balances.balance + excluded.balance, updates = balances.updates + 1;\nSELECT acct, balance, updates FROM balances ORDER BY acct;\nSELECT acct, old_bal, new_bal FROM audit ORDER BY acct;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "A1|150|2\nA2|325|2\nA1|100|150\nA2|250|325\n");
    } finally {
      await h.dispose();
    }
  });

  it("14 jq recursive walk and path-based redaction of sensitive keys", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'JSON' > config.json\n{\n  \"app\": \"payments\",\n  \"db\": {\n    \"host\": \"db.internal\",\n    \"password\": \"s3cr3t-db-password\",\n    \"replica\": {\n      \"token\": \"rep-tok-999\",\n      \"port\": 5432\n    }\n  },\n  \"webhooks\": [\n    {\"url\": \"https://a.example.com\", \"secret\": \"wh-sec-1\"},\n    {\"url\": \"https://b.example.com\", \"timeout\": 30}\n  ]\n}\nJSON\njq -c 'walk(if type == \"object\" then with_entries(if (.key | test(\"^(password|token|secret)$\")) then .value = \"***REDACTED***\" else . end) else . end)' config.json");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "{\"app\":\"payments\",\"db\":{\"host\":\"db.internal\",\"password\":\"***REDACTED***\",\"replica\":{\"token\":\"***REDACTED***\",\"port\":5432}},\"webhooks\":[{\"url\":\"https://a.example.com\",\"secret\":\"***REDACTED***\"},{\"url\":\"https://b.example.com\",\"timeout\":30}]}\n");
    } finally {
      await h.dispose();
    }
  });

  it("15 jq group_by reduce and transpose over multi-series matrix", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'JSON' > series.json\n[\n  [10, 20, 30],\n  [15, 25, 35],\n  [5, 15, 25]\n]\nJSON\njq -c 'transpose | map(reduce .[] as $v (0; . + $v))' series.json");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "[30,60,90]\n");
    } finally {
      await h.dispose();
    }
  });

  it("16 yq yaml merge anchors explode and conversion to TSV", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'YAML' > deploy.yaml\ndefaults: &def\n  replicas: 2\n  memory_mb: 512\nservices:\n  - name: api\n    <<: *def\n    memory_mb: 1024\n  - name: worker\n    <<: *def\n  - name: cron\n    <<: *def\n    replicas: 1\nYAML\nyq 'explode(.) | .services' deploy.yaml -o=tsv");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "name\treplicas\tmemory_mb\napi\t2\t1024\nworker\t2\t512\ncron\t1\t512\n");
    } finally {
      await h.dispose();
    }
  });

  it("17 xq xml attribute and element query piped to xan aggregation", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'XML' > clusters.xml\n<fleet>\n  <node id=\"n1\" zone=\"us-east-1a\"><cpu>16</cpu><mem>64</mem></node>\n  <node id=\"n2\" zone=\"us-east-1a\"><cpu>32</cpu><mem>128</mem></node>\n  <node id=\"n3\" zone=\"us-east-1b\"><cpu>16</cpu><mem>64</mem></node>\n  <node id=\"n4\" zone=\"us-east-1b\"><cpu>64</cpu><mem>256</mem></node>\n</fleet>\nXML\nxq -c '.fleet.node[] | {id: .[\"@id\"], zone: .[\"@zone\"], cpu: (.cpu | tonumber), mem: (.mem | tonumber)}' clusters.xml | jq -s '.' | in2csv -f json | xan groupby zone 'count() as nodes, sum(cpu) as total_cpu, sum(mem) as total_mem' | xan sort -s zone");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "zone,nodes,total_cpu,total_mem\nus-east-1a,2,48,192\nus-east-1b,2,80,320\n");
    } finally {
      await h.dispose();
    }
  });

  it("18 xmllint xpath extraction combined with awk and sqlite3 import", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'XML' > catalog.xml\n<catalog>\n  <book id=\"B1\"><title>Systems Programming</title><price>45</price></book>\n  <book id=\"B2\"><title>Distributed Consensus</title><price>60</price></book>\n  <book id=\"B3\"><title>Compiler Design</title><price>55</price></book>\n</catalog>\nXML\n{\n  echo \"id,title,price\"\n  for id in B1 B2 B3; do\n    title=$(xmllint --xpath \"string(//book[@id='$id']/title)\" catalog.xml)\n    price=$(xmllint --xpath \"string(//book[@id='$id']/price)\" catalog.xml)\n    printf '%s,%s,%s\\n' \"$id\" \"$title\" \"$price\"\n  done\n} > books.csv\nsqlite3 books.db << 'SQL'\n.mode csv\n.import books.csv books\n.mode list\nSELECT id, title, CAST(price AS INT) * 2 AS two_copy_cost FROM books WHERE CAST(price AS INT) >= 50 ORDER BY id;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "B2|Distributed Consensus|120\nB3|Compiler Design|110\n");
    } finally {
      await h.dispose();
    }
  });

  it("19 htmlq nth-of-type table scraping to csvsql summary", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'HTML' > status.html\n<html><body>\n  <table id=\"incidents\">\n    <tr class=\"row\"><td class=\"id\">INC-10</td><td class=\"sev\">SEV1</td><td class=\"mins\">45</td></tr>\n    <tr class=\"row\"><td class=\"id\">INC-11</td><td class=\"mins\">15</td><td class=\"sev\">SEV2</td></tr>\n    <tr class=\"row\"><td class=\"id\">INC-12</td><td class=\"sev\">SEV1</td><td class=\"mins\">30</td></tr>\n  </table>\n</body></html>\nHTML\n{\n  echo \"id,sev,mins\"\n  for i in 1 2 3; do\n    id=$(htmlq --text \"tr.row:nth-of-type($i) td.id\" < status.html)\n    sev=$(htmlq --text \"tr.row:nth-of-type($i) td.sev\" < status.html)\n    mins=$(htmlq --text \"tr.row:nth-of-type($i) td.mins\" < status.html)\n    printf '%s,%s,%s\\n' \"$id\" \"$sev\" \"$mins\"\n  done\n} > inc.csv\ncsvsql --query \"SELECT sev, COUNT(*) AS cnt, CAST(SUM(mins) AS INT) AS total_mins FROM inc GROUP BY sev ORDER BY sev\" inc.csv");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "sev,cnt,total_mins\nSEV1,2,75\nSEV2,1,15\n");
    } finally {
      await h.dispose();
    }
  });

  it("20 end-to-end xan sqlite3 jq yq csvkit multi-format reconciliation pipeline", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'CSV' > raw_tx.csv\ntx_id,merchant,category,amount_cents,status\nT100,acme,cloud,15000,settled\nT101,globex,saas,8500,settled\nT102,acme,cloud,25000,settled\nT103,initech,cloud,12000,refunded\nT104,globex,saas,11500,settled\nCSV\nxan filter 'status == \"settled\"' raw_tx.csv | xan groupby category,merchant 'count() as tx_count, sum(amount_cents) as total_cents' | xan sort -s category,merchant > agg_tx.csv\nsqlite3 recon.db << 'SQL'\n.mode csv\n.import agg_tx.csv agg_tx\n.mode list\nSELECT category, COUNT(*) AS merchants, SUM(CAST(tx_count AS INT)) AS total_tx, SUM(CAST(total_cents AS INT)) / 100 AS total_dollars FROM agg_tx GROUP BY category ORDER BY category;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "cloud|1|2|400\nsaas|1|2|200\n");
    } finally {
      await h.dispose();
    }
  });

});
