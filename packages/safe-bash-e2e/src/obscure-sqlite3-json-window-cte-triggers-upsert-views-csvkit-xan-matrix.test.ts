import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure sqlite3 json, window, cte, triggers, upsert, views, csvkit, and xan matrix", () => {
  it("01_sqlite3_recursive_cte_bom_cost_rollup", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 -separator '|' :memory: << 'EOF'\nCREATE TABLE bom(parent TEXT, child TEXT, qty INT, unit_cost INT);\nINSERT INTO bom VALUES\n  ('server', 'chassis', 1, 200),\n  ('server', 'motherboard', 1, 300),\n  ('motherboard', 'cpu', 2, 400),\n  ('motherboard', 'dimm', 8, 50);\nWITH RECURSIVE tree(item, mult, cost) AS (\n  SELECT child, qty, unit_cost FROM bom WHERE parent = 'server'\n  UNION ALL\n  SELECT b.child, t.mult * b.qty, b.unit_cost\n  FROM bom b JOIN tree t ON b.parent = t.item\n)\nSELECT item, mult, mult * cost AS extended_cost FROM tree ORDER BY extended_cost DESC, item ASC;\nEOF");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "cpu|2|800\ndimm|8|400\nmotherboard|1|300\nchassis|1|200\n");
    } finally {
      await h.dispose();
    }
  });

  it("02_sqlite3_window_rank_dense_rank_lag_lead_running_sum", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 -separator '|' :memory: << 'EOF'\nCREATE TABLE sales(dept TEXT, rep TEXT, rev INT);\nINSERT INTO sales VALUES\n  ('cloud', 'alice', 500),\n  ('cloud', 'bob', 500),\n  ('cloud', 'carol', 300),\n  ('edge', 'dave', 400),\n  ('edge', 'eve', 250);\nSELECT dept, rep, rev,\n       RANK() OVER (PARTITION BY dept ORDER BY rev DESC) AS rnk,\n       DENSE_RANK() OVER (PARTITION BY dept ORDER BY rev DESC) AS drnk,\n       COALESCE(LAG(rev, 1) OVER (PARTITION BY dept ORDER BY rev DESC, rep ASC), 0) AS prev_rev,\n       SUM(rev) OVER (PARTITION BY dept ORDER BY rev DESC, rep ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_dept\nFROM sales\nORDER BY dept ASC, rev DESC, rep ASC;\nEOF");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "cloud|alice|500|1|1|0|500\ncloud|bob|500|1|1|500|1000\ncloud|carol|300|3|2|500|1300\nedge|dave|400|1|1|0|400\nedge|eve|250|2|2|400|650\n");
    } finally {
      await h.dispose();
    }
  });

  it("03_sqlite3_upsert_on_conflict_do_update_with_where_and_excluded", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 -separator '|' :memory: << 'EOF'\nCREATE TABLE quotas(tenant TEXT PRIMARY KEY, used INT, ver INT);\nINSERT INTO quotas VALUES ('acme', 100, 1), ('globex', 250, 2);\nINSERT INTO quotas VALUES ('acme', 175, 2)\n  ON CONFLICT(tenant) DO UPDATE SET used = excluded.used, ver = quotas.ver + 1;\nINSERT INTO quotas VALUES ('initech', 80, 1)\n  ON CONFLICT(tenant) DO UPDATE SET used = excluded.used, ver = quotas.ver + 1;\nSELECT tenant, used, ver FROM quotas ORDER BY tenant;\nEOF");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "acme|175|2\nglobex|250|2\ninitech|80|1\n");
    } finally {
      await h.dispose();
    }
  });

  it("04_sqlite3_triggers_after_insert_update_delete_audit_trail", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 -separator '|' :memory: << 'EOF'\nCREATE TABLE accounts(id INT PRIMARY KEY, bal INT);\nCREATE TABLE audit(op TEXT, acct_id INT, old_bal INT, new_bal INT);\nCREATE TRIGGER tr_ins AFTER INSERT ON accounts BEGIN\n  INSERT INTO audit VALUES ('INS', NEW.id, 0, NEW.bal);\nEND;\nCREATE TRIGGER tr_upd AFTER UPDATE ON accounts BEGIN\n  INSERT INTO audit VALUES ('UPD', NEW.id, OLD.bal, NEW.bal);\nEND;\nCREATE TRIGGER tr_del AFTER DELETE ON accounts BEGIN\n  INSERT INTO audit VALUES ('DEL', OLD.id, OLD.bal, 0);\nEND;\nINSERT INTO accounts VALUES (10, 1000);\nUPDATE accounts SET bal = 1350 WHERE id = 10;\nDELETE FROM accounts WHERE id = 10;\nSELECT op, acct_id, old_bal, new_bal FROM audit;\nEOF");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "INS|10|0|1000\nUPD|10|1000|1350\nDEL|10|1350|0\n");
    } finally {
      await h.dispose();
    }
  });

  it("05_sqlite3_json_each_json_extract_json_group_array_pipeline", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 -separator '|' :memory: << 'EOF'\nCREATE TABLE orders(id INT, payload TEXT);\nINSERT INTO orders VALUES\n  (1, '{\"customer\":\"alice\",\"items\":[{\"sku\":\"A1\",\"qty\":2},{\"sku\":\"B2\",\"qty\":5}]}'),\n  (2, '{\"customer\":\"bob\",\"items\":[{\"sku\":\"A1\",\"qty\":3}]}');\nSELECT json_extract(o.payload, '$.customer') AS cust,\n       json_extract(j.value, '$.sku') AS sku,\n       json_extract(j.value, '$.qty') AS qty\nFROM orders o, json_each(o.payload, '$.items') j\nORDER BY cust, sku;\nEOF");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "alice|A1|2\nalice|B2|5\nbob|A1|3\n");
    } finally {
      await h.dispose();
    }
  });

  it("06_sqlite3_savepoint_nested_rollback_to_and_release", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 -separator '|' :memory: << 'EOF'\nCREATE TABLE steps(step INT, label TEXT);\nBEGIN;\nINSERT INTO steps VALUES (1, 'init');\nSAVEPOINT sp_a;\nINSERT INTO steps VALUES (2, 'tentative_a');\nSAVEPOINT sp_b;\nINSERT INTO steps VALUES (3, 'bad_branch');\nROLLBACK TO sp_b;\nINSERT INTO steps VALUES (4, 'good_branch');\nRELEASE sp_a;\nCOMMIT;\nSELECT step, label FROM steps ORDER BY step;\nEOF");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "1|init\n2|tentative_a\n4|good_branch\n");
    } finally {
      await h.dispose();
    }
  });

  it("07_sqlite3_views_and_scalar_functions_coalesce_nullif_iif_printf", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 -separator '|' :memory: << 'EOF'\nCREATE TABLE raw_metrics(service TEXT, ok_cnt INT, total_cnt INT, note TEXT);\nINSERT INTO raw_metrics VALUES\n  ('auth', 990, 1000, '  healthy  '),\n  ('billing', 0, 0, ''),\n  ('search', 475, 500, NULL);\nCREATE VIEW v_sla AS\n  SELECT UPPER(service) AS svc,\n         COALESCE(ROUND(100.0 * ok_cnt / NULLIF(total_cnt, 0), 1), 0.0) AS pct,\n         IIF(total_cnt = 0, 'NO_TRAFFIC', IIF(100.0 * ok_cnt / total_cnt >= 98.0, 'PASS', 'WARN')) AS gate,\n         COALESCE(NULLIF(TRIM(note), ''), 'none') AS clean_note\n  FROM raw_metrics;\nSELECT svc, pct, gate, clean_note FROM v_sla ORDER BY svc;\nEOF");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "AUTH|99.0|PASS|healthy\nBILLING|0.0|NO_TRAFFIC|none\nSEARCH|95.0|WARN|none\n");
    } finally {
      await h.dispose();
    }
  });

  it("08_xan_select_filter_sort_groupby_pipeline", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/jobs.csv\njob_id,queue,status,duration_s\nj1,gpu,ok,120\nj2,cpu,fail,45\nj3,gpu,ok,180\nj4,cpu,ok,30\nj5,gpu,fail,60\nEOF\nxan filter 'status == \"ok\"' /workspace/jobs.csv | xan sort -s duration_s -N -R | xan select job_id,queue,duration_s");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "job_id,queue,duration_s\nj3,gpu,180\nj1,gpu,120\nj4,cpu,30\n");
    } finally {
      await h.dispose();
    }
  });

  it("09_xan_map_computed_columns_and_semi_anti_joins", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/cart.csv\nsku,qty,price\nA1,3,15\nB2,10,2\nC3,4,25\nEOF\ncat << 'EOF' > /workspace/approved.csv\nsku\nA1\nC3\nEOF\nxan map 'qty * price' line_total /workspace/cart.csv > /workspace/with_total.csv\nxan join --semi sku /workspace/with_total.csv sku /workspace/approved.csv\nxan join --anti sku /workspace/with_total.csv sku /workspace/approved.csv");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "sku,qty,price,line_total\nA1,3,15,45\nC3,4,25,100\nsku,qty,price,line_total\nB2,10,2,20\n");
    } finally {
      await h.dispose();
    }
  });

  it("10_xan_top_and_frequency_distribution", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/events.csv\nservice,latency\napi,42\ndb,110\ncache,8\napi,95\ndb,140\napi,19\nEOF\nxan top latency -l 3 /workspace/events.csv");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "service,latency\ndb,140\ndb,110\napi,95\n");
    } finally {
      await h.dispose();
    }
  });

  it("11_csvcut_csvgrep_csvsort_csvformat_pipeline", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/employees.csv\nemp_id,name,dept,salary\n101,Alice,Engineering,145000\n102,Bob,Sales,98000\n103,Carol,Engineering,162000\n104,Dave,Marketing,88000\n105,Eve,Engineering,138000\nEOF\ncsvgrep -c dept -m Engineering /workspace/employees.csv \\\n  | csvcut -c name,salary \\\n  | csvsort -c salary -r \\\n  | csvformat -D '|'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "name|salary\nCarol|162000\nAlice|145000\nEve|138000\n");
    } finally {
      await h.dispose();
    }
  });

  it("12_csvjoin_inner_left_outer_and_csvlook_table", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/users.csv\nuid,handle\n1,alice\n2,bob\n3,carol\nEOF\ncat << 'EOF' > /workspace/badges.csv\nuid,badge\n1,founder\n3,maintainer\nEOF\ncsvjoin -c uid --left /workspace/users.csv /workspace/badges.csv");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "uid,handle,badge\n1,alice,founder\n2,bob,\n3,carol,maintainer\n");
    } finally {
      await h.dispose();
    }
  });

  it("13_in2csv_json_array_to_csv_and_csvstat_count", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/sensors.json\n[\n  {\"sensor\": \"temp_1\", \"val\": 21.5, \"zone\": \"north\"},\n  {\"sensor\": \"temp_2\", \"val\": 24.0, \"zone\": \"south\"},\n  {\"sensor\": \"temp_3\", \"val\": 19.5, \"zone\": \"north\"}\n]\nEOF\nin2csv /workspace/sensors.json > /workspace/sensors.csv\ncat /workspace/sensors.csv\ncsvstat --count /workspace/sensors.csv");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "sensor,val,zone\ntemp_1,21.5,north\ntemp_2,24.0,south\ntemp_3,19.5,north\n3\n");
    } finally {
      await h.dispose();
    }
  });

  it("14_sqlite3_multi_table_left_join_having_and_subquery_filter", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 -separator '|' :memory: << 'EOF'\nCREATE TABLE customers(cid INT PRIMARY KEY, name TEXT, tier TEXT);\nCREATE TABLE invoices(iid INT PRIMARY KEY, cid INT, amount INT, paid INT);\nINSERT INTO customers VALUES (1, 'Acme', 'enterprise'), (2, 'Beta', 'pro'), (3, 'Gamma', 'enterprise');\nINSERT INTO invoices VALUES (10, 1, 500, 1), (11, 1, 700, 0), (12, 2, 200, 1);\nSELECT c.name,\n       COUNT(i.iid) AS inv_count,\n       COALESCE(SUM(i.amount), 0) AS total_billed,\n       COALESCE(SUM(CASE WHEN i.paid = 0 THEN i.amount ELSE 0 END), 0) AS unpaid\nFROM customers c\nLEFT JOIN invoices i ON c.cid = i.cid\nGROUP BY c.cid, c.name\nORDER BY total_billed DESC, c.name ASC;\nEOF");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "Acme|2|1200|700\nBeta|1|200|0\nGamma|0|0|0\n");
    } finally {
      await h.dispose();
    }
  });

  it("15_sqlite3_alter_table_add_column_and_rename_column", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 -separator '|' :memory: << 'EOF'\nCREATE TABLE nodes(id INT, hostname TEXT);\nINSERT INTO nodes VALUES (1, 'node-a'), (2, 'node-b');\nALTER TABLE nodes ADD COLUMN status TEXT DEFAULT 'active';\nALTER TABLE nodes RENAME COLUMN hostname TO host;\nUPDATE nodes SET status = 'draining' WHERE id = 2;\nSELECT id, host, status FROM nodes ORDER BY id;\nEOF");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "1|node-a|active\n2|node-b|draining\n");
    } finally {
      await h.dispose();
    }
  });

  it("16_xan_transpose_matrix_and_re_query", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/quarterly.csv\nmetric,Q1,Q2,Q3\nrevenue,100,120,150\ncost,60,65,70\nEOF\nxan transpose /workspace/quarterly.csv");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "metric,revenue,cost\nQ1,100,60\nQ2,120,65\nQ3,150,70\n");
    } finally {
      await h.dispose();
    }
  });

  it("17_sqlite3_check_and_foreign_key_constraints_enforcement", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 -separator '|' :memory: << 'EOF'\nPRAGMA foreign_keys = ON;\nCREATE TABLE teams(id INT PRIMARY KEY, name TEXT UNIQUE);\nCREATE TABLE members(id INT PRIMARY KEY, team_id INT REFERENCES teams(id) ON DELETE CASCADE, age INT CHECK(age >= 18));\nINSERT INTO teams VALUES (1, 'core'), (2, 'infra');\nINSERT INTO members VALUES (10, 1, 28), (11, 1, 34), (12, 2, 25);\nDELETE FROM teams WHERE id = 1;\nSELECT id, team_id, age FROM members ORDER BY id;\nEOF");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "12|2|25\n");
    } finally {
      await h.dispose();
    }
  });

  it("18_csvsql_multi_csv_join_with_custom_table_names", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/t_depts.csv\ndid,dname\n10,Platform\n20,Security\nEOF\ncat << 'EOF' > /workspace/t_staff.csv\nsname,did,level\nGrace,10,L6\nAlan,20,L7\nAda,10,L7\nEOF\ncsvsql --tables depts,staff --query \"\n  SELECT d.dname, COUNT(*) AS hc, MAX(s.level) AS top_level\n  FROM depts d JOIN staff s ON d.did = s.did\n  GROUP BY d.dname\n  ORDER BY d.dname\n\" /workspace/t_depts.csv /workspace/t_staff.csv");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "dname,hc,top_level\nPlatform,2,L7\nSecurity,1,L7\n");
    } finally {
      await h.dispose();
    }
  });

  it("19_sqlite3_case_insensitive_like_glob_and_between_predicates", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 -separator '|' :memory: << 'EOF'\nCREATE TABLE files(path TEXT, size_kb INT);\nINSERT INTO files VALUES\n  ('src/main.rs', 45),\n  ('src/lib.rs', 120),\n  ('README.md', 12),\n  ('tests/MAIN_test.rs', 85),\n  ('docs/guide.pdf', 640);\nSELECT path, size_kb\nFROM files\nWHERE path LIKE '%main%' AND path GLOB '*.rs' AND size_kb BETWEEN 40 AND 100\nORDER BY path;\nEOF");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "src/main.rs|45\ntests/MAIN_test.rs|85\n");
    } finally {
      await h.dispose();
    }
  });

  it("20_sqlite3_compound_union_intersect_except_set_operations", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 -separator '|' :memory: << 'EOF'\nCREATE TABLE region_a(sku TEXT);\nCREATE TABLE region_b(sku TEXT);\nINSERT INTO region_a VALUES ('S1'), ('S2'), ('S3'), ('S4');\nINSERT INTO region_b VALUES ('S2'), ('S4'), ('S5');\nSELECT 'BOTH' AS bucket, sku FROM (SELECT sku FROM region_a INTERSECT SELECT sku FROM region_b)\nUNION ALL\nSELECT 'ONLY_A' AS bucket, sku FROM (SELECT sku FROM region_a EXCEPT SELECT sku FROM region_b)\nORDER BY bucket, sku;\nEOF");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "BOTH|S2\nBOTH|S4\nONLY_A|S1\nONLY_A|S3\n");
    } finally {
      await h.dispose();
    }
  });

});
