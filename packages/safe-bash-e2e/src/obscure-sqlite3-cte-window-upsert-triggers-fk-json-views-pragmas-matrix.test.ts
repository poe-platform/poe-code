import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure sqlite3 cte window upsert triggers fk json views pragmas matrix", () => {
  it("01 recursive CTE bill of materials rollup", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 bom.db \"\n      CREATE TABLE parts (parent TEXT, child TEXT, qty INT, cost INT);\n      INSERT INTO parts VALUES ('bike', 'wheel', 2, 0), ('bike', 'frame', 1, 120), ('wheel', 'spoke', 10, 2), ('wheel', 'rim', 1, 30);\n      WITH RECURSIVE tree(root, item, total_qty, unit_cost) AS (\n        SELECT parent, child, qty, cost FROM parts WHERE parent = 'bike'\n        UNION ALL\n        SELECT t.root, p.child, t.total_qty * p.qty, p.cost\n        FROM tree t JOIN parts p ON t.item = p.parent\n      )\n      SELECT root, SUM(total_qty * unit_cost) FROM tree WHERE unit_cost > 0 GROUP BY root;\n    \"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "bike|220");
    });
  });

  it("02 window functions row_number rank dense_rank", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 win.db \"\n      CREATE TABLE scores (dept TEXT, emp TEXT, score INT);\n      INSERT INTO scores VALUES ('eng','alice',95),('eng','bob',95),('eng','carol',80),('ops','dave',90),('ops','erin',85);\n      SELECT dept, emp, ROW_NUMBER() OVER (PARTITION BY dept ORDER BY score DESC, emp ASC), RANK() OVER (PARTITION BY dept ORDER BY score DESC), DENSE_RANK() OVER (PARTITION BY dept ORDER BY score DESC)\n      FROM scores ORDER BY dept, emp;\n    \"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "eng|alice|1|1|1\neng|bob|2|1|1\neng|carol|3|3|2\nops|dave|1|1|1\nops|erin|2|2|2");
    });
  });

  it("03 window functions lag and lead", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 lag.db \"\n      CREATE TABLE metrics (host TEXT, ts INT, val INT);\n      INSERT INTO metrics VALUES ('h1',1,10),('h1',2,18),('h1',3,15),('h2',1,100),('h2',2,130);\n      SELECT host, ts, val, LAG(val, 1, 0) OVER (PARTITION BY host ORDER BY ts), LEAD(val, 1, -1) OVER (PARTITION BY host ORDER BY ts)\n      FROM metrics ORDER BY host, ts;\n    \"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "h1|1|10|0|18\nh1|2|18|10|15\nh1|3|15|18|-1\nh2|1|100|0|130\nh2|2|130|100|-1");
    });
  });

  it("04 window frame rows between 1 preceding and 1 following", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 frame.db \"\n      CREATE TABLE ledger (acct TEXT, seq INT, amt INT);\n      INSERT INTO ledger VALUES ('a',1,10),('a',2,20),('a',3,30),('a',4,40);\n      SELECT seq, amt, SUM(amt) OVER (PARTITION BY acct ORDER BY seq ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING)\n      FROM ledger ORDER BY seq;\n    \"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1|10|30\n2|20|60\n3|30|90\n4|40|70");
    });
  });

  it("05 upsert on conflict do update with where", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 upsert.db \"\n      CREATE TABLE kv (k TEXT PRIMARY KEY, cnt INT, tag TEXT);\n      INSERT INTO kv VALUES ('a', 5, 'init'), ('b', 10, 'init');\n      INSERT INTO kv VALUES ('a', 3, 'upd'), ('b', 0, 'skip'), ('c', 7, 'new')\n        ON CONFLICT(k) DO UPDATE SET cnt = cnt + excluded.cnt, tag = excluded.tag WHERE excluded.cnt > 0;\n      SELECT k, cnt, tag FROM kv ORDER BY k;\n    \"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "a|8|upd\nb|10|init\nc|7|new");
    });
  });

  it("06 upsert on conflict do nothing", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 donothing.db \"\n      CREATE TABLE users (id INT PRIMARY KEY, name TEXT);\n      INSERT INTO users VALUES (1, 'alice'), (2, 'bob');\n      INSERT INTO users VALUES (2, 'bob_dup'), (3, 'carol') ON CONFLICT(id) DO NOTHING;\n      SELECT id, name FROM users ORDER BY id;\n    \"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1|alice\n2|bob\n3|carol");
    });
  });

  it("07 before insert and after update triggers with when clause", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 trig.db \"\n      CREATE TABLE accounts (id INT PRIMARY KEY, bal INT);\n      CREATE TABLE audit (id INT, old_bal INT, new_bal INT);\n      CREATE TRIGGER tr_upd AFTER UPDATE ON accounts WHEN OLD.bal != NEW.bal BEGIN\n        INSERT INTO audit VALUES (NEW.id, OLD.bal, NEW.bal);\n      END;\n      INSERT INTO accounts VALUES (1, 100), (2, 200);\n      UPDATE accounts SET bal = 100 WHERE id = 1;\n      UPDATE accounts SET bal = 250 WHERE id = 2;\n      SELECT id, old_bal, new_bal FROM audit;\n    \"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "2|200|250");
    });
  });

  it("08 nested savepoint rollback to and release", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 sp.db \"\n      CREATE TABLE items (name TEXT);\n      BEGIN;\n      INSERT INTO items VALUES ('one');\n      SAVEPOINT s1;\n      INSERT INTO items VALUES ('two');\n      SAVEPOINT s2;\n      INSERT INTO items VALUES ('three');\n      ROLLBACK TO s2;\n      RELEASE s1;\n      COMMIT;\n      SELECT name FROM items ORDER BY rowid;\n    \"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "one\ntwo");
    });
  });

  it("09 pragma foreign_keys cascade and violation check", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 fk.db \"\n      PRAGMA foreign_keys = ON;\n      CREATE TABLE orgs (id INT PRIMARY KEY, name TEXT);\n      CREATE TABLE members (id INT PRIMARY KEY, org_id INT, user TEXT, FOREIGN KEY(org_id) REFERENCES orgs(id) ON DELETE CASCADE);\n      INSERT INTO orgs VALUES (1, 'core'), (2, 'edge');\n      INSERT INTO members VALUES (10, 1, 'alice'), (11, 1, 'bob'), (12, 2, 'carol');\n      DELETE FROM orgs WHERE id = 1;\n      SELECT id, org_id, user FROM members ORDER BY id;\n    \"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "12|2|carol");
    });
  });

  it("10 json functions extract set insert replace remove type array_length", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 jsonfn.db \"\n      CREATE TABLE docs (id INT, body TEXT);\n      INSERT INTO docs VALUES (1, '{\\\"user\\\":\\\"alice\\\",\\\"roles\\\":[\\\"admin\\\",\\\"dev\\\"],\\\"meta\\\":{\\\"active\\\":true,\\\"old\\\":1}}');\n      SELECT\n        JSON_EXTRACT(body, '$.user'),\n        JSON_ARRAY_LENGTH(body, '$.roles'),\n        JSON_TYPE(body, '$.meta.active'),\n        JSON_EXTRACT(JSON_REMOVE(JSON_SET(body, '$.meta.score', 99), '$.meta.old'), '$.meta.score')\n      FROM docs;\n    \"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "alice|2|true|99");
    });
  });

  it("11 json_each table valued function join", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 jeach.db \"\n      CREATE TABLE releases (ver TEXT, tags TEXT);\n      INSERT INTO releases VALUES ('1.0', '[\\\"stable\\\",\\\"lts\\\"]'), ('2.0', '[\\\"beta\\\"]');\n      SELECT r.ver, j.value FROM releases r, json_each(r.tags) j ORDER BY r.ver, j.value;\n    \"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1.0|lts\n1.0|stable\n2.0|beta");
    });
  });

  it("12 json_group_array and json_group_object", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 jgrp.db \"\n      CREATE TABLE envs (svc TEXT, k TEXT, v INT);\n      INSERT INTO envs VALUES ('api','port',8080),('api','workers',4),('web','port',3000);\n      SELECT svc, json_group_array(k), JSON_EXTRACT(json_group_object(k, v), '$.port')\n      FROM envs GROUP BY svc ORDER BY svc;\n    \"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "api|[\"port\",\"workers\"]|8080\nweb|[\"port\"]|3000");
    });
  });

  it("13 view over left join with coalesce and nullif", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 view.db \"\n      CREATE TABLE depts (id INT, name TEXT);\n      CREATE TABLE staff (name TEXT, dept_id INT, bonus INT);\n      INSERT INTO depts VALUES (1, 'eng'), (2, 'sales');\n      INSERT INTO staff VALUES ('alice', 1, 500), ('bob', 1, 0), ('ghost', 99, 100);\n      CREATE VIEW staff_report AS\n        SELECT s.name AS emp, COALESCE(d.name, 'unassigned') AS dept, COALESCE(NULLIF(s.bonus, 0), -1) AS eff_bonus\n        FROM staff s LEFT JOIN depts d ON s.dept_id = d.id;\n      SELECT emp, dept, eff_bonus FROM staff_report ORDER BY emp;\n    \"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "alice|eng|500\nbob|eng|-1\nghost|unassigned|100");
    });
  });

  it("14 alter table add rename drop column across invocations", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 alt.db \"CREATE TABLE cfg (id INT, old_name TEXT, drop_me TEXT); INSERT INTO cfg VALUES (1, 'val1', 'trash');\"\n    sqlite3 alt.db \"ALTER TABLE cfg RENAME COLUMN old_name TO new_name; ALTER TABLE cfg DROP COLUMN drop_me; ALTER TABLE cfg ADD COLUMN extra TEXT DEFAULT 'def';\"\n    sqlite3 alt.db \"INSERT INTO cfg (id, new_name) VALUES (2, 'val2'); SELECT id, new_name, extra FROM cfg ORDER BY id;\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1|val1|def\n2|val2|def");
    });
  });

  it("15 fts5 virtual table multi-term and column match queries", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 :memory: \"\n      CREATE VIRTUAL TABLE articles USING fts5(title, body);\n      INSERT INTO articles VALUES ('Rust Wasm Guide', 'fast deterministic sandboxed shell in rust and wasm');\n      INSERT INTO articles VALUES ('TypeScript Handbook', 'modular plugins in node and typescript');\n      INSERT INTO articles VALUES ('Rust CLI', 'building fast command line tools in rust');\n      SELECT title FROM articles WHERE articles MATCH 'rust wasm' ORDER BY title;\n      SELECT '---';\n      SELECT title FROM articles WHERE articles MATCH 'fast rust' ORDER BY title;\n    \"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Rust Wasm Guide\n---\nRust CLI\nRust Wasm Guide");
    });
  });

  it("16 multi-CTE pipeline with aggregation and filtering", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 cte.db \"\n      CREATE TABLE orders (cust TEXT, region TEXT, total INT);\n      INSERT INTO orders VALUES ('c1','us',100),('c1','us',200),('c2','us',50),('c3','eu',400);\n      WITH by_cust AS (\n        SELECT cust, region, SUM(total) AS spend FROM orders GROUP BY cust, region\n      ),\n      vip AS (\n        SELECT cust, region, spend FROM by_cust WHERE spend >= 150\n      )\n      SELECT region, COUNT(*), SUM(spend) FROM vip GROUP BY region ORDER BY region;\n    \"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "eu|1|400\nus|1|300");
    });
  });

  it("17 conditional sum with nested case when and having", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 case.db \"\n      CREATE TABLE tx (acct TEXT, kind TEXT, amt INT);\n      INSERT INTO tx VALUES ('a','credit',500),('a','debit',150),('b','credit',100),('b','debit',80),('c','credit',300);\n      SELECT acct, SUM(CASE WHEN kind = 'credit' THEN amt ELSE -amt END) AS net\n      FROM tx GROUP BY acct HAVING net >= 200 ORDER BY acct;\n    \"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "a|350\nc|300");
    });
  });

  it("18 set operations union intersect except", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 setops.db \"\n      CREATE TABLE s1 (v TEXT); INSERT INTO s1 VALUES ('a'),('b'),('c');\n      CREATE TABLE s2 (v TEXT); INSERT INTO s2 VALUES ('b'),('c'),('d');\n      SELECT v FROM s1 INTERSECT SELECT v FROM s2 ORDER BY v;\n      SELECT '---';\n      SELECT v FROM s1 EXCEPT SELECT v FROM s2 ORDER BY v;\n    \"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "b\nc\n---\na");
    });
  });

  it("19 output modes csv json line", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 modes.db \"\n      CREATE TABLE t (k TEXT, v INT);\n      INSERT INTO t VALUES ('alpha', 1), ('beta', 2);\n    \"\n    sqlite3 -header -csv modes.db \"SELECT k, v FROM t ORDER BY k;\"\n    sqlite3 -json modes.db \"SELECT k, v FROM t ORDER BY k;\" | jq -c .\n    sqlite3 modes.db \".mode line\" \"SELECT k, v FROM t WHERE k = 'alpha';\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "k,v\nalpha,1\nbeta,2\n[{\"k\":\"alpha\",\"v\":1},{\"k\":\"beta\",\"v\":2}]\n    k = alpha\n    v = 1");
    });
  });

  it("20 csv import with trigger and dump round-trip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'id,name,score\\n1,alice,90\\n2,bob,80\\n' > raw.csv\n    sqlite3 imp.db \"\n      CREATE TABLE players (id INT, name TEXT, score INT);\n      CREATE TABLE log (msg TEXT);\n      CREATE TRIGGER tr_imp AFTER INSERT ON players BEGIN\n        INSERT INTO log VALUES ('added:' || NEW.name || ':' || NEW.score);\n      END;\n    \"\n    sqlite3 imp.db \".mode csv\" \".import --skip 1 raw.csv players\"\n    sqlite3 imp.db \"SELECT msg FROM log ORDER BY rowid;\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "added:alice:90\nadded:bob:80");
    });
  });

});
