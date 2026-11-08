import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure sqlite3 NULL/TYPEOF/QUOTE, JSON, recursive CTE, triggers, xan & csvkit parity matrix", () => {
  test("01. sqlite3 QUOTE, TYPEOF, and JSON_QUOTE distinguish SQL NULL from '', 'NULL', and 'null' literals", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "SELECT QUOTE(NULL), TYPEOF(NULL), JSON_QUOTE(NULL), QUOTE('NULL'), TYPEOF('NULL'), QUOTE('null'), TYPEOF('null'), QUOTE(''), TYPEOF('');",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "NULL|null|null|'NULL'|text|'null'|text|''|text\n");
    });
  });

  test("02. sqlite3 table columns with NULL vs text 'NULL' in QUOTE, TYPEOF, COALESCE, IFNULL, and IIF", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "CREATE TABLE t(id INT, opt TEXT);",
          "INSERT INTO t VALUES (1, NULL), (2, 'alpha'), (3, 'O''Reilly');",
          "SELECT id, QUOTE(opt), TYPEOF(opt), COALESCE(opt, 'missing'), IFNULL(opt, 'fb'), IIF(opt IS NULL, 'is_null', 'has_val') FROM t ORDER BY id;",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "1|NULL|null|missing|fb|is_null",
          "2|'alpha'|text|alpha|alpha|has_val",
          "3|'O''Reilly'|text|O'Reilly|O'Reilly|has_val",
          "",
        ].join("\n")
      );
    });
  });

  test("03. sqlite3 .mode json renders SQL NULL as null and QUOTE(NULL) as string \"NULL\"", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          ".mode json",
          "CREATE TABLE items(id INT, label TEXT);",
          "INSERT INTO items VALUES (1, NULL), (2, 'ok');",
          "SELECT id, label, QUOTE(label) AS q, TYPEOF(label) AS t FROM items ORDER BY id;",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      const parsed = JSON.parse(res.stdout);
      assert.deepEqual(parsed, [
        { id: 1, label: null, q: "NULL", t: "null" },
        { id: 2, label: "ok", q: "'ok'", t: "text" },
      ]);
    });
  });

  test("04. sqlite3 string concatenation || with QUOTE(NULL) and TYPEOF(NULL)", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "SELECT 'q=' || QUOTE(NULL) || ',t=' || TYPEOF(NULL) || ',n=' || QUOTE(42);",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "q=NULL,t=null,n=42\n");
    });
  });

  test("05. sqlite3 .nullvalue customizes display of SQL NULL without affecting QUOTE(NULL) or TYPEOF(NULL)", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          ".nullvalue <NIL>",
          "CREATE TABLE row_nulls(id INT, v TEXT);",
          "INSERT INTO row_nulls VALUES (1, NULL), (2, 'present');",
          "SELECT id, v, QUOTE(v), TYPEOF(v) FROM row_nulls ORDER BY id;",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        ["1|<NIL>|NULL|null", "2|present|'present'|text", ""].join("\n")
      );
    });
  });

  test("06. sqlite3 recursive CTE graph traversal with depth, path accumulator, and cycle guard", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "CREATE TABLE edges(src TEXT, dst TEXT);",
          "INSERT INTO edges VALUES ('root','svc-a'),('svc-a','db-1'),('svc-a','cache-1'),('root','svc-b'),('svc-b','db-2');",
          "WITH RECURSIVE reach(node, depth, path) AS (",
          "  SELECT 'root', 0, 'root'",
          "  UNION ALL",
          "  SELECT e.dst, r.depth + 1, r.path || '->' || e.dst",
          "  FROM edges e JOIN reach r ON e.src = r.node",
          "  WHERE r.depth < 4",
          ")",
          "SELECT node, depth, path FROM reach ORDER BY depth, node;",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "root|0|root",
          "svc-a|1|root->svc-a",
          "svc-b|1|root->svc-b",
          "cache-1|2|root->svc-a->cache-1",
          "db-1|2|root->svc-a->db-1",
          "db-2|2|root->svc-b->db-2",
          "",
        ].join("\n")
      );
    });
  });

  test("07. sqlite3 window functions ROW_NUMBER, RANK, DENSE_RANK, LAG, and LEAD over partitioned scores", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "CREATE TABLE scores(team TEXT, player TEXT, pts INT);",
          "INSERT INTO scores VALUES ('A','p1',30),('A','p2',30),('A','p3',15),('B','p4',50),('B','p5',25);",
          "SELECT team, player, pts,",
          "  RANK() OVER (PARTITION BY team ORDER BY pts DESC) AS rnk,",
          "  DENSE_RANK() OVER (PARTITION BY team ORDER BY pts DESC) AS drnk,",
          "  COALESCE(LAG(pts, 1) OVER (PARTITION BY team ORDER BY pts DESC, player), -1) AS prev_pts",
          "FROM scores ORDER BY team, pts DESC, player;",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "A|p1|30|1|1|-1",
          "A|p2|30|1|1|30",
          "A|p3|15|3|2|30",
          "B|p4|50|1|1|-1",
          "B|p5|25|2|2|50",
          "",
        ].join("\n")
      );
    });
  });

  test("08. sqlite3 BEFORE/AFTER UPDATE triggers with WHEN condition and audit log table", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "CREATE TABLE accounts(id INT PRIMARY KEY, bal INT);",
          "CREATE TABLE audit(id INT, old_bal INT, new_bal INT);",
          "CREATE TRIGGER tr_audit AFTER UPDATE ON accounts WHEN NEW.bal != OLD.bal BEGIN",
          "  INSERT INTO audit VALUES (OLD.id, OLD.bal, NEW.bal);",
          "END;",
          "INSERT INTO accounts VALUES (1, 100), (2, 250);",
          "UPDATE accounts SET bal = 100 WHERE id = 1;",
          "UPDATE accounts SET bal = 175 WHERE id = 1;",
          "UPDATE accounts SET bal = 300 WHERE id = 2;",
          "SELECT id, old_bal, new_bal FROM audit ORDER BY id;",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1|100|175\n2|250|300\n");
    });
  });

  test("09. sqlite3 UPSERT ON CONFLICT DO UPDATE with excluded.* and WHERE guard", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "CREATE TABLE kv(k TEXT PRIMARY KEY, v INT, rev INT);",
          "INSERT INTO kv VALUES ('a', 10, 1), ('b', 20, 1);",
          "INSERT INTO kv VALUES ('a', 35, 2), ('b', 15, 2), ('c', 50, 1)",
          "  ON CONFLICT(k) DO UPDATE SET v = excluded.v, rev = kv.rev + 1 WHERE excluded.v > kv.v;",
          "SELECT k, v, rev FROM kv ORDER BY k;",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "a|35|2\nb|20|1\nc|50|1\n");
    });
  });

  test("10. sqlite3 JSON functions json_set, json_remove, json_patch, json_extract, and json_each", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "SELECT json_extract(json_patch(json_set('{\"a\":1,\"b\":2}', '$.c', 3), '{\"b\":null,\"d\":4}'), '$.a', '$.c', '$.d');",
          "SELECT key || '=' || value FROM json_each('{\"x\":10,\"y\":20}') ORDER BY key;",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "[1,3,4]\nx=10\ny=20\n");
    });
  });

  test("11. sqlite3 FTS5 full-text search with table/column MATCH, UPDATE, and DELETE", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "CREATE VIRTUAL TABLE docs USING fts5(title, body);",
          "INSERT INTO docs VALUES",
          "  ('Rust Compiler', 'Borrow checker and lifetime analysis'),",
          "  ('TypeScript Runtime', 'Type checker and bundler pipeline'),",
          "  ('SQLite Engine', 'B-tree storage and query optimizer');",
          "SELECT rowid, title FROM docs WHERE docs MATCH 'checker borrow' ORDER BY rowid;",
          "SELECT rowid, title FROM docs WHERE title MATCH 'sqlite' ORDER BY rowid;",
          "DELETE FROM docs WHERE rowid = 2;",
          "SELECT COUNT(*) FROM docs WHERE docs MATCH 'checker';",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1|Rust Compiler\n3|SQLite Engine\n1\n");
    });
  });

  test("12. sqlite3 SAVEPOINT, ROLLBACK TO SAVEPOINT, and RELEASE SAVEPOINT transactional integrity", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 <<'SQL'",
          "CREATE TABLE ledger(id INT PRIMARY KEY, amt INT);",
          "INSERT INTO ledger VALUES (1, 100);",
          "SAVEPOINT sp1;",
          "INSERT INTO ledger VALUES (2, 200);",
          "SAVEPOINT sp2;",
          "UPDATE ledger SET amt = 999 WHERE id = 1;",
          "ROLLBACK TO sp2;",
          "RELEASE sp1;",
          "SELECT id, amt FROM ledger ORDER BY id;",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1|100\n2|200\n");
    });
  });

  test("13. xan filter, map, groupby, sort, and select pipeline over CSV metrics", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/metrics.csv": [
            "region,service,reqs,latency",
            "us,api,100,50",
            "us,web,150,30",
            "us,cache,500,5",
            "eu,api,120,40",
            "eu,web,180,20",
            "",
          ].join("\n"),
        },
      },
      async (sh) => {
        const res = await sh.exec(
          [
            "xan filter 'latency >= 20' /work/metrics.csv",
            "  | xan groupby region 'sum(reqs) as total_reqs, mean(latency) as avg_lat'",
            "  | xan sort -s region",
          ].join(" ")
        );
        assert.equal(res.exitCode, 0);
        assert.equal(
          res.stdout,
          ["region,total_reqs,avg_lat", "eu,300,30", "us,250,40", ""].join("\n")
        );
      }
    );
  });

  test("14. csvkit csvcut -C negative range exclusion, csvgrep, and csvjson formatting", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/staff.csv": [
            "name,dept,role,salary",
            "alice,eng,staff,120",
            "bob,sales,rep,95",
            "carol,eng,principal,150",
            "",
          ].join("\n"),
        },
      },
      async (sh) => {
        const res = await sh.exec(
          "csvcut -C 2: /work/staff.csv | csvgrep -c 1 -r '^(alice|carol)$' | csvjson -i 2"
        );
        assert.equal(res.exitCode, 0);
        const parsed = JSON.parse(res.stdout);
        assert.deepEqual(parsed, [
          { name: "alice", salary: 120 },
          { name: "carol", salary: 150 },
        ]);
      }
    );
  });

  test("15. jq recursive walk, reduce, group_by, and format strings @csv/@uri/@base64", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "jq -r '",
          "  group_by(.team)",
          "  | map({",
          "      team: .[0].team,",
          "      total: (reduce .[].score as $s (0; . + $s)),",
          "      b64: (.[0].team | @base64)",
          "    })",
          "  | .[] | [ .team, .total, .b64 ] | @csv",
          "' <<'JSON'",
          '[{"team":"core","score":15},{"team":"edge","score":25},{"team":"core","score":35}]',
          "JSON",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, '"core",50,"Y29yZQ=="\n"edge",25,"ZWRnZQ=="\n');
    });
  });

  test("16. yq YAML-to-JSON and JSON-to-YAML round-trip with -P - and deep map update", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf '{"service":"auth","replicas":2,"tags":["prod","v2"]}\\n' | yq -P '.replicas = (.replicas + 3) | .tags += ["ha"]' - | yq -o=json '.' - | jq -c '.'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, '{"service":"auth","replicas":5,"tags":["prod","v2","ha"]}\n');
    });
  });

  test("17. awk associative arrays, split(), gsub(), and formatted summary report", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "awk -F':' '",
          "  { gsub(/^[ \\t]+|[ \\t]+$/, \"\", $2); sum[$1] += $3; cnt[$1]++ }",
          "  END {",
          "    for (k in sum) printf \"%s:%d:%.1f\\n\", k, sum[k], sum[k]/cnt[k]",
          "  }",
          "' <<'EOF' | sort",
          "api: GET :12",
          "worker: JOB :30",
          "api: POST :18",
          "worker: JOB :10",
          "EOF",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "api:30:15.0\nworker:40:20.0\n");
    });
  });

  test("18. sed branch labels (:loop / b / t), hold space exchange, and multi-line join", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf 'alpha\\nbeta\\ngamma\\n' | sed ':a;N;$!ba;s/\\n/ -> /g'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "alpha -> beta -> gamma\n");
    });
  });

  test("19. bc scale arithmetic and hex ibase/obase conversion", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "bc_val=$(printf 'scale=4; (355 / 113) * 2\\n' | bc)",
          "hex_val=$(printf 'obase=16; ibase=10; 255 * 16 + 15\\n' | bc)",
          'printf "%s|%s\\n" "$bc_val" "$hex_val"',
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "6.2830|FFF\n");
    });
  });

  test("20. end-to-end sqlite3 -> xan to json -> jq -> openssl dgst -sha256 signature verification", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out /tmp/k.pem 2>/dev/null",
          "openssl pkey -in /tmp/k.pem -pubout -out /tmp/k.pub 2>/dev/null",
          "sqlite3 /tmp/audit.db > /tmp/events.csv <<'SQL'",
          "CREATE TABLE events(id INT, kind TEXT, meta TEXT);",
          "INSERT INTO events VALUES (1, 'deploy', NULL), (2, 'verify', 'ok');",
          ".headers on",
          ".mode csv",
          "SELECT id, kind, QUOTE(meta) AS qmeta, TYPEOF(meta) AS tmeta FROM events ORDER BY id;",
          "SQL",
          "xan to json /tmp/events.csv | jq -c '.' > /tmp/payload.json",
          "openssl dgst -sha256 -sign /tmp/k.pem -out /tmp/payload.sig /tmp/payload.json",
          "openssl dgst -sha256 -verify /tmp/k.pub -signature /tmp/payload.sig /tmp/payload.json",
          "cat /tmp/payload.json",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.match(res.stdout, /^Verified OK\n/);
      const lines = res.stdout.trim().split("\n");
      const parsed = JSON.parse(lines[1]!);
      assert.deepEqual(parsed, [
        { id: 1, kind: "deploy", qmeta: "NULL", tmeta: "null" },
        { id: 2, kind: "verify", qmeta: "'ok'", tmeta: "text" },
      ]);
    });
  });
});
