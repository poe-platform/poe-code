import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure sqlite3 recursive graph window frames json each triggers matrix", () => {
  it("1. recursive CTE organizational hierarchy depth and path breadcrumb materialization", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 /tmp/org77.db << 'SQL'\nCREATE TABLE emp(id INT, name TEXT, mgr_id INT);\nINSERT INTO emp VALUES (1, 'CEO', NULL), (2, 'VP_Eng', 1), (3, 'VP_Sales', 1), (4, 'Lead_A', 2), (5, 'Dev_1', 4);\nWITH RECURSIVE tree(id, name, depth, path) AS (\n  SELECT id, name, 0, name FROM emp WHERE mgr_id IS NULL\n  UNION ALL\n  SELECT e.id, e.name, t.depth + 1, t.path || '->' || e.name\n  FROM emp e JOIN tree t ON e.mgr_id = t.id\n)\nSELECT depth, path FROM tree ORDER BY id;\nSQL");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "0|CEO\n1|CEO->VP_Eng\n1|CEO->VP_Sales\n2|CEO->VP_Eng->Lead_A\n3|CEO->VP_Eng->Lead_A->Dev_1");
    });
  });

  it("2. window functions: ROW_NUMBER, RANK, DENSE_RANK partitioned by department", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 /tmp/win77.db << 'SQL'\nCREATE TABLE scores(dept TEXT, emp TEXT, score INT);\nINSERT INTO scores VALUES ('eng','alice',95),('eng','bob',95),('eng','carol',80),('ops','dave',90),('ops','erin',85);\nSELECT dept, emp, score,\n  ROW_NUMBER() OVER (PARTITION BY dept ORDER BY score DESC, emp ASC) AS rn,\n  RANK() OVER (PARTITION BY dept ORDER BY score DESC) AS rnk,\n  DENSE_RANK() OVER (PARTITION BY dept ORDER BY score DESC) AS drnk\nFROM scores ORDER BY dept, rn;\nSQL");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "eng|alice|95|1|1|1\neng|bob|95|2|1|1\neng|carol|80|3|3|2\nops|dave|90|1|1|1\nops|erin|85|2|2|2");
    });
  });

  it("3. window functions: LAG, LEAD, and cumulative SUM() OVER (PARTITION BY ... ORDER BY ...)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 /tmp/lag77.db << 'SQL'\nCREATE TABLE rev(acct TEXT, mo INT, amt INT);\nINSERT INTO rev VALUES ('A',1,100),('A',2,150),('A',3,200),('B',1,50),('B',2,80);\nSELECT acct, mo, amt,\n  COALESCE(LAG(amt, 1) OVER (PARTITION BY acct ORDER BY mo), 0) AS prev_amt,\n  COALESCE(LEAD(amt, 1) OVER (PARTITION BY acct ORDER BY mo), 0) AS next_amt,\n  SUM(amt) OVER (PARTITION BY acct ORDER BY mo) AS running_sum\nFROM rev ORDER BY acct, mo;\nSQL");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "A|1|100|0|150|100\nA|2|150|100|200|250\nA|3|200|150|0|450\nB|1|50|0|80|50\nB|2|80|50|0|130");
    });
  });

  it("4. json_each table-valued expansion joined with relational table and aggregated", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 /tmp/je77.db << 'SQL'\nCREATE TABLE posts(id INT, title TEXT, tags_json TEXT);\nINSERT INTO posts VALUES (1, 'Rust Wasm', '[\"rust\",\"wasm\",\"shell\"]'), (2, 'SQL Engine', '[\"rust\",\"sql\"]');\nSELECT j.value AS tag, COUNT(*) AS cnt\nFROM posts p, json_each(p.tags_json) j\nGROUP BY j.value\nORDER BY cnt DESC, tag ASC;\nSQL");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "rust|2\nshell|1\nsql|1\nwasm|1");
    });
  });

  it("5. json_object, json_group_array, and json_group_object nested JSON document construction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 /tmp/jg77.db << 'SQL'\nCREATE TABLE items(cat TEXT, code TEXT, price INT);\nINSERT INTO items VALUES ('hw','cpu',300),('hw','ram',120),('sw','os',99);\nSELECT cat, json_group_object(code, price) AS map_json\nFROM items GROUP BY cat ORDER BY cat;\nSQL");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "hw|{\"cpu\":300,\"ram\":120}\nsw|{\"os\":99}");
    });
  });

  it("6. INSERT ... ON CONFLICT(key) DO UPDATE SET with excluded reference and conditional WHERE", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 /tmp/up77.db << 'SQL'\nCREATE TABLE kv(k TEXT PRIMARY KEY, v INT, updates INT);\nINSERT INTO kv VALUES ('alpha', 10, 1), ('beta', 20, 1);\nINSERT INTO kv VALUES ('alpha', 25, 1), ('gamma', 30, 1)\n  ON CONFLICT(k) DO UPDATE SET v = kv.v + excluded.v, updates = kv.updates + 1;\nSELECT k, v, updates FROM kv ORDER BY k;\nSQL");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "alpha|35|2\nbeta|20|1\ngamma|30|1");
    });
  });

  it("7. AFTER INSERT, AFTER UPDATE, and AFTER DELETE triggers maintaining an audit log table", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 /tmp/trig77.db << 'SQL'\nCREATE TABLE accounts(id INT PRIMARY KEY, bal INT);\nCREATE TABLE audit(op TEXT, acct_id INT, delta INT);\nCREATE TRIGGER tr_ins AFTER INSERT ON accounts BEGIN\n  INSERT INTO audit VALUES ('INS', NEW.id, NEW.bal);\nEND;\nCREATE TRIGGER tr_upd AFTER UPDATE ON accounts BEGIN\n  INSERT INTO audit VALUES ('UPD', NEW.id, NEW.bal - OLD.bal);\nEND;\nCREATE TRIGGER tr_del AFTER DELETE ON accounts BEGIN\n  INSERT INTO audit VALUES ('DEL', OLD.id, -OLD.bal);\nEND;\nINSERT INTO accounts VALUES (1, 100), (2, 250);\nUPDATE accounts SET bal = 180 WHERE id = 1;\nDELETE FROM accounts WHERE id = 2;\nSELECT op, acct_id, delta FROM audit;\nSQL");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "INS|1|100\nINS|2|250\nUPD|1|80\nDEL|2|-250");
    });
  });

  it("8. nested SAVEPOINT, ROLLBACK TO SAVEPOINT, and RELEASE SAVEPOINT state verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 /tmp/sp77.db << 'SQL'\nCREATE TABLE ledger(step TEXT);\nBEGIN;\nINSERT INTO ledger VALUES ('s1');\nSAVEPOINT sp_a;\nINSERT INTO ledger VALUES ('s2_kept');\nSAVEPOINT sp_b;\nINSERT INTO ledger VALUES ('s3_rolled_back');\nROLLBACK TO sp_b;\nRELEASE sp_b;\nRELEASE sp_a;\nCOMMIT;\nSELECT step FROM ledger;\nSQL");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "s1\ns2_kept");
    });
  });

  it("9. PIVOT query via SUM(CASE WHEN ...) and ROUND(..., 2) percentage calculation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 /tmp/piv77.db << 'SQL'\nCREATE TABLE events(region TEXT, status TEXT, cnt INT);\nINSERT INTO events VALUES ('us','ok',80),('us','err',20),('eu','ok',45),('eu','err',5);\nSELECT region,\n  SUM(CASE WHEN status = 'ok' THEN cnt ELSE 0 END) AS ok_cnt,\n  SUM(CASE WHEN status = 'err' THEN cnt ELSE 0 END) AS err_cnt,\n  SUM(cnt) AS total_cnt\nFROM events GROUP BY region ORDER BY region;\nSQL");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "eu|45|5|50\nus|80|20|100");
    });
  });

  it("10. FTS5 virtual table full-text search with boolean AND / OR / prefix queries", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 :memory: << 'SQL'\nCREATE VIRTUAL TABLE docs USING fts5(title, body);\nINSERT INTO docs VALUES ('Storage Guide', 'Configure zstd compression for virtual filesystem');\nINSERT INTO docs VALUES ('Network Guide', 'Configure tls certificates for edge proxy');\nINSERT INTO docs VALUES ('Shell Manual', 'Execute bash pipelines over virtual filesystem');\nSELECT title FROM docs WHERE docs MATCH 'virtual filesystem' ORDER BY title;\nSQL");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Shell Manual\nStorage Guide");
    });
  });

  it("11. VIEW creation, querying VIEW with JOIN and GROUP BY, and DROP VIEW", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 /tmp/vw77.db << 'SQL'\nCREATE TABLE users(id INT, name TEXT, tier TEXT);\nCREATE TABLE spends(user_id INT, amount INT);\nINSERT INTO users VALUES (1,'Alice','gold'),(2,'Bob','silver'),(3,'Carol','gold');\nINSERT INTO spends VALUES (1,120),(1,80),(2,50),(3,300);\nCREATE VIEW gold_users AS SELECT id, name FROM users WHERE tier = 'gold';\nSELECT g.name, SUM(s.amount) AS total\nFROM gold_users g JOIN spends s ON g.id = s.user_id\nGROUP BY g.name ORDER BY total DESC;\nSQL");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Carol|300\nAlice|200");
    });
  });

  it("12. ALTER TABLE ADD COLUMN with DEFAULT and RENAME COLUMN migration", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 /tmp/alt77.db << 'SQL'\nCREATE TABLE nodes(id INT, host TEXT);\nINSERT INTO nodes VALUES (1, 'n1.internal'), (2, 'n2.internal');\nALTER TABLE nodes ADD COLUMN role TEXT DEFAULT 'worker';\nALTER TABLE nodes RENAME COLUMN host TO hostname;\nUPDATE nodes SET role = 'control' WHERE id = 1;\nSELECT id, hostname, role FROM nodes ORDER BY id;\nSQL");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1|n1.internal|control\n2|n2.internal|worker");
    });
  });

  it("13. correlated scalar subquery and EXISTS / NOT EXISTS filtering", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 /tmp/sub77.db << 'SQL'\nCREATE TABLE customers(id INT, name TEXT);\nCREATE TABLE invoices(cust_id INT, total INT);\nINSERT INTO customers VALUES (1,'Acme'),(2,'Globex'),(3,'Initech');\nINSERT INTO invoices VALUES (1,500),(1,300),(3,900);\nSELECT c.name,\n  COALESCE((SELECT SUM(i.total) FROM invoices i WHERE i.cust_id = c.id), 0) AS lifetime_val\nFROM customers c\nWHERE EXISTS (SELECT 1 FROM invoices i WHERE i.cust_id = c.id)\nORDER BY c.id;\nSQL");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Acme|800\nInitech|900");
    });
  });

  it("14. set operations: UNION, UNION ALL, INTERSECT, and EXCEPT", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 /tmp/set77.db << 'SQL'\nCREATE TABLE a(v INT);\nCREATE TABLE b(v INT);\nINSERT INTO a VALUES (1),(2),(3),(4);\nINSERT INTO b VALUES (3),(4),(5);\nSELECT 'INTERSECT', v FROM (SELECT v FROM a INTERSECT SELECT v FROM b)\nUNION ALL\nSELECT 'EXCEPT', v FROM (SELECT v FROM a EXCEPT SELECT v FROM b)\nORDER BY 1, 2;\nSQL");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "EXCEPT|1\nEXCEPT|2\nINTERSECT|3\nINTERSECT|4");
    });
  });

  it("15. string & hex functions: SUBSTR, INSTR, REPLACE, TRIM, UPPER, LOWER, LENGTH, HEX", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 /tmp/str77.db << 'SQL'\nSELECT\n  UPPER(TRIM('  poe-code  ')),\n  REPLACE('v1.2.0-beta', '-beta', '-stable'),\n  SUBSTR('abcdef', 2, 3),\n  INSTR('alpha:beta', ':'),\n  HEX('AB');\nSQL");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "POE-CODE|v1.2.0-stable|bcd|6|4142");
    });
  });

  it("16. COALESCE, NULLIF, IIF, and TYPEOF across mixed SQL value types", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 /tmp/null77.db << 'SQL'\nCREATE TABLE raw_vals(id INT, a TEXT, b TEXT, n INT);\nINSERT INTO raw_vals VALUES (1, '', 'fallback', 10), (2, 'primary', 'fallback', 0);\nSELECT id,\n  COALESCE(NULLIF(a, ''), b) AS resolved,\n  IIF(n > 0, 'POS', 'ZERO') AS sign_label,\n  TYPEOF(n)\nFROM raw_vals ORDER BY id;\nSQL");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1|fallback|POS|integer\n2|primary|ZERO|integer");
    });
  });

  it("17. GROUP_CONCAT with custom separator and HAVING clause on aggregate alias", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 /tmp/gc77.db << 'SQL'\nCREATE TABLE memberships(team TEXT, member TEXT);\nINSERT INTO memberships VALUES ('core','alice'),('core','bob'),('core','carol'),('ui','dave');\nSELECT team, COUNT(*) AS cnt, GROUP_CONCAT(member, '+') AS roster\nFROM (SELECT team, member FROM memberships ORDER BY team, member)\nGROUP BY team\nHAVING cnt >= 2;\nSQL");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "core|3|alice+bob+carol");
    });
  });

  it("18. multi-mode output formatting (.mode json, .mode markdown, .mode csv, .mode line)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 /tmp/mode77.db << 'SQL'\nCREATE TABLE m(k TEXT, v INT);\nINSERT INTO m VALUES ('cpu', 8), ('mem', 32);\n.mode list\nSELECT k, v FROM m ORDER BY k;\n.mode line\nSELECT k, v FROM m ORDER BY k;\nSQL");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "cpu|8\nmem|32\n    k = cpu\n    v = 8\n\n    k = mem\n    v = 32");
    });
  });

  it("19. CSV .import into table, SQL transformation, and .headers on + .mode csv export", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'CSV' > /tmp/raw77.csv\nsku,qty,unit_price\nS1,4,25\nS2,10,12\nS3,2,100\nCSV\nsqlite3 /tmp/imp77.db \".mode csv\" \".import /tmp/raw77.csv sales\" \".headers on\" \"SELECT sku, CAST(qty AS INT) * CAST(unit_price AS INT) AS line_total FROM sales ORDER BY line_total DESC;\" | tr -d '\\r'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "sku,line_total\nS3,200\nS2,120\nS1,100");
    });
  });

  it("20. recursive CTE Fibonacci sequence generator with modulo filtering", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 /tmp/fib77.db << 'SQL'\nWITH RECURSIVE fib(n, a, b) AS (\n  SELECT 1, 0, 1\n  UNION ALL\n  SELECT n + 1, b, a + b FROM fib WHERE n < 10\n)\nSELECT n, b AS val FROM fib WHERE b % 2 = 1;\nSQL");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1|1\n2|1\n4|3\n5|5\n7|13\n8|21\n10|55");
    });
  });

});
