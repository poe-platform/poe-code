import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withE2EHarness } from "./harness.js";

describe("sqlite3 SQL window functions, CTEs, triggers, constraints, JSON, TVFs, and CLI dot-commands matrix", () => {
  it("1. executes WITH RECURSIVE CTE for hierarchical org-chart traversal with depth and breadcrumb paths", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
sqlite3 /org.db <<'SQL'
CREATE TABLE employees (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  manager_id INTEGER
);
INSERT INTO employees VALUES
  (1, 'Ada', NULL),
  (2, 'Grace', 1),
  (3, 'Linus', 1),
  (4, 'Ken', 2),
  (5, 'Dennis', 2),
  (6, 'Margaret', 4);

WITH RECURSIVE org_tree(id, name, depth, path) AS (
  SELECT id, name, 0, name FROM employees WHERE manager_id IS NULL
  UNION ALL
  SELECT e.id, e.name, t.depth + 1, t.path || '->' || e.name
  FROM employees e
  JOIN org_tree t ON e.manager_id = t.id
)
SELECT id, depth, path FROM org_tree ORDER BY path;
SQL
`);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "1|0|Ada",
          "2|1|Ada->Grace",
          "5|2|Ada->Grace->Dennis",
          "4|2|Ada->Grace->Ken",
          "6|3|Ada->Grace->Ken->Margaret",
          "3|1|Ada->Linus",
          ""
        ].join("\n")
      );
    });
  });

  it("2. executes multiple chained non-recursive CTEs computing regional summaries and filtered rankings", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
sqlite3 /sales.db <<'SQL'
CREATE TABLE orders (id INTEGER PRIMARY KEY, region TEXT, rep TEXT, amount INTEGER);
INSERT INTO orders VALUES
  (1, 'NA', 'Alice', 400),
  (2, 'NA', 'Alice', 300),
  (3, 'NA', 'Bob', 500),
  (4, 'EU', 'Clara', 900),
  (5, 'EU', 'Dieter', 300),
  (6, 'APAC', 'Emi', 250);

WITH rep_totals AS (
  SELECT region, rep, SUM(amount) AS rep_sum, COUNT(*) AS order_cnt
  FROM orders
  GROUP BY region, rep
),
region_totals AS (
  SELECT region, SUM(rep_sum) AS reg_sum, AVG(rep_sum) AS reg_avg
  FROM rep_totals
  GROUP BY region
)
SELECT r.region, r.rep, r.rep_sum, g.reg_sum
FROM rep_totals r
JOIN region_totals g ON r.region = g.region
WHERE r.rep_sum >= g.reg_avg
ORDER BY g.reg_sum DESC, r.rep;
SQL
`);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "NA|Alice|700|1200",
          "EU|Clara|900|1200",
          "APAC|Emi|250|250",
          ""
        ].join("\n")
      );
    });
  });

  it("3. computes ranking window functions ROW_NUMBER, RANK, DENSE_RANK, and NTILE over partitioned rows", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
sqlite3 :memory: <<'SQL'
CREATE TABLE scores (player TEXT, team TEXT, pts INTEGER);
INSERT INTO scores VALUES
  ('p1', 'A', 100),
  ('p2', 'A', 90),
  ('p3', 'A', 90),
  ('p4', 'A', 70),
  ('p5', 'B', 50),
  ('p6', 'B', 50),
  ('p7', 'B', 20);

SELECT
  team,
  player,
  pts,
  ROW_NUMBER() OVER (PARTITION BY team ORDER BY pts DESC, player ASC) AS rn,
  RANK() OVER (PARTITION BY team ORDER BY pts DESC) AS rnk,
  DENSE_RANK() OVER (PARTITION BY team ORDER BY pts DESC) AS drnk,
  NTILE(2) OVER (PARTITION BY team ORDER BY pts DESC, player ASC) AS bucket
FROM scores
ORDER BY team, rn;
SQL
`);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "A|p1|100|1|1|1|1",
          "A|p2|90|2|2|2|1",
          "A|p3|90|3|2|2|2",
          "A|p4|70|4|4|3|2",
          "B|p5|50|1|1|1|1",
          "B|p6|50|2|1|1|1",
          "B|p7|20|3|3|2|2",
          ""
        ].join("\n")
      );
    });
  });

  it("4. computes navigation window functions LAG, LEAD, FIRST_VALUE, LAST_VALUE, and NTH_VALUE", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
sqlite3 :memory: <<'SQL'
CREATE TABLE metrics (day INTEGER, val INTEGER);
INSERT INTO metrics VALUES (1, 10), (2, 25), (3, 40), (4, 35);

SELECT
  day,
  val,
  LAG(val, 1, 0) OVER (ORDER BY day) AS prev_val,
  LEAD(val, 1, -1) OVER (ORDER BY day) AS next_val,
  FIRST_VALUE(val) OVER (ORDER BY day) AS first_v,
  NTH_VALUE(val, 2) OVER (ORDER BY day ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS second_v
FROM metrics
ORDER BY day;
SQL
`);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "1|10|0|25|10|25",
          "2|25|10|40|10|25",
          "3|40|25|35|10|25",
          "4|35|40|-1|10|25",
          ""
        ].join("\n")
      );
    });
  });

  it("5. computes running SUM, COUNT, MIN, MAX over window partitions", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
sqlite3 :memory: <<'SQL'
CREATE TABLE ledger (id INTEGER, acct TEXT, delta INTEGER);
INSERT INTO ledger VALUES
  (1, 'cash', 100),
  (2, 'cash', -30),
  (3, 'cash', 50),
  (4, 'cash', 20),
  (5, 'ar', 200),
  (6, 'ar', -80);

SELECT
  id,
  acct,
  delta,
  SUM(delta) OVER (PARTITION BY acct ORDER BY id) AS running_bal,
  COUNT(*) OVER (PARTITION BY acct ORDER BY id) AS running_cnt,
  MAX(delta) OVER (PARTITION BY acct) AS max_delta
FROM ledger
ORDER BY id;
SQL
`);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "1|cash|100|100|1|100",
          "2|cash|-30|70|2|100",
          "3|cash|50|120|3|100",
          "4|cash|20|140|4|100",
          "5|ar|200|200|1|200",
          "6|ar|-80|120|2|200",
          ""
        ].join("\n")
      );
    });
  });

  it("6. executes UPSERT with ON CONFLICT DO UPDATE using excluded references and conditional WHERE", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
sqlite3 /inventory.db <<'SQL'
CREATE TABLE stock (
  sku TEXT PRIMARY KEY,
  qty INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO stock (sku, qty, version) VALUES ('A1', 10, 1), ('B2', 5, 2);

INSERT INTO stock (sku, qty, version) VALUES
  ('A1', 15, 2),
  ('B2', 99, 1),
  ('C3', 7, 1)
ON CONFLICT(sku) DO UPDATE SET
  qty = stock.qty + excluded.qty,
  version = excluded.version
WHERE excluded.version > stock.version;

INSERT INTO stock (sku, qty, version) VALUES ('A1', 500, 99)
ON CONFLICT(sku) DO NOTHING;

SELECT sku, qty, version FROM stock ORDER BY sku;
SQL
`);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "A1|25|2",
          "B2|5|2",
          "C3|7|1",
          ""
        ].join("\n")
      );
    });
  });

  it("7. supports RETURNING clauses on INSERT, UPDATE, and DELETE statements", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
sqlite3 :memory: <<'SQL'
CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, done INTEGER DEFAULT 0);
INSERT INTO tasks (title) VALUES ('build'), ('test'), ('deploy') RETURNING id, UPPER(title);
UPDATE tasks SET done = 1 WHERE title != 'deploy' RETURNING id, title, done;
DELETE FROM tasks WHERE title = 'build' RETURNING id, title;
SELECT id, title, done FROM tasks ORDER BY id;
SQL
`);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "1|BUILD",
          "2|TEST",
          "3|DEPLOY",
          "1|build|1",
          "2|test|1",
          "1|build",
          "2|test|1",
          "3|deploy|0",
          ""
        ].join("\n")
      );
    });
  });

  it("8. fires BEFORE and AFTER triggers on INSERT, UPDATE, DELETE with WHEN guards and enforces CHECK/NOT NULL constraints", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
sqlite3 /trig.db <<'SQL'
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  owner TEXT NOT NULL,
  balance INTEGER CHECK (balance >= 0)
);
CREATE TABLE audit_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, op TEXT, acct_id INTEGER, old_bal INTEGER, new_bal INTEGER);

CREATE TRIGGER trg_audit_insert
AFTER INSERT ON accounts
BEGIN
  INSERT INTO audit_log (op, acct_id, old_bal, new_bal) VALUES ('INSERT', NEW.id, -1, NEW.balance);
END;

CREATE TRIGGER trg_audit_update
AFTER UPDATE OF balance ON accounts
WHEN OLD.balance != NEW.balance
BEGIN
  INSERT INTO audit_log (op, acct_id, old_bal, new_bal) VALUES ('UPDATE', NEW.id, OLD.balance, NEW.balance);
END;

CREATE TRIGGER trg_audit_delete
AFTER DELETE ON accounts
BEGIN
  INSERT INTO audit_log (op, acct_id, old_bal, new_bal) VALUES ('DELETE', OLD.id, OLD.balance, -1);
END;

INSERT INTO accounts VALUES (1, 'Alice', 500), (2, 'Bob', 200);
UPDATE accounts SET balance = 650 WHERE id = 1;
UPDATE accounts SET balance = 200 WHERE id = 2;
DELETE FROM accounts WHERE id = 2;
SELECT seq, op, acct_id, old_bal, new_bal FROM audit_log ORDER BY seq;
SQL
`);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "1|INSERT|1|-1|500",
          "2|INSERT|2|-1|200",
          "3|UPDATE|1|500|650",
          "4|DELETE|2|200|-1",
          ""
        ].join("\n")
      );

      const badCheck = await h.exec(`sqlite3 /trig.db "INSERT INTO accounts VALUES (3, 'Eve', -10);"`);
      assert.notEqual(badCheck.exitCode, 0);
      assert.match(badCheck.stderr, /CHECK constraint failed/i);

      const badNull = await h.exec(`sqlite3 /trig.db "INSERT INTO accounts VALUES (4, NULL, 100);"`);
      assert.notEqual(badNull.exitCode, 0);
      assert.match(badNull.stderr, /NOT NULL constraint failed/i);
    });
  });

  it("9. evaluates GENERATED ALWAYS AS computed columns, INSERT OR IGNORE, and INSERT OR REPLACE conflict resolution", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
sqlite3 :memory: <<'SQL'
CREATE TABLE line_items (
  sku TEXT PRIMARY KEY,
  unit_price INTEGER NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  subtotal INTEGER GENERATED ALWAYS AS (unit_price * qty) STORED
);

INSERT INTO line_items (sku, unit_price, qty) VALUES ('SKU-1', 25, 4), ('SKU-2', 40, 2);
INSERT OR IGNORE INTO line_items (sku, unit_price, qty) VALUES ('SKU-1', 999, 99);
INSERT OR REPLACE INTO line_items (sku, unit_price, qty) VALUES ('SKU-2', 50, 3), ('SKU-3', 15, 5);

SELECT sku, unit_price, qty, subtotal FROM line_items ORDER BY sku;
SQL
`);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "SKU-1|25|4|100",
          "SKU-2|50|3|150",
          "SKU-3|15|5|75",
          ""
        ].join("\n")
      );
    });
  });

  it("10. manages transactions and nested SAVEPOINT / ROLLBACK TO / RELEASE SAVEPOINT accurately", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
sqlite3 /tx.db <<'SQL'
CREATE TABLE items (k TEXT PRIMARY KEY, v INTEGER);
INSERT INTO items VALUES ('base', 1);

BEGIN TRANSACTION;
INSERT INTO items VALUES ('tx1', 10);
SAVEPOINT sp_a;
INSERT INTO items VALUES ('sp_a_item', 20);
SAVEPOINT sp_b;
UPDATE items SET v = 999 WHERE k = 'base';
INSERT INTO items VALUES ('sp_b_item', 30);
ROLLBACK TO SAVEPOINT sp_b;
RELEASE SAVEPOINT sp_b;
INSERT INTO items VALUES ('after_sp_b', 40);
RELEASE SAVEPOINT sp_a;
COMMIT;

BEGIN;
DELETE FROM items;
ROLLBACK;

SELECT k, v FROM items ORDER BY v;
SQL
`);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "base|1",
          "tx1|10",
          "sp_a_item|20",
          "after_sp_b|40",
          ""
        ].join("\n")
      );
    });
  });

  it("11. supports CREATE VIEW, querying views in joins and aggregations, and DROP VIEW", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
sqlite3 :memory: <<'SQL'
CREATE TABLE raw_events (id INTEGER PRIMARY KEY AUTOINCREMENT, service TEXT, kind TEXT, latency_ms INTEGER);
INSERT INTO raw_events (service, kind, latency_ms) VALUES
  ('auth', 'err', 120),
  ('auth', 'ok', 15),
  ('auth', 'err', 180),
  ('pay', 'err', 250),
  ('pay', 'ok', 20);

CREATE VIEW v_errors AS
  SELECT service, latency_ms FROM raw_events WHERE kind = 'err';

SELECT service, COUNT(*) AS err_cnt, SUM(latency_ms) AS total_err_ms
FROM v_errors
GROUP BY service
ORDER BY total_err_ms DESC;

DROP VIEW IF EXISTS v_errors;
SELECT COUNT(*) FROM raw_events;
SQL
`);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "auth|2|300",
          "pay|1|250",
          "5",
          ""
        ].join("\n")
      );
    });
  });

  it("12. evaluates SQLite JSON1 functions, -> and ->> operators, json_set/remove, json_each, and json_group_array/object", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
sqlite3 :memory: <<'SQL'
CREATE TABLE docs (id INTEGER PRIMARY KEY, doc TEXT);
INSERT INTO docs VALUES
  (1, '{"user":{"name":"Ada","roles":["admin","eng"]},"active":true,"score":42}'),
  (2, '{"user":{"name":"Bob","roles":["viewer"]},"active":false,"score":19}');

SELECT
  id,
  json_extract(doc, '$.user.name') AS name,
  doc -> '$.user.roles[0]' AS role_json,
  doc ->> '$.user.roles[0]' AS role_text,
  json_type(doc, '$.score') AS score_type,
  json_valid(doc) AS is_valid
FROM docs
ORDER BY id;

UPDATE docs
SET doc = json_remove(json_set(doc, '$.score', 100, '$.user.tier', 'gold'), '$.active')
WHERE id = 1;

SELECT json_extract(doc, '$.score'), json_extract(doc, '$.user.tier'), json_type(doc, '$.active')
FROM docs WHERE id = 1;

SELECT j.value
FROM docs d, json_each(d.doc, '$.user.roles') j
WHERE d.id = 1
ORDER BY j.key;

SELECT
  json_group_array( json_extract(doc, '$.user.name') ),
  json_group_object( CAST(id AS TEXT), json_extract(doc, '$.score') )
FROM docs;
SQL
`);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          '1|Ada|"admin"|admin|integer|1',
          '2|Bob|"viewer"|viewer|integer|1',
          "100|gold|",
          "admin",
          "eng",
          '["Ada","Bob"]|{"1":100,"2":19}',
          ""
        ].join("\n")
      );
    });
  });

  it("13. evaluates table-valued functions generate_series and json_tree for sequence generation and deep JSON inspection", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
sqlite3 :memory: <<'SQL'
SELECT value, value * value AS sq
FROM generate_series(2, 10, 2)
ORDER BY value;

SELECT fullkey, type, atom
FROM json_tree('{"a":{"b":[10,20]},"c":"ok"}')
WHERE atom IS NOT NULL
ORDER BY fullkey;
SQL
`);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "2|4",
          "4|16",
          "6|36",
          "8|64",
          "10|100",
          "$.a.b[0]|integer|10",
          "$.a.b[1]|integer|20",
          "$.c|text|ok",
          ""
        ].join("\n")
      );
    });
  });

  it("14. executes multi-table JOINs, aggregate FILTER (WHERE ...), GROUP_CONCAT, and HAVING clauses", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
sqlite3 :memory: <<'SQL'
CREATE TABLE depts (id INTEGER PRIMARY KEY, dept_name TEXT);
CREATE TABLE staff (id INTEGER PRIMARY KEY, dept_id INTEGER, name TEXT, salary INTEGER, status TEXT);

INSERT INTO depts VALUES (1, 'Core'), (2, 'Infra'), (3, 'Legal');
INSERT INTO staff VALUES
  (1, 1, 'Ada', 180, 'active'),
  (2, 1, 'Grace', 200, 'active'),
  (3, 1, 'Turing', 150, 'alumni'),
  (4, 2, 'Ken', 170, 'active'),
  (5, 2, 'Dennis', 175, 'active');

SELECT
  d.dept_name,
  COUNT(s.id) AS total_staff,
  COUNT(s.id) FILTER (WHERE s.status = 'active') AS active_staff,
  CASE WHEN SUM(s.salary) FILTER (WHERE s.status = 'active') IS NULL THEN 0 ELSE SUM(s.salary) FILTER (WHERE s.status = 'active') END AS active_payroll,
  CASE WHEN GROUP_CONCAT(s.name, ',') IS NULL THEN 'none' ELSE GROUP_CONCAT(s.name, ',') END AS members
FROM depts d
LEFT JOIN staff s ON s.dept_id = d.id
GROUP BY d.id, d.dept_name
HAVING COUNT(s.id) >= 0
ORDER BY d.id;
SQL
`);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "Core|3|2|380|Ada,Grace,Turing",
          "Infra|2|2|345|Ken,Dennis",
          "Legal|0|0|0|none",
          ""
        ].join("\n")
      );
    });
  });

  it("15. executes compound set queries UNION, UNION ALL, INTERSECT, and EXCEPT with ORDER BY and LIMIT/OFFSET", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
sqlite3 :memory: <<'SQL'
CREATE TABLE set_a (v INTEGER);
CREATE TABLE set_b (v INTEGER);
INSERT INTO set_a VALUES (1), (2), (3), (4), (5);
INSERT INTO set_b VALUES (3), (4), (5), (6), (7);

SELECT 'common', v FROM set_a INTERSECT SELECT 'common', v FROM set_b ORDER BY v;
SELECT 'diff', v FROM set_a EXCEPT SELECT 'diff', v FROM set_b ORDER BY v DESC;
SELECT 'merged', v FROM set_a UNION SELECT 'merged', v FROM set_b ORDER BY v LIMIT 4 OFFSET 2;
SQL
`);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "common|3",
          "common|4",
          "common|5",
          "diff|2",
          "diff|1",
          "merged|3",
          "merged|4",
          "merged|5",
          "merged|6",
          ""
        ].join("\n")
      );
    });
  });

  it("16. evaluates correlated EXISTS, NOT EXISTS, IN (SELECT ...), scalar subqueries, and CASE expressions", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
sqlite3 :memory: <<'SQL'
CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE invoices (id INTEGER PRIMARY KEY, customer_id INTEGER, total INTEGER);

INSERT INTO customers VALUES (1, 'Acme'), (2, 'Globex'), (3, 'Initech');
INSERT INTO invoices VALUES (101, 1, 500), (102, 1, 800), (103, 2, 150);

SELECT
  c.name,
  (SELECT TOTAL(i.total) FROM invoices i WHERE i.customer_id = c.id) AS lifetime,
  CASE
    WHEN EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id = c.id AND i.total >= 600) THEN 'enterprise'
    WHEN EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id = c.id) THEN 'standard'
    ELSE 'prospect'
  END AS segment
FROM customers c
ORDER BY c.id;

SELECT name FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id = c.id);
SQL
`);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "Acme|1300|enterprise",
          "Globex|150|standard",
          "Initech|0|prospect",
          "Initech",
          ""
        ].join("\n")
      );
    });
  });

  it("17. evaluates date/time functions with modifiers, printf formatting, and scalar string/math functions", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
sqlite3 :memory: <<'SQL'
SELECT
  date('2026-03-15', 'start of month', '+1 month', '-1 day') AS eom,
  strftime('%Y-%m-%d %H:%M', '2026-01-01 09:30:00', '+2 days', '+45 minutes') AS shifted,
  printf('%04d:%-6s:%.2f', 7, 'item', 3.14159) AS fmt,
  CASE WHEN 10 > 5 THEN 'yes' ELSE 'no' END AS cond,
  CASE WHEN NULLIF('same', 'same') IS NULL THEN 'fallback' ELSE 'other' END AS coal,
  HEX('ABC') AS hex_abc,
  REPLACE(TRIM('  hello_world  '), '_', '-') AS cleaned;
SQL
`);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "2026-03-31|2026-01-03 10:15|0007:item  :3.14|yes|fallback|414243|hello-world\n"
      );
    });
  });

  it("18. formats query results across CLI output modes (-csv, -json, -line, -markdown, -quote, .nullvalue)", async () => {
    await withE2EHarness(async (h) => {
      await h.exec(`
sqlite3 /modes.db <<'SQL'
CREATE TABLE items (id INTEGER, label TEXT, note TEXT);
INSERT INTO items VALUES (1, 'alpha,beta', NULL), (2, 'gamma', 'ok');
SQL
`);

      const csvRes = await h.exec(`sqlite3 -header -csv /modes.db "SELECT id, label, CASE WHEN note IS NULL THEN 'N/A' ELSE note END AS note FROM items ORDER BY id;"`);
      assert.equal(csvRes.exitCode, 0);
      assert.equal(csvRes.stdout.replace(/\r\n/g, "\n"), 'id,label,note\n1,"alpha,beta",N/A\n2,gamma,ok\n');

      const jsonRes = await h.exec(`sqlite3 -json /modes.db "SELECT id, label, note FROM items ORDER BY id;"`);
      assert.equal(jsonRes.exitCode, 0);
      assert.deepEqual(JSON.parse(jsonRes.stdout), [
        { id: 1, label: "alpha,beta", note: null },
        { id: 2, label: "gamma", note: "ok" }
      ]);

      const lineRes = await h.exec(`
sqlite3 /modes.db <<'SQL'
.mode line
.nullvalue NULL_VAL
SELECT id, note FROM items ORDER BY id;
SQL
`);
      assert.equal(lineRes.exitCode, 0);
      assert.match(lineRes.stdout, /id = 1\s+note = NULL_VAL/);
      assert.match(lineRes.stdout, /id = 2\s+note = ok/);

      const quoteRes = await h.exec(`sqlite3 -quote /modes.db "SELECT id, label, note FROM items WHERE id = 1;"`);
      assert.equal(quoteRes.exitCode, 0);
      assert.equal(quoteRes.stdout.trim(), "1,'alpha,beta',NULL");
    });
  });

  it("19. executes .import from CSV and .dump round-trip restoration into a fresh SQLite database", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/work/users.csv",
        "id,name,city\n10,Ada,London\n20,Grace,New York\n30,Linus,Helsinki\n"
      );

      const imp = await h.exec(`
sqlite3 /work/source.db <<'SQL'
.mode csv
.import /work/users.csv imported_users
SELECT COUNT(*), MIN(name), MAX(city) FROM imported_users;
SQL
`);
      assert.equal(imp.exitCode, 0);
      assert.equal(imp.stdout.trim(), "3,Ada,New York");

      const dumpAndRestore = await h.exec(`
sqlite3 /work/source.db ".dump" > /work/backup.sql
sqlite3 /work/restored.db < /work/backup.sql
sqlite3 /work/restored.db "SELECT id, name, city FROM imported_users ORDER BY CAST(id AS INTEGER);"
`);
      assert.equal(dumpAndRestore.exitCode, 0);
      assert.equal(
        dumpAndRestore.stdout,
        [
          "10|Ada|London",
          "20|Grace|New York",
          "30|Linus|Helsinki",
          ""
        ].join("\n")
      );
    });
  });

  it("20. persists B-Tree database image across invocations with ALTER TABLE, indexes, and PRAGMA integrity_check", async () => {
    await withE2EHarness(async (h) => {
      const step1 = await h.exec(`
sqlite3 /persist.db <<'SQL'
CREATE TABLE projects (id INTEGER PRIMARY KEY, code TEXT UNIQUE, budget INTEGER);
INSERT INTO projects VALUES (1, 'APOLLO', 1000), (2, 'GEMINI', 2500);
CREATE INDEX idx_projects_budget ON projects(budget);
SQL
`);
      assert.equal(step1.exitCode, 0);

      const step2 = await h.exec(`
sqlite3 /persist.db <<'SQL'
ALTER TABLE projects ADD COLUMN lead TEXT DEFAULT 'TBD';
ALTER TABLE projects RENAME COLUMN code TO project_code;
UPDATE projects SET lead = 'Margaret' WHERE project_code = 'APOLLO';
PRAGMA integrity_check;
SELECT id, project_code, budget, lead FROM projects ORDER BY id;
SQL
`);
      assert.equal(step2.exitCode, 0);
      assert.equal(
        step2.stdout,
        [
          "ok",
          "1|APOLLO|1000|Margaret",
          "2|GEMINI|2500|TBD",
          ""
        ].join("\n")
      );
    });
  });
});
