import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure sqlite3 JSON1, FTS5, triggers, views, savepoints, upsert, foreign keys & window analytics matrix", () => {
  it("1. window functions RANK, DENSE_RANK, and ROW_NUMBER over partitioned ties", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 :memory: "
          CREATE TABLE scores(dept TEXT, emp TEXT, score INT);
          INSERT INTO scores VALUES
            ('eng','alice',95),('eng','bob',95),('eng','carol',88),('eng','dave',80),
            ('ops','erin',91),('ops','frank',85),('ops','grace',85);
          SELECT dept, emp, score,
                 ROW_NUMBER() OVER (PARTITION BY dept ORDER BY score DESC, emp ASC) AS rn,
                 RANK() OVER (PARTITION BY dept ORDER BY score DESC) AS rnk,
                 DENSE_RANK() OVER (PARTITION BY dept ORDER BY score DESC) AS drnk
          FROM scores
          ORDER BY dept, rn;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "eng|alice|95|1|1|1",
          "eng|bob|95|2|1|1",
          "eng|carol|88|3|3|2",
          "eng|dave|80|4|4|3",
          "ops|erin|91|1|1|1",
          "ops|frank|85|2|2|2",
          "ops|grace|85|3|2|2",
        ].join("\n"),
      );
    });
  });

  it("2. window functions LAG, LEAD, FIRST_VALUE, and running SUM over partitioned series", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 :memory: "
          CREATE TABLE rev(region TEXT, q INT, amount INT);
          INSERT INTO rev VALUES
            ('east',1,100),('east',2,140),('east',3,120),
            ('west',1,200),('west',2,250);
          SELECT region, q, amount,
                 LAG(amount, 1, 0) OVER (PARTITION BY region ORDER BY q) AS prev_amt,
                 LEAD(amount, 1, -1) OVER (PARTITION BY region ORDER BY q) AS next_amt,
                 FIRST_VALUE(amount) OVER (PARTITION BY region ORDER BY q) AS first_amt,
                 SUM(amount) OVER (PARTITION BY region ORDER BY q) AS running_total
          FROM rev
          ORDER BY region, q;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "east|1|100|0|140|100|100",
          "east|2|140|100|120|100|240",
          "east|3|120|140|-1|100|360",
          "west|1|200|0|250|200|200",
          "west|2|250|200|-1|200|450",
        ].join("\n"),
      );
    });
  });

  it("3. WITH RECURSIVE organizational tree traversal with depth and breadcrumb path", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 :memory: "
          CREATE TABLE org(id INT PRIMARY KEY, name TEXT, manager_id INT);
          INSERT INTO org VALUES
            (1,'ceo',NULL),(2,'vp_eng',1),(3,'vp_ops',1),
            (4,'lead_backend',2),(5,'lead_frontend',2),(6,'sre',3);
          WITH RECURSIVE tree(id, name, depth, path) AS (
            SELECT id, name, 0, name FROM org WHERE manager_id IS NULL
            UNION ALL
            SELECT o.id, o.name, t.depth + 1, t.path || '->' || o.name
            FROM org o JOIN tree t ON o.manager_id = t.id
          )
          SELECT id, depth, path FROM tree ORDER BY id;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "1|0|ceo",
          "2|1|ceo->vp_eng",
          "3|1|ceo->vp_ops",
          "4|2|ceo->vp_eng->lead_backend",
          "5|2|ceo->vp_eng->lead_frontend",
          "6|2|ceo->vp_ops->sre",
        ].join("\n"),
      );
    });
  });

  it("4. multi-CTE pipeline chaining regional averages and above-benchmark filtering", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 :memory: "
          CREATE TABLE orders(store TEXT, region TEXT, total INT);
          INSERT INTO orders VALUES
            ('s1','north',100),('s1','north',140),('s2','north',80),
            ('s3','south',200),('s4','south',300),('s4','south',340);
          WITH store_totals AS (
            SELECT store, region, SUM(total) AS store_sum
            FROM orders GROUP BY store, region
          ),
          region_bench AS (
            SELECT region, AVG(store_sum) AS reg_avg
            FROM store_totals GROUP BY region
          )
          SELECT s.store, s.region, s.store_sum, CAST(r.reg_avg AS INT)
          FROM store_totals s
          JOIN region_bench r ON s.region = r.region
          WHERE s.store_sum > r.reg_avg
          ORDER BY s.store;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["s1|north|240|160", "s4|south|640|420"].join("\n"),
      );
    });
  });

  it("5. ON CONFLICT DO UPDATE with excluded pseudo-row and RETURNING clause", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 :memory: "
          CREATE TABLE inv(sku TEXT PRIMARY KEY, qty INT, rev INT);
          INSERT INTO inv VALUES ('A1', 10, 1), ('B2', 5, 1);
          INSERT INTO inv(sku, qty, rev) VALUES ('A1', 7, 1), ('C3', 12, 1)
            ON CONFLICT(sku) DO UPDATE SET
              qty = inv.qty + excluded.qty,
              rev = inv.rev + 1
            RETURNING sku, qty, rev;
          SELECT '---';
          SELECT sku, qty, rev FROM inv ORDER BY sku;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["A1|17|2", "C3|12|1", "---", "A1|17|2", "B2|5|1", "C3|12|1"].join("\n"),
      );
    });
  });

  it("6. INSERT OR REPLACE and INSERT OR IGNORE conflict resolution", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 :memory: "
          CREATE TABLE cfg(k TEXT PRIMARY KEY, v TEXT);
          INSERT INTO cfg VALUES ('host','db1'),('port','5432'),('mode','ro');
          INSERT OR IGNORE INTO cfg VALUES ('port','9999'),('pool','16');
          INSERT OR REPLACE INTO cfg VALUES ('mode','rw'),('tls','on');
          SELECT k, v FROM cfg ORDER BY k;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "host|db1",
          "mode|rw",
          "pool|16",
          "port|5432",
          "tls|on",
        ].join("\n"),
      );
    });
  });

  it("7. AFTER INSERT, AFTER UPDATE WHEN, and AFTER DELETE audit triggers", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 :memory: "
          CREATE TABLE accounts(id INT PRIMARY KEY, owner TEXT, bal INT);
          CREATE TABLE audit_log(seq INTEGER PRIMARY KEY AUTOINCREMENT, op TEXT, acct_id INT, detail TEXT);
          CREATE TRIGGER trg_ins AFTER INSERT ON accounts
          BEGIN
            INSERT INTO audit_log(op, acct_id, detail) VALUES ('INS', NEW.id, NEW.owner || ':' || NEW.bal);
          END;
          CREATE TRIGGER trg_upd AFTER UPDATE ON accounts WHEN OLD.bal != NEW.bal
          BEGIN
            INSERT INTO audit_log(op, acct_id, detail) VALUES ('UPD', NEW.id, OLD.bal || '->' || NEW.bal);
          END;
          CREATE TRIGGER trg_del AFTER DELETE ON accounts
          BEGIN
            INSERT INTO audit_log(op, acct_id, detail) VALUES ('DEL', OLD.id, OLD.owner || ':' || OLD.bal);
          END;
          INSERT INTO accounts VALUES (1, 'alice', 100), (2, 'bob', 50);
          UPDATE accounts SET bal = 100 WHERE id = 1;
          UPDATE accounts SET bal = 135 WHERE id = 1;
          DELETE FROM accounts WHERE id = 2;
          SELECT seq, op, acct_id, detail FROM audit_log ORDER BY seq;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "1|INS|1|alice:100",
          "2|INS|2|bob:50",
          "3|UPD|1|100->135",
          "4|DEL|2|bob:50",
        ].join("\n"),
      );
    });
  });

  it("8. BEFORE INSERT trigger with RAISE(IGNORE) and RAISE(ABORT) validation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 /tmp/trig.db "
          CREATE TABLE ledger(id INT PRIMARY KEY, amount INT);
          CREATE TRIGGER trg_guard BEFORE INSERT ON ledger
          BEGIN
            SELECT CASE
              WHEN NEW.amount = 0 THEN RAISE(IGNORE)
              WHEN NEW.amount < -1000 THEN RAISE(ABORT, 'overdraft limit exceeded')
            END;
          END;
          INSERT INTO ledger VALUES (1, 250), (2, 0), (3, -100);
        "
        if sqlite3 /tmp/trig.db "INSERT INTO ledger VALUES (4, -5000);" 2>/tmp/err.txt; then
          echo "UNEXPECTED_OK"
        else
          echo "ABORTED_AS_EXPECTED"
        fi
        grep -qi "overdraft limit exceeded" /tmp/err.txt && echo "MSG_OK"
        sqlite3 /tmp/trig.db "SELECT id, amount FROM ledger ORDER BY id;"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["ABORTED_AS_EXPECTED", "MSG_OK", "1|250", "3|-100"].join("\n"),
      );
    });
  });

  it("9. PRAGMA foreign_keys = ON with ON DELETE CASCADE and ON DELETE SET NULL", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 :memory: "
          PRAGMA foreign_keys = ON;
          CREATE TABLE teams(id INT PRIMARY KEY, name TEXT);
          CREATE TABLE mentors(id INT PRIMARY KEY, name TEXT);
          CREATE TABLE members(
            id INT PRIMARY KEY,
            member_name TEXT,
            team_id INT REFERENCES teams(id) ON DELETE CASCADE,
            mentor_id INT REFERENCES mentors(id) ON DELETE SET NULL
          );
          INSERT INTO teams VALUES (10, 'core'), (20, 'infra');
          INSERT INTO mentors VALUES (100, 'sara'), (200, 'leo');
          INSERT INTO members VALUES
            (1, 'alice', 10, 100),
            (2, 'bob', 10, 200),
            (3, 'carol', 20, 100);
          DELETE FROM teams WHERE id = 10;
          DELETE FROM mentors WHERE id = 100;
          SELECT id, member_name, team_id, COALESCE(CAST(mentor_id AS TEXT), 'NONE') FROM members ORDER BY id;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "3|carol|20|NONE");
    });
  });

  it("10. JSON1 functions json_extract, json_set, json_insert, json_replace, and json_remove", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 :memory: <<'SQL'
CREATE TABLE docs(id INT, payload TEXT);
INSERT INTO docs VALUES
  (1, '{"service":"auth","replicas":2,"tags":["prod","eu"],"debug":true}');
UPDATE docs
SET payload = json_remove(
  json_replace(
    json_insert(
      json_set(payload, '$.replicas', 5),
      '$.region', 'eu-west-1'
    ),
    '$.tags[1]', 'global'
  ),
  '$.debug'
)
WHERE id = 1;
SELECT
  json_extract(payload, '$.service'),
  json_extract(payload, '$.replicas'),
  json_extract(payload, '$.region'),
  json_extract(payload, '$.tags[0]'),
  json_extract(payload, '$.tags[1]'),
  COALESCE(json_extract(payload, '$.debug'), 'MISSING')
FROM docs WHERE id = 1;
SQL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "auth|5|eu-west-1|prod|global|MISSING");
    });
  });

  it("11. JSON1 aggregate functions json_group_array and json_group_object", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 :memory: "
          CREATE TABLE metrics(host TEXT, k TEXT, v INT);
          INSERT INTO metrics VALUES
            ('h1','cpu',72),('h1','mem',84),
            ('h2','cpu',41),('h2','mem',55);
          SELECT host,
                 json_group_array(k),
                 json_extract(json_group_object(k, v), '$.cpu'),
                 json_extract(json_group_object(k, v), '$.mem')
          FROM (SELECT * FROM metrics ORDER BY host, k)
          GROUP BY host
          ORDER BY host;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          'h1|["cpu","mem"]|72|84',
          'h2|["cpu","mem"]|41|55',
        ].join("\n"),
      );
    });
  });

  it("12. json_each table-valued function expansion joined with relational rows", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 :memory: "
          CREATE TABLE releases(ver TEXT, scores TEXT);
          INSERT INTO releases VALUES ('v1', '[10,20,30]'), ('v2', '[5,15]');
          SELECT r.ver, COUNT(j.value), SUM(CAST(j.value AS INT)), MAX(CAST(j.value AS INT))
          FROM releases r, json_each(r.scores) j
          GROUP BY r.ver
          ORDER BY r.ver;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), ["v1|3|60|30", "v2|2|20|15"].join("\n"));
    });
  });

  it("13. FTS5 full-text virtual table search with table/column MATCH, UPDATE, and DELETE", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 :memory: "
          CREATE VIRTUAL TABLE articles USING fts5(title, body);
          INSERT INTO articles VALUES
            ('sqlite engine', 'sqlite embedded relational database engine with fts5 search'),
            ('rust wasm compiler', 'compiling sqlite and shell pipelines into webassembly with rust'),
            ('sqlite search guide', 'sqlite fts5 full text search ranking guide');
          SELECT rowid, title FROM articles WHERE articles MATCH 'sqlite search' ORDER BY rowid;
          SELECT '---';
          SELECT rowid, title FROM articles WHERE title MATCH 'guide' ORDER BY rowid;
          UPDATE articles SET body = 'updated indexing tutorial' WHERE rowid = 1;
          DELETE FROM articles WHERE rowid = 2;
          SELECT '---';
          SELECT rowid, title FROM articles WHERE articles MATCH 'sqlite search' ORDER BY rowid;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "1|sqlite engine",
          "3|sqlite search guide",
          "---",
          "3|sqlite search guide",
          "---",
          "3|sqlite search guide",
        ].join("\n"),
      );
    });
  });

  it("14. nested SAVEPOINT, ROLLBACK TO SAVEPOINT, and RELEASE SAVEPOINT transaction control", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 :memory: "
          CREATE TABLE steps(n INT PRIMARY KEY, label TEXT);
          BEGIN;
          INSERT INTO steps VALUES (1, 'init');
          SAVEPOINT sp_outer;
            INSERT INTO steps VALUES (2, 'outer_work');
            SAVEPOINT sp_inner;
              INSERT INTO steps VALUES (3, 'discarded_inner');
            ROLLBACK TO sp_inner;
            RELEASE sp_inner;
            INSERT INTO steps VALUES (4, 'kept_after_inner');
          RELEASE sp_outer;
          COMMIT;
          SELECT n, label FROM steps ORDER BY n;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["1|init", "2|outer_work", "4|kept_after_inner"].join("\n"),
      );
    });
  });

  it("15. ALTER TABLE ADD COLUMN, RENAME COLUMN, and DROP COLUMN schema evolution", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 :memory: "
          CREATE TABLE users(id INT PRIMARY KEY, uname TEXT, legacy_flag INT);
          INSERT INTO users VALUES (1, 'ada', 9), (2, 'grace', 8);
          ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'member';
          ALTER TABLE users RENAME COLUMN uname TO handle;
          ALTER TABLE users DROP COLUMN legacy_flag;
          UPDATE users SET role = 'admin' WHERE id = 1;
          SELECT id, handle, role FROM users ORDER BY id;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["1|ada|admin", "2|grace|member"].join("\n"),
      );
    });
  });

  it("16. CREATE VIEW, view-to-view JOINs, and DROP VIEW lifecycle", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 :memory: "
          CREATE TABLE emps(id INT, name TEXT, dept_id INT, salary INT);
          CREATE TABLE depts(id INT, dname TEXT);
          INSERT INTO depts VALUES (1,'eng'),(2,'sales');
          INSERT INTO emps VALUES (1,'alice',1,150),(2,'bob',1,110),(3,'carol',2,130),(4,'dave',2,90);
          CREATE VIEW v_high_earners AS SELECT id, name, dept_id, salary FROM emps WHERE salary >= 120;
          CREATE VIEW v_dept_summary AS
            SELECT d.dname AS dname, COUNT(h.id) AS cnt, SUM(h.salary) AS total_sal
            FROM depts d JOIN v_high_earners h ON d.id = h.dept_id
            GROUP BY d.dname;
          SELECT dname, cnt, total_sal FROM v_dept_summary ORDER BY dname;
          DROP VIEW v_dept_summary;
          DROP VIEW v_high_earners;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["eng|1|150", "sales|1|130"].join("\n"),
      );
    });
  });

  it("17. sqlite3 .backup, .restore, and .dump dot-commands across database files", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 /tmp/source.db "
          CREATE TABLE items(id INT PRIMARY KEY, name TEXT);
          INSERT INTO items VALUES (1, 'alpha'), (2, 'beta');
        "
        sqlite3 /tmp/source.db ".backup /tmp/backup.db"
        sqlite3 /tmp/source.db "INSERT INTO items VALUES (3, 'gamma');"
        sqlite3 /tmp/restored.db ".restore /tmp/backup.db"
        sqlite3 /tmp/restored.db "SELECT id, name FROM items ORDER BY id;"
        echo "---"
        sqlite3 /tmp/restored.db ".dump" > /tmp/dump.sql
        sqlite3 /tmp/from_dump.db < /tmp/dump.sql
        sqlite3 /tmp/from_dump.db "SELECT COUNT(*), GROUP_CONCAT(name, ',') FROM items;"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["1|alpha", "2|beta", "---", "2|alpha,beta"].join("\n"),
      );
    });
  });

  it("18. sqlite3 .mode csv, .mode json, .nullvalue, and .separator output formatting", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 /tmp/fmt.db "
          CREATE TABLE t(id INT, label TEXT, note TEXT);
          INSERT INTO t VALUES (1, 'a,b', NULL), (2, 'plain', 'ok');
        "
        sqlite3 /tmp/fmt.db ".mode csv" ".headers on" ".nullvalue N/A" "SELECT id, label, note FROM t ORDER BY id;" | tr -d '\\r'
        echo "---"
        sqlite3 /tmp/fmt.db ".mode list" ".headers off" ".separator ::" ".nullvalue NULL!" "SELECT id, label, note FROM t ORDER BY id;"
        echo "---"
        sqlite3 /tmp/fmt.db ".mode json" "SELECT id, label FROM t ORDER BY id;" | jq -c 'map(.label)'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "id,label,note",
          '1,"a,b",N/A',
          "2,plain,ok",
          "---",
          "1::a,b::NULL!",
          "2::plain::ok",
          "---",
          '["a,b","plain"]',
        ].join("\n"),
      );
    });
  });

  it("19. compound set operations UNION, UNION ALL, INTERSECT, and EXCEPT", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 :memory: "
          CREATE TABLE set_a(x INT);
          CREATE TABLE set_b(x INT);
          INSERT INTO set_a VALUES (1),(2),(3),(4);
          INSERT INTO set_b VALUES (3),(4),(5),(6);
          SELECT 'INTERSECT:' || GROUP_CONCAT(x, ',') FROM (
            SELECT x FROM set_a INTERSECT SELECT x FROM set_b ORDER BY x
          );
          SELECT 'EXCEPT:' || GROUP_CONCAT(x, ',') FROM (
            SELECT x FROM set_a EXCEPT SELECT x FROM set_b ORDER BY x
          );
          SELECT 'UNION:' || GROUP_CONCAT(x, ',') FROM (
            SELECT x FROM set_a UNION SELECT x FROM set_b ORDER BY x
          );
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["INTERSECT:3,4", "EXCEPT:1,2", "UNION:1,2,3,4,5,6"].join("\n"),
      );
    });
  });

  it("20. aggregate FILTER (WHERE ...) clauses combined with searched CASE WHEN", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 :memory: "
          CREATE TABLE tx(acct TEXT, kind TEXT, amt INT);
          INSERT INTO tx VALUES
            ('a1','credit',200),('a1','debit',50),('a1','credit',100),('a1','debit',30),
            ('a2','credit',80),('a2','debit',120);
          SELECT acct,
                 COUNT(*) FILTER (WHERE kind = 'credit') AS credit_cnt,
                 SUM(amt) FILTER (WHERE kind = 'credit') AS credit_sum,
                 SUM(amt) FILTER (WHERE kind = 'debit') AS debit_sum,
                 CASE
                   WHEN SUM(CASE WHEN kind = 'credit' THEN amt ELSE -amt END) >= 0 THEN 'solvent'
                   ELSE 'deficit'
                 END AS status
          FROM tx
          GROUP BY acct
          ORDER BY acct;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["a1|2|300|80|solvent", "a2|1|80|120|deficit"].join("\n"),
      );
    });
  });
});
