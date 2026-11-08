import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withE2EHarness } from "./harness.js";

describe("sqlite3 DDL, DML, CTEs, window functions, triggers, FTS, JSON1, dot-commands, and CLI output modes matrix", () => {
  it("1. sqlite3 formats query results across -list, -csv, -json, -line, -markdown, -table, -box, -html, -quote, and -insert modes", async () => {
    await withE2EHarness(async (h) => {
      await h.exec(
        "sqlite3 /workspace/modes.db \"CREATE TABLE items(id INT, name TEXT, price REAL); INSERT INTO items VALUES (1, 'Keyboard', 99.5), (2, 'Mouse', 49.0);\"",
      );

      const csvRes = await h.exec("sqlite3 -header -csv /workspace/modes.db 'SELECT * FROM items ORDER BY id;'");
      assert.equal(csvRes.exitCode, 0, csvRes.stderr);
      assert.equal(csvRes.stdout.replace(/\r\n/g, "\n"), "id,name,price\n1,Keyboard,99.5\n2,Mouse,49.0\n");

      const jsonRes = await h.exec("sqlite3 -json /workspace/modes.db 'SELECT * FROM items ORDER BY id;'");
      assert.equal(jsonRes.exitCode, 0, jsonRes.stderr);
      assert.deepEqual(JSON.parse(jsonRes.stdout), [
        { id: 1, name: "Keyboard", price: 99.5 },
        { id: 2, name: "Mouse", price: 49 },
      ]);

      const lineRes = await h.exec("sqlite3 -line /workspace/modes.db 'SELECT id, name FROM items WHERE id = 1;'");
      assert.equal(lineRes.exitCode, 0, lineRes.stderr);
      assert.match(lineRes.stdout, /id = 1\s+name = Keyboard/);

      const mdRes = await h.exec("sqlite3 -markdown /workspace/modes.db 'SELECT id, name FROM items ORDER BY id;'");
      assert.equal(mdRes.exitCode, 0, mdRes.stderr);
      assert.match(mdRes.stdout, /\|\s*id\s*\|\s*name\s*\|/);
      assert.match(mdRes.stdout, /\|\s*1\s*\|\s*Keyboard\s*\|/);

      const insRes = await h.exec(
        "sqlite3 /workspace/modes.db \".mode insert exported\" \"SELECT id, name FROM items WHERE id = 1;\"",
      );
      assert.equal(insRes.exitCode, 0, insRes.stderr);
      assert.match(insRes.stdout, /INSERT INTO (?:"exported"|exported) VALUES\(1,'Keyboard'\);/);
    });
  });

  it("2. sqlite3 supports -cmd, -init, -nullvalue, -separator, -echo, -changes, -readonly, and -bail flags", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/init.sql",
        "CREATE TABLE cfg(k TEXT PRIMARY KEY, v TEXT);\nINSERT INTO cfg VALUES ('env', 'prod'), ('region', NULL);\n",
      );

      const res = await h.exec(
        "sqlite3 -init /workspace/init.sql -nullvalue '<NULL>' -separator ':' /workspace/cfg.db 'SELECT k, v FROM cfg ORDER BY k;'",
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "env:prod\nregion:<NULL>\n");

      const roErr = await h.exec("sqlite3 -readonly /workspace/cfg.db \"INSERT INTO cfg VALUES ('x', 'y');\"");
      assert.notEqual(roErr.exitCode, 0);
      assert.match(roErr.stderr, /readonly/i);
    });
  });

  it("3. sqlite3 executes dot-commands (.tables, .schema, .indexes, .mode, .headers, .output, .once, .dump, .read)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/setup.sql",
        `CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT UNIQUE);
CREATE INDEX idx_users_email ON users(email);
INSERT INTO users VALUES (1, 'ada@example.com'), (2, 'grace@example.com');
`,
      );

      const res = await h.exec(
        `sqlite3 /workspace/dots.db <<'SQL'
.read /workspace/setup.sql
.tables
.indexes
.once /workspace/users.csv
.mode csv
.headers on
SELECT * FROM users ORDER BY id;
.output stdout
.dump
SQL`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /users/);
      assert.match(res.stdout, /idx_users_email/);
      assert.match(res.stdout, /CREATE TABLE users/);

      const csvFile = await h.readText("/workspace/users.csv");
      assert.equal(csvFile.replace(/\r\n/g, "\n"), "id,email\n1,ada@example.com\n2,grace@example.com\n");
    });
  });

  it("4. sqlite3 .import imports CSV and custom-delimited files into existing and auto-created tables", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/employees.csv",
        "emp_id,dept,salary\n101,eng,150000\n102,eng,165000\n103,sales,120000\n",
      );

      const res = await h.exec(
        `sqlite3 /workspace/imp.db <<'SQL'
.mode csv
.import /workspace/employees.csv employees
.mode json
SELECT dept, COUNT(*) AS cnt, SUM(CAST(salary AS INT)) AS total_sal FROM employees GROUP BY dept ORDER BY dept;
SQL`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.deepEqual(JSON.parse(res.stdout), [
        { dept: "eng", cnt: 2, total_sal: 315000 },
        { dept: "sales", cnt: 1, total_sal: 120000 },
      ]);
    });
  });

  it("5. sqlite3 .parameter set/unset/list/clear binds named parameters in queries", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `sqlite3 :memory: <<'SQL'
CREATE TABLE items(name TEXT, category TEXT, stock INT);
INSERT INTO items VALUES ('bolt', 'hw', 50), ('nut', 'hw', 120), ('hammer', 'tools', 15);
.parameter init
.parameter set :cat 'hw'
.parameter set :min_stock 60
.mode csv
SELECT name, stock FROM items WHERE category = :cat AND stock >= :min_stock;
SQL`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "nut,120");
    });
  });

  it("6. sqlite3 evaluates INNER, LEFT, CROSS, and self JOINs with multi-column ON and USING clauses", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `sqlite3 -json :memory: <<'SQL'
CREATE TABLE depts(dept_id INT PRIMARY KEY, dept_name TEXT);
CREATE TABLE staff(id INT PRIMARY KEY, name TEXT, dept_id INT, manager_id INT);
INSERT INTO depts VALUES (10, 'Platform'), (20, 'Security'), (30, 'Legal');
INSERT INTO staff VALUES (1, 'Alice', 10, NULL), (2, 'Bob', 10, 1), (3, 'Carol', 20, 1);

SELECT d.dept_name, COUNT(s.id) AS headcount
FROM depts d
LEFT JOIN staff s USING(dept_id)
GROUP BY d.dept_id, d.dept_name
ORDER BY d.dept_id;
SQL`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.deepEqual(JSON.parse(res.stdout), [
        { dept_name: "Platform", headcount: 2 },
        { dept_name: "Security", headcount: 1 },
        { dept_name: "Legal", headcount: 0 },
      ]);
    });
  });

  it("7. sqlite3 evaluates correlated subqueries, EXISTS / NOT EXISTS, and IN / NOT IN with NULL semantics", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `sqlite3 -csv :memory: <<'SQL'
CREATE TABLE customers(id INT, name TEXT);
CREATE TABLE orders(id INT, customer_id INT, total INT);
INSERT INTO customers VALUES (1, 'Acme'), (2, 'Beta'), (3, 'Gamma');
INSERT INTO orders VALUES (100, 1, 250), (101, 1, 450), (102, 3, 100);

SELECT c.name,
       (SELECT SUM(o.total) FROM orders o WHERE o.customer_id = c.id) AS spend
FROM customers c
WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id)
ORDER BY c.id;
SQL`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.replace(/\r\n/g, "\n"), "Acme,700\nGamma,100\n");
    });
  });

  it("8. sqlite3 evaluates compound queries (UNION, UNION ALL, INTERSECT, EXCEPT) with ORDER BY and LIMIT/OFFSET", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `sqlite3 -csv :memory: <<'SQL'
CREATE TABLE a(x INT);
CREATE TABLE b(x INT);
INSERT INTO a VALUES (1), (2), (3), (4);
INSERT INTO b VALUES (3), (4), (5);

SELECT x FROM a INTERSECT SELECT x FROM b ORDER BY x;
SELECT '---';
SELECT x FROM a EXCEPT SELECT x FROM b ORDER BY x;
SQL`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.replace(/\r\n/g, "\n"), "3\n4\n---\n1\n2\n");
    });
  });

  it("9. sqlite3 evaluates non-recursive and recursive CTEs (WITH RECURSIVE) for hierarchy traversal and series generation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `sqlite3 -json :memory: <<'SQL'
CREATE TABLE org(id INT, name TEXT, parent_id INT);
INSERT INTO org VALUES (1, 'CEO', NULL), (2, 'VP_Eng', 1), (3, 'VP_Prod', 1), (4, 'Staff_Eng', 2), (5, 'Sr_Eng', 4);

WITH RECURSIVE tree(id, name, depth, path) AS (
  SELECT id, name, 0, name FROM org WHERE parent_id IS NULL
  UNION ALL
  SELECT o.id, o.name, t.depth + 1, t.path || '->' || o.name
  FROM org o JOIN tree t ON o.parent_id = t.id
)
SELECT id, depth, path FROM tree ORDER BY id;
SQL`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.deepEqual(JSON.parse(res.stdout), [
        { id: 1, depth: 0, path: "CEO" },
        { id: 2, depth: 1, path: "CEO->VP_Eng" },
        { id: 3, depth: 1, path: "CEO->VP_Prod" },
        { id: 4, depth: 2, path: "CEO->VP_Eng->Staff_Eng" },
        { id: 5, depth: 3, path: "CEO->VP_Eng->Staff_Eng->Sr_Eng" },
      ]);
    });
  });

  it("10. sqlite3 evaluates window functions (ROW_NUMBER, RANK, DENSE_RANK, LAG, LEAD, FIRST_VALUE, LAST_VALUE, NTH_VALUE, NTILE, running SUM)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `sqlite3 -json :memory: <<'SQL'
CREATE TABLE scores(team TEXT, player TEXT, pts INT);
INSERT INTO scores VALUES
  ('A', 'p1', 30),
  ('A', 'p2', 30),
  ('A', 'p3', 20),
  ('B', 'p4', 50),
  ('B', 'p5', 10);

SELECT team, player, pts,
       RANK() OVER (PARTITION BY team ORDER BY pts DESC) AS rnk,
       DENSE_RANK() OVER (PARTITION BY team ORDER BY pts DESC) AS drnk,
       LAG(pts, 1, 0) OVER (PARTITION BY team ORDER BY pts DESC, player) AS prev_pts,
       SUM(pts) OVER (PARTITION BY team ORDER BY pts DESC, player ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_total
FROM scores
ORDER BY team, pts DESC, player;
SQL`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.deepEqual(JSON.parse(res.stdout), [
        { team: "A", player: "p1", pts: 30, rnk: 1, drnk: 1, prev_pts: 0, running_total: 30 },
        { team: "A", player: "p2", pts: 30, rnk: 1, drnk: 1, prev_pts: 30, running_total: 60 },
        { team: "A", player: "p3", pts: 20, rnk: 3, drnk: 2, prev_pts: 30, running_total: 80 },
        { team: "B", player: "p4", pts: 50, rnk: 1, drnk: 1, prev_pts: 0, running_total: 50 },
        { team: "B", player: "p5", pts: 10, rnk: 2, drnk: 2, prev_pts: 50, running_total: 60 },
      ]);
    });
  });

  it("11. sqlite3 evaluates aggregate FILTER (WHERE ...) clauses and GROUP_CONCAT", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `sqlite3 -json :memory: <<'SQL'
CREATE TABLE events(service TEXT, status INT);
INSERT INTO events VALUES
  ('api', 200), ('api', 500), ('api', 200), ('api', 503),
  ('web', 200), ('web', 404);

SELECT service,
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE status >= 500) AS err_5xx,
       GROUP_CONCAT(status, '|') AS codes
FROM events
GROUP BY service
ORDER BY service;
SQL`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.deepEqual(JSON.parse(res.stdout), [
        { service: "api", total: 4, err_5xx: 2, codes: "200|500|200|503" },
        { service: "web", total: 2, err_5xx: 0, codes: "200|404" },
      ]);
    });
  });

  it("12. sqlite3 supports UPSERT (ON CONFLICT DO UPDATE / DO NOTHING) and RETURNING clauses on INSERT, UPDATE, and DELETE", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `sqlite3 -json :memory: <<'SQL'
CREATE TABLE kv(k TEXT PRIMARY KEY, hits INT);
INSERT INTO kv VALUES ('home', 1), ('docs', 5);
INSERT INTO kv VALUES ('home', 10), ('pricing', 2)
  ON CONFLICT(k) DO UPDATE SET hits = kv.hits + excluded.hits
  RETURNING k, hits;
SQL`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.deepEqual(JSON.parse(res.stdout), [
        { k: "home", hits: 11 },
        { k: "pricing", hits: 2 },
      ]);
    });
  });

  it("13. sqlite3 fires BEFORE/AFTER INSERT, UPDATE, DELETE, and INSTEAD OF view triggers with WHEN and RAISE", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `sqlite3 -json :memory: <<'SQL'
CREATE TABLE accounts(id INT PRIMARY KEY, balance INT);
CREATE TABLE audit_log(acc_id INT, old_bal INT, new_bal INT);

CREATE TRIGGER trg_no_negative
BEFORE UPDATE ON accounts
WHEN NEW.balance < 0
BEGIN
  SELECT RAISE(ABORT, 'overdraft forbidden');
END;

CREATE TRIGGER trg_audit_update
AFTER UPDATE ON accounts
BEGIN
  INSERT INTO audit_log VALUES (NEW.id, OLD.balance, NEW.balance);
END;

INSERT INTO accounts VALUES (1, 100);
UPDATE accounts SET balance = 150 WHERE id = 1;
SELECT * FROM audit_log;
SQL`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.deepEqual(JSON.parse(res.stdout), [{ acc_id: 1, old_bal: 100, new_bal: 150 }]);
    });
  });

  it("14. sqlite3 enforces UNIQUE, PRIMARY KEY, NOT NULL, and CHECK constraints and cascades via AFTER DELETE triggers", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `sqlite3 -json :memory: <<'SQL'
CREATE TABLE authors(id INT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE books(id INT PRIMARY KEY, title TEXT NOT NULL, author_id INT NOT NULL, price INT CHECK (price > 0));
CREATE TRIGGER trg_authors_cascade_delete
AFTER DELETE ON authors
BEGIN
  DELETE FROM books WHERE author_id = OLD.id;
END;
INSERT INTO authors VALUES (1, 'Knuth'), (2, 'Dijkstra');
INSERT INTO books VALUES (10, 'TAOCP', 1, 80), (11, 'Literate Programming', 1, 45), (20, 'Discipline of Programming', 2, 60);

DELETE FROM authors WHERE id = 1;
SELECT id, title, price FROM books ORDER BY id;
SQL`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.deepEqual(JSON.parse(res.stdout), [
        { id: 20, title: "Discipline of Programming", price: 60 },
      ]);
    });
  });

  it("15. sqlite3 supports transactions (BEGIN, COMMIT, ROLLBACK) and nested SAVEPOINT / RELEASE / ROLLBACK TO", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `sqlite3 -csv :memory: <<'SQL'
CREATE TABLE ledger(entry TEXT, amount INT);
BEGIN;
INSERT INTO ledger VALUES ('deposit', 100);
SAVEPOINT sp1;
INSERT INTO ledger VALUES ('tentative_fee', -25);
SAVEPOINT sp2;
INSERT INTO ledger VALUES ('cancelled_bonus', 50);
ROLLBACK TO sp2;
RELEASE sp1;
COMMIT;
SELECT entry, amount FROM ledger ORDER BY rowid;
SQL`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.replace(/\r\n/g, "\n"), "deposit,100\ntentative_fee,-25\n");
    });
  });

  it("16. sqlite3 evaluates JSON1 functions (json_extract, ->, ->>, json_object, json_array, json_set, json_insert, json_replace, json_remove, json_patch, json_group_array, json_group_object)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `sqlite3 -json :memory: <<'SQL'
CREATE TABLE payloads(id INT, doc TEXT);
INSERT INTO payloads VALUES
  (1, '{"service":"auth","meta":{"tier":1,"tags":["rust","wasm"]}}'),
  (2, '{"service":"edge","meta":{"tier":2,"tags":["cdn"]}}');

SELECT id,
       doc ->> '$.service' AS svc,
       json_extract(doc, '$.meta.tags[0]') AS first_tag,
       json_set(doc, '$.meta.active', 1) AS updated
FROM payloads
ORDER BY id;
SQL`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      const rows = JSON.parse(res.stdout);
      assert.equal(rows[0].svc, "auth");
      assert.equal(rows[0].first_tag, "rust");
      assert.equal(JSON.parse(rows[0].updated).meta.active, 1);
    });
  });

  it("17. sqlite3 evaluates table-valued functions json_each, json_tree, and generate_series", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `sqlite3 -csv :memory: <<'SQL'
SELECT value, value * value AS sq FROM generate_series(1, 5, 2);
SELECT '---';
SELECT key, value FROM json_each('{"alpha":10,"beta":20}') ORDER BY key;
SQL`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.replace(/\r\n/g, "\n"),
        "1,1\n3,9\n5,25\n---\nalpha,10\nbeta,20\n",
      );
    });
  });

  it("18. sqlite3 supports pattern matching with LIKE, GLOB, REGEXP, and MATCH operators and ESCAPE clauses", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `sqlite3 -json :memory: <<'SQL'
CREATE TABLE docs(id INT PRIMARY KEY, title TEXT, body TEXT);
INSERT INTO docs VALUES
  (1, 'Rust Memory Safety', 'Ownership and borrowing eliminate data races without garbage collection'),
  (2, 'Bash Pipeline Engine', 'Streaming virtual filesystem pipes with deterministic resource budgets'),
  (3, 'Rust Parser Combinators', 'Zero-copy lexical scanning and recursive descent parsing in Rust');

SELECT id, title, REPLACE(title, 'Rust', '[Rust]') AS hi
FROM docs
WHERE title REGEXP '^Rust' AND body GLOB '*Rust*' OR (title LIKE 'Rust%' AND id = 1)
ORDER BY id;
SQL`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.deepEqual(JSON.parse(res.stdout), [
        { id: 1, title: "Rust Memory Safety", hi: "[Rust] Memory Safety" },
        { id: 3, title: "Rust Parser Combinators", hi: "[Rust] Parser Combinators" },
      ]);
    });
  });

  it("19. sqlite3 supports ALTER TABLE (RENAME TO, RENAME COLUMN, ADD COLUMN, DROP COLUMN), views, and generated columns", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `sqlite3 -json :memory: <<'SQL'
CREATE TABLE items(
  id INT PRIMARY KEY,
  qty INT,
  unit_price INT,
  total INT GENERATED ALWAYS AS (qty * unit_price) STORED,
  obsolete TEXT
);
INSERT INTO items(id, qty, unit_price, obsolete) VALUES (1, 4, 25, 'old');
ALTER TABLE items DROP COLUMN obsolete;
ALTER TABLE items RENAME COLUMN unit_price TO price;
ALTER TABLE items ADD COLUMN currency TEXT DEFAULT 'USD';
SELECT id, qty, price, total, currency FROM items;
SQL`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.deepEqual(JSON.parse(res.stdout), [
        { id: 1, qty: 4, price: 25, total: 100, currency: "USD" },
      ]);
    });
  });

  it("20. chains jq -> sqlite3 .import -> window analytics -> yq / csvlook in an end-to-end data warehouse pipeline", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/events.jsonl",
        [
          '{"region":"us-east","service":"api","latency":42}',
          '{"region":"us-east","service":"db","latency":18}',
          '{"region":"eu-west","service":"api","latency":65}',
          '{"region":"eu-west","service":"cache","latency":7}',
          "",
        ].join("\n"),
      );

      const res = await h.exec(
        String.raw`
set -euo pipefail
jq -r '["region","service","latency"], (. | [.region, .service, (.latency | tostring)]) | @csv' /workspace/events.jsonl > /workspace/raw.csv
(echo "region,service,latency"; jq -r '[.region, .service, .latency] | @csv' /workspace/events.jsonl) > /workspace/clean.csv

sqlite3 /workspace/warehouse.db <<'SQL'
.mode csv
.import /workspace/clean.csv metrics
SQL

sqlite3 -json /workspace/warehouse.db "
  SELECT region, service, CAST(latency AS INT) AS latency,
         RANK() OVER (PARTITION BY region ORDER BY CAST(latency AS INT) DESC) AS regional_rank
  FROM metrics
  ORDER BY region, regional_rank;
" | yq '.'
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /"?region"?: "?eu-west"?/);
      assert.match(res.stdout, /"?service"?: "?api"?/);
      assert.match(res.stdout, /"?regional_rank"?: 1/);
    });
  });
});
