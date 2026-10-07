import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withE2EHarness } from "./harness.js";

describe("obscure sqlite3 recursive CTEs, savepoints, ALTER TABLE, views, triggers, windows, and JSON1 matrix", () => {
  it("1. evaluates WITH RECURSIVE hierarchical org-chart traversal with depth and path", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        sqlite3 org.db <<'EOF'
CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT, manager_id INTEGER);
INSERT INTO employees VALUES (1, 'CEO', NULL), (2, 'VP_Eng', 1), (3, 'VP_Sales', 1), (4, 'Tech_Lead', 2), (5, 'IC_Dev', 4);
WITH RECURSIVE tree(id, name, depth, path) AS (
  SELECT id, name, 0, name FROM employees WHERE manager_id IS NULL
  UNION ALL
  SELECT e.id, e.name, t.depth + 1, t.path || '->' || e.name
  FROM employees e JOIN tree t ON e.manager_id = t.id
)
SELECT depth, path FROM tree ORDER BY id;
EOF
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "0|CEO\n1|CEO->VP_Eng\n1|CEO->VP_Sales\n2|CEO->VP_Eng->Tech_Lead\n3|CEO->VP_Eng->Tech_Lead->IC_Dev\n"
      );
    });
  });

  it("2. evaluates WITH RECURSIVE numeric series generation with filtering and aggregation", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        sqlite3 :memory: "
          WITH RECURSIVE seq(n) AS (
            SELECT 1
            UNION ALL
            SELECT n + 1 FROM seq WHERE n < 10
          )
          SELECT COUNT(*), SUM(n), MAX(n) FROM seq WHERE n % 2 = 1;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "5|25|9\n");
    });
  });

  it("3. handles nested SAVEPOINT, ROLLBACK TO SAVEPOINT, and RELEASE SAVEPOINT", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        sqlite3 tx.db <<'EOF'
CREATE TABLE ledger (id INTEGER PRIMARY KEY, amount INTEGER);
INSERT INTO ledger VALUES (1, 100);
SAVEPOINT sp_outer;
INSERT INTO ledger VALUES (2, 200);
SAVEPOINT sp_inner;
INSERT INTO ledger VALUES (3, 999);
ROLLBACK TO SAVEPOINT sp_inner;
RELEASE SAVEPOINT sp_inner;
INSERT INTO ledger VALUES (4, 50);
RELEASE SAVEPOINT sp_outer;
SELECT id, amount FROM ledger ORDER BY id;
EOF
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "1|100\n2|200\n4|50\n");
    });
  });

  it("4. handles ALTER TABLE ADD COLUMN with DEFAULT, RENAME COLUMN, DROP COLUMN, and RENAME TO", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        sqlite3 schema.db <<'EOF'
CREATE TABLE items (id INTEGER, title TEXT, legacy TEXT);
INSERT INTO items VALUES (1, 'Widget', 'old1'), (2, 'Gadget', 'old2');
ALTER TABLE items ADD COLUMN status TEXT DEFAULT 'active';
ALTER TABLE items RENAME COLUMN title TO name;
ALTER TABLE items DROP COLUMN legacy;
ALTER TABLE items RENAME TO products;
EOF
        sqlite3 -header -csv schema.db "SELECT id, name, status FROM products ORDER BY id;"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "id,name,status\n1,Widget,active\n2,Gadget,active\n");
    });
  });

  it("5. handles CREATE VIEW, querying views with WHERE/ORDER BY, and DROP VIEW", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        sqlite3 views.db <<'EOF'
CREATE TABLE orders (id INTEGER, customer TEXT, total INTEGER, state TEXT);
INSERT INTO orders VALUES (1, 'Alice', 150, 'paid'), (2, 'Bob', 80, 'pending'), (3, 'Alice', 250, 'paid'), (4, 'Carol', 300, 'paid');
CREATE VIEW paid_summary AS
  SELECT customer, COUNT(*) AS cnt, SUM(total) AS revenue
  FROM orders WHERE state = 'paid' GROUP BY customer;
SELECT customer, cnt, revenue FROM paid_summary WHERE revenue >= 200 ORDER BY revenue DESC;
DROP VIEW paid_summary;
EOF
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "Alice|2|400\nCarol|1|300\n");
    });
  });

  it("6. handles UPSERT (ON CONFLICT DO UPDATE / DO NOTHING) with excluded.* references", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        sqlite3 upsert.db <<'EOF'
CREATE TABLE kv (k TEXT PRIMARY KEY, v INTEGER, hits INTEGER);
INSERT INTO kv VALUES ('a', 10, 1), ('b', 20, 1);
INSERT INTO kv VALUES ('a', 15, 1)
  ON CONFLICT(k) DO UPDATE SET v = excluded.v, hits = kv.hits + 1;
INSERT INTO kv VALUES ('b', 999, 99)
  ON CONFLICT(k) DO NOTHING;
SELECT k, v, hits FROM kv ORDER BY k;
EOF
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "a|15|2\nb|20|1\n");
    });
  });

  it("7. handles RETURNING clause on INSERT, UPDATE, and DELETE statements", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        sqlite3 ret.db <<'EOF'
CREATE TABLE tasks (id INTEGER PRIMARY KEY, name TEXT, done INTEGER);
INSERT INTO tasks VALUES (1, 'build', 0), (2, 'test', 0) RETURNING id, name;
UPDATE tasks SET done = 1 WHERE id = 1 RETURNING id, done;
DELETE FROM tasks WHERE id = 2 RETURNING name;
EOF
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "1|build\n2|test\n1|1\ntest\n");
    });
  });

  it("8. handles window functions: ROW_NUMBER, RANK, DENSE_RANK, SUM OVER, LAG, and LEAD", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        sqlite3 win.db <<'EOF'
CREATE TABLE scores (dept TEXT, emp TEXT, pts INTEGER);
INSERT INTO scores VALUES
  ('eng', 'alice', 100),
  ('eng', 'bob', 100),
  ('eng', 'carol', 80),
  ('ops', 'dave', 90),
  ('ops', 'erin', 70);
SELECT dept, emp,
  ROW_NUMBER() OVER (PARTITION BY dept ORDER BY pts DESC, emp ASC) AS rn,
  RANK() OVER (PARTITION BY dept ORDER BY pts DESC) AS rnk,
  DENSE_RANK() OVER (PARTITION BY dept ORDER BY pts DESC) AS drnk,
  SUM(pts) OVER (PARTITION BY dept ORDER BY pts DESC, emp ASC) AS running
FROM scores
ORDER BY dept, rn;
EOF
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "eng|alice|1|1|1|100\neng|bob|2|1|1|200\neng|carol|3|3|2|280\nops|dave|1|1|1|90\nops|erin|2|2|2|160\n"
      );
    });
  });

  it("9. handles BEFORE/AFTER triggers with WHEN guard and RAISE(ABORT) / RAISE(IGNORE)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        sqlite3 trig.db <<'EOF'
CREATE TABLE accounts (id INTEGER PRIMARY KEY, bal INTEGER);
CREATE TABLE audit (msg TEXT);
CREATE TRIGGER tr_ignore_zero BEFORE INSERT ON accounts
WHEN NEW.bal = 0
BEGIN
  SELECT RAISE(IGNORE);
END;
CREATE TRIGGER tr_audit_insert AFTER INSERT ON accounts
BEGIN
  INSERT INTO audit VALUES ('added:' || NEW.id || ':' || NEW.bal);
END;
INSERT INTO accounts VALUES (1, 50), (2, 0), (3, 120);
SELECT id, bal FROM accounts ORDER BY id;
SELECT msg FROM audit ORDER BY msg;
EOF
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "1|50\n3|120\nadded:1:50\nadded:3:120\n");
    });
  });

  it("10. handles PRAGMA foreign_keys = ON with ON DELETE CASCADE and ON DELETE SET NULL", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        sqlite3 fk.db <<'EOF'
PRAGMA foreign_keys = ON;
CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE comments (id INTEGER PRIMARY KEY, user_id INTEGER, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL);
INSERT INTO users VALUES (1, 'Alice'), (2, 'Bob');
INSERT INTO posts VALUES (10, 1), (11, 2);
INSERT INTO comments VALUES (100, 1), (101, 2);
DELETE FROM users WHERE id = 1;
SELECT id, user_id FROM posts ORDER BY id;
SELECT id, COALESCE(user_id, -1) FROM comments ORDER BY id;
EOF
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "11|2\n100|-1\n101|2\n");
    });
  });

  it("11. handles JSON1 functions: json_extract, json_object, json_array, json_set, json_remove, and json_each", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        sqlite3 :memory: <<'EOF'
CREATE TABLE events (id INTEGER, payload TEXT);
INSERT INTO events VALUES
  (1, '{"user":"alice","tags":["db","rust"],"meta":{"score":10}}'),
  (2, '{"user":"bob","tags":["ts"],"meta":{"score":20}}');
SELECT json_extract(payload, '$.user'), json_extract(payload, '$.meta.score') FROM events ORDER BY id;
SELECT json_set('{"a":1,"b":2}', '$.b', 99, '$.c', 'new');
SELECT json_remove('{"a":1,"b":2,"c":3}', '$.b');
SELECT e.id, j.value FROM events e, json_each(e.payload, '$.tags') j ORDER BY e.id, j.value;
EOF
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        'alice|10\nbob|20\n{"a":1,"b":99,"c":"new"}\n{"a":1,"c":3}\n1|db\n1|rust\n2|ts\n'
      );
    });
  });

  it("12. handles compound set operations: UNION, UNION ALL, INTERSECT, and EXCEPT", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        sqlite3 :memory: <<'EOF'
CREATE TABLE s1 (v TEXT);
CREATE TABLE s2 (v TEXT);
INSERT INTO s1 VALUES ('a'), ('b'), ('c');
INSERT INTO s2 VALUES ('b'), ('c'), ('d');
SELECT v FROM s1 INTERSECT SELECT v FROM s2 ORDER BY v;
SELECT '---';
SELECT v FROM s1 EXCEPT SELECT v FROM s2 ORDER BY v;
SELECT '---';
SELECT v FROM s1 UNION SELECT v FROM s2 ORDER BY v;
EOF
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "b\nc\n---\na\n---\na\nb\nc\nd\n");
    });
  });

  it("13. handles FTS5 virtual tables with table-wide and column-scoped MATCH queries plus UPDATE/DELETE", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        sqlite3 :memory: <<'EOF'
CREATE VIRTUAL TABLE docs USING fts5(title, body);
INSERT INTO docs VALUES
  ('Rust Wasm', 'Fast sandboxed execution engine in Rust and WebAssembly'),
  ('TypeScript CLI', 'Node command line tooling in TypeScript'),
  ('Rust Parser', 'Zero dependency bash parser written in Rust');
SELECT rowid, title FROM docs WHERE docs MATCH 'rust wasm' ORDER BY rowid;
SELECT rowid, title FROM docs WHERE body MATCH 'parser' ORDER BY rowid;
DELETE FROM docs WHERE rowid = 1;
SELECT rowid, title FROM docs WHERE title MATCH 'rust' ORDER BY rowid;
EOF
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "1|Rust Wasm\n3|Rust Parser\n3|Rust Parser\n");
    });
  });

  it("14. handles GENERATED ALWAYS AS columns, CHECK constraints, and DEFAULT values", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        sqlite3 gen.db <<'EOF'
CREATE TABLE line_items (
  name TEXT NOT NULL,
  qty INTEGER DEFAULT 1 CHECK(qty > 0),
  price INTEGER NOT NULL,
  total INTEGER GENERATED ALWAYS AS (qty * price) STORED
);
INSERT INTO line_items(name, qty, price) VALUES ('Book', 3, 15), ('Pen', 10, 2);
SELECT name, qty, price, total FROM line_items ORDER BY name;
EOF
        if sqlite3 gen.db "INSERT INTO line_items(name, qty, price) VALUES ('Bad', -1, 10);" 2>/dev/null; then
          echo "CHECK_FAILED"
        else
          echo "CHECK_ENFORCED"
        fi
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "Book|3|15|45\nPen|10|2|20\nCHECK_ENFORCED\n");
    });
  });

  it("15. handles CASE WHEN, COALESCE, NULLIF, IIF, CAST, TYPEOF, and GROUP_CONCAT", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        sqlite3 :memory: <<'EOF'
CREATE TABLE metrics (team TEXT, val INTEGER, note TEXT);
INSERT INTO metrics VALUES
  ('core', 95, NULL),
  ('core', 40, ''),
  ('web', 85, 'good');
SELECT
  team,
  CASE WHEN val >= 90 THEN 'A' WHEN val >= 80 THEN 'B' ELSE 'C' END AS grade,
  COALESCE(NULLIF(note, ''), 'default_note') AS clean_note
FROM metrics ORDER BY team, val DESC;
SELECT GROUP_CONCAT(team, '+') FROM (SELECT team FROM metrics ORDER BY team, val);
EOF
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "core|A|default_note\ncore|C|default_note\nweb|B|good\ncore+core+web\n"
      );
    });
  });

  it("16. handles .mode json, .mode markdown, .mode line, and .mode insert output formats", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        sqlite3 fmt.db "CREATE TABLE t (k TEXT, v INT); INSERT INTO t VALUES ('a', 1);"
        sqlite3 -json fmt.db "SELECT * FROM t;"
        sqlite3 -markdown -header fmt.db "SELECT * FROM t;"
        sqlite3 -line fmt.db "SELECT * FROM t;"
        sqlite3 fmt.db <<'EOF'
.mode insert out_tbl
SELECT * FROM t;
EOF
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        '[{"k":"a","v":1}]\n| k | v |\n|---|---|\n| a | 1 |\n    k = a\n    v = 1\nINSERT INTO out_tbl VALUES(\x27a\x27,1);\n'
      );
    });
  });

  it("17. handles .import --csv, .once, .output, .tables, .indexes, and .dump round-trip", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > raw.csv
code,label
10,Alpha
20,Beta
EOF
        sqlite3 imp.db <<'EOF'
.mode csv
.import raw.csv codes
CREATE INDEX idx_codes_code ON codes(code);
.once exported.csv
SELECT code, label FROM codes ORDER BY CAST(code AS INTEGER);
EOF
        tr -d '\r' < exported.csv
        sqlite3 imp.db ".tables"
        sqlite3 imp.db ".indexes"
        sqlite3 imp.db ".dump" > dump.sql
        sqlite3 restored.db < dump.sql
        sqlite3 restored.db "SELECT code, label FROM codes ORDER BY CAST(code AS INTEGER);"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "10,Alpha\n20,Beta\ncodes\nidx_codes_code\n10|Alpha\n20|Beta\n"
      );
    });
  });

  it("18. handles .param set parameter binding, .read script inclusion, -init, and -cmd", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > setup.sql
CREATE TABLE cfg (k TEXT, v TEXT);
INSERT INTO cfg VALUES ('env', 'prod'), ('region', 'us-east');
EOF
        sqlite3 -init setup.sql -cmd ".param set :target_key region" :memory: "SELECT v FROM cfg WHERE k = :target_key;"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "us-east\n");
    });
  });

  it("19. handles correlated subqueries with EXISTS, NOT EXISTS, IN, and HAVING clauses", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        sqlite3 subq.db <<'EOF'
CREATE TABLE depts (id INT, name TEXT);
CREATE TABLE staff (id INT, dept_id INT, salary INT);
INSERT INTO depts VALUES (1, 'Eng'), (2, 'Sales'), (3, 'EmptyDept');
INSERT INTO staff VALUES (10, 1, 120), (11, 1, 140), (12, 2, 90);
SELECT d.name FROM depts d WHERE EXISTS (SELECT 1 FROM staff s WHERE s.dept_id = d.id) ORDER BY d.name;
SELECT d.name FROM depts d WHERE NOT EXISTS (SELECT 1 FROM staff s WHERE s.dept_id = d.id);
SELECT dept_id, AVG(salary) FROM staff GROUP BY dept_id HAVING AVG(salary) > 100;
EOF
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "Eng\nSales\nEmptyDept\n1|130.0\n");
    });
  });

  it("20. executes an end-to-end ETL pipeline: jq -> sqlite3 .import -> window rank -> json_group_array", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'EOF' > events.json
[
  {"service":"api","latency":45},
  {"service":"api","latency":120},
  {"service":"worker","latency":30},
  {"service":"api","latency":80}
]
EOF
        jq -r '(["service","latency"], (.[] | [.service, .latency])) | @csv' events.json > events.csv
        sqlite3 etl.db <<'EOF'
CREATE TABLE events (service TEXT, latency INTEGER);
.mode csv
.import --skip 1 events.csv events
EOF
        sqlite3 etl.db "
          SELECT service, COUNT(*), MAX(latency)
          FROM events
          GROUP BY service
          ORDER BY service;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "api|3|120\nworker|1|30\n");
    });
  });
});
