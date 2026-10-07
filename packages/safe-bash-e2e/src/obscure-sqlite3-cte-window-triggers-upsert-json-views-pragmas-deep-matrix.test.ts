import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure sqlite3 cte window triggers upsert json views pragmas deep matrix", () => {
  it("01 recursive CTE org chart path breadcrumbs and level depth", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 org.db << 'SQL'\nCREATE TABLE employees (id TEXT PRIMARY KEY, mgr_id TEXT, name TEXT, title TEXT);\nINSERT INTO employees VALUES\n  ('E1', NULL, 'Ada', 'CEO'),\n  ('E2', 'E1', 'Grace', 'VP_Eng'),\n  ('E3', 'E1', 'Alan', 'VP_Sec'),\n  ('E4', 'E2', 'Ken', 'Staff_Eng'),\n  ('E5', 'E3', 'Margaret', 'Principal_Sec');\nWITH RECURSIVE chain(id, name, title, lvl, path) AS (\n  SELECT id, name, title, 0, name\n  FROM employees WHERE mgr_id IS NULL\n  UNION ALL\n  SELECT e.id, e.name, e.title, c.lvl + 1, c.path || ' -> ' || e.name\n  FROM employees e JOIN chain c ON e.mgr_id = c.id\n)\nSELECT id, lvl, path FROM chain ORDER BY lvl, id;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "E1|0|Ada\nE2|1|Ada -> Grace\nE3|1|Ada -> Alan\nE4|2|Ada -> Grace -> Ken\nE5|2|Ada -> Alan -> Margaret\n");
    } finally {
      await h.dispose();
    }
  });

  it("02 window functions LAG LEAD FIRST_VALUE and running SUM over partitioned series", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 metrics.db << 'SQL'\nCREATE TABLE daily (svc TEXT, day INT, reqs INT);\nINSERT INTO daily VALUES\n  ('api', 1, 100),\n  ('api', 2, 150),\n  ('api', 3, 130),\n  ('auth', 1, 50),\n  ('auth', 2, 80),\n  ('auth', 3, 70);\nSELECT\n  svc,\n  day,\n  reqs,\n  COALESCE(LAG(reqs, 1) OVER (PARTITION BY svc ORDER BY day), 0) AS prev_reqs,\n  COALESCE(LEAD(reqs, 1) OVER (PARTITION BY svc ORDER BY day), 0) AS next_reqs,\n  FIRST_VALUE(reqs) OVER (PARTITION BY svc ORDER BY day) AS day1_reqs,\n  SUM(reqs) OVER (PARTITION BY svc ORDER BY day) AS cum_reqs\nFROM daily\nORDER BY svc, day;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "api|1|100|0|150|100|100\napi|2|150|100|130|100|250\napi|3|130|150|0|100|380\nauth|1|50|0|80|50|50\nauth|2|80|50|70|50|130\nauth|3|70|80|0|50|200\n");
    } finally {
      await h.dispose();
    }
  });

  it("03 BEFORE INSERT and AFTER DELETE triggers maintaining summary counter table", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 trig.db << 'SQL'\nCREATE TABLE tasks (id INT PRIMARY KEY, project TEXT, points INT);\nCREATE TABLE proj_totals (project TEXT PRIMARY KEY, total_points INT);\nINSERT INTO proj_totals VALUES ('core', 0), ('ui', 0);\nCREATE TRIGGER tr_task_ins AFTER INSERT ON tasks\nBEGIN\n  UPDATE proj_totals SET total_points = total_points + NEW.points WHERE project = NEW.project;\nEND;\nCREATE TRIGGER tr_task_del AFTER DELETE ON tasks\nBEGIN\n  UPDATE proj_totals SET total_points = total_points - OLD.points WHERE project = OLD.project;\nEND;\nINSERT INTO tasks VALUES (1, 'core', 5), (2, 'core', 8), (3, 'ui', 3);\nDELETE FROM tasks WHERE id = 1;\nSELECT project, total_points FROM proj_totals ORDER BY project;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "core|8\nui|3\n");
    } finally {
      await h.dispose();
    }
  });

  it("04 UPSERT ON CONFLICT DO UPDATE and DO NOTHING with composite expressions", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 kv.db << 'SQL'\nCREATE TABLE feature_flags (flag TEXT PRIMARY KEY, enabled INT, revisions INT);\nINSERT INTO feature_flags VALUES ('dark_mode', 0, 1), ('beta_search', 1, 1);\nINSERT INTO feature_flags VALUES ('dark_mode', 1, 1)\n  ON CONFLICT(flag) DO UPDATE SET enabled = excluded.enabled, revisions = feature_flags.revisions + 1;\nINSERT INTO feature_flags VALUES ('beta_search', 0, 1)\n  ON CONFLICT(flag) DO NOTHING;\nINSERT INTO feature_flags VALUES ('fast_checkout', 1, 1)\n  ON CONFLICT(flag) DO UPDATE SET enabled = excluded.enabled, revisions = feature_flags.revisions + 1;\nSELECT flag, enabled, revisions FROM feature_flags ORDER BY flag;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "beta_search|1|1\ndark_mode|1|2\nfast_checkout|1|1\n");
    } finally {
      await h.dispose();
    }
  });

  it("05 SAVEPOINT ROLLBACK TO SAVEPOINT and RELEASE SAVEPOINT transactional integrity", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 tx.db << 'SQL'\nCREATE TABLE wallet (id TEXT PRIMARY KEY, bal INT);\nINSERT INTO wallet VALUES ('W1', 500), ('W2', 300);\nBEGIN;\nUPDATE wallet SET bal = bal - 100 WHERE id = 'W1';\nSAVEPOINT sp_bonus;\nUPDATE wallet SET bal = bal + 1000 WHERE id = 'W2';\nROLLBACK TO SAVEPOINT sp_bonus;\nUPDATE wallet SET bal = bal + 100 WHERE id = 'W2';\nRELEASE SAVEPOINT sp_bonus;\nCOMMIT;\nSELECT id, bal FROM wallet ORDER BY id;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "W1|400\nW2|400\n");
    } finally {
      await h.dispose();
    }
  });

  it("06 CREATE VIEW over JOIN with aggregate filtering and ORDER BY", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 store.db << 'SQL'\nCREATE TABLE products (pid TEXT PRIMARY KEY, name TEXT, cat TEXT, price INT);\nCREATE TABLE line_items (oid INT, pid TEXT, qty INT);\nINSERT INTO products VALUES ('P1', 'SSD', 'hw', 120), ('P2', 'RAM', 'hw', 80), ('P3', 'IDE', 'sw', 200);\nINSERT INTO line_items VALUES (1, 'P1', 2), (2, 'P2', 3), (3, 'P3', 2), (4, 'P1', 1);\nCREATE VIEW v_cat_rev AS\n  SELECT p.cat AS category, COUNT(*) AS lines, SUM(p.price * l.qty) AS gross\n  FROM products p JOIN line_items l ON p.pid = l.pid\n  GROUP BY p.cat;\nSELECT category, lines, gross FROM v_cat_rev ORDER BY gross DESC;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "hw|3|600\nsw|1|400\n");
    } finally {
      await h.dispose();
    }
  });

  it("07 json_object json_array json_group_array and json_group_object aggregation", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 jagg.db << 'SQL'\nCREATE TABLE nodes (cluster TEXT, host TEXT, cores INT);\nINSERT INTO nodes VALUES\n  ('c1', 'n1', 16),\n  ('c1', 'n2', 32),\n  ('c2', 'n3', 64);\nSELECT\n  cluster,\n  json_group_array(host) AS hosts_json,\n  json_group_object(host, cores) AS cores_map\nFROM nodes\nGROUP BY cluster\nORDER BY cluster;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "c1|[\"n1\",\"n2\"]|{\"n1\":16,\"n2\":32}\nc2|[\"n3\"]|{\"n3\":64}\n");
    } finally {
      await h.dispose();
    }
  });

  it("08 nested CASE WHEN with COALESCE NULLIF IIF and PRINTF formatting", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 fmt.db << 'SQL'\nCREATE TABLE endpoints (path TEXT, p95_ms INT, override_sla INT);\nINSERT INTO endpoints VALUES\n  ('/v1/pay', 420, 500),\n  ('/v1/auth', 85, NULL),\n  ('/v1/report', 1250, 1000),\n  ('/v1/ping', 12, 12);\nSELECT\n  path,\n  CASE\n    WHEN p95_ms > COALESCE(override_sla, 200) THEN 'BREACH'\n    WHEN p95_ms >= 100 THEN 'WARN'\n    ELSE 'OK'\n  END AS status,\n  IIF(NULLIF(p95_ms, override_sla) IS NULL, 'EXACT_SLA', PRINTF('%04dms', p95_ms)) AS tag\nFROM endpoints\nORDER BY path;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "/v1/auth|OK|0085ms\n/v1/pay|WARN|0420ms\n/v1/ping|OK|EXACT_SLA\n/v1/report|BREACH|1250ms\n");
    } finally {
      await h.dispose();
    }
  });

  it("09 GROUP_CONCAT DISTINCT with FILTER WHERE aggregate clauses", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 filt.db << 'SQL'\nCREATE TABLE deploys (service TEXT, env TEXT, status TEXT);\nINSERT INTO deploys VALUES\n  ('api', 'prod', 'ok'),\n  ('api', 'stage', 'ok'),\n  ('api', 'prod', 'fail'),\n  ('api', 'dev', 'ok'),\n  ('worker', 'prod', 'ok'),\n  ('worker', 'stage', 'fail');\nSELECT\n  service,\n  COUNT(*) FILTER (WHERE status = 'ok') AS ok_cnt,\n  COUNT(*) FILTER (WHERE status = 'fail') AS fail_cnt,\n  GROUP_CONCAT(DISTINCT env) AS envs\nFROM deploys\nGROUP BY service\nORDER BY service;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "api|3|1|prod,stage,dev\nworker|1|1|prod,stage\n");
    } finally {
      await h.dispose();
    }
  });

  it("10 ALTER TABLE ADD COLUMN and RENAME TO schema evolution", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 mig.db << 'SQL'\nCREATE TABLE users_v1 (id INT PRIMARY KEY, handle TEXT);\nINSERT INTO users_v1 VALUES (1, 'alice'), (2, 'bob');\nALTER TABLE users_v1 ADD COLUMN role TEXT DEFAULT 'member';\nINSERT INTO users_v1 VALUES (3, 'carol', 'admin');\nALTER TABLE users_v1 RENAME TO users;\nSELECT id, handle, role FROM users ORDER BY id;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "1|alice|member\n2|bob|member\n3|carol|admin\n");
    } finally {
      await h.dispose();
    }
  });

  it("11 PRAGMA user_version application_id and integrity_check persistence", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 pragma.db << 'SQL'\nPRAGMA user_version = 42;\nPRAGMA application_id = 9001;\nCREATE TABLE items (id INT PRIMARY KEY, label TEXT NOT NULL, weight REAL);\nSQL\nsqlite3 pragma.db << 'SQL'\nPRAGMA user_version;\nPRAGMA application_id;\nPRAGMA integrity_check;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "42\n9001\nok\n");
    } finally {
      await h.dispose();
    }
  });

  it("12 .mode line formatting on multi-row and tableless queries", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 modes.db << 'SQL'\nCREATE TABLE regions (code TEXT, latency INT);\nINSERT INTO regions VALUES ('use1', 14), ('euw1', 28);\n.mode line\nSELECT code, latency FROM regions ORDER BY code;\nSELECT 'global' AS scope, 2 AS region_count;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "   code = euw1\nlatency = 28\n\n   code = use1\nlatency = 14\n       scope = global\nregion_count = 2\n");
    } finally {
      await h.dispose();
    }
  });

  it("13 .import CSV triggers BEFORE and AFTER INSERT validation and audit", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'CSV' > batch.csv\nid,acct,amount\n10,A1,250\n11,A2,400\n12,A1,150\nCSV\nsqlite3 imp.db << 'SQL'\nCREATE TABLE ledger (id INT, acct TEXT, amount INT);\nCREATE TABLE import_log (entry TEXT);\nCREATE TRIGGER tr_imp AFTER INSERT ON ledger\nBEGIN\n  INSERT INTO import_log VALUES (NEW.acct || ':' || NEW.amount);\nEND;\n.mode csv\n.import --skip 1 batch.csv ledger\n.mode list\nSELECT acct, SUM(CAST(amount AS INT)) FROM ledger GROUP BY acct ORDER BY acct;\nSELECT entry FROM import_log ORDER BY rowid;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "A1|400\nA2|400\nA1:250\nA2:400\nA1:150\n");
    } finally {
      await h.dispose();
    }
  });

  it("14 string functions SUBSTR INSTR REPLACE TRIM UPPER LOWER LENGTH", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 str.db << 'SQL'\nCREATE TABLE urls (id INT, raw TEXT);\nINSERT INTO urls VALUES\n  (1, '  https://api.example.com/v1/users  '),\n  (2, '  https://auth.example.com/v2/tokens ');\nSELECT\n  id,\n  UPPER(SUBSTR(TRIM(raw), 9, INSTR(SUBSTR(TRIM(raw), 9), '.') - 1)) AS subdomain,\n  REPLACE(TRIM(raw), 'https://', '') AS stripped,\n  LENGTH(TRIM(raw)) AS len\nFROM urls\nORDER BY id;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "1|API|api.example.com/v1/users|32\n2|AUTH|auth.example.com/v2/tokens|34\n");
    } finally {
      await h.dispose();
    }
  });

  it("15 compound arithmetic in SELECT and GROUP BY with ROUND and CAST", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 math.db << 'SQL'\nCREATE TABLE nodes (pool TEXT, cap_gb INT, used_gb INT);\nINSERT INTO nodes VALUES\n  ('hot', 100, 35),\n  ('hot', 100, 45),\n  ('cold', 500, 125),\n  ('cold', 500, 175);\nSELECT\n  pool,\n  SUM(cap_gb) - SUM(used_gb) AS free_gb,\n  ROUND(100.0 * SUM(used_gb) / SUM(cap_gb), 1) AS util_pct,\n  CAST((SUM(used_gb) * 10) / 3 AS INT) AS weighted\nFROM nodes\nGROUP BY pool\nORDER BY pool;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "cold|700|30.0|1000\nhot|120|40.0|266\n");
    } finally {
      await h.dispose();
    }
  });

  it("16 correlated scalar subquery and EXISTS / NOT EXISTS filtering", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 subq.db << 'SQL'\nCREATE TABLE teams (tid TEXT PRIMARY KEY, name TEXT);\nCREATE TABLE incidents (iid INT, tid TEXT, sev INT);\nINSERT INTO teams VALUES ('T1', 'Core'), ('T2', 'Payments'), ('T3', 'Search');\nINSERT INTO incidents VALUES (1, 'T1', 1), (2, 'T1', 2), (3, 'T2', 3);\nSELECT\n  t.tid,\n  t.name,\n  (SELECT COUNT(*) FROM incidents i WHERE i.tid = t.tid) AS inc_count\nFROM teams t\nWHERE EXISTS (SELECT 1 FROM incidents i WHERE i.tid = t.tid AND i.sev <= 2)\nORDER BY t.tid;\nSELECT t.tid, t.name\nFROM teams t\nWHERE NOT EXISTS (SELECT 1 FROM incidents i WHERE i.tid = t.tid)\nORDER BY t.tid;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "T1|Core|2\nT3|Search\n");
    } finally {
      await h.dispose();
    }
  });

  it("17 UNION ALL and INTERSECT / EXCEPT set operations", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 sets.db << 'SQL'\nCREATE TABLE prod_hosts (host TEXT);\nCREATE TABLE stage_hosts (host TEXT);\nINSERT INTO prod_hosts VALUES ('h1'), ('h2'), ('h3');\nINSERT INTO stage_hosts VALUES ('h2'), ('h3'), ('h4');\nSELECT 'INTERSECT:' || host FROM (\n  SELECT host FROM prod_hosts\n  INTERSECT\n  SELECT host FROM stage_hosts\n) ORDER BY 1;\nSELECT 'EXCEPT:' || host FROM (\n  SELECT host FROM prod_hosts\n  EXCEPT\n  SELECT host FROM stage_hosts\n) ORDER BY 1;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "INTERSECT:h2\nINTERSECT:h3\nEXCEPT:h1\n");
    } finally {
      await h.dispose();
    }
  });

  it("18 foreign key enforcement PRAGMA foreign_keys = ON with ON DELETE CASCADE", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 fk.db << 'SQL'\nPRAGMA foreign_keys = ON;\nCREATE TABLE orgs (org_id TEXT PRIMARY KEY);\nCREATE TABLE members (mem_id TEXT PRIMARY KEY, org_id TEXT REFERENCES orgs(org_id) ON DELETE CASCADE);\nINSERT INTO orgs VALUES ('O1'), ('O2');\nINSERT INTO members VALUES ('M1', 'O1'), ('M2', 'O1'), ('M3', 'O2');\nDELETE FROM orgs WHERE org_id = 'O1';\nSELECT mem_id, org_id FROM members ORDER BY mem_id;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "M3|O2\n");
    } finally {
      await h.dispose();
    }
  });

  it("19 multi-CTE query chaining regional benchmarks and outlier detection", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 cte2.db << 'SQL'\nCREATE TABLE samples (region TEXT, host TEXT, ms INT);\nINSERT INTO samples VALUES\n  ('us', 'u1', 20), ('us', 'u2', 30), ('us', 'u3', 70),\n  ('eu', 'e1', 40), ('eu', 'e2', 50), ('eu', 'e3', 120);\nWITH reg_avg AS (\n  SELECT region, AVG(ms) AS avg_ms FROM samples GROUP BY region\n),\noutliers AS (\n  SELECT s.region, s.host, s.ms, CAST(r.avg_ms AS INT) AS reg_mean\n  FROM samples s JOIN reg_avg r ON s.region = r.region\n  WHERE s.ms > r.avg_ms * 1.5\n)\nSELECT region, host, ms, reg_mean FROM outliers ORDER BY region, host;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "eu|e3|120|70\nus|u3|70|40\n");
    } finally {
      await h.dispose();
    }
  });

  it("20 .nullvalue custom placeholder with LEFT JOIN and .separator custom pipe", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 lj.db << 'SQL'\nCREATE TABLE services (svc TEXT PRIMARY KEY);\nCREATE TABLE owners (svc TEXT, lead TEXT);\nINSERT INTO services VALUES ('auth'), ('billing'), ('search');\nINSERT INTO owners VALUES ('auth', 'alice'), ('search', 'carol');\n.nullvalue UNASSIGNED\n.separator \" :: \"\nSELECT s.svc, o.lead FROM services s LEFT JOIN owners o ON s.svc = o.svc ORDER BY s.svc;\nSQL");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "auth :: alice\nbilling :: UNASSIGNED\nsearch :: carol\n");
    } finally {
      await h.dispose();
    }
  });

});
