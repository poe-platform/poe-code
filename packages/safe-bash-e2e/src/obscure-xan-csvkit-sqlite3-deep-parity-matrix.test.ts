import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure xan, csvkit, and sqlite3 deep parity matrix", () => {
  it("01: xan count -H / --human-readable thousand separators, k/M scaling, and -p / --parallel suppression", async () => {
    const rows1250 = ["id,val", ...Array.from({ length: 1250 }, (_, i) => `${i + 1},x`)].join("\n") + "\n";
    const rows12500 = ["id,val", ...Array.from({ length: 12500 }, (_, i) => `${i + 1},y`)].join("\n") + "\n";
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/small.csv": rows1250,
        "/workspace/large.csv": rows12500,
      },
    });
    try {
      const res = await h.exec(`
        xan count -H /workspace/small.csv
        xan count --human-readable /workspace/large.csv
        xan count -H -p /workspace/large.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "1,250\n12,500 (12.5k)\n12500\n");
    } finally {
      await h.dispose();
    }
  });

  it("02: xan slice --skip, unsorted/duplicate -I / --indices, -B / --end-byte --raw, and -n / --no-headers", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/items.csv": "id,code\n10,a\n20,b\n30,c\n40,d\n50,e\n",
      },
    });
    try {
      const res = await h.exec(`
        echo "=== SKIP ==="
        xan slice --skip 2 -l 2 /workspace/items.csv
        echo "=== INDICES ==="
        xan slice -I '3,1,3,0' /workspace/items.csv
        echo "=== RAW ==="
        xan slice -n -B 8 --end-byte 18 --raw /workspace/items.csv
        echo "=== NO HEADERS ==="
        xan slice -n -s 1 -l 2 /workspace/items.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "=== SKIP ===",
          "id,code",
          "30,c",
          "40,d",
          "=== INDICES ===",
          "id,code",
          "10,a",
          "20,b",
          "40,d",
          "=== RAW ===",
          "10,a",
          "20,b",
          "=== NO HEADERS ===",
          "10,a",
          "20,b",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("03: xan head and xan tail with --limit, -n / --no-headers, .tsv/.psv delimiter inference, and -o / --output", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/metrics.tsv": "host\tcpu\nn1\t15\nn2\t40\nn3\t85\nn4\t92\n",
        "/workspace/events.psv": "id|kind\n1|login\n2|query\n3|export\n4|logout\n",
      },
    });
    try {
      const res = await h.exec(`
        echo "=== HEAD NO HEADERS ==="
        xan head -l 2 -n /workspace/metrics.tsv
        echo "=== TAIL LIMIT ==="
        xan tail --limit 2 /workspace/events.psv
        xan head --limit 2 -o /workspace/top.tsv /workspace/events.psv
        echo "=== OUT TSV ==="
        cat /workspace/top.tsv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "=== HEAD NO HEADERS ===",
          "host,cpu",
          "n1,15",
          "=== TAIL LIMIT ===",
          "id,kind",
          "3,export",
          "4,logout",
          "=== OUT TSV ===",
          "id\tkind",
          "1\tlogin",
          "2\tquery",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("04: xan select -e and xan map with modulo %, unary -, nested upper(trim()), and len() in arithmetic", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/orders.csv": "sku,qty,price,discount\n  ab-10 ,7,12,3\n cd-200 ,10,5,2\n",
      },
    });
    try {
      const res = await h.exec(`
        echo "=== SELECT EVAL ==="
        xan select -e 'upper(trim(sku)) as clean_sku, (qty % 4) * 10 as rem_score, -discount + (len(trim(sku)) * 2) as adj' /workspace/orders.csv
        echo "=== MAP ==="
        xan map 'price * qty - discount as net, len(trim(sku)) % 3 as bucket' /workspace/orders.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "=== SELECT EVAL ===",
          "clean_sku,rem_score,adj",
          "AB-10,30,7",
          "CD-200,20,10",
          "=== MAP ===",
          "sku,qty,price,discount,net,bucket",
          "  ab-10 ,7,12,3,81,2",
          " cd-200 ,10,5,2,48,0",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("05: xan to json/jsonl with --nulls, --omit, -n / --no-headers, and column-wide numeric inference", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/records.csv": "id,code,note\n007,100,ok\n042,A200,\n",
      },
    });
    try {
      const res = await h.exec(`
        echo "=== DEFAULT JSON ==="
        xan to json /workspace/records.csv
        echo "=== NULLS JSONL ==="
        xan to jsonl --nulls /workspace/records.csv
        echo "=== OMIT JSONL ==="
        xan to jsonl --omit /workspace/records.csv
        echo "=== NO HEADERS JSONL ==="
        xan to jsonl -n /workspace/records.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "=== DEFAULT JSON ===",
          '[{"id":7,"code":"100","note":"ok"},{"id":42,"code":"A200","note":""}]',
          "=== NULLS JSONL ===",
          '{"id":7,"code":"100","note":"ok"}',
          '{"id":42,"code":"A200","note":null}',
          "=== OMIT JSONL ===",
          '{"id":7,"code":"100","note":"ok"}',
          '{"id":42,"code":"A200"}',
          "=== NO HEADERS JSONL ===",
          '{"0":"id","1":"code","2":"note"}',
          '{"0":"007","1":"100","2":"ok"}',
          '{"0":"042","1":"A200","2":""}',
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("06: xan join --cross with two file operands and --nulls matching empty join keys", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/tiers.csv": "tier\ncore\nedge\n",
        "/workspace/envs.csv": "env\ndev\nprod\n",
        "/workspace/emps.csv": "emp,dept_id\nada,10\ngrace,\nlinus,20\n",
        "/workspace/depts.csv": "dept_id,dept_name\n10,infra\n,unassigned\n",
      },
    });
    try {
      const res = await h.exec(`
        echo "=== CROSS ==="
        xan join --cross /workspace/tiers.csv /workspace/envs.csv
        echo "=== JOIN WITHOUT NULLS ==="
        xan join dept_id /workspace/emps.csv /workspace/depts.csv
        echo "=== JOIN WITH NULLS ==="
        xan join --nulls dept_id /workspace/emps.csv /workspace/depts.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "=== CROSS ===",
          "tier,env",
          "core,dev",
          "core,prod",
          "edge,dev",
          "edge,prod",
          "=== JOIN WITHOUT NULLS ===",
          "emp,dept_id,dept_name",
          "ada,10,infra",
          "=== JOIN WITH NULLS ===",
          "emp,dept_id,dept_name",
          "ada,10,infra",
          "grace,,unassigned",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("07: xan search --every-column with -i / --ignore-case, -e / --exact, -v / --invert-match, and -n / --no-headers", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/tags.csv": "id,primary_tag,backup_tag\n1,prod-us,PROD-eu\n2,prod-us,staging-eu\n3,dev-us,dev-eu\n4,prod,PROD\n",
      },
    });
    try {
      const res = await h.exec(`
        echo "=== EVERY SUBSTRING IGNORE CASE ==="
        xan search --every-column -s 'primary_tag,backup_tag' -i 'prod' /workspace/tags.csv
        echo "=== EVERY EXACT IGNORE CASE ==="
        xan search --every-column -s 'primary_tag,backup_tag' -e -i 'prod' /workspace/tags.csv
        echo "=== EVERY INVERT ==="
        xan search --every-column -s 'primary_tag,backup_tag' -i -v 'prod' /workspace/tags.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "=== EVERY SUBSTRING IGNORE CASE ===",
          "id,primary_tag,backup_tag",
          "1,prod-us,PROD-eu",
          "4,prod,PROD",
          "=== EVERY EXACT IGNORE CASE ===",
          "id,primary_tag,backup_tag",
          "4,prod,PROD",
          "=== EVERY INVERT ===",
          "id,primary_tag,backup_tag",
          "2,prod-us,staging-eu",
          "3,dev-us,dev-eu",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("08: xan stats --nulls and xan rename with quoted comma headers and -n / --no-headers", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/scores.csv": "name,score\nada,10\ngrace,\nlinus,20\n",
      },
    });
    try {
      const res = await h.exec(`
        echo "=== STATS DEFAULT ==="
        xan stats -s score /workspace/scores.csv | xan select 'field,count,count_empty,sum,mean,variance'
        echo "=== STATS NULLS ==="
        xan stats --nulls -s score /workspace/scores.csv | xan select 'field,count,count_empty,sum,mean,variance'
        echo "=== RENAME QUOTED ==="
        xan rename '"user, full",points' /workspace/scores.csv
        echo "=== RENAME NO HEADERS ==="
        printf "a,10\\nb,20\\n" | xan rename -n -s 1 'metric'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "=== STATS DEFAULT ===",
          "field,count,count_empty,sum,mean,variance",
          "score,2,1,30,15,25",
          "=== STATS NULLS ===",
          "field,count,count_empty,sum,mean,variance",
          "score,2,1,30,10,66.66666666666667",
          "=== RENAME QUOTED ===",
          '"user, full",points',
          "ada,10",
          "grace,",
          "linus,20",
          "=== RENAME NO HEADERS ===",
          "0,metric",
          "a,10",
          "b,20",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("09: csvcut and csvgrep colon-range selectors (1:3, :2, 3:) and -C / --not-columns open-ended range", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/grid.csv": "c1,c2,c3,c4\na1,b1,c1,d1\na2,err,c2,d2\n",
      },
    });
    try {
      const res = await h.exec(`
        echo "=== CUT 1:3 ==="
        csvcut -c '1:3' /workspace/grid.csv
        echo "=== CUT :2 ==="
        csvcut -c ':2' /workspace/grid.csv
        echo "=== CUT 3: ==="
        csvcut -c '3:' /workspace/grid.csv
        echo "=== NOT-COLS 2:3 ==="
        csvcut -C '2:3' /workspace/grid.csv
        echo "=== NOT-COLS OPEN 2: ==="
        csvcut -C '2:' /workspace/grid.csv
        echo "=== CSVGREP 1:2 ==="
        csvgrep -c '1:2' -a -m 'err' /workspace/grid.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "=== CUT 1:3 ===",
          "c1,c2,c3",
          "a1,b1,c1",
          "a2,err,c2",
          "=== CUT :2 ===",
          "c1,c2",
          "a1,b1",
          "a2,err",
          "=== CUT 3: ===",
          "c3,c4",
          "c1,d1",
          "c2,d2",
          "=== NOT-COLS 2:3 ===",
          "c1,c4",
          "a1,d1",
          "a2,d2",
          "=== NOT-COLS OPEN 2: ===",
          "c1,c4",
          "a1,d1",
          "a2,d2",
          "=== CSVGREP 1:2 ===",
          "c1,c2,c3,c4",
          "a2,err,c2,d2",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("10: csvsort and csvstat with colon-range selectors (2:3, 1:2), -I / --no-inference, and -i / --ignore-case", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/roster.csv": "id,team,role,score\n1,beta,dev,20\n2,Alpha,ops,100\n3,alpha,dev,5\n",
      },
    });
    try {
      const res = await h.exec(`
        echo "=== CSVSORT 2:3 ==="
        csvsort -c '2:3' -i /workspace/roster.csv
        echo "=== CSVSTAT 1:2 ==="
        csvstat -c '1,4' --sum /workspace/roster.csv
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "=== CSVSORT 2:3 ===",
          "id,team,role,score",
          "3,alpha,dev,5",
          "2,Alpha,ops,100",
          "1,beta,dev,20",
          "=== CSVSTAT 1:2 ===",
          "  1. id: 6",
          "  4. score: 125",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("11: sqlite3 output modes: .mode box / -box and .mode table / -table with centered headers", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(`
        sqlite3 /workspace/modes.db <<'SQL'
CREATE TABLE nodes (id INT, region TEXT, ms INT);
INSERT INTO nodes VALUES (1, 'us-east', 12), (20, 'eu', 145);
.mode box
SELECT id, region, ms FROM nodes ORDER BY id;
.mode table
SELECT id, region, ms FROM nodes ORDER BY id;
SQL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "┌────┬─────────┬─────┐",
          "│ id │ region  │ ms  │",
          "├────┼─────────┼─────┤",
          "│ 1  │ us-east │ 12  │",
          "│ 20 │ eu      │ 145 │",
          "└────┴─────────┴─────┘",
          "+----+---------+-----+",
          "| id | region  | ms  |",
          "+----+---------+-----+",
          "| 1  | us-east | 12  |",
          "| 20 | eu      | 145 |",
          "+----+---------+-----+",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("12: sqlite3 .mode column with .width, .mode html with entity escaping, and .mode ascii", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(`
        sqlite3 /workspace/fmt.db <<'SQL'
CREATE TABLE alerts (svc TEXT, msg TEXT);
INSERT INTO alerts VALUES ('auth', 'a < b & "ok"'), ('db', 'timeout > 5s');
.headers on
.mode column
.width 6 14
SELECT svc, msg FROM alerts ORDER BY svc;
.mode html
SELECT svc, msg FROM alerts ORDER BY svc;
SQL
        sqlite3 -ascii /workspace/fmt.db "SELECT svc, msg FROM alerts ORDER BY svc;" | od -An -tx1 | tr -s ' \n' ' '
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trimEnd(),
        [
          "svc     msg           ",
          "------  --------------",
          'auth    a < b & "ok"  ',
          "db      timeout > 5s  ",
          "<TR><TH>svc</TH>",
          "<TH>msg</TH>",
          "</TR>",
          "<TR><TD>auth</TD>",
          "<TD>a &lt; b &amp; &quot;ok&quot;</TD>",
          "</TR>",
          "<TR><TD>db</TD>",
          "<TD>timeout &gt; 5s</TD>",
          "</TR>",
          " 61 75 74 68 1f 61 20 3c 20 62 20 26 20 22 6f 6b 22 1e 64 62 1f 74 69 6d 65 6f 75 74 20 3e 20 35 73 1e",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("13: sqlite3 dot-commands: .print, .show, .databases, and .tables <pattern> with views", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(`
        sqlite3 :memory: <<'SQL'
CREATE TABLE audit_events (id INT);
CREATE TABLE billing_items (id INT);
CREATE VIEW audit_summary AS SELECT id FROM audit_events;
.print === PRINT BANNER ===
.tables audit_%
.databases
.nullvalue N/A
.headers on
.show
SQL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "=== PRINT BANNER ===",
          "audit_events   audit_summary",
          'main: "" r/w',
          "        echo: off",
          "     headers: on",
          "        mode: list",
          '   nullvalue: "N/A"',
          "      output: stdout",
          'colseparator: "|"',
          'rowseparator: "\\n"',
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("14: sqlite3 string functions: CONCAT, CONCAT_WS, FORMAT, LPAD, RPAD, REPEAT, and REVERSE", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(`
        sqlite3 :memory: <<'SQL'
CREATE TABLE items (id INT, region TEXT, env TEXT, tag TEXT);
INSERT INTO items VALUES (7, 'us', NULL, 'api'), (42, 'eu', 'prod', 'db');
SELECT
  CONCAT('v', id, '-', env, '!') AS c1,
  CONCAT_WS(':', region, env, tag) AS c2,
  FORMAT('%04d/%s', id, tag) AS c3,
  LPAD(CAST(id AS TEXT), 4, '0') AS c4,
  RPAD(tag, 5, '.') AS c5,
  REPEAT(region, 2) AS c6,
  REVERSE(tag) AS c7
FROM items
ORDER BY id;
SQL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "v7-!|us:api|0007/api|0007|api..|usus|ipa",
          "v42-prod!|eu:prod:db|0042/db|0042|db...|eueu|bd",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("15: sqlite3 character & binary functions: CHAR, UNICODE, HEX, UNHEX, OCTET_LENGTH, and negative SUBSTR", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(`
        sqlite3 :memory: <<'SQL'
CREATE TABLE tokens (word TEXT, rel TEXT);
INSERT INTO tokens VALUES ('café', 'release-2026-q4');
SELECT
  CHAR(80, 111, 101) AS ch,
  UNICODE('Z') AS uni,
  HEX('Poe') AS hx,
  CAST(UNHEX('506F65') AS TEXT) AS unhx,
  LENGTH(word) AS char_len,
  OCTET_LENGTH(word) AS byte_len,
  SUBSTR(rel, -2) AS tail2,
  SUBSTR(rel, -7, 4) AS year_part
FROM tokens;
SQL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "Poe|90|506F65|Poe|4|5|q4|2026\n");
    } finally {
      await h.dispose();
    }
  });

  it("16: sqlite3 math functions: SIGN, CEIL, CEILING, FLOOR, TRUNC, MOD, POW, POWER, and SQRT", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(`
        sqlite3 :memory: <<'SQL'
CREATE TABLE nums (v REAL, n INT);
INSERT INTO nums VALUES (-3.7, 17), (2.3, 9);
SELECT
  SIGN(v),
  CEIL(v),
  CEILING(v),
  FLOOR(v),
  TRUNC(v),
  MOD(n, 5),
  CAST(POW(2, 10) AS INT),
  CAST(POWER(3, 4) AS INT),
  CAST(SQRT(144) AS INT)
FROM nums
ORDER BY n;
SQL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "1|3|3|2|2|4|1024|81|12",
          "-1|-3|-3|-4|-3|2|1024|81|12",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("17: sqlite3 JSON functions: JSON_ARRAY, JSON_QUOTE, and multi-path JSON_EXTRACT", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(`
        sqlite3 :memory: <<'SQL'
CREATE TABLE events (id INT, svc TEXT, payload TEXT);
INSERT INTO events VALUES
  (1, 'auth', '{"meta":{"tier":1,"region":"us"},"tags":["sec","core"]}'),
  (2, 'edge', '{"meta":{"tier":2,"region":"eu"},"tags":["cdn"]}');
SELECT
  JSON_ARRAY(id, svc, JSON('{"ok":true}')) AS arr,
  JSON_QUOTE(svc) AS q,
  JSON_EXTRACT(payload, '$.meta.region', '$.meta.tier', '$.tags[0]', '$.missing') AS multi
FROM events
ORDER BY id;
SQL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          '[1,"auth",{"ok":true}]|"auth"|["us",1,"sec",null]',
          '[2,"edge",{"ok":true}]|"edge"|["eu",2,"cdn",null]',
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("18: sqlite3 aggregate GROUP BY / HAVING queries formatted in .mode box, .mode table, .mode markdown, .mode line, and .mode quote", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(`
        sqlite3 :memory: <<'SQL'
CREATE TABLE sales (dept TEXT, amount INT);
INSERT INTO sales VALUES ('eng', 120), ('eng', 80), ('ops', 50), ('sec', 300);
.mode box
SELECT dept, SUM(amount) AS total FROM sales GROUP BY dept HAVING SUM(amount) >= 100 ORDER BY dept;
.mode markdown
SELECT dept, SUM(amount) AS total FROM sales GROUP BY dept HAVING SUM(amount) >= 100 ORDER BY dept;
.mode line
SELECT dept, SUM(amount) AS total FROM sales GROUP BY dept HAVING SUM(amount) >= 100 ORDER BY dept;
.mode quote
SELECT dept, SUM(amount) AS total FROM sales GROUP BY dept HAVING SUM(amount) >= 100 ORDER BY dept;
SQL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "┌──────┬───────┐",
          "│ dept │ total │",
          "├──────┼───────┤",
          "│ eng  │ 200   │",
          "│ sec  │ 300   │",
          "└──────┴───────┘",
          "| dept | total |",
          "|------|-------|",
          "| eng  | 200   |",
          "| sec  | 300   |",
          " dept = eng",
          "total = 200",
          "",
          " dept = sec",
          "total = 300",
          "'dept','total'",
          "'eng',200",
          "'sec',300",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("19: cross-tool pipeline: in2csv NDJSON -> csvcut colon range -> xan map modulo/len -> xan to json --omit -> sqlite3 JSON_EXTRACT", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/raw.ndjson": [
          '{"id":10,"svc":"auth","cost":45,"owner":"sec","note":"urgent"}',
          '{"id":20,"svc":"payments","cost":120,"owner":"fin","note":""}',
          '{"id":30,"svc":"cache","cost":15,"owner":"infra","note":"ok"}',
        ].join("\n") + "\n",
      },
    });
    try {
      const res = await h.exec(`
        in2csv -f ndjson /workspace/raw.ndjson \\
          | csvcut -c '1:3,5' \\
          | xan map 'cost % 50 as rem, len(svc) as svc_len' \\
          | xan to jsonl --omit > /workspace/enriched.jsonl
        cat /workspace/enriched.jsonl
        sqlite3 :memory: <<'SQL'
CREATE TABLE docs (line TEXT);
.import /workspace/enriched.jsonl docs
SELECT
  CONCAT_WS(':', JSON_EXTRACT(line, '$.svc'), JSON_EXTRACT(line, '$.rem'), COALESCE(JSON_EXTRACT(line, '$.note'), 'NONE'))
FROM docs
ORDER BY CAST(JSON_EXTRACT(line, '$.id') AS INT);
SQL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          '{"id":10,"svc":"auth","cost":45,"note":"urgent","rem":45,"svc_len":4}',
          '{"id":20,"svc":"payments","cost":120,"rem":20,"svc_len":8}',
          '{"id":30,"svc":"cache","cost":15,"note":"ok","rem":15,"svc_len":5}',
          "auth:45:urgent",
          "payments:20:NONE",
          "cache:15:ok",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("20: end-to-end 10-stage FinOps reconciliation pipeline across xan, csvkit, and sqlite3", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/usage.csv": [
          "acct_id,primary_env,backup_env,units,rate",
          "A1,prod-us,PROD-eu,12,5",
          "A2,prod-us,dev-eu,8,10",
          "A3,,prod-ap,6,15",
          "A4,prod-ap,PROD-us,20,4",
        ].join("\n") + "\n",
        "/workspace/owners.csv": [
          "acct_id,team",
          "A1,core",
          ",unassigned",
          "A4,platform",
        ].join("\n") + "\n",
      },
    });
    try {
      const res = await h.exec(`
        xan join --nulls acct_id /workspace/usage.csv /workspace/owners.csv \\
          | xan map 'units * rate as spend' > /workspace/joined.csv
        echo "COUNT=$(xan count -H /workspace/joined.csv)"
        xan search --every-column -s 'primary_env,backup_env' -i 'prod' /workspace/joined.csv \\
          | csvcut -c '1,4:7' > /workspace/prod_only.csv
        sqlite3 /workspace/finops.db <<'SQL'
.mode csv
.import /workspace/prod_only.csv prod_spend
.mode box
SELECT
  acct_id,
  UPPER(team) AS team,
  LPAD(spend, 4, '0') AS padded_spend,
  MOD(CAST(spend AS INT), 50) AS rem50
FROM prod_spend
ORDER BY CAST(spend AS INT) DESC;
SQL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "COUNT=2",
          "┌─────────┬──────────┬──────────────┬───────┐",
          "│ acct_id │ team     │ padded_spend │ rem50 │",
          "├─────────┼──────────┼──────────────┼───────┤",
          "│ A4      │ PLATFORM │ 0080         │ 30    │",
          "│ A1      │ CORE     │ 0060         │ 10    │",
          "└─────────┴──────────┴──────────────┴───────┘",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });
});
