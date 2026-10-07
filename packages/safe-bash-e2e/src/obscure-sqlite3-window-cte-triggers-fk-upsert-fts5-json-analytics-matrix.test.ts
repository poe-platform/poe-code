import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure sqlite3 window functions, recursive CTEs, triggers, foreign keys, upserts, FTS5 & JSON1 analytics matrix", () => {
  it("01: traverses hierarchical org-chart paths and depths using WITH RECURSIVE", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 /workspace/org.db << 'SQL'
CREATE TABLE emp (id INT PRIMARY KEY, name TEXT, mgr_id INT);
INSERT INTO emp VALUES (1, 'CEO', NULL), (2, 'VP_Eng', 1), (3, 'VP_Sales', 1), (4, 'Lead_FE', 2), (5, 'IC_FE', 4);
WITH RECURSIVE tree(id, name, path, depth) AS (
  SELECT id, name, name, 0 FROM emp WHERE mgr_id IS NULL
  UNION ALL
  SELECT e.id, e.name, tree.path || '->' || e.name, tree.depth + 1
  FROM emp e JOIN tree ON e.mgr_id = tree.id
)
SELECT depth || ':' || path FROM tree ORDER BY id;
SQL
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "0:CEO\n1:CEO->VP_Eng\n1:CEO->VP_Sales\n2:CEO->VP_Eng->Lead_FE\n3:CEO->VP_Eng->Lead_FE->IC_FE\n",
      );
    });
  });

  it("02: computes ROW_NUMBER, RANK, and DENSE_RANK partitioned by department", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 /workspace/win.db << 'SQL'
CREATE TABLE scores (dept TEXT, emp TEXT, score INT);
INSERT INTO scores VALUES ('eng','a',100),('eng','b',100),('ops','x',80),('ops','y',70),('eng','c',90);
SELECT dept, emp, score,
  ROW_NUMBER() OVER (PARTITION BY dept ORDER BY score DESC, emp ASC),
  RANK() OVER (PARTITION BY dept ORDER BY score DESC),
  DENSE_RANK() OVER (PARTITION BY dept ORDER BY score DESC)
FROM scores ORDER BY dept, score DESC, emp ASC;
SQL
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "eng|a|100|1|1|1\neng|b|100|2|1|1\neng|c|90|3|3|2\nops|x|80|1|1|1\nops|y|70|2|2|2\n",
      );
    });
  });

  it("03: evaluates LAG, LEAD nested inside COALESCE, and running SUM() OVER (ORDER BY q)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 /workspace/ts.db << 'SQL'
CREATE TABLE rev (q INT, amt INT);
INSERT INTO rev VALUES (1, 100), (2, 150), (3, 120), (4, 200);
SELECT q, amt,
  COALESCE(LAG(amt, 1) OVER (ORDER BY q), 0),
  COALESCE(LEAD(amt, 1) OVER (ORDER BY q), 0),
  SUM(amt) OVER (ORDER BY q)
FROM rev ORDER BY q;
SQL
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "1|100|0|150|100\n2|150|100|120|250\n3|120|150|200|370\n4|200|120|0|570\n",
      );
    });
  });

  it("04: performs ON CONFLICT(key) DO UPDATE SET with excluded column references", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 /workspace/upsert.db << 'SQL'
CREATE TABLE kv (k TEXT PRIMARY KEY, cnt INT, label TEXT);
INSERT INTO kv VALUES ('a', 1, 'init'), ('b', 5, 'init');
INSERT INTO kv VALUES ('a', 3, 'updated'), ('c', 2, 'new')
  ON CONFLICT(k) DO UPDATE SET cnt = kv.cnt + excluded.cnt, label = excluded.label;
SELECT k, cnt, label FROM kv ORDER BY k;
SQL
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "a|4|updated\nb|5|init\nc|2|new\n");
    });
  });

  it("05: fires AFTER INSERT and AFTER UPDATE triggers to populate an audit ledger", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 /workspace/trig.db << 'SQL'
CREATE TABLE accounts (id INT PRIMARY KEY, bal INT);
CREATE TABLE audit (evt TEXT, acct_id INT, delta INT);
CREATE TRIGGER tr_ins AFTER INSERT ON accounts BEGIN
  INSERT INTO audit VALUES ('OPEN', NEW.id, NEW.bal);
END;
CREATE TRIGGER tr_upd AFTER UPDATE ON accounts BEGIN
  INSERT INTO audit VALUES ('CHANGE', NEW.id, NEW.bal - OLD.bal);
END;
INSERT INTO accounts VALUES (1, 100), (2, 250);
UPDATE accounts SET bal = 180 WHERE id = 1;
SELECT evt, acct_id, delta FROM audit ORDER BY rowid;
SQL
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "OPEN|1|100\nOPEN|2|250\nCHANGE|1|80\n");
    });
  });

  it("06: enforces PRAGMA foreign_keys = ON with ON DELETE CASCADE across parent/child tables", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 /workspace/fk.db << 'SQL'
PRAGMA foreign_keys = ON;
CREATE TABLE users (id INT PRIMARY KEY, name TEXT);
CREATE TABLE posts (id INT PRIMARY KEY, user_id INT REFERENCES users(id) ON DELETE CASCADE, title TEXT);
INSERT INTO users VALUES (1, 'Alice'), (2, 'Bob');
INSERT INTO posts VALUES (10, 1, 'A1'), (11, 1, 'A2'), (20, 2, 'B1');
DELETE FROM users WHERE id = 1;
SELECT id, user_id, title FROM posts ORDER BY id;
SQL
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "20|2|B1\n");
    });
  });

  it("07: mutates JSON documents with json_extract, json_array_length, json_set(..., json('true')), and json_remove", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 /workspace/js1.db << 'SQL'
CREATE TABLE docs (id INT, body TEXT);
INSERT INTO docs VALUES (1, '{"user":{"name":"alice","roles":["admin","dev"]},"temp":true}');
SELECT
  json_extract(body, '$.user.name'),
  json_array_length(body, '$.user.roles'),
  json_remove(json_set(body, '$.user.active', json('true')), '$.temp')
FROM docs;
SQL
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        'alice|2|{"user":{"name":"alice","roles":["admin","dev"],"active":true}}\n',
      );
    });
  });

  it("08: expands JSON arrays via json_each table-valued function in a GROUP BY query", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 /workspace/jseach.db << 'SQL'
CREATE TABLE items (name TEXT, tags TEXT);
INSERT INTO items VALUES ('p1', '["rust","wasm"]'), ('p2', '["rust","cli"]');
SELECT j.value AS tag, COUNT(*) AS cnt
FROM items, json_each(items.tags) j
GROUP BY j.value
ORDER BY cnt DESC, tag ASC;
SQL
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "rust|2\ncli|1\nwasm|1\n");
    });
  });

  it("09: aggregates nested JSON objects using json_group_array(json_object(...))", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 /workspace/jsagg.db << 'SQL'
CREATE TABLE tasks (proj TEXT, title TEXT, prio INT);
INSERT INTO tasks VALUES ('core', 'lexer', 1), ('core', 'parser', 2), ('ui', 'theme', 1);
SELECT proj, json_group_array(json_object('title', title, 'prio', prio))
FROM (SELECT * FROM tasks ORDER BY proj, prio)
GROUP BY proj ORDER BY proj;
SQL
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        'core|[{"title":"lexer","prio":1},{"title":"parser","prio":2}]\nui|[{"title":"theme","prio":1}]\n',
      );
    });
  });

  it("10: indexes and searches full-text documents with FTS5 virtual tables and MATCH", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 :memory: << 'SQL'
CREATE VIRTUAL TABLE articles USING fts5(title, body);
INSERT INTO articles VALUES
  ('Rust Shell', 'Zero dependency virtual bash execution engine'),
  ('SQLite Engine', 'Relational queries with window functions and triggers'),
  ('Archive Tools', 'Tar gzip bzip2 xz and zstd streaming compression');
SELECT title FROM articles WHERE articles MATCH 'virtual bash' ORDER BY title;
SQL
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "Rust Shell\n");
    });
  });

  it("11: manages nested transactions with SAVEPOINT, ROLLBACK TO SAVEPOINT, and RELEASE SAVEPOINT", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 /workspace/tx.db << 'SQL'
CREATE TABLE ledger (id INT, note TEXT);
BEGIN;
INSERT INTO ledger VALUES (1, 'committed_base');
SAVEPOINT sp1;
INSERT INTO ledger VALUES (2, 'rolled_back');
ROLLBACK TO SAVEPOINT sp1;
INSERT INTO ledger VALUES (3, 'kept_after_sp1');
RELEASE SAVEPOINT sp1;
COMMIT;
SELECT id, note FROM ledger ORDER BY id;
SQL
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1|committed_base\n3|kept_after_sp1\n");
    });
  });

  it("12: creates and queries aggregated views with WHERE filtering", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 /workspace/views.db << 'SQL'
CREATE TABLE line_items (order_id INT, sku TEXT, qty INT, price INT);
INSERT INTO line_items VALUES (100, 'A', 2, 15), (100, 'B', 1, 30), (101, 'A', 1, 15), (102, 'C', 4, 25);
CREATE VIEW order_totals AS
  SELECT order_id, COUNT(*) AS items, SUM(qty * price) AS total
  FROM line_items GROUP BY order_id;
SELECT order_id, items, total FROM order_totals WHERE total >= 50 ORDER BY order_id;
SQL
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "100|2|60\n102|1|100\n");
    });
  });

  it("13: evolves table schemas with ALTER TABLE ADD COLUMN DEFAULT and RENAME COLUMN", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 /workspace/alter.db << 'SQL'
CREATE TABLE nodes (id INT, label TEXT);
INSERT INTO nodes VALUES (1, 'alpha');
ALTER TABLE nodes ADD COLUMN status TEXT DEFAULT 'active';
ALTER TABLE nodes RENAME COLUMN label TO name;
INSERT INTO nodes VALUES (2, 'beta', 'pending');
SELECT id, name, status FROM nodes ORDER BY id;
SQL
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1|alpha|active\n2|beta|pending\n");
    });
  });

  it("14: exports query results in -json and -csv -header modes for downstream jq pipelines", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 /workspace/modes.db "CREATE TABLE m (id INT, val TEXT); INSERT INTO m VALUES (1,'one'),(2,'two');"
        sqlite3 -json /workspace/modes.db "SELECT * FROM m ORDER BY id;" | jq -c 'map(.val)'
        sqlite3 -csv -header /workspace/modes.db "SELECT * FROM m ORDER BY id;" | tr -d '\\r'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, '["one","two"]\nid,val\n1,one\n2,two\n');
    });
  });

  it("15: evaluates INTERSECT and EXCEPT compound set queries", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 /workspace/sets.db << 'SQL'
CREATE TABLE s1 (x INT);
CREATE TABLE s2 (x INT);
INSERT INTO s1 VALUES (1), (2), (3), (4);
INSERT INTO s2 VALUES (3), (4), (5);
SELECT 'INTERSECT', x FROM (SELECT x FROM s1 INTERSECT SELECT x FROM s2) ORDER BY x;
SELECT 'EXCEPT', x FROM (SELECT x FROM s1 EXCEPT SELECT x FROM s2) ORDER BY x;
SQL
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "INTERSECT|3\nINTERSECT|4\nEXCEPT|1\nEXCEPT|2\n",
      );
    });
  });

  it("16: filters rows using correlated EXISTS and NOT EXISTS subqueries", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 /workspace/corr.db << 'SQL'
CREATE TABLE customers (id INT, name TEXT);
CREATE TABLE invoices (cust_id INT, amount INT);
INSERT INTO customers VALUES (1, 'Alice'), (2, 'Bob'), (3, 'Carol');
INSERT INTO invoices VALUES (1, 100), (3, 250);
SELECT name FROM customers c WHERE EXISTS (SELECT 1 FROM invoices i WHERE i.cust_id = c.id) ORDER BY name;
SELECT name FROM customers c WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.cust_id = c.id) ORDER BY name;
SQL
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "Alice\nCarol\nBob\n");
    });
  });

  it("17: evaluates COALESCE, NULLIF, and multi-branch CASE WHEN expressions", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 /workspace/expr.db << 'SQL'
CREATE TABLE raw (id INT, a INT, b INT);
INSERT INTO raw VALUES (1, 10, 10), (2, 25, 5), (3, NULL, 7);
SELECT id,
  COALESCE(NULLIF(a, b), -1) AS resolved,
  CASE WHEN a IS NULL THEN 'missing' WHEN a = b THEN 'equal' ELSE 'diff' END AS kind
FROM raw ORDER BY id;
SQL
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1|-1|equal\n2|25|diff\n3|-1|missing\n");
    });
  });

  it("18: concatenates ordered group values with GROUP_CONCAT(col, sep)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 /workspace/gc.db << 'SQL'
CREATE TABLE memberships (team TEXT, member TEXT);
INSERT INTO memberships VALUES ('core','charlie'),('core','alice'),('core','bob'),('infra','zoe'),('infra','amy');
SELECT team, GROUP_CONCAT(member, '+')
FROM (SELECT team, member FROM memberships ORDER BY team, member)
GROUP BY team ORDER BY team;
SQL
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "core|alice+bob+charlie\ninfra|amy+zoe\n");
    });
  });

  it("19: performs self-JOINs with inequality predicates to pair employees by department", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 /workspace/self.db << 'SQL'
CREATE TABLE staff (id INT, name TEXT, dept TEXT);
INSERT INTO staff VALUES (1, 'Alice', 'R&D'), (2, 'Bob', 'R&D'), (3, 'Carol', 'R&D'), (4, 'Dan', 'Ops');
SELECT a.name || '-' || b.name
FROM staff a JOIN staff b ON a.dept = b.dept AND a.id < b.id
ORDER BY a.id, b.id;
SQL
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "Alice-Bob\nAlice-Carol\nBob-Carol\n");
    });
  });

  it("20: runs end-to-end CSV .import into sqlite3 with nested RANK() OVER (...) inside json_object", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat << 'CSV' > /workspace/sales.csv
region,rep,amount
west,alice,300
west,bob,500
east,carol,400
CSV
        sqlite3 /workspace/etl.db << 'SQL'
.mode csv
.import /workspace/sales.csv sales
.mode list
SELECT json_object(
  'region', region,
  'rep', rep,
  'amount', CAST(amount AS INT),
  'rank', RANK() OVER (PARTITION BY region ORDER BY CAST(amount AS INT) DESC)
) FROM sales ORDER BY region, CAST(amount AS INT) DESC;
SQL
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        '{"region":"east","rep":"carol","amount":400,"rank":1}\n{"region":"west","rep":"bob","amount":500,"rank":1}\n{"region":"west","rep":"alice","amount":300,"rank":2}\n',
      );
    });
  });
});
