import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

const createEnv = () => ({
  exec: (script: string) => withE2EHarness((h) => h.exec(script)),
});

describe("obscure sqlite3 fts5 validation, savepoints, alter table, pragmas, triggers, and relational parity matrix", () => {
  it("1. sqlite3 CREATE VIRTUAL TABLE rejects non-fts5 modules (fts4, rtree)", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sqlite3 :memory: "CREATE VIRTUAL TABLE docs USING fts4(title);" 2>fts4.err; rc1=$?
      sqlite3 :memory: "CREATE VIRTUAL TABLE geo USING rtree(id, minX, maxX);" 2>rtree.err; rc2=$?
      grep -qi 'only fts5 is supported' fts4.err && grep -qi 'only fts5 is supported' rtree.err && echo "rc1=$rc1 rc2=$rc2 ok"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "rc1=1 rc2=1 ok\n");
  });

  it("2. sqlite3 CREATE VIRTUAL TABLE fts5 rejects options, empty columns, duplicates, and reserved names", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sqlite3 :memory: "CREATE VIRTUAL TABLE d USING fts5(title, tokenize='porter');" 2>/dev/null; r1=$?
      sqlite3 :memory: "CREATE VIRTUAL TABLE d USING fts5(title UNINDEXED);" 2>/dev/null; r2=$?
      sqlite3 :memory: "CREATE VIRTUAL TABLE d USING fts5();" 2>/dev/null; r3=$?
      sqlite3 :memory: "CREATE VIRTUAL TABLE d USING fts5(title, title);" 2>/dev/null; r4=$?
      sqlite3 :memory: "CREATE VIRTUAL TABLE d USING fts5(rowid);" 2>/dev/null; r5=$?
      sqlite3 :memory: "CREATE VIRTUAL TABLE d USING fts5(rank);" 2>/dev/null; r6=$?
      echo "$r1:$r2:$r3:$r4:$r5:$r6"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "1:1:1:1:1:1\n");
  });

  it("3. sqlite3 CREATE VIRTUAL TABLE IF NOT EXISTS vs duplicate table error", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sqlite3 :memory: "CREATE VIRTUAL TABLE docs USING fts5(title); CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(title); INSERT INTO docs VALUES ('ok'); SELECT title FROM docs;"
      sqlite3 :memory: "CREATE VIRTUAL TABLE docs USING fts5(title); CREATE VIRTUAL TABLE docs USING fts5(title);" 2>dup.err; rc=$?
      grep -qi 'already exists' dup.err && echo "dup_rc=$rc"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "ok",
        "dup_rc=1",
        "",
      ].join("\n")
    );
  });

  it("4. sqlite3 rejects MATCH on ordinary tables and rejects binary persistence of FTS5 tables", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sqlite3 :memory: "CREATE TABLE ordinary(body TEXT); INSERT INTO ordinary VALUES ('hello'); SELECT * FROM ordinary WHERE body MATCH 'hello';" 2>match.err; rc_m=$?
      sqlite3 fts_persist.db "CREATE VIRTUAL TABLE docs USING fts5(body); INSERT INTO docs VALUES ('hello');" 2>persist.err; rc_p=$?
      grep -qi 'MATCH requires an FTS5' match.err && grep -qi 'unsupported FTS5 binary persistence' persist.err && echo "rc_m=$rc_m rc_p=$rc_p"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "rc_m=1 rc_p=1\n");
  });

  it("5. sqlite3 nested SAVEPOINT, ROLLBACK TO SAVEPOINT, and RELEASE SAVEPOINT", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sqlite3 sp.db <<'SQL'
CREATE TABLE accounts (name TEXT PRIMARY KEY, bal INT);
INSERT INTO accounts VALUES ('alice', 100), ('bob', 200);
BEGIN;
UPDATE accounts SET bal = bal - 40 WHERE name = 'alice';
SAVEPOINT s1;
UPDATE accounts SET bal = bal + 999 WHERE name = 'bob';
ROLLBACK TO s1;
UPDATE accounts SET bal = bal + 40 WHERE name = 'bob';
RELEASE s1;
COMMIT;
SELECT name, bal FROM accounts ORDER BY name;
SQL
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "alice|60",
        "bob|240",
        "",
      ].join("\n")
    );
  });

  it("6. sqlite3 ALTER TABLE ADD COLUMN, RENAME COLUMN, and RENAME TO across file invocations", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sqlite3 mig.db "CREATE TABLE users_v1 (id INT, handle TEXT); INSERT INTO users_v1 VALUES (1, 'ada');"
      sqlite3 mig.db "ALTER TABLE users_v1 RENAME COLUMN handle TO username; ALTER TABLE users_v1 ADD COLUMN role TEXT DEFAULT 'admin';"
      sqlite3 mig.db "ALTER TABLE users_v1 RENAME TO users_v2;"
      sqlite3 mig.db "SELECT id, username, role FROM users_v2;"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "1|ada|admin\n");
  });

  it("7. sqlite3 BEFORE INSERT trigger with RAISE(ABORT) and RAISE(IGNORE)", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sqlite3 trig.db <<'SQL'
CREATE TABLE scores (player TEXT, pts INT);
CREATE TRIGGER tr_skip_neg BEFORE INSERT ON scores WHEN NEW.pts < 0 BEGIN
  SELECT RAISE(IGNORE);
END;
INSERT INTO scores VALUES ('p1', 10), ('p2', -5), ('p3', 25);
SELECT player, pts FROM scores ORDER BY player;
SQL
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "p1|10",
        "p3|25",
        "",
      ].join("\n")
    );
  });

  it("8. sqlite3 WITHOUT ROWID composite primary key table persistence", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sqlite3 wor.db "CREATE TABLE kv_cluster (ns TEXT, k TEXT, v INT, PRIMARY KEY (ns, k)) WITHOUT ROWID; INSERT INTO kv_cluster VALUES ('prod', 'b', 2), ('prod', 'a', 1), ('dev', 'a', 9);"
      sqlite3 wor.db "SELECT ns, k, v FROM kv_cluster WHERE ns = 'prod' ORDER BY k;"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "prod|a|1",
        "prod|b|2",
        "",
      ].join("\n")
    );
  });

  it("9. sqlite3 PRAGMA user_version, application_id, and table_info persistence", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sqlite3 pragma.db "PRAGMA user_version = 42; PRAGMA application_id = 1337; CREATE TABLE items (id INT PRIMARY KEY, name TEXT NOT NULL);"
      sqlite3 pragma.db "PRAGMA user_version; PRAGMA application_id;"
      sqlite3 pragma.db "PRAGMA table_info(items);" | awk -F'|' '{print $2 ":" $3 ":" $4}'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "42",
        "1337",
        "id:INT:0",
        "name:TEXT:1",
        "",
      ].join("\n")
    );
  });

  it("10. sqlite3 json_set, json_insert, json_replace, json_remove, json_type, and json_valid", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sqlite3 :memory: <<'SQL'
SELECT
  json_remove(
    json_replace(
      json_insert('{"a":1,"b":2}', '$.c', 3),
      '$.a', 99
    ),
    '$.b'
  ),
  json_type('{"x":[1,2]}', '$.x'),
  json_valid('{"ok":true}'),
  json_valid('{bad');
SQL
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, '{"a":99,"c":3}|array|1|0\n');
  });

  it("11. sqlite3 COALESCE, NULLIF, IIF, TYPEOF, QUOTE, HEX, and LENGTH scalar functions", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sqlite3 :memory: <<'SQL'
SELECT
  COALESCE(NULL, NULLIF('same', 'same'), 'fallback'),
  IIF(10 > 5, 'yes', 'no'),
  TYPEOF(3.14),
  QUOTE('it''s'),
  HEX('AB'),
  LENGTH('hello');
SQL
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "fallback|yes|real|'it''s'|4142|5\n");
  });

  it("12. sqlite3 INTERSECT, EXCEPT, UNION, and UNION ALL with ORDER BY and LIMIT", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sqlite3 :memory: <<'SQL'
CREATE TABLE a (x INT);
CREATE TABLE b (x INT);
INSERT INTO a VALUES (1), (2), (3), (4);
INSERT INTO b VALUES (2), (4), (6);
SELECT x FROM a INTERSECT SELECT x FROM b ORDER BY x;
SELECT '---';
SELECT x FROM a EXCEPT SELECT x FROM b ORDER BY x;
SQL
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "2",
        "4",
        "---",
        "1",
        "3",
        "",
      ].join("\n")
    );
  });

  it("13. sqlite3 .mode line, .headers on, .separator, and .nullvalue formatting dot-commands", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sqlite3 :memory: <<'SQL'
CREATE TABLE t (k TEXT, v INT);
INSERT INTO t VALUES ('alpha', 1), ('beta', NULL);
.nullvalue N/A
.mode line
SELECT k, v FROM t ORDER BY k;
SQL
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "    k = alpha",
        "    v = 1",
        "",
        "    k = beta",
        "    v = N/A",
        "",
      ].join("\n")
    );
  });

  it("14. sqlite3 .dump and .schema SQL reconstruction and replay into a new database", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sqlite3 orig.db "CREATE TABLE items (id INT PRIMARY KEY, name TEXT); INSERT INTO items VALUES (1, 'one'), (2, 'two');"
      sqlite3 orig.db ".dump" > dump.sql
      sqlite3 clone.db < dump.sql
      sqlite3 clone.db "SELECT id, name FROM items ORDER BY id;"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "1|one",
        "2|two",
        "",
      ].join("\n")
    );
  });

  it("15. sqlite3 .mode csv and .import into table with GROUP BY / HAVING aggregation", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'dept,amount\neng,100\neng,150\nsales,80\n' > exp.csv
      sqlite3 imp.db ".mode csv" ".import exp.csv expenses" "SELECT dept, SUM(CAST(amount AS INT)) AS total FROM expenses GROUP BY dept HAVING total >= 200;" | tr -d '\\r'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "eng,250\n");
  });

  it("16. sqlite3 correlated subqueries in SELECT, WHERE EXISTS, and WHERE IN", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sqlite3 :memory: <<'SQL'
CREATE TABLE depts (id INT, name TEXT);
CREATE TABLE emps (name TEXT, dept_id INT, salary INT);
INSERT INTO depts VALUES (1, 'Eng'), (2, 'Design'), (3, 'Empty');
INSERT INTO emps VALUES ('Ada', 1, 120), ('Bob', 1, 100), ('Cara', 2, 110);
SELECT
  d.name,
  (SELECT COUNT(*) FROM emps e WHERE e.dept_id = d.id) AS cnt
FROM depts d
WHERE EXISTS (SELECT 1 FROM emps e WHERE e.dept_id = d.id)
ORDER BY d.id;
SQL
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "Eng|2",
        "Design|1",
        "",
      ].join("\n")
    );
  });

  it("17. sqlite3 GROUP_CONCAT, TOTAL, ROUND, SUBSTR, TRIM, REPLACE, and INSTR", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sqlite3 :memory: <<'SQL'
CREATE TABLE words (w TEXT);
INSERT INTO words VALUES ('alpha'), ('beta'), ('gamma');
SELECT
  GROUP_CONCAT(UPPER(SUBSTR(w, 1, 2)), '-'),
  REPLACE(TRIM('  hello_world  '), '_', ':'),
  INSTR('foobar', 'bar')
FROM words;
SQL
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "AL-BE-GA|hello:world|4\n");
  });

  it("18. sqlite3 CASE WHEN conditional aggregation inside SUM and COUNT", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sqlite3 :memory: <<'SQL'
CREATE TABLE logs (status INT);
INSERT INTO logs VALUES (200), (200), (404), (500), (503);
SELECT
  SUM(CASE WHEN status = 200 THEN 1 ELSE 0 END) AS ok_cnt,
  SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS err5xx_cnt
FROM logs;
SQL
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "2|2\n");
  });

  it("19. sqlite3 multi-table INNER JOIN and LEFT JOIN with COALESCE", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sqlite3 :memory: <<'SQL'
CREATE TABLE customers (id INT, name TEXT);
CREATE TABLE orders (cust_id INT, total INT);
INSERT INTO customers VALUES (1, 'Alice'), (2, 'Bob');
INSERT INTO orders VALUES (1, 50), (1, 70);
SELECT c.name, COALESCE(SUM(o.total), 0) AS spend
FROM customers c
LEFT JOIN orders o ON o.cust_id = c.id
GROUP BY c.id, c.name
ORDER BY c.id;
SQL
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "Alice|120",
        "Bob|0",
        "",
      ].join("\n")
    );
  });

  it("20. sqlite3 + csvsql + xan + jq cross-engine relational equivalence", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'service,reqs,errors\napi,1000,5\nworker,500,0\ncache,2000,10\n' > metrics.csv
      csvsql --query "SELECT service, CAST(reqs AS INT) AS reqs FROM metrics WHERE CAST(errors AS INT) > 0 ORDER BY CAST(reqs AS INT) DESC" metrics.csv | xan select service,reqs
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "service,reqs",
        "cache,2000",
        "api,1000",
        "",
      ].join("\n")
    );
  });
});
