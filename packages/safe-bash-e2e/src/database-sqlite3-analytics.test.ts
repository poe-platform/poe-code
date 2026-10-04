import assert from "node:assert/strict";
import test from "node:test";
import {
  createObservabilityLogsFixture,
  createRelationalCsvFixture,
} from "./fixtures.js";
import { withE2EHarness } from "./harness.js";

test("sqlite3 VFS persistence across invocations and SQLite Format 3 binary header verification", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "sqlite3 /workspace/app.db \"CREATE TABLE services (id INTEGER PRIMARY KEY, name TEXT UNIQUE, port INTEGER);\"",
      "sqlite3 /workspace/app.db \"INSERT INTO services (name, port) VALUES ('auth', 9000), ('billing', 9001), ('ledger', 9002);\"",
      "sqlite3 /workspace/app.db \"SELECT name || ':' || port FROM services ORDER BY port;\"",
      "head -c 15 /workspace/app.db",
      "echo ''",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "auth:9000",
        "billing:9001",
        "ledger:9002",
        "SQLite format 3",
        "",
      ].join("\n"),
    );
  });
});

test("sqlite3 .import CSV ingestion and multi-table JOIN analytics over relational fixture", async () => {
  await withE2EHarness({ files: createRelationalCsvFixture() }, async (h) => {
    const script = [
      "sqlite3 /workspace/warehouse.db <<'SQL'",
      ".mode csv",
      ".import /workspace/data/customers.csv customers",
      ".import /workspace/data/products.csv products",
      ".import /workspace/data/orders.csv orders",
      ".mode list",
      ".separator |",
      "SELECT c.name, COUNT(o.order_id) AS n_orders, PRINTF('%.2f', SUM(CAST(o.quantity AS REAL) * CAST(p.unit_price AS REAL))) AS spend",
      "FROM orders o",
      "JOIN customers c ON o.customer_id = c.customer_id",
      "JOIN products p ON o.product_id = p.product_id",
      "WHERE o.status = 'completed'",
      "GROUP BY c.customer_id, c.name",
      "ORDER BY CAST(spend AS REAL) DESC;",
      "SQL",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "Alice Vance|2|1355.00",
        "Bob Tanaka|2|810.00",
        "Clara Oswald|1|600.00",
        "Elena Rostova|1|320.00",
        "",
      ].join("\n"),
    );
  });
});

test("sqlite3 recursive CTEs: hierarchical org chart and transitive path construction", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "sqlite3 /workspace/org.db <<'SQL'",
      "CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT, manager_id INTEGER);",
      "INSERT INTO employees VALUES (1, 'CEO', NULL), (2, 'VP_Eng', 1), (3, 'VP_Sales', 1), (4, 'Dir_Core', 2), (5, 'Staff_Dev', 4);",
      "WITH RECURSIVE org_tree AS (",
      "  SELECT id, name, manager_id, 0 AS depth, name AS chain FROM employees WHERE manager_id IS NULL",
      "  UNION ALL",
      "  SELECT e.id, e.name, e.manager_id, t.depth + 1, t.chain || '->' || e.name",
      "  FROM employees e JOIN org_tree t ON e.manager_id = t.id",
      ")",
      "SELECT depth || ':' || chain FROM org_tree ORDER BY id;",
      "SQL",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "0:CEO",
        "1:CEO->VP_Eng",
        "1:CEO->VP_Sales",
        "2:CEO->VP_Eng->Dir_Core",
        "3:CEO->VP_Eng->Dir_Core->Staff_Dev",
        "",
      ].join("\n"),
    );
  });
});

test("sqlite3 window functions: ROW_NUMBER, RANK, LAG, and running totals over partitions", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "sqlite3 /workspace/metrics.db <<'SQL'",
      "CREATE TABLE sales (dept TEXT, rep TEXT, amount INTEGER);",
      "INSERT INTO sales VALUES",
      "  ('eng', 'alice', 300),",
      "  ('eng', 'bob',   500),",
      "  ('eng', 'carol', 200),",
      "  ('ops', 'dave',  400),",
      "  ('ops', 'erin',  100);",
      "SELECT",
      "  dept,",
      "  rep,",
      "  amount,",
      "  RANK() OVER (PARTITION BY dept ORDER BY amount DESC) AS rnk,",
      "  SUM(amount) OVER (PARTITION BY dept ORDER BY amount DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_sum",
      "FROM sales",
      "ORDER BY dept, rnk;",
      "SQL",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "eng|bob|500|1|500",
        "eng|alice|300|2|800",
        "eng|carol|200|3|1000",
        "ops|dave|400|1|400",
        "ops|erin|100|2|500",
        "",
      ].join("\n"),
    );
  });
});

test("sqlite3 UPSERT (INSERT ... ON CONFLICT DO UPDATE) and RETURNING clause", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "sqlite3 /workspace/kv.db <<'SQL'",
      "CREATE TABLE counters (key TEXT PRIMARY KEY, hits INTEGER NOT NULL);",
      "INSERT INTO counters VALUES ('login', 1), ('search', 5);",
      "INSERT INTO counters (key, hits) VALUES ('login', 3), ('checkout', 2)",
      "  ON CONFLICT(key) DO UPDATE SET hits = counters.hits + excluded.hits",
      "  RETURNING key, hits;",
      "SQL",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "login|4",
        "checkout|2",
        "",
      ].join("\n"),
    );
  });
});

test("sqlite3 AFTER INSERT / UPDATE triggers maintaining an audit log table", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "sqlite3 /workspace/audit.db <<'SQL'",
      "CREATE TABLE accounts (id TEXT PRIMARY KEY, balance INTEGER);",
      "CREATE TABLE audit_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT, old_bal INTEGER, new_bal INTEGER);",
      "CREATE TRIGGER trg_account_update AFTER UPDATE ON accounts",
      "BEGIN",
      "  INSERT INTO audit_log (account_id, old_bal, new_bal) VALUES (NEW.id, OLD.balance, NEW.balance);",
      "END;",
      "INSERT INTO accounts VALUES ('acc_1', 1000);",
      "UPDATE accounts SET balance = 850 WHERE id = 'acc_1';",
      "UPDATE accounts SET balance = 1200 WHERE id = 'acc_1';",
      "SELECT seq, account_id, old_bal, new_bal FROM audit_log ORDER BY seq;",
      "SQL",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "1|acc_1|1000|850",
        "2|acc_1|850|1200",
        "",
      ].join("\n"),
    );
  });
});

test("sqlite3 transactions: BEGIN, SAVEPOINT, ROLLBACK TO, and COMMIT atomicity", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "sqlite3 /workspace/tx.db <<'SQL'",
      "CREATE TABLE items (name TEXT);",
      "BEGIN;",
      "INSERT INTO items VALUES ('committed_1');",
      "SAVEPOINT sp1;",
      "INSERT INTO items VALUES ('rolled_back_2');",
      "ROLLBACK TO sp1;",
      "INSERT INTO items VALUES ('committed_3');",
      "COMMIT;",
      "SELECT name FROM items ORDER BY rowid;",
      "SQL",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "committed_1",
        "committed_3",
        "",
      ].join("\n"),
    );
  });
});

test("sqlite3 JSON1 functions (json_extract, json_object, json_group_array, json_each)", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "sqlite3 /workspace/events.db <<'SQL'",
      "CREATE TABLE raw_events (payload TEXT);",
      "INSERT INTO raw_events VALUES",
      "  ('{\"user\":\"alice\",\"tags\":[\"admin\",\"sre\"],\"score\":95}'),",
      "  ('{\"user\":\"bob\",\"tags\":[\"dev\"],\"score\":82}');",
      "SELECT json_extract(r.payload, '$.user') AS u, j.value AS tag",
      "FROM raw_events r, json_each(json_extract(r.payload, '$.tags')) j",
      "ORDER BY u, tag;",
      "SQL",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "alice|admin",
        "alice|sre",
        "bob|dev",
        "",
      ].join("\n"),
    );
  });
});

test("sqlite3 output modes (-json, -csv, -markdown, -line, .mode insert) piped to jq and csvcut", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "sqlite3 /workspace/modes.db \"CREATE TABLE t (id INT, label TEXT); INSERT INTO t VALUES (1, 'one'), (2, 'two');\"",
      "sqlite3 -json /workspace/modes.db 'SELECT * FROM t ORDER BY id;' | jq -r '.[] | \"\\(.id)=\\(.label)\"'",
      "sqlite3 -header -csv /workspace/modes.db 'SELECT * FROM t ORDER BY id;' | csvcut -c label",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "1=one",
        "2=two",
        "label",
        "one",
        "two",
        "",
      ].join("\n"),
    );
  });
});

test("sqlite3 .dump SQL export and full reconstruction into a fresh database", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "sqlite3 /workspace/source.db \"CREATE TABLE nodes (k TEXT PRIMARY KEY, v INT); INSERT INTO nodes VALUES ('x', 10), ('y', 20);\"",
      "sqlite3 /workspace/source.db '.dump' > /workspace/dump.sql",
      "sqlite3 /workspace/restored.db < /workspace/dump.sql",
      "sqlite3 /workspace/restored.db 'SELECT k, v FROM nodes ORDER BY k;'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "x|10",
        "y|20",
        "",
      ].join("\n"),
    );
  });
});

test("sqlite3 .backup and .restore dot-commands for binary database cloning", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "sqlite3 /workspace/main.db \"CREATE TABLE cfg (k TEXT, v TEXT); INSERT INTO cfg VALUES ('env', 'prod');\"",
      "sqlite3 /workspace/main.db '.backup /workspace/backup.db'",
      "sqlite3 /workspace/main.db \"DELETE FROM cfg;\"",
      "sqlite3 /workspace/backup.db 'SELECT k, v FROM cfg;'",
      "sqlite3 /workspace/main.db '.restore /workspace/backup.db'",
      "sqlite3 /workspace/main.db 'SELECT k, v FROM cfg;'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "env|prod",
        "env|prod",
        "",
      ].join("\n"),
    );
  });
});

test("sqlite3 views, indexes, and .tables / .schema introspection", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "sqlite3 /workspace/schema.db <<'SQL'",
      "CREATE TABLE orders (id INT PRIMARY KEY, total INT, active INT);",
      "CREATE INDEX idx_orders_active ON orders(active);",
      "CREATE VIEW active_orders AS SELECT id, total FROM orders WHERE active = 1;",
      "INSERT INTO orders VALUES (1, 50, 1), (2, 80, 0), (3, 120, 1);",
      "SELECT SUM(total) FROM active_orders;",
      "SQL",
    ].join("\n");

    await h.expectOk(script, "170\n");
  });
});

test("sqlite3 .parameter bind variables prevent injection and parameterize queries", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "sqlite3 /workspace/params.db <<'SQL'",
      "CREATE TABLE users (name TEXT, role TEXT);",
      "INSERT INTO users VALUES ('alice', 'admin'), ('bob', 'viewer');",
      ".parameter init",
      ".parameter set :target_role 'admin'",
      "SELECT name FROM users WHERE role = :target_role;",
      "SQL",
    ].join("\n");

    await h.expectOk(script, "alice\n");
  });
});

test("sqlite3 .read dot-command and .once / .output file redirection", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/init.sql": [
          "CREATE TABLE metrics (ts INT, val INT);",
          "INSERT INTO metrics VALUES (1, 10), (2, 20), (3, 30);",
          "",
        ].join("\n"),
      },
    },
    async (h) => {
      const script = [
        "sqlite3 /workspace/m.db <<'SQL'",
        ".read /workspace/init.sql",
        ".mode csv",
        ".headers on",
        ".once /workspace/metrics_out.csv",
        "SELECT ts, val * 2 AS doubled FROM metrics ORDER BY ts;",
        "SQL",
        "cat /workspace/metrics_out.csv",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "ts,doubled",
          "1,20",
          "2,40",
          "3,60",
          "",
        ].join("\n"),
      );
    },
  );
});

test("JSONL log ingestion pipeline: jq -> CSV -> sqlite3 .import -> SQL aggregation -> jq JSON report", async () => {
  await withE2EHarness({ files: createObservabilityLogsFixture() }, async (h) => {
    const script = [
      "jq -r '[.ts, .method, .path, (.status | tostring), (.latency_ms | tostring), .region] | @csv' /workspace/logs/api.jsonl > /workspace/api_events.csv",
      "sqlite3 /workspace/telemetry.db <<'SQL'",
      "CREATE TABLE events (ts TEXT, method TEXT, path TEXT, status INT, latency_ms INT, region TEXT);",
      ".mode csv",
      ".import /workspace/api_events.csv events",
      "SQL",
      "sqlite3 -json /workspace/telemetry.db \"SELECT region, COUNT(*) AS reqs, MAX(CAST(latency_ms AS INT)) AS peak_ms FROM events GROUP BY region ORDER BY region;\" \\",
      "  | jq -r '.[] | \"\\(.region):reqs=\\(.reqs),peak=\\(.peak_ms)\"'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "ap-south:reqs=2,peak=39",
        "eu-west:reqs=3,peak=410",
        "us-east:reqs=5,peak=520",
        "",
      ].join("\n"),
    );
  });
});

test("sqlite3 compound queries: UNION, UNION ALL, INTERSECT, and EXCEPT", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "sqlite3 /workspace/sets.db <<'SQL'",
      "CREATE TABLE a (val INT);",
      "CREATE TABLE b (val INT);",
      "INSERT INTO a VALUES (1), (2), (3), (4);",
      "INSERT INTO b VALUES (3), (4), (5), (6);",
      "SELECT 'intersect:' || GROUP_CONCAT(val, ',') FROM (SELECT val FROM a INTERSECT SELECT val FROM b ORDER BY val);",
      "SELECT 'except:' || GROUP_CONCAT(val, ',') FROM (SELECT val FROM a EXCEPT SELECT val FROM b ORDER BY val);",
      "SELECT 'union:' || GROUP_CONCAT(val, ',') FROM (SELECT val FROM a UNION SELECT val FROM b ORDER BY val);",
      "SQL",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "intersect:3,4",
        "except:1,2",
        "union:1,2,3,4,5,6",
        "",
      ].join("\n"),
    );
  });
});

test("sqlite3 CASE expressions, COALESCE, NULLIF, and HAVING clauses", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "sqlite3 /workspace/grades.db <<'SQL'",
      "CREATE TABLE scores (student TEXT, dept TEXT, score INT, bonus INT);",
      "INSERT INTO scores VALUES",
      "  ('alice', 'cs', 92, NULL),",
      "  ('bob',   'cs', 78, 5),",
      "  ('carol', 'cs', 88, 2),",
      "  ('dave',  'math', 65, NULL);",
      "SELECT",
      "  dept,",
      "  COUNT(*) AS cnt,",
      "  SUM(CASE WHEN score + COALESCE(bonus, 0) >= 85 THEN 1 ELSE 0 END) AS honors",
      "FROM scores",
      "GROUP BY dept",
      "HAVING COUNT(*) >= 2;",
      "SQL",
    ].join("\n");

    await h.expectOk(script, "cs|3|2\n");
  });
});

test("sqlite3 ALTER TABLE (ADD COLUMN, RENAME COLUMN, RENAME TO) and PRAGMA user_version", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "sqlite3 /workspace/mig.db <<'SQL'",
      "PRAGMA user_version = 7;",
      "CREATE TABLE tasks (id INT PRIMARY KEY, title TEXT);",
      "INSERT INTO tasks VALUES (1, 'ship');",
      "ALTER TABLE tasks ADD COLUMN status TEXT DEFAULT 'open';",
      "ALTER TABLE tasks RENAME COLUMN title TO summary;",
      "ALTER TABLE tasks RENAME TO work_items;",
      "SELECT id, summary, status FROM work_items;",
      "PRAGMA user_version;",
      "SQL",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "1|ship|open",
        "7",
        "",
      ].join("\n"),
    );
  });
});

test("sqlite3 date/time functions and modifiers (date, datetime, strftime, unixepoch)", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "sqlite3 :memory: \"SELECT date('2026-10-01', '+7 days'), strftime('%Y-%m', '2026-10-15T12:30:00Z');\"",
    ].join("\n");

    await h.expectOk(script, "2026-10-08|2026-10\n");
  });
});

test("sqlite3 correlated subqueries, EXISTS, and IN predicates", async () => {
  await withE2EHarness({ files: createRelationalCsvFixture() }, async (h) => {
    const script = [
      "sqlite3 /workspace/subq.db <<'SQL'",
      ".mode csv",
      ".import /workspace/data/customers.csv customers",
      ".import /workspace/data/orders.csv orders",
      ".mode list",
      ".separator |",
      "SELECT c.customer_id, c.name",
      "FROM customers c",
      "WHERE EXISTS (",
      "  SELECT 1 FROM orders o",
      "  WHERE o.customer_id = c.customer_id AND o.status = 'completed' AND CAST(o.quantity AS INT) >= 4",
      ")",
      "ORDER BY c.customer_id;",
      "SQL",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "c1|Alice Vance",
        "c3|Clara Oswald",
        "c5|Elena Rostova",
        "",
      ].join("\n"),
    );
  });
});
