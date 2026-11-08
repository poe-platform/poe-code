import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("sqlite3, bc, tar/zip archive compression, and crypto/binary pipeline matrix", () => {
  it("1. sqlite3 window functions: ROW_NUMBER, RANK, DENSE_RANK, LAG, LEAD, and running SUM OVER PARTITION BY", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        sqlite3 -csv -header /workspace/sales.db <<'SQL'
CREATE TABLE sales (dept TEXT, rep TEXT, amount INTEGER);
INSERT INTO sales VALUES
  ('eng', 'alice', 300),
  ('eng', 'bob', 300),
  ('eng', 'carol', 200),
  ('ops', 'dave', 400),
  ('ops', 'erin', 150);

SELECT
  dept,
  rep,
  amount,
  ROW_NUMBER() OVER (PARTITION BY dept ORDER BY amount DESC, rep ASC) AS rn,
  RANK() OVER (PARTITION BY dept ORDER BY amount DESC) AS rnk,
  DENSE_RANK() OVER (PARTITION BY dept ORDER BY amount DESC) AS drnk,
  LAG(amount, 1, -1) OVER (PARTITION BY dept ORDER BY amount DESC, rep ASC) AS prev_amt,
  SUM(amount) OVER (PARTITION BY dept ORDER BY amount DESC, rep ASC) AS running_sum
FROM sales
ORDER BY dept ASC, rn ASC;
SQL
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      const lines = r.stdout.trim().split("\n");
      assert.equal(lines[0], "dept,rep,amount,rn,rnk,drnk,prev_amt,running_sum");
      assert.equal(lines[1], "eng,alice,300,1,1,1,-1,300");
      assert.equal(lines[2], "eng,bob,300,2,1,1,300,600");
      assert.equal(lines[3], "eng,carol,200,3,3,2,300,800");
      assert.equal(lines[4], "ops,dave,400,1,1,1,-1,400");
      assert.equal(lines[5], "ops,erin,150,2,2,2,400,550");
    });
  });

  it("2. sqlite3 WITH RECURSIVE organizational hierarchy traversal and path aggregation", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        sqlite3 /workspace/org.db <<'SQL'
CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT, manager_id INTEGER);
INSERT INTO employees VALUES
  (1, 'ceo', NULL),
  (2, 'vp_eng', 1),
  (3, 'vp_sales', 1),
  (4, 'staff_eng', 2),
  (5, 'senior_eng', 4),
  (6, 'acct_exec', 3);

WITH RECURSIVE org_tree(id, name, depth, path) AS (
  SELECT id, name, 0, name FROM employees WHERE manager_id IS NULL
  UNION ALL
  SELECT e.id, e.name, t.depth + 1, t.path || '->' || e.name
  FROM employees e
  JOIN org_tree t ON e.manager_id = t.id
)
SELECT id, depth, path FROM org_tree ORDER BY path ASC;
SQL
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "1|0|ceo",
          "2|1|ceo->vp_eng",
          "4|2|ceo->vp_eng->staff_eng",
          "5|3|ceo->vp_eng->staff_eng->senior_eng",
          "3|1|ceo->vp_sales",
          "6|2|ceo->vp_sales->acct_exec",
        ].join("\n")
      );
    });
  });

  it("3. sqlite3 triggers, views, ON CONFLICT DO UPDATE upsert, and audit logging", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        sqlite3 /workspace/inventory.db <<'SQL'
CREATE TABLE stock (sku TEXT PRIMARY KEY, qty INTEGER NOT NULL);
CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, sku TEXT, new_qty INTEGER);

CREATE TRIGGER tr_stock_insert AFTER INSERT ON stock
BEGIN
  INSERT INTO audit_log (action, sku, new_qty) VALUES ('INSERT', NEW.sku, NEW.qty);
END;

CREATE TRIGGER tr_stock_update AFTER UPDATE ON stock
BEGIN
  INSERT INTO audit_log (action, sku, new_qty) VALUES ('UPDATE', NEW.sku, NEW.qty);
END;

INSERT INTO stock VALUES ('SKU-10', 5), ('SKU-20', 12);
INSERT INTO stock (sku, qty) VALUES ('SKU-10', 8)
  ON CONFLICT(sku) DO UPDATE SET qty = stock.qty + excluded.qty;
UPDATE stock SET qty = qty + 3 WHERE sku = 'SKU-20';

CREATE VIEW v_stock_summary AS
  SELECT s.sku, s.qty, COUNT(a.id) AS events
  FROM stock s
  JOIN audit_log a ON a.sku = s.sku
  GROUP BY s.sku
  ORDER BY s.sku;

SELECT * FROM v_stock_summary;
SELECT action, sku, new_qty FROM audit_log ORDER BY id;
SQL
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "SKU-10|13|2",
          "SKU-20|15|2",
          "INSERT|SKU-10|5",
          "INSERT|SKU-20|12",
          "UPDATE|SKU-10|13",
          "UPDATE|SKU-20|15",
        ].join("\n")
      );
    });
  });

  it("4. sqlite3 dot-commands: .mode csv/json/markdown/line/insert/tabs and .import CSV round-trip", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/users.csv",
        "id,username,score\n10,ada,98\n20,grace,99\n30,linus,95\n"
      );
      const r = await h.exec(`
        sqlite3 /workspace/import.db <<'SQL'
.mode csv
.import /workspace/users.csv users
.mode json
SELECT id, username, CAST(score AS INTEGER) AS score FROM users ORDER BY CAST(id AS INTEGER);
.mode markdown
SELECT id, username, score FROM users WHERE username = 'grace';
.mode insert exported_users
SELECT id, username FROM users WHERE username = 'ada';
SQL
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.match(r.stdout, /\{"id":"10","username":"ada","score":98\}/);
      assert.match(r.stdout, /\| 20 \| grace\s+\| 99\s+\|/);
      assert.match(r.stdout, /INSERT INTO (?:"?exported_users"?) VALUES\('10','ada'\);/);
    });
  });

  it("5. sqlite3 binary persistence across separate CLI invocations and compound UNION/INTERSECT/EXCEPT", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        sqlite3 /workspace/persist.db "CREATE TABLE a (v TEXT); CREATE TABLE b (v TEXT);"
        sqlite3 /workspace/persist.db "INSERT INTO a VALUES ('x'), ('y'), ('z'); INSERT INTO b VALUES ('y'), ('z'), ('w');"
        echo "=== INTERSECT ==="
        sqlite3 /workspace/persist.db "SELECT v FROM a INTERSECT SELECT v FROM b ORDER BY v;"
        echo "=== EXCEPT ==="
        sqlite3 /workspace/persist.db "SELECT v FROM a EXCEPT SELECT v FROM b ORDER BY v;"
        echo "=== UNION ==="
        sqlite3 /workspace/persist.db "SELECT v FROM a UNION SELECT v FROM b ORDER BY v;"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "=== INTERSECT ===",
          "y",
          "z",
          "=== EXCEPT ===",
          "x",
          "=== UNION ===",
          "w",
          "x",
          "y",
          "z",
        ].join("\n")
      );
    });
  });

  it("6. bc arbitrary-precision decimal arithmetic at scale=30 with pow, sqrt, division, and modulo", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        bc <<'BC'
scale = 30
a = 2 ^ 100
a
b = sqrt(2)
b
c = 355 / 113
c
scale = 0
(2 ^ 100) % 97
BC
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      const lines = r.stdout.trim().split("\n");
      assert.equal(lines[0], "1267650600228229401496703205376");
      assert.match(lines[1]!, /^1\.414213562373095048801688724209/);
      assert.match(lines[2]!, /^3\.141592920353982300884955752212/);
      assert.equal(lines[3], "16");
    });
  });

  it("7. bc user-defined recursive and iterative functions with auto locals, loops, and control flow", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        bc <<'BC'
define fact(n) {
  if (n <= 1) return 1
  return n * fact(n - 1)
}

define gcd(a, b) {
  auto r
  while (b != 0) {
    r = a % b
    a = b
    b = r
  }
  return a
}

define collatz_steps(n) {
  auto steps
  steps = 0
  for (; n > 1; steps++) {
    if (n % 2 == 0) {
      n = n / 2
    } else {
      n = 3 * n + 1
    }
  }
  return steps
}

fact(12)
gcd(1071, 462)
collatz_steps(27)
BC
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout.trim(), ["479001600", "21", "111"].join("\n"));
    });
  });

  it("8. bc base conversions with ibase and obase across binary, octal, decimal, and hexadecimal", async () => {
    await withE2EHarness(async (h) => {
      // Note: In bc, set obase before ibase or express obase in the current ibase!
      const r = await h.exec(`
        bc <<'BC'
obase = 2
255
obase = 16
48879
ibase = 16
obase = A
DEAD + BEEF
BC
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout.trim(), ["11111111", "BEEF", "105884"].join("\n"));
    });
  });

  it("9. bc -l math library: pi via 4*a(1), trig identity s(x)^2 + c(x)^2, and l(e(x))", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        bc -l <<'BC'
pi = 4 * a(1)
pi
x = 0.7
id = s(x) * s(x) + c(x) * c(x)
id
le = l(e(2.5))
le
BC
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      const lines = r.stdout.trim().split("\n");
      assert.match(lines[0]!, /^3\.14159265358979/);
      assert.match(lines[1]!, /^1\.00000000000000|\.99999999999999/);
      assert.match(lines[2]!, /^2\.50000000000000|2\.49999999999999/);
    });
  });

  it("10. bc 1D array indexing, sieve of Eratosthenes prime summation, and length()/scale() builtins", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        bc <<'BC'
for (i = 2; i <= 50; i++) composite[i] = 0
for (i = 2; i * i <= 50; i++) {
  if (composite[i] == 0) {
    for (j = i * i; j <= 50; j += i) {
      composite[j] = 1
    }
  }
}
sum = 0
count = 0
for (i = 2; i <= 50; i++) {
  if (composite[i] == 0) {
    sum += i
    count += 1
  }
}
count
sum
length(12345.678)
scale(12345.678)
BC
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout.trim(), ["15", "328", "8", "3"].join("\n"));
    });
  });

  it("11. tar create, list, and extract with gzip (-z), bzip2 (-j), and xz (-J) compression", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        mkdir -p /workspace/src/sub
        printf 'alpha-content\n' > /workspace/src/a.txt
        printf 'beta-content\n' > /workspace/src/sub/b.txt

        tar -czf /workspace/archive.tar.gz -C /workspace/src .
        tar -cjf /workspace/archive.tar.bz2 -C /workspace/src .
        tar -cJf /workspace/archive.tar.xz -C /workspace/src .

        mkdir -p /workspace/out_gz /workspace/out_bz2 /workspace/out_xz
        tar -xzf /workspace/archive.tar.gz -C /workspace/out_gz
        tar -xjf /workspace/archive.tar.bz2 -C /workspace/out_bz2
        tar -xJf /workspace/archive.tar.xz -C /workspace/out_xz

        diff -r /workspace/src /workspace/out_gz
        diff -r /workspace/src /workspace/out_bz2
        diff -r /workspace/src /workspace/out_xz
        cat /workspace/out_gz/a.txt /workspace/out_bz2/sub/b.txt /workspace/out_xz/a.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        ["alpha-content", "beta-content", "alpha-content"].join("\n")
      );
    });
  });

  it("12. tar streaming pipeline over stdout/stdin with --strip-components and zstd compression", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        mkdir -p /workspace/pkg/v1/lib
        printf 'export const v = 1;\n' > /workspace/pkg/v1/lib/index.js
        printf '{"name":"pkg"}\n' > /workspace/pkg/v1/package.json

        mkdir -p /workspace/target
        tar -cf - -C /workspace pkg/v1 | zstd -c | zstd -d -c | tar -xf - -C /workspace/target --strip-components=2
        cat /workspace/target/package.json /workspace/target/lib/index.js
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        ['{"name":"pkg"}', "export const v = 1;"].join("\n")
      );
    });
  });

  it("13. zip and unzip recursive archive creation, listing, stdout extraction (-p), and directory extraction (-d)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        mkdir -p /workspace/bundle/assets
        printf 'hello zip world\n' > /workspace/bundle/readme.txt
        printf '01020304\n' > /workspace/bundle/assets/data.txt

        cd /workspace
        zip -q -r /workspace/bundle.zip bundle
        unzip -p /workspace/bundle.zip bundle/readme.txt
        mkdir -p /workspace/unpacked
        unzip -q /workspace/bundle.zip -d /workspace/unpacked
        cat /workspace/unpacked/bundle/assets/data.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout.trim(), ["hello zip world", "01020304"].join("\n"));
    });
  });

  it("14. sha256sum, sha512sum, and md5sum manifest generation and verification (-c)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        cd /workspace
        printf 'payload-one\n' > one.txt
        printf 'payload-two\n' > two.txt

        sha256sum one.txt two.txt > sums.sha256
        sha512sum one.txt two.txt > sums.sha512
        md5sum one.txt two.txt > sums.md5

        sha256sum -c sums.sha256
        sha512sum -c sums.sha512
        md5sum -c sums.md5
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "one.txt: OK",
          "two.txt: OK",
          "one.txt: OK",
          "two.txt: OK",
          "one.txt: OK",
          "two.txt: OK",
        ].join("\n")
      );
    });
  });

  it("15. sha256sum -c detects tampered file and exits non-zero", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        cd /workspace
        printf 'authentic\n' > artifact.bin
        sha256sum artifact.bin > artifact.sha256
        printf 'corrupted\n' > artifact.bin
        if sha256sum -c artifact.sha256 >/workspace/check.out 2>/workspace/check.err; then
          echo "unexpected-pass"
        else
          echo "tamper-detected"
        fi
        cat /workspace/check.out
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.match(r.stdout, /tamper-detected/);
      assert.match(r.stdout, /artifact\.bin: FAILED/);
    });
  });

  it("16. xxd hex dump, plain hex (-p), reverse binary patching (-r), and C include array (-i)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf 'SafeBash' > /workspace/bin.dat
        xxd -p /workspace/bin.dat
        xxd -p /workspace/bin.dat | sed 's/42617368/52757374/' | xxd -r -p
        echo ""
        cd /workspace
        xxd -i bin.dat
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      const lines = r.stdout.trim().split("\n");
      assert.equal(lines[0], "5361666542617368");
      assert.equal(lines[1], "SafeRust");
      assert.match(r.stdout, /unsigned char bin_dat\[\] = \{/);
      assert.match(r.stdout, /unsigned int bin_dat_len = 8;/);
    });
  });

  it("17. od and hexdump formatting binary headers and little-endian integers", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf '\\x01\\x02\\x03\\x04ABCD' > /workspace/header.bin
        od -An -tx1 /workspace/header.bin | tr -s ' '
        hexdump -C /workspace/header.bin | head -n 1
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.match(r.stdout, /01 02 03 04 41 42 43 44/);
      assert.match(r.stdout, /00000000\s+01 02 03 04 41 42 43 44\s+\|\.\.\.\.ABCD\|/);
    });
  });

  it("18. dd byte slicing with bs, skip, count, and conv=ucase,swab", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf '0123456789abcdef' > /workspace/raw.txt
        dd if=/workspace/raw.txt of=/workspace/slice.txt bs=4 skip=1 count=2 status=none
        cat /workspace/slice.txt
        echo ""
        printf 'abcd' | dd conv=ucase,swab status=none
        echo ""
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout.trim(), ["456789ab", "BADC"].join("\n"));
    });
  });

  it("19. base64 and base32 multi-stage encoding/decoding pipeline with binary gzip payload", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf 'zero-dep rust migration verification payload 2026\n' \
          | gzip -c \
          | base64 -w 0 \
          | base32 -w 0 \
          | base32 -d \
          | base64 -d \
          | gunzip -c
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "zero-dep rust migration verification payload 2026\n");
    });
  });

  it("20. end-to-end pipeline: bc generates dataset -> sqlite3 aggregates -> tar.gz archives with sha256 manifest", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        mkdir -p /workspace/report
        {
          echo "n,square,cube"
          bc <<'BC'
for (i = 1; i <= 10; i++) {
  print i, ",", i*i, ",", i*i*i, "\n"
}
BC
        } > /workspace/report/powers.csv

        sqlite3 -csv -header /workspace/report/metrics.db <<'SQL' > /workspace/report/summary.csv
.mode csv
.import /workspace/report/powers.csv powers
SELECT
  COUNT(*) AS rows,
  SUM(CAST(square AS INTEGER)) AS sum_sq,
  SUM(CAST(cube AS INTEGER)) AS sum_cb
FROM powers;
SQL

        cd /workspace/report
        sha256sum powers.csv summary.csv > MANIFEST.sha256
        tar -czf /workspace/report.tar.gz powers.csv summary.csv MANIFEST.sha256

        mkdir -p /workspace/verify
        tar -xzf /workspace/report.tar.gz -C /workspace/verify
        cd /workspace/verify
        sha256sum -c MANIFEST.sha256
        cat summary.csv
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.replace(/\r\n/g, "\n").trim(),
        [
          "powers.csv: OK",
          "summary.csv: OK",
          "rows,sum_sq,sum_cb",
          "10,385,3025",
        ].join("\n")
      );
    });
  });
});
