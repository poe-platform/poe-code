import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("safe-bash E2E: sqlite3 advanced SQL (window functions, recursive CTEs, triggers, upserts, JSON1, FTS5)", () => {
  it("1. evaluates ranking window functions: ROW_NUMBER, RANK, DENSE_RANK, and NTILE across partitions", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        sqlite3 /workspace/rank.db <<'SQL'
CREATE TABLE scores (dept TEXT, employee TEXT, score INT);
INSERT INTO scores VALUES
  ('eng', 'alice', 95),
  ('eng', 'bob', 95),
  ('eng', 'carol', 80),
  ('eng', 'dave', 70),
  ('sales', 'erin', 90),
  ('sales', 'frank', 85);
SELECT
  dept,
  employee,
  score,
  ROW_NUMBER() OVER (PARTITION BY dept ORDER BY score DESC, employee ASC) AS rn,
  RANK() OVER (PARTITION BY dept ORDER BY score DESC) AS rnk,
  DENSE_RANK() OVER (PARTITION BY dept ORDER BY score DESC) AS drnk,
  NTILE(2) OVER (PARTITION BY dept ORDER BY score DESC, employee ASC) AS tile
FROM scores
ORDER BY dept ASC, rn ASC;
SQL
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "eng|alice|95|1|1|1|1",
          "eng|bob|95|2|1|1|1",
          "eng|carol|80|3|3|2|2",
          "eng|dave|70|4|4|3|2",
          "sales|erin|90|1|1|1|1",
          "sales|frank|85|2|2|2|2",
          ""
        ].join("\n")
      );
    });
  });

  it("2. evaluates navigation window functions: LAG, LEAD, FIRST_VALUE, LAST_VALUE, and NTH_VALUE", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        sqlite3 /workspace/nav.db <<'SQL'
CREATE TABLE metrics (day INT, revenue INT);
INSERT INTO metrics VALUES (1, 100), (2, 150), (3, 130), (4, 200);
SELECT
  day,
  revenue,
  LAG(revenue, 1, 0) OVER (ORDER BY day) AS prev_rev,
  LEAD(revenue, 1, -1) OVER (ORDER BY day) AS next_rev,
  FIRST_VALUE(revenue) OVER (ORDER BY day) AS first_rev,
  NTH_VALUE(revenue, 2) OVER (ORDER BY day) AS second_rev
FROM metrics
ORDER BY day;
SQL
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "1|100|0|150|100|150",
          "2|150|100|130|100|150",
          "3|130|150|200|100|150",
          "4|200|130|-1|100|150",
          ""
        ].join("\n")
      );
    });
  });

  it("3. computes running totals and partitioned aggregates using SUM, COUNT, MIN, MAX OVER (...)", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        sqlite3 /workspace/running.db <<'SQL'
CREATE TABLE ledger (acct TEXT, seq INT, amount INT);
INSERT INTO ledger VALUES
  ('A', 1, 50),
  ('A', 2, 30),
  ('A', 3, -20),
  ('B', 1, 100),
  ('B', 2, 40);
SELECT
  acct,
  seq,
  amount,
  SUM(amount) OVER (PARTITION BY acct ORDER BY seq) AS running_balance,
  COUNT(*) OVER (PARTITION BY acct) AS acct_tx_count
FROM ledger
ORDER BY acct, seq;
SQL
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "A|1|50|50|3",
          "A|2|30|80|3",
          "A|3|-20|60|3",
          "B|1|100|100|2",
          "B|2|40|140|2",
          ""
        ].join("\n")
      );
    });
  });

  it("4. executes WITH RECURSIVE CTEs for sequence generation and hierarchical org-chart traversal", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        sqlite3 /workspace/org.db <<'SQL'
CREATE TABLE employees (id INT PRIMARY KEY, name TEXT, manager_id INT);
INSERT INTO employees VALUES
  (1, 'CEO', NULL),
  (2, 'VP_Eng', 1),
  (3, 'VP_Sales', 1),
  (4, 'TechLead', 2),
  (5, 'SeniorDev', 4);

WITH RECURSIVE org_tree(id, name, depth, path) AS (
  SELECT id, name, 0, name FROM employees WHERE manager_id IS NULL
  UNION ALL
  SELECT e.id, e.name, t.depth + 1, t.path || '->' || e.name
  FROM employees e
  JOIN org_tree t ON e.manager_id = t.id
)
SELECT id, depth, path FROM org_tree ORDER BY id;
SQL
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "1|0|CEO",
          "2|1|CEO->VP_Eng",
          "3|1|CEO->VP_Sales",
          "4|2|CEO->VP_Eng->TechLead",
          "5|3|CEO->VP_Eng->TechLead->SeniorDev",
          ""
        ].join("\n")
      );
    });
  });

  it("5. executes multi-CTE pipelines chaining multiple non-recursive CTEs", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        sqlite3 /workspace/multi_cte.db <<'SQL'
CREATE TABLE orders (customer TEXT, item TEXT, qty INT, unit_price INT);
INSERT INTO orders VALUES
  ('alice', 'book', 2, 15),
  ('alice', 'pen', 5, 2),
  ('bob', 'laptop', 1, 1000),
  ('carol', 'book', 1, 15);

WITH
  line_totals AS (
    SELECT customer, qty * unit_price AS line_total FROM orders
  ),
  customer_spend AS (
    SELECT customer, SUM(line_total) AS total_spend FROM line_totals GROUP BY customer
  )
SELECT customer, total_spend
FROM customer_spend
WHERE total_spend >= 30
ORDER BY total_spend DESC, customer ASC;
SQL
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "bob|1000\nalice|40\n");
    });
  });

  it("6. fires AFTER INSERT, AFTER UPDATE, and AFTER DELETE triggers with NEW and OLD references", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        sqlite3 /workspace/triggers.db <<'SQL'
CREATE TABLE accounts (id INT PRIMARY KEY, owner TEXT, balance INT);
CREATE TABLE audit_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, owner TEXT, delta INT);

CREATE TRIGGER trg_acct_insert AFTER INSERT ON accounts
BEGIN
  INSERT INTO audit_log(action, owner, delta) VALUES ('INSERT', NEW.owner, NEW.balance);
END;

CREATE TRIGGER trg_acct_update AFTER UPDATE ON accounts
BEGIN
  INSERT INTO audit_log(action, owner, delta) VALUES ('UPDATE', NEW.owner, NEW.balance - OLD.balance);
END;

CREATE TRIGGER trg_acct_delete AFTER DELETE ON accounts
BEGIN
  INSERT INTO audit_log(action, owner, delta) VALUES ('DELETE', OLD.owner, -OLD.balance);
END;

INSERT INTO accounts VALUES (1, 'alice', 100);
INSERT INTO accounts VALUES (2, 'bob', 250);
UPDATE accounts SET balance = 175 WHERE id = 1;
DELETE FROM accounts WHERE id = 2;

SELECT seq, action, owner, delta FROM audit_log ORDER BY seq;
SQL
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "1|INSERT|alice|100",
          "2|INSERT|bob|250",
          "3|UPDATE|alice|75",
          "4|DELETE|bob|-250",
          ""
        ].join("\n")
      );
    });
  });

  it("7. supports conditional triggers with WHEN clauses and BEFORE/AFTER multi-statement bodies", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        sqlite3 /workspace/guard_trig.db <<'SQL'
CREATE TABLE inventory (sku TEXT PRIMARY KEY, stock INT);
CREATE TABLE reorder_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT, remaining INT);

CREATE TRIGGER low_stock_alert AFTER UPDATE ON inventory
WHEN NEW.stock < 5 AND OLD.stock >= 5
BEGIN
  INSERT INTO reorder_alerts(sku, remaining) VALUES (NEW.sku, NEW.stock);
END;

INSERT INTO inventory VALUES ('SKU-1', 10), ('SKU-2', 8);
UPDATE inventory SET stock = 6 WHERE sku = 'SKU-1';
UPDATE inventory SET stock = 3 WHERE sku = 'SKU-1';
UPDATE inventory SET stock = 2 WHERE sku = 'SKU-1';
UPDATE inventory SET stock = 4 WHERE sku = 'SKU-2';
SELECT id, sku, remaining FROM reorder_alerts ORDER BY id;
SQL
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "1|SKU-1|3\n2|SKU-2|4\n");
    });
  });

  it("8. handles INSERT ... ON CONFLICT DO UPDATE (UPSERT) with excluded.col references and DO NOTHING", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        sqlite3 /workspace/upsert.db <<'SQL'
CREATE TABLE counters (key TEXT PRIMARY KEY, hits INT, note TEXT);
INSERT INTO counters VALUES ('home', 1, 'initial');
INSERT INTO counters VALUES ('home', 5, 'updated')
  ON CONFLICT(key) DO UPDATE SET hits = counters.hits + excluded.hits, note = excluded.note;
INSERT INTO counters VALUES ('home', 99, 'ignored')
  ON CONFLICT(key) DO NOTHING;
INSERT INTO counters VALUES ('about', 2, 'fresh')
  ON CONFLICT(key) DO UPDATE SET hits = counters.hits + excluded.hits;
SELECT key, hits, note FROM counters ORDER BY key;
SQL
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "about|2|fresh\nhome|6|updated\n");
    });
  });

  it("9. supports RETURNING clauses on INSERT, UPDATE, and DELETE statements", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        sqlite3 /workspace/returning.db <<'SQL'
CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, done INT DEFAULT 0);
INSERT INTO tasks(title) VALUES ('write tests'), ('ship rust') RETURNING id, title, done;
UPDATE tasks SET done = 1 WHERE id = 1 RETURNING id, title, done;
DELETE FROM tasks WHERE id = 2 RETURNING id, title;
SQL
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "1|write tests|0",
          "2|ship rust|0",
          "1|write tests|1",
          "2|ship rust",
          ""
        ].join("\n")
      );
    });
  });

  it("10. manages nested transactions with SAVEPOINT, ROLLBACK TO SAVEPOINT, and RELEASE SAVEPOINT", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        sqlite3 /workspace/savepoint.db <<'SQL'
CREATE TABLE items (name TEXT);
BEGIN;
INSERT INTO items VALUES ('one');
SAVEPOINT sp1;
INSERT INTO items VALUES ('two');
SAVEPOINT sp2;
INSERT INTO items VALUES ('three_discarded');
ROLLBACK TO SAVEPOINT sp2;
RELEASE SAVEPOINT sp1;
INSERT INTO items VALUES ('four');
COMMIT;
SELECT name FROM items ORDER BY rowid;
SQL
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "one\ntwo\nfour\n");
    });
  });

  it("11. performs schema migrations with ALTER TABLE ADD COLUMN, RENAME COLUMN, DROP COLUMN, and RENAME TO", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        sqlite3 /workspace/alter.db <<'SQL'
CREATE TABLE users (id INT PRIMARY KEY, username TEXT, legacy_col TEXT);
INSERT INTO users VALUES (1, 'alice', 'drop_me'), (2, 'bob', 'drop_me_too');
ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'member';
ALTER TABLE users RENAME COLUMN username TO handle;
ALTER TABLE users DROP COLUMN legacy_col;
ALTER TABLE users RENAME TO accounts;
INSERT INTO accounts(id, handle, role) VALUES (3, 'carol', 'admin');
SELECT id, handle, role FROM accounts ORDER BY id;
SQL
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "1|alice|member\n2|bob|member\n3|carol|admin\n");
    });
  });

  it("12. evaluates aggregate FILTER (WHERE ...) clauses alongside GROUP_CONCAT and TOTAL", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        sqlite3 /workspace/filter_agg.db <<'SQL'
CREATE TABLE events (service TEXT, status INT, latency_ms INT);
INSERT INTO events VALUES
  ('api', 200, 12),
  ('api', 500, 140),
  ('api', 200, 18),
  ('api', 503, 210),
  ('web', 200, 8),
  ('web', 200, 10);
SELECT
  service,
  COUNT(*) AS total_reqs,
  COUNT(*) FILTER (WHERE status >= 500) AS error_reqs,
  SUM(latency_ms) FILTER (WHERE status = 200) AS ok_latency_sum
FROM events
GROUP BY service
ORDER BY service;
SQL
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "api|4|2|30\nweb|2|0|18\n");
    });
  });

  it("13. queries and mutates JSON documents using json_extract, ->, ->>, json_set, json_insert, json_replace, json_remove, and json_patch", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        sqlite3 /workspace/json1.db <<'SQL'
CREATE TABLE configs (id INT PRIMARY KEY, doc TEXT);
INSERT INTO configs VALUES (1, '{"service":"auth","port":8080,"tags":["v1","prod"],"limits":{"rps":100}}');
SELECT
  doc ->> '$.service' AS svc,
  doc -> '$.port' AS port,
  json_extract(doc, '$.tags[1]') AS second_tag,
  json_type(doc, '$.limits') AS limits_type
FROM configs WHERE id = 1;

UPDATE configs
SET doc = json_patch(
  json_remove( json_set(doc, '$.port', 9090, '$.limits.burst', 250), '$.tags[0]' ),
  '{"region":"us-east"}'
)
WHERE id = 1;

SELECT
  json_extract(doc, '$.port'),
  json_extract(doc, '$.limits.burst'),
  json_extract(doc, '$.tags[0]'),
  json_extract(doc, '$.region')
FROM configs WHERE id = 1;
SQL
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "auth|8080|prod|object\n9090|250|prod|us-east\n");
    });
  });

  it("14. expands JSON arrays and objects into relational rows with json_each and json_tree", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        sqlite3 /workspace/json_tvf.db <<'SQL'
CREATE TABLE releases (pkg TEXT, tags_json TEXT);
INSERT INTO releases VALUES
  ('core', '["stable","lts"]'),
  ('cli', '["beta","canary"]');
SELECT r.pkg, j.key, j.value
FROM releases r, json_each(r.tags_json) j
ORDER BY r.pkg ASC, j.key ASC;
SQL
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "cli|0|beta",
          "cli|1|canary",
          "core|0|stable",
          "core|1|lts",
          ""
        ].join("\n")
      );
    });
  });

  it("15. aggregates rows into JSON structures using json_group_array and json_group_object", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        sqlite3 /workspace/json_agg.db <<'SQL'
CREATE TABLE kv (ns TEXT, k TEXT, v INT);
INSERT INTO kv VALUES ('a', 'x', 1), ('a', 'y', 2), ('b', 'z', 9);
SELECT ns, json_group_array(k), json_group_object(k, v)
FROM kv
GROUP BY ns
ORDER BY ns;
SQL
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        'a|["x","y"]|{"x":1,"y":2}\nb|["z"]|{"z":9}\n'
      );
    });
  });

  it("16. traverses deep JSON trees with json_tree and generates sequences with generate_series", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        sqlite3 /workspace/tvf.db <<'SQL'
SELECT value FROM generate_series(10, 25, 5);
SELECT fullkey, type, atom
FROM json_tree('{"app":{"name":"poe","ports":[80,443]}}')
WHERE atom IS NOT NULL
ORDER BY fullkey;
SQL
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "10",
          "15",
          "20",
          "25",
          "$.app.name|text|poe",
          "$.app.ports[0]|integer|80",
          "$.app.ports[1]|integer|443",
          ""
        ].join("\n")
      );
    });
  });

  it("17. combines queries with UNION, UNION ALL, INTERSECT, and EXCEPT set operations", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        sqlite3 /workspace/sets.db <<'SQL'
CREATE TABLE prod_hosts (host TEXT);
CREATE TABLE staging_hosts (host TEXT);
INSERT INTO prod_hosts VALUES ('db-1'), ('app-1'), ('cache-1');
INSERT INTO staging_hosts VALUES ('app-1'), ('cache-1'), ('dev-1');

SELECT 'common', host FROM (
  SELECT host FROM prod_hosts INTERSECT SELECT host FROM staging_hosts
) ORDER BY host;

SELECT 'prod_only', host FROM (
  SELECT host FROM prod_hosts EXCEPT SELECT host FROM staging_hosts
) ORDER BY host;

SELECT 'all_unique', host FROM (
  SELECT host FROM prod_hosts UNION SELECT host FROM staging_hosts
) ORDER BY host;
SQL
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "common|app-1",
          "common|cache-1",
          "prod_only|db-1",
          "all_unique|app-1",
          "all_unique|cache-1",
          "all_unique|db-1",
          "all_unique|dev-1",
          ""
        ].join("\n")
      );
    });
  });

  it("18. creates and queries relational VIEWs and TEMP tables with multi-table LEFT/INNER/CROSS JOINs", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        sqlite3 /workspace/views.db <<'SQL'
CREATE TABLE customers (id INT PRIMARY KEY, name TEXT);
CREATE TABLE invoices (id INT PRIMARY KEY, customer_id INT, total INT);
INSERT INTO customers VALUES (1, 'Alice'), (2, 'Bob'), (3, 'Charlie');
INSERT INTO invoices VALUES (101, 1, 50), (102, 1, 70), (103, 3, 200);

CREATE VIEW customer_summary AS
SELECT
  c.id AS cid,
  c.name AS name,
  COUNT(i.id) AS inv_count,
  TOTAL(i.total) AS total_billed
FROM customers c
LEFT JOIN invoices i ON c.id = i.customer_id
GROUP BY c.id, c.name;

SELECT cid, name, inv_count, CAST(total_billed AS INT) FROM customer_summary ORDER BY cid;
SQL
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "1|Alice|2|120",
          "2|Bob|0|0",
          "3|Charlie|1|200",
          ""
        ].join("\n")
      );
    });
  });

  it("19. evaluates correlated scalar subqueries, EXISTS, NOT EXISTS, and IN (SELECT ...)", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        sqlite3 /workspace/subq.db <<'SQL'
CREATE TABLE departments (id INT PRIMARY KEY, name TEXT);
CREATE TABLE staff (id INT PRIMARY KEY, dept_id INT, name TEXT, salary INT);
INSERT INTO departments VALUES (10, 'Engineering'), (20, 'Design'), (30, 'EmptyDept');
INSERT INTO staff VALUES
  (1, 10, 'Alice', 150),
  (2, 10, 'Bob', 120),
  (3, 20, 'Carol', 130);

SELECT
  d.name,
  (SELECT COUNT(*) FROM staff s WHERE s.dept_id = d.id) AS headcount,
  EXISTS (SELECT 1 FROM staff s WHERE s.dept_id = d.id AND s.salary >= 140) AS has_principal
FROM departments d
WHERE d.id IN (SELECT DISTINCT dept_id FROM staff)
ORDER BY d.id;

SELECT d.name FROM departments d
WHERE NOT EXISTS (SELECT 1 FROM staff s WHERE s.dept_id = d.id);
SQL
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "Engineering|2|1",
          "Design|1|0",
          "EmptyDept",
          ""
        ].join("\n")
      );
    });
  });

  it("20. dumps database schema and data with .dump and restores into a fresh database with full integrity", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        sqlite3 /workspace/orig.db <<'SQL'
CREATE TABLE products (id INT PRIMARY KEY, sku TEXT, price INT);
INSERT INTO products VALUES (1, 'A-100', 25), (2, 'B-200', 40), (3, 'C-300', 99);
SQL
        sqlite3 /workspace/orig.db ".dump" > /workspace/backup.sql
        sqlite3 /workspace/restored.db < /workspace/backup.sql
        sqlite3 /workspace/restored.db "SELECT id, sku, price FROM products ORDER BY id;"
        sqlite3 /workspace/restored.db "PRAGMA integrity_check;"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "1|A-100|25",
          "2|B-200|40",
          "3|C-300|99",
          "ok",
          ""
        ].join("\n")
      );
    });
  });
});
