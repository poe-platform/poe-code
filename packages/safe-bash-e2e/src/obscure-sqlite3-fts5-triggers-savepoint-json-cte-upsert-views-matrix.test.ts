import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure sqlite3 fts5 triggers savepoint json cte upsert views matrix", () => {
  it("1. FTS5 virtual table creation, multi-term MATCH query, and boolean NOT/AND operators", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 :memory: \"\n  CREATE VIRTUAL TABLE docs USING fts5(title, body);\n  INSERT INTO docs VALUES\n    ('Rust Wasm', 'deterministic sandboxed shell execution engine'),\n    ('TypeScript CLI', 'modular command plugins with sandboxed vfs'),\n    ('Legacy Bash', 'unsandboxed host process spawning');\n  SELECT title FROM docs WHERE docs MATCH 'sandboxed' ORDER BY title;\n\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Rust Wasm\nTypeScript CLI");
    });
  });

  it("2. nested SAVEPOINT, ROLLBACK TO SAVEPOINT, and RELEASE SAVEPOINT transaction recovery", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 :memory: \"\n  CREATE TABLE ledger(acct TEXT, bal INT);\n  INSERT INTO ledger VALUES ('A', 100), ('B', 200);\n  BEGIN;\n  UPDATE ledger SET bal = bal - 30 WHERE acct = 'A';\n  SAVEPOINT sp1;\n  UPDATE ledger SET bal = bal + 999 WHERE acct = 'B';\n  ROLLBACK TO sp1;\n  UPDATE ledger SET bal = bal + 30 WHERE acct = 'B';\n  RELEASE sp1;\n  COMMIT;\n  SELECT acct, bal FROM ledger ORDER BY acct;\n\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "A|70\nB|230");
    });
  });

  it("3. UPSERT (ON CONFLICT DO UPDATE) with excluded.* and conditional WHERE clause", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 :memory: \"\n  CREATE TABLE kv(k TEXT PRIMARY KEY, v INT, ver INT);\n  INSERT INTO kv VALUES ('cpu', 4, 1), ('mem', 16, 2);\n  INSERT INTO kv VALUES ('cpu', 8, 3), ('mem', 32, 1), ('disk', 100, 1)\n    ON CONFLICT(k) DO UPDATE SET v = excluded.v, ver = excluded.ver\n    WHERE excluded.ver > kv.ver;\n  SELECT k, v, ver FROM kv ORDER BY k;\n\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "cpu|8|3\ndisk|100|1\nmem|16|2");
    });
  });

  it("4. AFTER INSERT, AFTER UPDATE, and AFTER DELETE audit triggers with OLD and NEW references", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 :memory: \"\n  CREATE TABLE items(id INT PRIMARY KEY, price INT);\n  CREATE TABLE audit(op TEXT, item_id INT, delta INT);\n  CREATE TRIGGER tr_ins AFTER INSERT ON items BEGIN\n    INSERT INTO audit VALUES ('INS', NEW.id, NEW.price);\n  END;\n  CREATE TRIGGER tr_upd AFTER UPDATE ON items BEGIN\n    INSERT INTO audit VALUES ('UPD', NEW.id, NEW.price - OLD.price);\n  END;\n  CREATE TRIGGER tr_del AFTER DELETE ON items BEGIN\n    INSERT INTO audit VALUES ('DEL', OLD.id, -OLD.price);\n  END;\n  INSERT INTO items VALUES (1, 50), (2, 80);\n  UPDATE items SET price = 75 WHERE id = 1;\n  DELETE FROM items WHERE id = 2;\n  SELECT op, item_id, delta FROM audit;\n\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "INS|1|50\nINS|2|80\nUPD|1|25\nDEL|2|-80");
    });
  });

  it("5. CREATE VIEW with aggregated subquery and JOIN against base table", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 :memory: \"\n  CREATE TABLE emp(name TEXT, dept TEXT, salary INT);\n  INSERT INTO emp VALUES ('Ada','Eng',150),('Bob','Eng',110),('Cara','Ops',120);\n  CREATE VIEW dept_summary AS\n    SELECT dept, COUNT(*) AS headcount, AVG(salary) AS avg_sal\n    FROM emp GROUP BY dept;\n  SELECT dept, headcount, CAST(avg_sal AS INT) FROM dept_summary ORDER BY dept;\n\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Eng|2|130\nOps|1|120");
    });
  });

  it("6. ALTER TABLE ADD COLUMN, RENAME COLUMN, and RENAME TO across persistent database file", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 /tmp/mig.db \"CREATE TABLE v1(id INT, old_name TEXT); INSERT INTO v1 VALUES (1, 'alpha');\"\nsqlite3 /tmp/mig.db \"ALTER TABLE v1 RENAME COLUMN old_name TO label; ALTER TABLE v1 ADD COLUMN active INT DEFAULT 1;\"\nsqlite3 /tmp/mig.db \"ALTER TABLE v1 RENAME TO v2;\"\nsqlite3 /tmp/mig.db \"SELECT id, label, active FROM v2;\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1|alpha|1");
    });
  });

  it("7. JSON_SET, JSON_INSERT, JSON_REPLACE, and JSON_REMOVE mutation chain", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 :memory: \"\n  SELECT json_remove(\n    json_replace(\n      json_insert('{\\\"a\\\":1,\\\"b\\\":2}', '$.c', 3),\n      '$.a', 10\n    ),\n    '$.b'\n  );\n\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"a\":10,\"c\":3}");
    });
  });

  it("8. JSON_GROUP_ARRAY and JSON_GROUP_OBJECT with ORDER BY and JSON_EXTRACT", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 :memory: \"\n  CREATE TABLE flags(env TEXT, k TEXT, v INT);\n  INSERT INTO flags VALUES ('prod','tls',1),('prod','workers',8),('dev','tls',0);\n  SELECT env, json_group_object(k, v) AS cfg\n  FROM flags GROUP BY env ORDER BY env;\n\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "dev|{\"tls\":0}\nprod|{\"tls\":1,\"workers\":8}");
    });
  });

  it("9. window functions NTILE, FIRST_VALUE, LAST_VALUE, and RANK over partitioned dataset", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 :memory: \"\n  CREATE TABLE scores(grp TEXT, player TEXT, pts INT);\n  INSERT INTO scores VALUES\n    ('A','p1',10),('A','p2',30),('A','p3',20),\n    ('B','p4',50),('B','p5',40);\n  SELECT grp, player, pts,\n         RANK() OVER (PARTITION BY grp ORDER BY pts DESC) AS rnk,\n         FIRST_VALUE(player) OVER (PARTITION BY grp ORDER BY pts DESC) AS leader\n  FROM scores\n  ORDER BY grp, rnk;\n\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "A|p2|30|1|p2\nA|p3|20|2|p2\nA|p1|10|3|p2\nB|p4|50|1|p4\nB|p5|40|2|p4");
    });
  });

  it("10. multi-CTE chain (WITH a AS (...), b AS (...)) for cohort retention analysis", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 :memory: \"\n  CREATE TABLE logins(uid TEXT, month INT);\n  INSERT INTO logins VALUES ('u1',1),('u1',2),('u2',1),('u3',2);\n  WITH m1 AS (SELECT uid FROM logins WHERE month = 1),\n       m2 AS (SELECT uid FROM logins WHERE month = 2)\n  SELECT COUNT(*) AS retained FROM m1 JOIN m2 ON m1.uid = m2.uid;\n\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1");
    });
  });

  it("11. correlated subquery with EXISTS and NOT EXISTS filtering", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 :memory: \"\n  CREATE TABLE customers(cid INT, name TEXT);\n  CREATE TABLE refunds(cid INT, amount INT);\n  INSERT INTO customers VALUES (1,'Alice'),(2,'Bob'),(3,'Carol');\n  INSERT INTO refunds VALUES (2, 50);\n  SELECT name FROM customers c\n  WHERE NOT EXISTS (SELECT 1 FROM refunds r WHERE r.cid = c.cid)\n  ORDER BY name;\n\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Alice\nCarol");
    });
  });

  it("12. CASE WHEN inside SUM and COUNT with HAVING filter and ORDER BY alias", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 :memory: \"\n  CREATE TABLE tx(region TEXT, status TEXT, amt INT);\n  INSERT INTO tx VALUES\n    ('eu','settled',100),('eu','failed',40),('eu','settled',200),\n    ('us','failed',90),('us','settled',50);\n  SELECT region,\n         SUM(CASE WHEN status = 'settled' THEN amt ELSE 0 END) AS ok_amt,\n         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS fail_cnt\n  FROM tx\n  GROUP BY region\n  HAVING ok_amt >= 50\n  ORDER BY ok_amt DESC;\n\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "eu|300|1\nus|50|1");
    });
  });

  it("13. UNION, UNION ALL, INTERSECT, and EXCEPT compound set queries", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 :memory: \"\n  CREATE TABLE s1(v TEXT); INSERT INTO s1 VALUES ('a'),('b'),('c');\n  CREATE TABLE s2(v TEXT); INSERT INTO s2 VALUES ('b'),('c'),('d');\n  SELECT v FROM s1 INTERSECT SELECT v FROM s2 ORDER BY v;\n  SELECT '---';\n  SELECT v FROM s1 EXCEPT SELECT v FROM s2 ORDER BY v;\n\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "b\nc\n---\na");
    });
  });

  it("14. sqlite3 .mode markdown, .mode line, and .mode tabs formatting", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 :memory: \".mode line\" \"SELECT 'prod' AS env, 4 AS nodes;\"\nsqlite3 :memory: \".mode tabs\" \".headers on\" \"SELECT 'eu' AS reg, 99 AS score;\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "env = prod\nnodes = 4\nreg\tscore\neu\t99");
    });
  });

  it("15. sqlite3 .dump SQL export and restoration into a fresh database", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 /tmp/src_dump.db \"CREATE TABLE items(id INT, name TEXT); INSERT INTO items VALUES (1,'wrench'),(2,'drill');\"\nsqlite3 /tmp/src_dump.db \".dump\" > /tmp/backup.sql\nsqlite3 /tmp/restored.db < /tmp/backup.sql\nsqlite3 /tmp/restored.db \"SELECT id, name FROM items ORDER BY id;\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1|wrench\n2|drill");
    });
  });

  it("16. sqlite3 printf() format specifiers, HEX(), QUOTE(), ZEROBLOB(), and LENGTH()", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 :memory: \"\n  SELECT printf('id=%04d name=%s', 7, 'node'),\n         HEX('ABC'),\n         QUOTE('it''s');\n\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "id=0007 name=node|414243|'it''s'");
    });
  });

  it("17. sqlite3 GROUP_CONCAT with custom separator and DISTINCT", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 :memory: \"\n  CREATE TABLE tags(doc INT, tag TEXT);\n  INSERT INTO tags VALUES (1,'rust'),(1,'wasm'),(1,'rust'),(2,'ts');\n  SELECT doc, GROUP_CONCAT(DISTINCT tag) FROM tags GROUP BY doc ORDER BY doc;\n\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1|rust,wasm\n2|ts");
    });
  });

  it("18. sqlite3 multi-table LEFT JOIN with COALESCE on unmatched rows", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 :memory: \"\n  CREATE TABLE hosts(hid INT, hname TEXT);\n  CREATE TABLE alerts(hid INT, sev TEXT);\n  INSERT INTO hosts VALUES (1,'h1'),(2,'h2');\n  INSERT INTO alerts VALUES (1,'crit');\n  SELECT h.hname, COALESCE(a.sev, 'clear') AS state\n  FROM hosts h LEFT JOIN alerts a ON h.hid = a.hid\n  ORDER BY h.hid;\n\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "h1|crit\nh2|clear");
    });
  });

  it("19. sqlite3 RETURNING clause on INSERT, UPDATE, and DELETE statements", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 :memory: \"\n  CREATE TABLE tasks(id INT PRIMARY KEY, done INT);\n  INSERT INTO tasks VALUES (10, 0) RETURNING id, done;\n  UPDATE tasks SET done = 1 WHERE id = 10 RETURNING id, done;\n  DELETE FROM tasks WHERE id = 10 RETURNING id;\n\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "10|0\n10|1\n10");
    });
  });

  it("20. sqlite3 PRAGMA user_version, integrity_check, .backup, .restore, and .tables", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 /tmp/pragma_src.db \"PRAGMA user_version = 42; CREATE TABLE alpha(id INT, label TEXT); INSERT INTO alpha VALUES (7, 'backup_ok');\"\nsqlite3 /tmp/pragma_src.db \".backup /tmp/pragma_bak.db\"\nsqlite3 /tmp/pragma_dst.db \".restore /tmp/pragma_bak.db\"\nsqlite3 /tmp/pragma_dst.db \"PRAGMA user_version;\" \"PRAGMA integrity_check;\" \".tables\" \"SELECT id, label FROM alpha;\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "42\nok\nalpha\n7|backup_ok");
    });
  });

});
