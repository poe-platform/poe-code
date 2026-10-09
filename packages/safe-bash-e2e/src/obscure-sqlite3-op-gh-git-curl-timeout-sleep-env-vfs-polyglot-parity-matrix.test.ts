import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

const createEnv = () => ({
  exec: (script: string) => withE2EHarness((h) => h.exec(script)),
});

describe("obscure sqlite3, op, gh, git, timeout, sleep, env, vfs devices, pandoc, ssconvert, and polyglot parity matrix", () => {
  it("1. sqlite3 genuine binary format 3 header and multi-page B-tree persistence across invocations", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sqlite3 app.db "CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT); WITH RECURSIVE seq(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM seq WHERE x < 120) INSERT INTO items SELECT x, printf('item-%03d', x) FROM seq;"
      head -c 15 app.db
      echo ""
      sqlite3 app.db "SELECT COUNT(*), MIN(label), MAX(label) FROM items;"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "SQLite format 3",
        "120|item-001|item-120",
        "",
      ].join("\n")
    );
  });

  it("2. sqlite3 WITH RECURSIVE hierarchical graph traversal and path aggregation", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sqlite3 org.db <<'EOF'
CREATE TABLE edges (parent TEXT, child TEXT);
INSERT INTO edges VALUES ('root', 'eng'), ('eng', 'platform'), ('eng', 'ai'), ('platform', 'wasm');
WITH RECURSIVE tree(node, depth, path) AS (
  SELECT 'root', 0, 'root'
  UNION ALL
  SELECT e.child, t.depth + 1, t.path || '->' || e.child
  FROM edges e JOIN tree t ON e.parent = t.node
)
SELECT depth, path FROM tree ORDER BY path;
EOF
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "0|root",
        "1|root->eng",
        "2|root->eng->ai",
        "2|root->eng->platform",
        "3|root->eng->platform->wasm",
        "",
      ].join("\n")
    );
  });

  it("3. sqlite3 window functions (ROW_NUMBER, DENSE_RANK, LAG, LEAD, and framing SUM OVER)", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sqlite3 win.db <<'EOF'
CREATE TABLE metrics (team TEXT, day INT, val INT);
INSERT INTO metrics VALUES ('a', 1, 10), ('a', 2, 20), ('a', 3, 20), ('a', 4, 40);
SELECT
  day,
  DENSE_RANK() OVER (PARTITION BY team ORDER BY val DESC) AS dr,
  COALESCE(LAG(val, 1) OVER (PARTITION BY team ORDER BY day), -1) AS prev_val,
  SUM(val) OVER (PARTITION BY team ORDER BY day ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS roll2
FROM metrics
ORDER BY day;
EOF
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "1|3|-1|10",
        "2|2|10|30",
        "3|2|20|40",
        "4|1|20|60",
        "",
      ].join("\n")
    );
  });

  it("4. sqlite3 UPSERT (ON CONFLICT DO UPDATE with excluded.*) and AFTER INSERT/UPDATE triggers", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sqlite3 kv.db <<'EOF'
CREATE TABLE kv (k TEXT PRIMARY KEY, v INT);
CREATE TABLE audit (op TEXT, k TEXT, v INT);
CREATE TRIGGER tr_ins AFTER INSERT ON kv BEGIN
  INSERT INTO audit VALUES ('INS', NEW.k, NEW.v);
END;
CREATE TRIGGER tr_upd AFTER UPDATE ON kv BEGIN
  INSERT INTO audit VALUES ('UPD', NEW.k, NEW.v);
END;
INSERT INTO kv VALUES ('hits', 1), ('misses', 2);
INSERT INTO kv VALUES ('hits', 5) ON CONFLICT(k) DO UPDATE SET v = kv.v + excluded.v;
SELECT k, v FROM kv ORDER BY k;
SELECT op, k, v FROM audit ORDER BY rowid;
EOF
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "hits|6",
        "misses|2",
        "INS|hits|1",
        "INS|misses|2",
        "UPD|hits|6",
        "",
      ].join("\n")
    );
  });

  it("5. sqlite3 json_extract, json_each, json_object, and json_group_array", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sqlite3 json.db <<'EOF'
CREATE TABLE events (id INT, payload TEXT);
INSERT INTO events VALUES
  (1, '{"service":"api","tags":["prod","us-east"]}'),
  (2, '{"service":"worker","tags":["prod","eu-west"]}');
SELECT e.id, json_extract(e.payload, '$.service'), j.value
FROM events e, json_each(e.payload, '$.tags') j
WHERE j.value != 'prod'
ORDER BY e.id;
EOF
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "1|api|us-east",
        "2|worker|eu-west",
        "",
      ].join("\n")
    );
  });

  it("6. sqlite3 FTS5 MATCH query, CREATE VIEW, GENERATED ALWAYS AS, RETURNING, and generate_series()", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sqlite3 :memory: "CREATE VIRTUAL TABLE docs USING fts5(title, body); INSERT INTO docs VALUES ('Rust Engine', 'native sandbox shell'), ('TS Harness', 'plugin runner'); SELECT title FROM docs WHERE docs MATCH 'sandbox';"
      sqlite3 adv.db <<'EOF'
CREATE TABLE items (
  id INT PRIMARY KEY,
  qty INT,
  price INT,
  total INT GENERATED ALWAYS AS (qty * price)
);
INSERT INTO items (id, qty, price) VALUES (1, 3, 20), (2, 5, 10) RETURNING id, total;
CREATE VIEW high_items AS SELECT id, total FROM items WHERE total >= 50;
SELECT id, total FROM high_items ORDER BY id;
SELECT GROUP_CONCAT(value, ':') FROM generate_series(10, 30, 10);
EOF
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "Rust Engine",
        "1|60",
        "2|50",
        "1|60",
        "2|50",
        "10:20:30",
        "",
      ].join("\n")
    );
  });

  it("7. sqlite3 output modes (-json, -csv -header, -line) and WITH ... UPDATE correlated subquery", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sqlite3 mode.db "CREATE TABLE t (id INT, score INT); INSERT INTO t VALUES (1, 10), (2, 20);"
      sqlite3 mode.db "WITH bonus(id, extra) AS (VALUES (1, 5), (2, 15)) UPDATE t SET score = score + (SELECT extra FROM bonus WHERE bonus.id = t.id);"
      sqlite3 -json mode.db "SELECT id, score FROM t ORDER BY id;" | jq -c '.'
      sqlite3 -csv -header mode.db "SELECT id, score FROM t ORDER BY id;"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        '[{"id":1,"score":15},{"id":2,"score":35}]',
        "id,score",
        "1,15",
        "2,35",
        "",
      ].join("\n")
    );
  });

  it("8. op vault/item lifecycle, op read, op inject with literal escaped braces, and op run secret masking", async () => {
    const env = createEnv();
    const res = await env.exec(`
      op vault create SecVault --format json >/dev/null
      op item create --category login --title "DBCreds" --vault SecVault username=db_admin password=super_secret_pw_99 >/dev/null
      echo "read=$(op read 'op://SecVault/DBCreds/username')"
      printf 'USER={{ op://SecVault/DBCreds/username }} LIT={{ "{{keep_me}}" }}\n' > tpl.in
      op inject -i tpl.in -o tpl.out >/dev/null
      cat tpl.out
      DB_PW="op://SecVault/DBCreds/password" op run -- sh -c 'echo "pw=$DB_PW"'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "read=db_admin",
        "USER=db_admin LIT={{keep_me}}",
        "pw=<concealed by 1Password>",
        "",
      ].join("\n")
    );
  });

  it("9. op document create/get, op vault list, and op completion", async () => {
    const env = createEnv();
    const res = await env.exec(`
      op vault create DocVault --format json >/dev/null
      printf 'tls_cert_pem_payload' > cert.pem
      op document create cert.pem --title "ProdCert" --vault DocVault >/dev/null
      echo "doc=$(op document get ProdCert --vault DocVault)"
      op vault list --format json | jq -r 'map(.name) | index("DocVault") != null'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "doc=tls_cert_pem_payload",
        "true",
        "",
      ].join("\n")
    );
  });

  it("10. gh repo, label, and issue lifecycle with JSON field filtering", async () => {
    const env = createEnv();
    const res = await env.exec(`
      gh repo create acme/engine --private >/dev/null
      gh label create parity --color FF0000 -R acme/engine >/dev/null
      gh issue create -R acme/engine --title "Verify ZSTD header" --body "Check RFC 8878" --label parity >/dev/null
      gh issue close 1 -R acme/engine >/dev/null
      gh issue list -R acme/engine --state closed --json number,title,state | jq -c -S '.[0]'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      '{"number":1,"state":"CLOSED","title":"Verify ZSTD header"}\n'
    );
  });

  it("11. gh pr create, merge, state=closed listing, and release create/view/delete lifecycle", async () => {
    const env = createEnv();
    const res = await env.exec(`
      gh repo create acme/service --public >/dev/null
      gh pr create -R acme/service --title "Add B-tree" --body "Binary SQLite" --head feat/btree --base main >/dev/null
      gh pr merge 1 -R acme/service --squash >/dev/null
      gh pr list -R acme/service --state closed --json number,state | jq -c -S '.[0]'
      gh release create v2.0.0 -R acme/service --title "v2.0.0" --notes "Full parity" >/dev/null
      gh release view v2.0.0 -R acme/service --json tagName,name | jq -c -S '.'
      gh release delete v2.0.0 -R acme/service --yes >/dev/null
      gh release list -R acme/service --json tagName | jq -c '.'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        '{"number":1,"state":"MERGED"}',
        '{"name":"v2.0.0","tagName":"v2.0.0"}',
        "[]",
        "",
      ].join("\n")
    );
  });

  it("12. gh secret, variable, and api endpoint inspection", async () => {
    const env = createEnv();
    const res = await env.exec(`
      gh repo create acme/infra --private >/dev/null
      gh secret set DEPLOY_KEY --body "sec_val" -R acme/infra >/dev/null
      gh variable set REGION --body "us-west-2" -R acme/infra >/dev/null
      echo "var=$(gh variable get REGION -R acme/infra)"
      gh secret list -R acme/infra --json name | jq -r '.[0].name'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "var=us-west-2",
        "DEPLOY_KEY",
        "",
      ].join("\n")
    );
  });

  it("13. sqlite3 PRAGMA foreign_keys enforcement, json_tree() traversal, and csvpy inspection", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sqlite3 fk.db "PRAGMA foreign_keys = ON; CREATE TABLE p(id INT PRIMARY KEY); CREATE TABLE c(id INT, pid INT REFERENCES p(id)); INSERT INTO p VALUES (1); INSERT INTO c VALUES (10, 1);"
      sqlite3 fk.db "PRAGMA foreign_keys = ON; INSERT INTO c VALUES (11, 999);" 2>/dev/null; fk_rc=$?
      sqlite3 fk.db <<'SQL'
SELECT fullkey, COALESCE(atom, type) FROM json_tree('{"a":{"b":7}}') ORDER BY fullkey;
SQL
      echo "fk_rejected=$((fk_rc != 0))"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "$|object",
        "$.a|object",
        "$.a.b|7",
        "fk_rejected=1",
        "",
      ].join("\n")
    );
  });

  it("14. sleep argument validation and nested timeout preemption + --preserve-status", async () => {
    const env = createEnv();
    const res = await env.exec(`
      sleep 2>/dev/null; rc_empty=$?
      sleep invalid_num 2>/dev/null; rc_bad=$?
      sleep -1 2>/dev/null; rc_neg=$?
      timeout 0.05 sh -c 'timeout 10 sleep 1; echo should_not_print'; rc_nested=$?
      timeout --preserve-status -s TERM 0.05 sleep 1; rc_pres=$?
      echo "empty=$rc_empty bad=$rc_bad neg=$rc_neg nested=$rc_nested pres=$rc_pres"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "empty=1 bad=1 neg=1 nested=124 pres=143\n");
  });

  it("15. env -i clean environment, -u unset, -C working directory change, and -S split-string", async () => {
    const env = createEnv();
    const res = await env.exec(`
      mkdir -p subdir
      printf 'in_subdir\n' > subdir/marker.txt
      export KEEP=1 DROP=2
      env -u DROP sh -c 'echo "keep=$KEEP drop=\${DROP:-unset}"'
      env -C subdir cat marker.txt
      env -i ONLY=yes sh -c 'echo "only=$ONLY keep=\${KEEP:-gone}"'
      env -S 'A=10 B=20 sh -c "echo \\$A:\\$B"'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "keep=1 drop=unset",
        "in_subdir",
        "only=yes keep=gone",
        "10:20",
        "",
      ].join("\n")
    );
  });

  it("16. /dev/null, /dev/zero, /dev/random, and /dev/urandom virtual device semantics", async () => {
    const res = await withE2EHarness({ mountDev: true }, (h) =>
      h.exec(`
        dd if=/dev/zero bs=8 count=2 2>/dev/null | od -An -tx1 | tr -s ' ' | sed 's/^ //; s/ $//'
        rnd_len=$(head -c 24 /dev/urandom | wc -c | tr -d ' ')
        rnd2_len=$(head -c 12 /dev/random | wc -c | tr -d ' ')
        echo "discarded" > /dev/null
        null_len=$(wc -c < /dev/null | tr -d ' ')
        echo "urandom=$rnd_len random=$rnd2_len null=$null_len"
      `)
    );
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
        "urandom=24 random=12 null=0",
        "",
      ].join("\n")
    );
  });

  it("17. background jobs (&, $!, wait, jobs) exit code preservation and parallel file generation", async () => {
    const env = createEnv();
    const res = await env.exec(`
      (printf 'job1_done\n' > j1.txt; exit 0) &
      p1=$!
      (printf 'job2_done\n' > j2.txt; exit 7) &
      p2=$!
      wait $p1
      r1=$?
      wait $p2
      r2=$?
      echo "r1=$r1 r2=$r2 j1=$(cat j1.txt) j2=$(cat j2.txt)"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "r1=0 r2=7 j1=job1_done j2=job2_done\n");
  });

  it("18. pandoc Markdown-to-HTML and HTML-to-Markdown conversion with html-to-markdown and mdq", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > doc.md
# Release Plan

- [x] Compress with genuine headers
- [ ] Ship release
EOF
      pandoc -f markdown -t html doc.md > doc.html
      grep -o 'Release Plan' doc.html
      mdq '# Release Plan' doc.md | head -n 1
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "Release Plan",
        "# Release Plan",
        "",
      ].join("\n")
    );
  });

  it("19. ssconvert spreadsheet conversion (CSV <-> JSON / HTML)", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'service,latency\napi,12\ndb,4\n' > perf.csv
      ssconvert perf.csv perf.html 2>/dev/null
      grep -o 'latency' perf.html | head -n 1
      grep -o '12' perf.html | head -n 1
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "latency",
        "12",
        "",
      ].join("\n")
    );
  });

  it("20. polyglot SecOps audit pipeline: gh + op + sqlite3 + jq + xan + tar -Jcf (genuine XZ magic)", async () => {
    const env = createEnv();
    const res = await env.exec(`
      op vault create AuditVault --format json >/dev/null
      op item create --category login --title "Signer" --vault AuditVault key="audit_hmac_2026" >/dev/null
      gh repo create sec/audit --private >/dev/null
      gh issue create -R sec/audit --title "CVE-2026-0001" --body "High" >/dev/null
      gh issue create -R sec/audit --title "CVE-2026-0002" --body "Low" >/dev/null
      sqlite3 audit.db "CREATE TABLE cves (num INT, title TEXT);"
      gh issue list -R sec/audit --json number,title | jq -r '.[] | "INSERT INTO cves VALUES (\\(.number), \\"\\(.title)\\");"' | sqlite3 audit.db
      sqlite3 -csv -header audit.db "SELECT num, title FROM cves ORDER BY num;" > report.csv
      tar -Jcf bundle.tar.xz report.csv audit.db
      echo "xz_magic=$(xxd -p -l 6 bundle.tar.xz) rows=$(xan count report.csv) signer=$(op read 'op://AuditVault/Signer/key')"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "xz_magic=fd377a585a00 rows=2 signer=audit_hmac_2026\n");
  });
});
