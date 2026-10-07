import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure multi-stage SQL, CSV, JSON, YAML, XML, HTML, AWK, SED & BC analytics matrix", () => {
  it("1. sqlite3 COALESCE, NULLIF, IIF, and TYPEOF across mixed types", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 :memory: "
          CREATE TABLE raw(id INT, a TEXT, b TEXT, n INT, r REAL);
          INSERT INTO raw VALUES (1, 'none', 'fallback1', 10, 1.5), (2, 'primary2', 'fallback2', 0, 2.25), (3, NULL, 'fallback3', -5, -5.5);
          SELECT id, COALESCE(NULLIF(a, 'none'), b), IIF(n > 0, 'pos', IIF(n < 0, 'neg', 'zero')), TYPEOF(a), TYPEOF(n), TYPEOF(r)
          FROM raw ORDER BY id;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "1|fallback1|pos|text|integer|real",
          "2|primary2|zero|text|integer|real",
          "3|fallback3|neg|null|integer|real",
        ].join("\n"),
      );
    });
  });

  it("2. sqlite3 derived table subquery with GROUP_CONCAT custom separator and HAVING on SELECT alias", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 :memory: "
          CREATE TABLE tags(item TEXT, tag TEXT);
          INSERT INTO tags VALUES ('p1','db'),('p1','sql'),('p1','fast'),('p2','ui'),('p3','api'),('p3','rest');
          SELECT item, COUNT(*) AS c, GROUP_CONCAT(tag, '|')
          FROM (SELECT * FROM tags ORDER BY item, tag)
          GROUP BY item HAVING c >= 2 ORDER BY item;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["p1|3|db|fast|sql", "p3|2|api|rest"].join("\n"),
      );
    });
  });

  it("3. sqlite3 LEFT JOIN derived table subquery with EXISTS and NOT EXISTS correlated predicates", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 :memory: "
          CREATE TABLE users(id INT, name TEXT);
          CREATE TABLE orders(uid INT, amt INT);
          INSERT INTO users VALUES (1,'Ada'),(2,'Bob'),(3,'Cyd');
          INSERT INTO orders VALUES (1,100),(1,250),(3,50);
          SELECT u.name, COALESCE(s.total, 0)
          FROM users u
          LEFT JOIN (SELECT uid, SUM(amt) AS total FROM orders GROUP BY uid) s ON u.id = s.uid
          WHERE EXISTS (SELECT 1 FROM orders o WHERE o.uid = u.id AND o.amt >= 100)
             OR NOT EXISTS (SELECT 1 FROM orders o WHERE o.uid = u.id)
          ORDER BY u.id;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "Ada|350\nBob|0");
    });
  });

  it("4. jq indices, index, rindex on strings and arrays with transpose and flatten(1)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        jq -cn '
          {
            idx: ("ababa" | indices("aba")),
            first_idx: ([10, 20, 30, 20, 10] | index(20)),
            last_idx: ([10, 20, 30, 20, 10] | rindex(20)),
            trans: ([[1, 2, 3], [4, 5, 6]] | transpose),
            flat: ([[1, [2]], [[3]]] | flatten(1))
          }
        '
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        '{"idx":[0,2],"first_idx":1,"last_idx":3,"trans":[[1,4],[2,5],[3,6]],"flat":[1,[2],[3]]}',
      );
    });
  });

  it("5. jq while, until, limit, first, and last iterative generators", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        jq -cn '
          {
            pows: ([1 | while(. < 100; . * 2)]),
            fact: ([1, 1] | until(.[0] > 5; [.[0] + 1, .[1] * .[0]]) | .[1]),
            lim: ([limit(3; [10, 20, 30, 40, 50][])]),
            fst: first([7, 8, 9][]),
            lst: last([7, 8, 9][])
          }
        '
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        '{"pows":[1,2,4,8,16,32,64],"fact":120,"lim":[10,20,30],"fst":7,"lst":9}',
      );
    });
  });

  it("6. jq scan, gsub, splits, and test regex pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        jq -cn '
          "Foo_123__Bar_456" | {
            nums: [scan("[0-9]+")],
            norm: gsub("_+"; "-"),
            parts: [splits("_+")],
            has_digits: test("[0-9]{3}")
          }
        '
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        '{"nums":["123","456"],"norm":"Foo-123-Bar-456","parts":["Foo","123","Bar","456"],"has_digits":true}',
      );
    });
  });

  it("7. yq YAML in-place array transformation and JSON conversion", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'EOF' > /workspace/cfg.yaml
service:
  name: billing
  ports:
    - 8080
    - 8443
  tls: true
EOF
        yq -o=json ".service.ports |= map(. + 100)" /workspace/cfg.yaml | jq -c .
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        '{"service":{"name":"billing","ports":[8180,8543],"tls":true}}',
      );
    });
  });

  it("8. xmllint --xpath count() and string() with attribute predicates", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'EOF' > /workspace/books.xml
<library>
  <book id="b1" lang="en"><title>Awk Guide</title><price>30</price></book>
  <book id="b2" lang="fr"><title>Sed Avance</title><price>45</price></book>
  <book id="b3" lang="en"><title>Rust Shell</title><price>50</price></book>
</library>
EOF
        c=$(xmllint --xpath "count(//book[@lang='en'])" /workspace/books.xml)
        t=$(xmllint --xpath "string(//book[@id='b3']/title)" /workspace/books.xml)
        echo "en_count=$c b3=$t"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "en_count=2 b3=Rust Shell");
    });
  });

  it("9. htmlq -r node removal, -t text extraction, and -a attribute query", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'EOF' > /workspace/page.html
<div class="card">
  <h2>Title One</h2>
  <p class="secret">Remove Me</p>
  <p class="summary">Keep One</p>
  <a href="/docs/v1">Docs</a>
</div>
EOF
        txt=$(htmlq -t -r ".secret" ".card p" -f /workspace/page.html | tr -s " \\n" " " | sed "s/^ //;s/ $//")
        href=$(htmlq -a href ".card a" -f /workspace/page.html)
        echo "$txt|$href"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "Keep One|/docs/v1");
    });
  });

  it("10. xan map with inline 'as' alias, filter, sort -R, and select pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'EOF' > /workspace/emp.csv
name,dept,salary,bonus
Ada,eng,150,30
Bob,sales,110,40
Cyd,eng,170,25
Dan,eng,130,15
Eve,sales,125,35
EOF
        xan map "salary + bonus as total_comp" /workspace/emp.csv | xan filter "total_comp >= 160" | xan sort -N -R -s total_comp | xan select name,dept,total_comp
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "name,dept,total_comp",
          "Cyd,eng,195",
          "Ada,eng,180",
          "Eve,sales,160",
        ].join("\n"),
      );
    });
  });

  it("11. csvkit csvgrep, csvcut, csvsort -r, and csvjson pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'EOF' > /workspace/inv.csv
sku,warehouse,qty,status
A-10,east,45,active
B-20,west,0,discontinued
C-30,east,120,active
D-40,north,15,active
EOF
        csvgrep -c status -m active /workspace/inv.csv | csvcut -c sku,warehouse,qty | csvsort -c qty -r | csvjson | jq -c 'map({sku, warehouse, qty})'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        '[{"sku":"C-30","warehouse":"east","qty":120.0},{"sku":"A-10","warehouse":"east","qty":45.0},{"sku":"D-40","warehouse":"north","qty":15.0}]',
      );
    });
  });

  it("12. awk NR == FNR two-file hash join and aggregation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'EOF' > /workspace/users.tsv
u1	Ada
u2	Bob
u3	Cyd
EOF
        cat <<'EOF' > /workspace/events.tsv
u2	login	10
u1	upload	25
u2	logout	5
u3	login	15
u1	logout	20
EOF
        awk -F "\\t" '
          NR == FNR { name[$1] = $2; next }
          { sum[$1] += $3; cnt[$1]++ }
          END {
            for (u in name) {
              printf "%s:%s:%d:%d\\n", u, name[u], cnt[u], sum[u]
            }
          }
        ' /workspace/users.tsv /workspace/events.tsv | sort
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["u1:Ada:2:45", "u2:Bob:2:15", "u3:Cyd:1:15"].join("\n"),
      );
    });
  });

  it("13. awk sub, split, and formatted numeric projection", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "id=101;tags=alpha,beta,gamma;score=92.5\\nid=102;tags=delta,epsilon;score=88.0\\n" | awk -F ";" '
          {
            sub(/^id=/, "", $1)
            sub(/^tags=/, "", $2)
            sub(/^score=/, "", $3)
            n = split($2, t, ",")
            printf "%s|%d|%s|%.1f\\n", $1, n, t[n], $3 + 7.5
          }
        '
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["101|3|gamma|100.0", "102|2|epsilon|95.5"].join("\n"),
      );
    });
  });

  it("14. sed hold space line reversal (1!G;h;$p)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "first\\nsecond\\nthird\\nfourth\\n" | sed -n '1!G;h;$p'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["fourth", "third", "second", "first"].join("\n"),
      );
    });
  });

  it("15. sed branch loop (:a ... ta) for recursive thousand-separator insertion", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "1234\\n1234567\\n9876543210\\n42\\n" | sed -E ':a; s/([0-9]+)([0-9]{3})(\\b|,)/\\1,\\2\\3/; ta'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["1,234", "1,234,567", "9,876,543,210", "42"].join("\n"),
      );
    });
  });

  it("16. bc user-defined function with sqrt, scale control, and for/if accumulation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        bc <<'EOF'
scale=4
define hyp(a, b) {
  return sqrt(a*a + b*b)
}
hyp(3, 4)
scale=0
s = 0
for (i = 1; i <= 10; i++) {
  if (i % 2 == 1) s += i * i
}
s
EOF
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "5.0000\n165");
    });
  });

  it("17. sqlite3 -json piped to jq @tsv and awk ratio formatting", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 -json :memory: "
          CREATE TABLE metrics(svc TEXT, p50 INT, p99 INT);
          INSERT INTO metrics VALUES ('auth', 12, 48), ('pay', 35, 190), ('search', 20, 85);
          SELECT * FROM metrics ORDER BY svc;
        " | jq -r '.[] | [.svc, .p50, .p99, (.p99 - .p50)] | @tsv' | awk -F "\\t" '
          { printf "%s:spread=%d,ratio=%.2f\\n", $1, $4, $3 / $2 }
        '
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "auth:spread=36,ratio=4.00",
          "pay:spread=155,ratio=5.43",
          "search:spread=65,ratio=4.25",
        ].join("\n"),
      );
    });
  });

  it("18. yq YAML-to-CSV piped into xan groupby and sort", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'EOF' > /workspace/items.yaml
- region: us
  tier: pro
  rev: 120
- region: eu
  tier: pro
  rev: 90
- region: us
  tier: free
  rev: 30
- region: eu
  tier: pro
  rev: 110
EOF
        yq -o=csv "." /workspace/items.yaml | xan groupby region "sum(rev) as total_rev, count() as cnt" | xan sort -s region
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["region,total_rev,cnt", "eu,200,2", "us,150,2"].join("\n"),
      );
    });
  });

  it("19. diff -u, patch, awk key-value extraction, and jq -sc from_entries", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "host=db1\\nport=5432\\npool=10\\n" > /workspace/v1.conf
        printf "host=db1-replica\\nport=5432\\npool=25\\ntimeout=30\\n" > /workspace/v2.conf
        diff -u /workspace/v1.conf /workspace/v2.conf > /workspace/conf.patch
        patch -s /workspace/v1.conf /workspace/conf.patch
        awk -F "=" '{printf "{\\"key\\":\\"%s\\",\\"value\\":\\"%s\\"}\\n", $1, $2}' /workspace/v1.conf | jq -sc "from_entries"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        '{"host":"db1-replica","port":"5432","pool":"25","timeout":"30"}',
      );
    });
  });

  it("20. end-to-end log pipeline: rg extraction -> sed normalization -> xan stats -> jq report", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'EOF' > /workspace/access.log
2025-03-01T10:00:01Z endpoint=/api/orders status=200 ms=40
2025-03-01T10:00:02Z endpoint=/api/orders status=500 ms=120
2025-03-01T10:00:03Z endpoint=/api/users status=200 ms=20
2025-03-01T10:00:04Z endpoint=/api/orders status=200 ms=50
2025-03-01T10:00:05Z endpoint=/api/users status=200 ms=30
EOF
        {
          echo "endpoint,status,ms"
          rg "endpoint=" /workspace/access.log | sed -E 's/^[^ ]+ endpoint=([^ ]+) status=([0-9]+) ms=([0-9]+)$/\\1,\\2,\\3/'
        } | xan groupby endpoint "count() as reqs, sum(ms) as total_ms, mean(ms) as avg_ms" | xan sort -s endpoint | xan to json | jq -c .
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        '[{"endpoint":"/api/orders","reqs":3,"total_ms":210,"avg_ms":70},{"endpoint":"/api/users","reqs":2,"total_ms":50,"avg_ms":25}]',
      );
    });
  });
});
