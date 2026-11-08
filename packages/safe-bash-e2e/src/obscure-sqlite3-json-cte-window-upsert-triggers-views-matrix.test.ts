import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure sqlite3 JSON, recursive CTE, window, UPSERT, triggers, and views matrix", () => {
  test("1. sqlite3 json_extract, json_type, and 2-argument json_array_length(doc, path)", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "CREATE TABLE events(id INTEGER, payload TEXT);",
          "INSERT INTO events VALUES (1, '{\"user\":{\"name\":\"ada\"},\"tags\":[\"db\",\"rust\",\"wasm\"],\"active\":true}');",
          "SELECT json_extract(payload, '$.user.name'), json_type(payload, '$.active'), json_array_length(payload, '$.tags') FROM events;",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "ada|true|3\n");
    });
  });

  test("2. sqlite3 json_object, json_array, json_set, and json_remove mutations", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "SELECT json_object('a', 1, 'b', json_array('x', 'y')), json_set('{\"a\":1,\"b\":2}', '$.b', 99, '$.c', 'new'), json_remove('{\"a\":1,\"b\":2,\"c\":3}', '$.b');",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        '{"a":1,"b":["x","y"]}|{"a":1,"b":99,"c":"new"}|{"a":1,"c":3}\n'
      );
    });
  });

  test("3. sqlite3 json_each table-valued function expansion and ordering", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "SELECT key, value FROM json_each('[10, 20, 30]') ORDER BY CAST(key AS INTEGER);",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "0|10\n1|20\n2|30\n");
    });
  });

  test("4. sqlite3 WITH RECURSIVE Fibonacci sequence generation", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "WITH RECURSIVE fib(n, a, b) AS (",
          "  SELECT 1, 0, 1",
          "  UNION ALL",
          "  SELECT n + 1, b, a + b FROM fib WHERE n < 8",
          ")",
          "SELECT GROUP_CONCAT(a, ',') FROM fib;",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "0,1,1,2,3,5,8,13\n");
    });
  });

  test("5. sqlite3 ROW_NUMBER(), RANK(), and DENSE_RANK() partitioned window functions", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "CREATE TABLE scores(team TEXT, player TEXT, pts INTEGER);",
          "INSERT INTO scores VALUES ('A','p1',30),('A','p2',30),('A','p3',20),('B','p4',50),('B','p5',40);",
          "SELECT team, player, pts, ROW_NUMBER() OVER (PARTITION BY team ORDER BY pts DESC, player ASC), RANK() OVER (PARTITION BY team ORDER BY pts DESC), DENSE_RANK() OVER (PARTITION BY team ORDER BY pts DESC) FROM scores ORDER BY team, pts DESC, player;",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        ["A|p1|30|1|1|1", "A|p2|30|2|1|1", "A|p3|20|3|3|2", "B|p4|50|1|1|1", "B|p5|40|2|2|2", ""].join(
          "\n"
        )
      );
    });
  });

  test("6. sqlite3 LAG, LEAD with defaults, and cumulative SUM() OVER (ORDER BY ...)", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "CREATE TABLE daily(day INTEGER, rev INTEGER);",
          "INSERT INTO daily VALUES (1, 100), (2, 150), (3, 120), (4, 200);",
          "SELECT day, rev, LAG(rev, 1, 0) OVER (ORDER BY day), LEAD(rev, 1, -1) OVER (ORDER BY day), SUM(rev) OVER (ORDER BY day) FROM daily ORDER BY day;",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        ["1|100|0|150|100", "2|150|100|120|250", "3|120|150|200|370", "4|200|120|-1|570", ""].join(
          "\n"
        )
      );
    });
  });

  test("7. sqlite3 UPSERT ON CONFLICT(k) DO UPDATE SET with excluded reference", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "CREATE TABLE kv(k TEXT PRIMARY KEY, v INTEGER);",
          "INSERT INTO kv VALUES ('a', 10), ('b', 20);",
          "INSERT INTO kv VALUES ('a', 5), ('c', 30) ON CONFLICT(k) DO UPDATE SET v = kv.v + excluded.v;",
          "SELECT k, v FROM kv ORDER BY k;",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "a|15\nb|20\nc|30\n");
    });
  });

  test("8. sqlite3 UPSERT ON CONFLICT(id) DO NOTHING", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "CREATE TABLE uniq(id INTEGER PRIMARY KEY, label TEXT);",
          "INSERT INTO uniq VALUES (1, 'first'), (2, 'second');",
          "INSERT INTO uniq VALUES (2, 'ignored'), (3, 'third') ON CONFLICT(id) DO NOTHING;",
          "SELECT id, label FROM uniq ORDER BY id;",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1|first\n2|second\n3|third\n");
    });
  });

  test("9. sqlite3 AFTER INSERT and AFTER UPDATE triggers with OLD/NEW references", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "CREATE TABLE accounts(id INTEGER PRIMARY KEY, bal INTEGER);",
          "CREATE TABLE audit(msg TEXT);",
          "CREATE TRIGGER tr_ins AFTER INSERT ON accounts BEGIN INSERT INTO audit VALUES ('ins:' || NEW.id || ':' || NEW.bal); END;",
          "CREATE TRIGGER tr_upd AFTER UPDATE ON accounts BEGIN INSERT INTO audit VALUES ('upd:' || OLD.bal || '->' || NEW.bal); END;",
          "INSERT INTO accounts VALUES (1, 100);",
          "UPDATE accounts SET bal = 150 WHERE id = 1;",
          "SELECT GROUP_CONCAT(msg, '|') FROM audit;",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "ins:1:100|upd:100->150\n");
    });
  });

  test("10. sqlite3 CREATE VIEW and grouped aggregation over view", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "CREATE TABLE items(name TEXT, cat TEXT, price INTEGER);",
          "INSERT INTO items VALUES ('laptop','tech',1200),('mouse','tech',40),('desk','furn',300),('chair','furn',150);",
          "CREATE VIEW expensive AS SELECT name, cat, price FROM items WHERE price >= 150;",
          "SELECT cat, COUNT(*), SUM(price) FROM expensive GROUP BY cat ORDER BY cat;",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "furn|2|450\ntech|1|1200\n");
    });
  });

  test("11. sqlite3 INTERSECT and EXCEPT compound set operations", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "CREATE TABLE s1(x INTEGER); INSERT INTO s1 VALUES (1),(2),(3),(4);",
          "CREATE TABLE s2(x INTEGER); INSERT INTO s2 VALUES (3),(4),(5);",
          "SELECT 'I', x FROM (SELECT x FROM s1 INTERSECT SELECT x FROM s2) ORDER BY x;",
          "SELECT 'E', x FROM (SELECT x FROM s1 EXCEPT SELECT x FROM s2) ORDER BY x;",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "I|3\nI|4\nE|1\nE|2\n");
    });
  });

  test("12. sqlite3 INSTR, SUBSTR, REPLACE, HEX, and QUOTE scalar string functions", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "SELECT INSTR('hello_world', '_'), SUBSTR('hello_world', 7, 5), REPLACE('a-b-c', '-', '/'), LOWER(HEX('AB')), QUOTE('it''s');",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "6|world|a/b/c|4142|'it''s'\n");
    });
  });

  test("13. sqlite3 scalar multi-arg MAX/MIN, ABS, COALESCE, NULLIF, and TYPEOF", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "SELECT ABS(-42), MAX(10, 25, 18), MIN(10, 25, 18), COALESCE(NULL, NULLIF(5, 5), 99), TYPEOF(3.14), TYPEOF('txt'), TYPEOF(NULL);",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "42|25|10|99|real|text|null\n");
    });
  });

  test("14. sqlite3 searched CASE WHEN ... THEN ... ELSE ... END expressions", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "CREATE TABLE grades(name TEXT, score INTEGER);",
          "INSERT INTO grades VALUES ('a', 95), ('b', 82), ('c', 67);",
          "SELECT name, CASE WHEN score >= 90 THEN 'A' WHEN score >= 80 THEN 'B' ELSE 'C' END AS letter FROM grades ORDER BY name;",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "a|A\nb|B\nc|C\n");
    });
  });

  test("15. sqlite3 correlated scalar subquery and WHERE ... IN (SELECT ...) filter", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "CREATE TABLE depts(id INTEGER, dname TEXT);",
          "CREATE TABLE emps(ename TEXT, dept_id INTEGER, sal INTEGER);",
          "INSERT INTO depts VALUES (1, 'eng'), (2, 'sales'), (3, 'empty');",
          "INSERT INTO emps VALUES ('alice', 1, 120), ('bob', 1, 100), ('carol', 2, 90);",
          "SELECT dname, (SELECT COUNT(*) FROM emps e WHERE e.dept_id = d.id) AS cnt FROM depts d WHERE d.id IN (SELECT dept_id FROM emps) ORDER BY dname;",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "eng|2\nsales|1\n");
    });
  });

  test("16. sqlite3 LEFT JOIN with unmatched NULL rows and COALESCE(SUM(...), 0)", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "CREATE TABLE users(id INTEGER, uname TEXT);",
          "CREATE TABLE orders(uid INTEGER, amount INTEGER);",
          "INSERT INTO users VALUES (1, 'ada'), (2, 'grace'), (3, 'linus');",
          "INSERT INTO orders VALUES (1, 40), (1, 60), (3, 25);",
          "SELECT u.uname, COUNT(o.amount), COALESCE(SUM(o.amount), 0) FROM users u LEFT JOIN orders o ON u.id = o.uid GROUP BY u.id, u.uname ORDER BY u.id;",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "ada|2|100\ngrace|0|0\nlinus|1|25\n");
    });
  });

  test("17. sqlite3 compound HAVING clause with AND/OR over COUNT(*) and SUM(...)", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "CREATE TABLE tx(acct TEXT, amt INTEGER);",
          "INSERT INTO tx VALUES ('x', 50), ('x', 70), ('y', 30), ('z', 40), ('z', 45), ('z', 20);",
          "SELECT acct, COUNT(*), SUM(amt) FROM tx GROUP BY acct HAVING COUNT(*) >= 2 AND SUM(amt) > 100 ORDER BY acct;",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "x|2|120\nz|3|105\n");
    });
  });

  test("18. sqlite3 SAVEPOINT, ROLLBACK TO, RELEASE, and COMMIT transaction control", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "CREATE TABLE ledger(id INTEGER, v TEXT);",
          "BEGIN;",
          "INSERT INTO ledger VALUES (1, 'keep');",
          "SAVEPOINT sp1;",
          "INSERT INTO ledger VALUES (2, 'discard');",
          "ROLLBACK TO sp1;",
          "RELEASE sp1;",
          "INSERT INTO ledger VALUES (3, 'final');",
          "COMMIT;",
          "SELECT GROUP_CONCAT(id || ':' || v, ',') FROM ledger;",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1:keep,3:final\n");
    });
  });

  test("19. sqlite3 ALTER TABLE ADD COLUMN with DEFAULT value backfilling existing rows", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "CREATE TABLE cfg(k TEXT, v TEXT);",
          "INSERT INTO cfg VALUES ('host', 'localhost');",
          "ALTER TABLE cfg ADD COLUMN env TEXT DEFAULT 'prod';",
          "INSERT INTO cfg VALUES ('port', '8080', 'dev');",
          "SELECT k, v, env FROM cfg ORDER BY k;",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "host|localhost|prod\nport|8080|dev\n");
    });
  });

  test("20. sqlite3 -header -csv output mode with RFC 4180 comma quoting", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 -header -csv <<'SQL'",
          "CREATE TABLE t(id INTEGER, label TEXT);",
          "INSERT INTO t VALUES (1, 'alpha'), (2, 'beta,gamma');",
          "SELECT id, label FROM t ORDER BY id;",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, 'id,label\n1,alpha\n2,"beta,gamma"\n');
    });
  });
});
