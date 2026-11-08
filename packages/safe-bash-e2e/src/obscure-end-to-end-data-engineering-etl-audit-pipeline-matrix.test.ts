import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure end-to-end data engineering, ETL, log forensics, and audit pipeline matrix", () => {
  test("1. YAML -> yq -> jq SQL generator -> sqlite3 -> CSV -> xan groupby pipeline", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "cat <<'YAML' > /tmp/services.yaml",
          "clusters:",
          "  - name: api-east",
          "    tier: prod",
          "    rps: 1200",
          "  - name: api-west",
          "    tier: prod",
          "    rps: 800",
          "  - name: staging-1",
          "    tier: stage",
          "    rps: 150",
          "YAML",
          "sqlite3 /tmp/ops.db 'CREATE TABLE svc(name TEXT, tier TEXT, rps INTEGER);'",
          "yq -o=json '.clusters[]' /tmp/services.yaml | jq -r '\"INSERT INTO svc VALUES (\\u0027\" + .name + \"\\u0027,\\u0027\" + .tier + \"\\u0027,\" + (.rps|tostring) + \");\"' | sqlite3 /tmp/ops.db",
          "sqlite3 -header -csv /tmp/ops.db 'SELECT tier, name, rps FROM svc ORDER BY name;' | xan groupby tier 'count() as n, sum(rps) as total_rps' | xan sort -s tier",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "tier,n,total_rps\nprod,2,2000\nstage,1,150\n");
    });
  });

  test("2. XML -> xq -> in2csv -> csvsql grouped aggregation pipeline", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "cat <<'XML' > /tmp/orders.xml",
          "<orders>",
          '  <order id="101"><cust>ada</cust><amt>120</amt></order>',
          '  <order id="102"><cust>bob</cust><amt>80</amt></order>',
          '  <order id="103"><cust>ada</cust><amt>150</amt></order>',
          "</orders>",
          "XML",
          "xq -c '.orders.order' /tmp/orders.xml | in2csv -f json > /tmp/orders.csv",
          "csvsql --query 'SELECT cust, COUNT(*) AS cnt, SUM(CAST(amt AS INTEGER)) AS total FROM orders GROUP BY cust ORDER BY cust' /tmp/orders.csv",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "cust,cnt,total\nada,2,270\nbob,1,80\n");
    });
  });

  test("3. HTML scraping via htmlq + process substitution + paste + awk + jq sorting", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "cat <<'HTML' > /tmp/metrics.html",
          '<div class="host" data-name="web-1"><span class="cpu">42</span></div>',
          '<div class="host" data-name="web-2"><span class="cpu">78</span></div>',
          "HTML",
          `paste -d: <(htmlq --attribute data-name '.host' --filename /tmp/metrics.html) <(htmlq --text '.host .cpu' --filename /tmp/metrics.html) | awk -F: '{ printf "{\\"host\\":\\"%s\\",\\"cpu\\":%d}\\n", $1, $2 }' | jq -sc 'sort_by(.cpu) | reverse'`,
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, '[{"host":"web-2","cpu":78},{"host":"web-1","cpu":42}]\n');
    });
  });

  test("4. access log forensics via rg named captures + awk associative aggregation + sort", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "cat <<'LOG' > /tmp/access.log",
          "ip=10.0.0.1 status=200 ms=12",
          "ip=10.0.0.2 status=500 ms=140",
          "ip=10.0.0.1 status=200 ms=18",
          "ip=10.0.0.2 status=502 ms=210",
          "LOG",
          `rg -N -r '$ip|$st|$ms' '^ip=(?P<ip>[0-9.]+) status=(?P<st>[0-9]+) ms=(?P<ms>[0-9]+)$' /tmp/access.log | awk -F'|' '{ cnt[$1]++; sum[$1]+=$3; if ($2 >= 500) err[$1]++ } END { for (k in cnt) printf "%s,%d,%d,%d\\n", k, cnt[k], sum[k], err[k]+0 }' | sort`,
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "10.0.0.1,2,30,0\n10.0.0.2,2,350,2\n");
    });
  });

  test("5. config migration via sed -> diff -u -> patch -> sha256sum -> tar.gz -> verify", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "mkdir -p /tmp/cfg_bundle",
          'printf "timeout=30\\nretries=3\\nmode=legacy\\n" > /tmp/cfg_bundle/app.conf',
          'sed "s/mode=legacy/mode=strict/; s/retries=3/retries=5/" /tmp/cfg_bundle/app.conf > /tmp/cfg_bundle/app.conf.new',
          "diff -u /tmp/cfg_bundle/app.conf /tmp/cfg_bundle/app.conf.new > /tmp/cfg_bundle/upgrade.patch || true",
          "patch -s /tmp/cfg_bundle/app.conf /tmp/cfg_bundle/upgrade.patch",
          "rm /tmp/cfg_bundle/app.conf.new",
          "(cd /tmp/cfg_bundle && sha256sum app.conf upgrade.patch > SHA256SUMS)",
          "tar -czf /tmp/cfg_release.tar.gz -C /tmp/cfg_bundle .",
          "mkdir -p /tmp/cfg_verify && tar -xzf /tmp/cfg_release.tar.gz -C /tmp/cfg_verify",
          "(cd /tmp/cfg_verify && sha256sum -c SHA256SUMS) && grep '^mode=' /tmp/cfg_verify/app.conf",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "app.conf: OK\nupgrade.patch: OK\nmode=strict\n");
    });
  });

  test("6. sqlite3 -json window RANK() -> jq projection -> yq YAML formatting", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 -json <<'SQL' | jq -c 'map({dept, emp, rnk})' | yq -P '.'",
          "CREATE TABLE sal(dept TEXT, emp TEXT, pay INTEGER);",
          "INSERT INTO sal VALUES ('eng','ada',150),('eng','bob',120),('ops','carl',110);",
          "SELECT dept, emp, RANK() OVER (PARTITION BY dept ORDER BY pay DESC) AS rnk FROM sal ORDER BY dept, rnk;",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "- dept: eng\n  emp: ada\n  rnk: 1\n- dept: eng\n  emp: bob\n  rnk: 2\n- dept: ops\n  emp: carl\n  rnk: 1\n"
      );
    });
  });

  test("7. awk hex escape (\\x27) SQL UPSERT generation into sqlite3", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "cat <<'CSV' > /tmp/inv.csv",
          "sku,stock",
          "A1,10",
          "B2,5",
          "CSV",
          "cat <<'CSV' > /tmp/delta.csv",
          "sku,added",
          "A1,7",
          "C3,12",
          "CSV",
          "sqlite3 /tmp/wh.db 'CREATE TABLE stock(sku TEXT PRIMARY KEY, qty INTEGER);'",
          `awk -F, 'NR>1 { printf "INSERT INTO stock VALUES (\\x27%s\\x27, %d);\\n", $1, $2 }' /tmp/inv.csv | sqlite3 /tmp/wh.db`,
          `awk -F, 'NR>1 { printf "INSERT INTO stock VALUES (\\x27%s\\x27, %d) ON CONFLICT(sku) DO UPDATE SET qty = stock.qty + excluded.qty;\\n", $1, $2 }' /tmp/delta.csv | sqlite3 /tmp/wh.db`,
          "sqlite3 /tmp/wh.db 'SELECT sku, qty FROM stock ORDER BY sku;'",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "A1|17\nB2|5\nC3|12\n");
    });
  });

  test("8. bc fixed-point financial schedule piped into xan agg summary", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `(printf 'step,val\\n'; for i in 1 2 3 4; do v=$(printf "scale=2; %d * 12.50\\n" "$i" | bc); printf "%d,%s\\n" "$i" "$v"; done) | xan agg 'count() as n, sum(val) as total, mean(val) as avg'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "n,total,avg\n4,125,31.25\n");
    });
  });

  test("9. find + sort + xargs + rg capture replacement across multi-package tree", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "mkdir -p /tmp/repo/pkg_a /tmp/repo/pkg_b",
          'printf "export const VERSION = \\"1.0.0\\";\\n" > /tmp/repo/pkg_a/mod.ts',
          'printf "export const VERSION = \\"2.3.4\\";\\n" > /tmp/repo/pkg_b/mod.ts',
          `find /tmp/repo -name '*.ts' | sort | xargs rg -N -r '$1' 'VERSION = "([0-9.]+)"' | sort`,
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "/tmp/repo/pkg_a/mod.ts:export const 1.0.0;\n/tmp/repo/pkg_b/mod.ts:export const 2.3.4;\n"
      );
    });
  });

  test("10. binary packet decoding via xxd -r -p -> dd slice -> sha256sum", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "484541445f5041594c4f41445f5441494c" | xxd -r -p > /tmp/pkt.bin',
          "dd if=/tmp/pkt.bin of=/tmp/body.bin bs=1 skip=5 count=7 status=none",
          'printf "%s|%s\\n" "$(cat /tmp/body.bin)" "$(sha256sum /tmp/body.bin | awk \'{print $1}\')"',
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "PAYLOAD|ea36e4da4017000028db7794d946b152540d7c68bbdb6c60e999f1dce19a409b\n"
      );
    });
  });

  test("11. TOML config -> yq -p=toml -> jq -> envsubst -> sponge in-place template rendering", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "cat <<'TOML' > /tmp/app.toml",
          "[server]",
          'host = "10.20.30.40"',
          'port = "8443"',
          "TOML",
          "printf 'listen=$HOST:$PORT\\n' > /tmp/nginx.conf",
          "HOST=$(yq -p=toml -o=json '.' /tmp/app.toml | jq -r '.server.host')",
          "PORT=$(yq -p=toml -o=json '.' /tmp/app.toml | jq -r '.server.port')",
          "HOST=$HOST PORT=$PORT envsubst < /tmp/nginx.conf | sponge /tmp/nginx.conf",
          "cat /tmp/nginx.conf",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "listen=10.20.30.40:8443\n");
    });
  });

  test("12. csvjoin -> csvsort -> xan to json -> jq formatting pipeline", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "printf 'id,user\\n1,ada\\n2,grace\\n3,linus\\n' > /tmp/u.csv",
          "printf 'id,score\\n1,95\\n2,88\\n3,92\\n' > /tmp/s.csv",
          `csvjoin -c id /tmp/u.csv /tmp/s.csv | csvsort -c score -r | xan to json | jq -c 'map("\\(.user)=\\(.score)")'`,
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, '["ada=95","linus=92","grace=88"]\n');
    });
  });

  test("13. xmllint --xpath attribute extraction piped into bc invoice calculation", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "cat <<'XML' > /tmp/items.xml",
          '<cart><item price="19.95" qty="2"/><item price="5.50" qty="3"/></cart>',
          "XML",
          "P1=$(xmllint --xpath 'string(/cart/item[1]/@price)' /tmp/items.xml)",
          "Q1=$(xmllint --xpath 'string(/cart/item[1]/@qty)' /tmp/items.xml)",
          "P2=$(xmllint --xpath 'string(/cart/item[2]/@price)' /tmp/items.xml)",
          "Q2=$(xmllint --xpath 'string(/cart/item[2]/@qty)' /tmp/items.xml)",
          'printf "scale=2; (%s * %s) + (%s * %s)\\n" "$P1" "$Q1" "$P2" "$Q2" | bc',
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "56.40\n");
    });
  });

  test("14. three-way config merge via diff3 -m and paste reconciliation", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "printf 'v=1\\nport=8080\\ntls=off\\n' > /tmp/base.cfg",
          "printf 'v=2\\nport=8080\\ntls=off\\n' > /tmp/ours.cfg",
          "printf 'v=1\\nport=8080\\ntls=on\\n' > /tmp/theirs.cfg",
          "diff3 -m /tmp/ours.cfg /tmp/base.cfg /tmp/theirs.cfg > /tmp/merged.cfg",
          "paste -sd, /tmp/merged.cfg",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "v=2,port=8080,tls=on\n");
    });
  });

  test("15. NDJSON stream -> jq -sc group_by -> in2csv -f json -> xan sort", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf '{"svc":"auth","ms":20}\\n{"svc":"pay","ms":50}\\n{"svc":"auth","ms":30}\\n{"svc":"pay","ms":70}\\n' | jq -sc 'group_by(.svc) | map({svc: .[0].svc, avg_ms: ((map(.ms) | add) / length)})' | in2csv -f json | xan sort -s svc`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "svc,avg_ms\nauth,25\npay,60\n");
    });
  });

  test("16. tar -cJf / -xJf XZ-compressed log archive round-trip and rg filtering", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "mkdir -p /tmp/src_logs /tmp/clean_logs",
          "printf 'INFO boot\\nERROR disk\\nINFO ready\\n' > /tmp/src_logs/a.log",
          "printf 'WARN slow\\nERROR net\\n' > /tmp/src_logs/b.log",
          "tar -cJf /tmp/logs.tar.xz -C /tmp/src_logs a.log b.log",
          "tar -xJf /tmp/logs.tar.xz -C /tmp/clean_logs",
          "rg -N '^ERROR ' /tmp/clean_logs | sort",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "/tmp/clean_logs/a.log:ERROR disk\n/tmp/clean_logs/b.log:ERROR net\n"
      );
    });
  });

  test("17. sqlite3 recursive CTE organizational tree exported as JSON to jq", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sqlite3 -json <<'SQL' | jq -c 'map(.path)'",
          "CREATE TABLE org(id INTEGER, name TEXT, parent_id INTEGER);",
          "INSERT INTO org VALUES (1, 'CEO', NULL), (2, 'VP_Eng', 1), (3, 'Staff_Eng', 2);",
          "WITH RECURSIVE tree(id, path) AS (",
          "  SELECT id, name FROM org WHERE parent_id IS NULL",
          "  UNION ALL",
          "  SELECT o.id, t.path || '->' || o.name FROM org o JOIN tree t ON o.parent_id = t.id",
          ")",
          "SELECT path FROM tree ORDER BY id;",
          "SQL",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, '["CEO","CEO->VP_Eng","CEO->VP_Eng->Staff_Eng"]\n');
    });
  });

  test("18. key-value stream -> sed regex quoting -> paste -> awk JSON object -> jq keys", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf 'key1=val1\\nkey2=val2\\nkey3=val3\\n' | sed -E 's/^([^=]+)=(.*)$/"\\1":"\\2"/' | paste -sd, - | awk '{ print "{" $0 "}" }' | jq -c 'keys'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, '["key1","key2","key3"]\n');
    });
  });

  test("19. gzip + base64 -w 0 JSON envelope wrapping and unwrap verification", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          `PAYLOAD=$(printf '{"status":"verified","code":200}' | gzip -c | base64 -w 0)`,
          `printf '{"envelope":"%s"}\\n' "$PAYLOAD" | jq -r '.envelope' | base64 -d | gzip -dc | jq -r '."status" + ":" + (.code|tostring)'`,
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "verified:200\n");
    });
  });

  test("20. comm -23 / -13 / -12 identity reconciliation audit across sorted datasets", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "printf 'u1\\nu2\\nu3\\nu4\\n' | sort > /tmp/db_users.txt",
          "printf 'u2\\nu3\\nu5\\n' | sort > /tmp/idp_users.txt",
          "STALE=$(comm -23 /tmp/db_users.txt /tmp/idp_users.txt | paste -sd, -)",
          "MISSING=$(comm -13 /tmp/db_users.txt /tmp/idp_users.txt | paste -sd, -)",
          "ACTIVE=$(comm -12 /tmp/db_users.txt /tmp/idp_users.txt | paste -sd, -)",
          'printf "stale=%s|missing=%s|active=%s\\n" "$STALE" "$MISSING" "$ACTIVE"',
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "stale=u1,u4|missing=u5|active=u2,u3\n");
    });
  });
});
