import assert from "node:assert/strict";
import test from "node:test";

import { withE2EHarness } from "./harness.js";

test("obscure sqlite3 matrix 01: recursive CTE generating Fibonacci sequence", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(`
    sqlite3 :memory: "
      WITH RECURSIVE fib(i, a, b) AS (
        SELECT 0, 0, 1
        UNION ALL
        SELECT i + 1, b, a + b FROM fib WHERE i < 7
      )
      SELECT i, a, b FROM fib;
    "
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(
    res.stdout,
    [
      "0|0|1",
      "1|1|1",
      "2|1|2",
      "3|2|3",
      "4|3|5",
      "5|5|8",
      "6|8|13",
      "7|13|21",
      "",
    ].join("\n")
  );
  });
});

test("obscure sqlite3 matrix 02: recursive CTE traversing custom category hierarchy with depth and path", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(`
    sqlite3 :memory: "
      CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT, parent_id INTEGER);
      INSERT INTO categories VALUES
        (1, 'root', NULL),
        (2, 'compute', 1),
        (3, 'storage', 1),
        (4, 'wasm', 2),
        (5, 'kv', 3);
      WITH RECURSIVE cat_tree(id, name, parent_id, depth, path) AS (
        SELECT id, name, parent_id, 0, name FROM categories WHERE parent_id IS NULL
        UNION ALL
        SELECT c.id, c.name, c.parent_id, t.depth + 1, t.path || '/' || c.name
        FROM categories c
        JOIN cat_tree t ON c.parent_id = t.id
      )
      SELECT id, depth, path FROM cat_tree WHERE depth >= 1 ORDER BY id;
    "
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(
    res.stdout,
    [
      "2|1|root/compute",
      "3|1|root/storage",
      "4|2|root/compute/wasm",
      "5|2|root/storage/kv",
      "",
    ].join("\n")
  );
  });
});

test("obscure sqlite3 matrix 03: chained multiple CTEs combining aggregation and window ranking", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(`
    sqlite3 :memory: "
      CREATE TABLE events (team TEXT, points INTEGER);
      INSERT INTO events VALUES
        ('alpha', 10), ('alpha', 25),
        ('beta', 40), ('beta', 15),
        ('gamma', 20);
      WITH totals AS (
        SELECT team, SUM(points) AS total_pts, COUNT(*) AS cnt
        FROM events
        GROUP BY team
      ),
      ranked AS (
        SELECT team, total_pts, cnt, ROW_NUMBER() OVER (ORDER BY total_pts DESC) AS rnk
        FROM totals
      )
      SELECT rnk, team, total_pts, cnt FROM ranked ORDER BY rnk;
    "
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(
    res.stdout,
    [
      "1|beta|55|2",
      "2|alpha|35|2",
      "3|gamma|20|1",
      "",
    ].join("\n")
  );
  });
});

test("obscure sqlite3 matrix 04: CTE with VALUES table constructor and GROUP BY HAVING", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(`
    sqlite3 :memory: "
      WITH items(grp, val) AS (
        VALUES ('a', 10), ('b', 25), ('a', 30), ('b', 5), ('c', 8)
      )
      SELECT grp, SUM(val) AS total, COUNT(*) AS n
      FROM items
      GROUP BY grp
      HAVING SUM(val) >= 30
      ORDER BY grp;
    "
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "a|40|2\nb|30|2\n");
  });
});

test("obscure sqlite3 matrix 05: BEFORE and AFTER UPDATE triggers on upsert with WHEN and pre/post state", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(`
    sqlite3 :memory: "
      CREATE TABLE stock (sku TEXT PRIMARY KEY, qty INTEGER);
      CREATE TABLE log (phase TEXT, sku TEXT, old_qty INTEGER, new_qty INTEGER, stored_qty INTEGER);
      CREATE TRIGGER before_update BEFORE UPDATE ON stock WHEN NEW.qty > OLD.qty BEGIN
        INSERT INTO log SELECT 'before', OLD.sku, OLD.qty, NEW.qty, qty FROM stock WHERE sku = OLD.sku;
      END;
      CREATE TRIGGER after_update AFTER UPDATE ON stock WHEN NEW.qty > OLD.qty BEGIN
        INSERT INTO log SELECT 'after', NEW.sku, OLD.qty, NEW.qty, qty FROM stock WHERE sku = NEW.sku;
      END;
      INSERT INTO stock VALUES ('A', 5);
      INSERT INTO stock VALUES ('A', 3), ('B', 4), ('A', 2)
        ON CONFLICT(sku) DO UPDATE SET qty = stock.qty + excluded.qty;
      SELECT phase, sku, old_qty, new_qty, stored_qty FROM log;
    "
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(
    res.stdout,
    [
      "before|A|5|8|5",
      "after|A|5|8|8",
      "before|A|8|10|8",
      "after|A|8|10|10",
      "",
    ].join("\n")
  );
  });
});

test("obscure sqlite3 matrix 06: BEFORE INSERT trigger with RAISE(ABORT, msg) blocking invalid row", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(`
    sqlite3 /tmp/trig_abort.db "
      CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price INTEGER);
      CREATE TRIGGER chk_price BEFORE INSERT ON products BEGIN
        SELECT CASE WHEN NEW.price < 0 THEN RAISE(ABORT, 'negative price not allowed') END;
      END;
      INSERT INTO products VALUES (1, 'book', 20);
    "
    sqlite3 /tmp/trig_abort.db "INSERT INTO products VALUES (2, 'bad', -5);" 2>/tmp/trig_err.txt || echo "failed:$?"
    grep -q "negative price not allowed" /tmp/trig_err.txt && echo "err_matched"
    sqlite3 /tmp/trig_abort.db "SELECT id, name, price FROM products ORDER BY id;"
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "failed:1\nerr_matched\n1|book|20\n");
  });
});

test("obscure sqlite3 matrix 07: AFTER DELETE trigger archiving OLD rows alongside DELETE RETURNING", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(`
    sqlite3 :memory: "
      CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT, status TEXT);
      CREATE TABLE archive (id INTEGER, title TEXT);
      CREATE TRIGGER trg_del AFTER DELETE ON tasks BEGIN
        INSERT INTO archive VALUES (OLD.id, OLD.title);
      END;
      INSERT INTO tasks VALUES (1, 'ship wasm', 'done'), (2, 'write docs', 'open'), (3, 'clean logs', 'done');
      DELETE FROM tasks WHERE status = 'done' RETURNING id, title;
      SELECT '---', id, title FROM archive ORDER BY id;
    "
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(
    res.stdout,
    [
      "1|ship wasm",
      "3|clean logs",
      "---|1|ship wasm",
      "---|3|clean logs",
      "",
    ].join("\n")
  );
  });
});

test("obscure sqlite3 matrix 08: foreign key constraint failure rolls back statement when PRAGMA foreign_keys=ON", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(`
    sqlite3 /tmp/fk1.db "
      PRAGMA foreign_keys = ON;
      CREATE TABLE parents (id INTEGER PRIMARY KEY, label TEXT);
      CREATE TABLE children (id INTEGER PRIMARY KEY, pid INTEGER REFERENCES parents(id));
      INSERT INTO parents VALUES (1, 'one'), (2, 'two');
      INSERT INTO children VALUES (10, 1);
    "
    sqlite3 /tmp/fk1.db "PRAGMA foreign_keys = ON; INSERT INTO children VALUES (20, 2), (30, 99);" 2>/tmp/fk1.err || echo "fk_failed:$?"
    grep -qi "FOREIGN KEY constraint failed" /tmp/fk1.err && echo "fk_msg_ok"
    sqlite3 /tmp/fk1.db "SELECT id, pid FROM children ORDER BY id;"
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "fk_failed:1\nfk_msg_ok\n10|1\n");
  });
});

test("obscure sqlite3 matrix 09: foreign keys ON DELETE CASCADE and ON UPDATE CASCADE with child trigger", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(`
    sqlite3 :memory: "
      PRAGMA foreign_keys = ON;
      CREATE TABLE depts (id TEXT PRIMARY KEY);
      CREATE TABLE members (name TEXT, dept_id TEXT REFERENCES depts(id) ON UPDATE CASCADE ON DELETE CASCADE);
      CREATE TABLE audit (evt TEXT);
      CREATE TRIGGER mem_upd AFTER UPDATE ON members BEGIN
        INSERT INTO audit VALUES (OLD.name || ':' || OLD.dept_id || '->' || NEW.dept_id);
      END;
      INSERT INTO depts VALUES ('eng'), ('ops');
      INSERT INTO members VALUES ('alice', 'eng'), ('bob', 'ops'), ('carol', 'eng');
      UPDATE depts SET id = 'core' WHERE id = 'eng';
      DELETE FROM depts WHERE id = 'ops';
      SELECT name, dept_id FROM members ORDER BY name;
      SELECT evt FROM audit ORDER BY evt;
    "
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(
    res.stdout,
    [
      "alice|core",
      "carol|core",
      "alice:eng->core",
      "carol:eng->core",
      "",
    ].join("\n")
  );
  });
});

test("obscure sqlite3 matrix 10: foreign keys ON DELETE SET NULL and ON DELETE SET DEFAULT", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(`
    sqlite3 :memory: "
      PRAGMA foreign_keys = ON;
      CREATE TABLE tiers (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY,
        opt_tier INTEGER REFERENCES tiers(id) ON DELETE SET NULL,
        def_tier INTEGER DEFAULT 1 REFERENCES tiers(id) ON DELETE SET DEFAULT
      );
      INSERT INTO tiers VALUES (1, 'free'), (2, 'pro'), (3, 'enterprise');
      INSERT INTO accounts VALUES (100, 2, 3), (200, 3, 2);
      DELETE FROM tiers WHERE id = 2;
      SELECT id, COALESCE(opt_tier, -1), def_tier FROM accounts ORDER BY id;
    "
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "100|-1|3\n200|3|1\n");
  });
});

test("obscure sqlite3 matrix 11: INSERT INTO ... SELECT with ON CONFLICT DO UPDATE and WHERE filter", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(`
    sqlite3 :memory: "
      CREATE TABLE balances (acct TEXT PRIMARY KEY, amount INTEGER);
      CREATE TABLE deltas (acct TEXT, delta INTEGER);
      INSERT INTO balances VALUES ('a', 100), ('b', 50);
      INSERT INTO deltas VALUES ('a', 25), ('b', -10), ('c', 40);
      INSERT INTO balances(acct, amount)
        SELECT acct, delta FROM deltas
        ON CONFLICT(acct) DO UPDATE SET amount = balances.amount + excluded.amount
        WHERE excluded.amount > 0;
      SELECT acct, amount FROM balances ORDER BY acct;
    "
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "a|125\nb|50\nc|40\n");
  });
});

test("obscure sqlite3 matrix 12: FTS5 virtual table creation, rowid, table/column MATCH, UPDATE and DELETE", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(`
    sqlite3 :memory: "
      CREATE VIRTUAL TABLE docs USING fts5(title, body);
      INSERT INTO docs VALUES
        ('Rust Guide', 'fast memory safe systems language'),
        ('Shell Manual', 'safe bash virtual shell in rust and typescript'),
        ('Notes', 'unrelated text about gardening');
      SELECT rowid, title FROM docs WHERE docs MATCH 'RUST' ORDER BY rowid;
      SELECT rowid, title FROM docs WHERE title MATCH 'rust' ORDER BY rowid;
      SELECT rowid, title FROM docs WHERE docs MATCH 'safe rust' ORDER BY rowid;
      UPDATE docs SET title = 'Archived' WHERE rowid = 1;
      DELETE FROM docs WHERE rowid = 2;
      SELECT COUNT(*) FROM docs WHERE docs MATCH 'rust';
    "
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(
    res.stdout,
    [
      "1|Rust Guide",
      "2|Shell Manual",
      "1|Rust Guide",
      "1|Rust Guide",
      "2|Shell Manual",
      "0",
      "",
    ].join("\n")
  );
  });
});

test("obscure sqlite3 matrix 13: json_each and json_tree table-valued functions joined with relational rows", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(`
    sqlite3 :memory: <<'SQL'
CREATE TABLE orders (id INTEGER, payload TEXT);
INSERT INTO orders VALUES
  (1, '{"customer":"ada","items":[10,20,30]}'),
  (2, '{"customer":"bob","items":[5,15]}');
SELECT orders.id, je.key, je.value
FROM orders, json_each(orders.payload, '$.items') AS je
ORDER BY orders.id, CAST(je.key AS INTEGER);
SELECT fullkey, type, COALESCE(atom, '') FROM json_tree('{"a":[1,{"b":"ok"}]}') ORDER BY fullkey;
SQL
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(
    res.stdout,
    [
      "1|0|10",
      "1|1|20",
      "1|2|30",
      "2|0|5",
      "2|1|15",
      "$|object|",
      "$.a|array|",
      "$.a[0]|integer|1",
      "$.a[1]|object|",
      "$.a[1].b|text|ok",
      "",
    ].join("\n")
  );
  });
});

test("obscure sqlite3 matrix 14: json_set, json_remove, json_patch, json_type, json_valid, -> and ->>", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(`
    sqlite3 :memory: <<'SQL'
CREATE TABLE configs (name TEXT, doc TEXT);
INSERT INTO configs VALUES ('app', '{"host":"localhost","port":8080,"old":true,"tags":["v1","v2"]}');
UPDATE configs
SET doc = json_patch(
  json_remove(json_set(doc, '$.port', 9090, '$.tls', true), '$.old'),
  '{"meta":{"env":"prod"}}'
);
SELECT
  doc ->> '$.host',
  doc -> '$.meta',
  doc ->> '$.tags[1]',
  json_type(doc, '$.port'),
  json_valid(doc),
  json_valid('{bad')
FROM configs;
SQL
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "localhost|{\"env\":\"prod\"}|v2|integer|1|0\n");
  });
});

test("obscure sqlite3 matrix 15: json_object, json_array, json_group_array, and json_group_object", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(`
    sqlite3 :memory: "
      CREATE TABLE metrics (service TEXT, host TEXT, latency INTEGER);
      INSERT INTO metrics VALUES
        ('api', 'h1', 12),
        ('api', 'h2', 18),
        ('db', 'd1', 5);
      SELECT
        service,
        json_group_array(host),
        json_group_object(host, latency),
        json_object('svc', service, 'max', MAX(latency)),
        json_array(service, COUNT(*), SUM(latency))
      FROM metrics
      GROUP BY service
      ORDER BY service;
    "
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(
    res.stdout,
    [
      'api|["h1","h2"]|{"h1":12,"h2":18}|{"svc":"api","max":18}|["api",2,30]',
      'db|["d1"]|{"d1":5}|{"svc":"db","max":5}|["db",1,5]',
      "",
    ].join("\n")
  );
  });
});

test("obscure sqlite3 matrix 16: window functions RANK, DENSE_RANK, NTILE, LAG, LEAD, FIRST_VALUE, LAST_VALUE", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(`
    sqlite3 :memory: "
      CREATE TABLE scores (dept TEXT, emp TEXT, score INTEGER);
      INSERT INTO scores VALUES
        ('eng', 'a', 100),
        ('eng', 'b', 100),
        ('eng', 'c', 80),
        ('eng', 'd', 60);
      SELECT
        emp,
        RANK() OVER (PARTITION BY dept ORDER BY score DESC) AS rnk,
        DENSE_RANK() OVER (PARTITION BY dept ORDER BY score DESC) AS drnk,
        NTILE(2) OVER (PARTITION BY dept ORDER BY score DESC, emp ASC) AS tile,
        LAG(score, 1, -1) OVER (PARTITION BY dept ORDER BY score DESC, emp ASC) AS prev_s,
        LEAD(score, 1, -1) OVER (PARTITION BY dept ORDER BY score DESC, emp ASC) AS next_s,
        FIRST_VALUE(emp) OVER (PARTITION BY dept ORDER BY score DESC, emp ASC) AS first_e,
        LAST_VALUE(emp) OVER (PARTITION BY dept ORDER BY score DESC, emp ASC ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS last_e
      FROM scores
      ORDER BY score DESC, emp ASC;
    "
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(
    res.stdout,
    [
      "a|1|1|1|-1|100|a|d",
      "b|1|1|1|100|80|a|d",
      "c|3|2|2|100|60|a|d",
      "d|4|3|2|80|-1|a|d",
      "",
    ].join("\n")
  );
  });
});

test("obscure sqlite3 matrix 17: sliding window frames ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(`
    sqlite3 :memory: "
      CREATE TABLE ledger (acct TEXT, seq INTEGER, val INTEGER);
      INSERT INTO ledger VALUES
        ('x', 1, 10),
        ('x', 2, 20),
        ('x', 3, 30),
        ('x', 4, 40),
        ('y', 1, 5),
        ('y', 2, 15);
      SELECT
        acct,
        seq,
        SUM(val) OVER (PARTITION BY acct ORDER BY seq ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING) AS win_sum,
        SUM(val) OVER (PARTITION BY acct ORDER BY seq ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS run_sum
      FROM ledger
      ORDER BY acct, seq;
    "
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(
    res.stdout,
    [
      "x|1|30|10",
      "x|2|60|30",
      "x|3|90|60",
      "x|4|70|100",
      "y|1|20|5",
      "y|2|20|20",
      "",
    ].join("\n")
  );
  });
});

test("obscure sqlite3 matrix 18: scalar functions on columns IIF, IFNULL, NULLIF, INSTR, SUBSTR, LENGTH, ROUND, ABS, TYPEOF, QUOTE, HEX, PRINTF", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(`
    sqlite3 :memory: "
      CREATE TABLE samples (id INTEGER, code TEXT, num REAL, opt TEXT);
      INSERT INTO samples VALUES (1, '  ab-cd-ef  ', -12.3456, NULL), (2, 'xyz-123', 7.5, 'custom');
      SELECT
        id,
        LENGTH(TRIM(code)),
        SUBSTR(TRIM(code), 4, 2),
        INSTR(TRIM(code), '-'),
        ROUND(ABS(num), 2),
        IIF(num < 0, 'neg', 'pos'),
        IFNULL(opt, 'fallback'),
        COALESCE(NULLIF(opt, 'custom'), 'was_custom'),
        TYPEOF(num),
        QUOTE(opt),
        HEX(SUBSTR(TRIM(code), 1, 2)),
        PRINTF('%03d:%.1f', id, ABS(num))
      FROM samples
      ORDER BY id;
    "
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(
    res.stdout,
    [
      "1|8|cd|3|12.35|neg|fallback|was_custom|real|NULL|6162|001:12.3",
      "2|7|-1|4|7.5|pos|custom|was_custom|real|'custom'|7879|002:7.5",
      "",
    ].join("\n")
  );
  });
});

test("obscure sqlite3 matrix 19: WHERE predicates BETWEEN, NOT BETWEEN, IN, NOT IN, NOT LIKE, GLOB, <> and SQL comments", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(`
    sqlite3 :memory: "
      -- Setup inventory table
      CREATE TABLE inv (id INTEGER, code TEXT, qty INTEGER, tag TEXT);
      /* Populate sample rows */
      INSERT INTO inv VALUES
        (1, 'A-100', 15, 'core'),
        (2, 'B-200', 5, 'aux'),
        (3, 'A-300', 25, 'core'),
        (4, 'C-400', 50, 'legacy'),
        (5, 'A-500', 18, 'skip');
      SELECT id, code FROM inv
      WHERE qty BETWEEN 10 AND 30
        AND tag IN ('core', 'aux')
        AND id NOT IN (9, 10)
        AND code GLOB 'A-[0-9]*'
        AND code NOT LIKE '%999%'
        AND tag <> 'skip'
      ORDER BY id;
      SELECT id FROM inv WHERE qty NOT BETWEEN 10 AND 30 ORDER BY id;
    "
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "1|A-100\n3|A-300\n2\n4\n");
  });
});

test("obscure sqlite3 matrix 20: dot-commands .mode markdown/line/quote/insert, .parameter, SAVEPOINT/ROLLBACK TO, and .backup/.restore", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(`
    sqlite3 /tmp/main.db <<'SQL'
CREATE TABLE kv (k TEXT PRIMARY KEY, v INTEGER);
INSERT INTO kv VALUES ('a', 1);
BEGIN;
SAVEPOINT sp1;
INSERT INTO kv VALUES ('b', 2);
SAVEPOINT sp2;
INSERT INTO kv VALUES ('c', 3);
ROLLBACK TO sp2;
RELEASE sp1;
COMMIT;
.backup /tmp/backup.db
SQL
    sqlite3 :memory: <<'SQL'
.restore /tmp/backup.db
.parameter set :min_v 1
.mode markdown
SELECT k, v FROM kv WHERE v >= :min_v ORDER BY k;
.headers off
.mode quote
SELECT k, v FROM kv ORDER BY k;
.mode insert kv_copy
SELECT k, v FROM kv WHERE k = 'b';
SQL
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(
    res.stdout,
    [
      "| k | v |",
      "|---|---|",
      "| a | 1 |",
      "| b | 2 |",
      "'a',1",
      "'b',2",
      "INSERT INTO kv_copy VALUES('b',2);",
      "",
    ].join("\n")
  );
  });
});
