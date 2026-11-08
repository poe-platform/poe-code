import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withE2EHarness } from "./harness.js";

describe("awk, sed, jq, xan, and csvkit deep data processing matrix", () => {
  it("1. awk associative arrays, split(), gsub(), and formatted summary report across multiple log files (FNR vs NR)", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/logs/day1.log",
        [
          "2026-10-01T01:00:00Z service=auth status=200 latency_ms=12",
          "2026-10-01T01:01:00Z service=payments status=502 latency_ms=88",
          "2026-10-01T01:02:00Z service=auth status=200 latency_ms=18",
        ].join("\n") + "\n"
      );
      await h.writeText(
        "/logs/day2.log",
        [
          "2026-10-02T01:00:00Z service=payments status=200 latency_ms=32",
          "2026-10-02T01:01:00Z service=search status=200 latency_ms=15",
          "2026-10-02T01:02:00Z service=payments status=500 latency_ms=120",
        ].join("\n") + "\n"
      );

      const res = await h.exec(
        [
          "awk '",
          "FNR == 1 { files++ }",
          "{",
          "  for (i = 2; i <= NF; i++) {",
          "    split($i, kv, \"=\")",
          "    if (kv[1] == \"service\") svc = kv[2]",
          "    if (kv[1] == \"status\") st = kv[2] + 0",
          "    if (kv[1] == \"latency_ms\") lat = kv[2] + 0",
          "  }",
          "  count[svc]++",
          "  sum[svc] += lat",
          "  if (st >= 500) errs[svc]++",
          "}",
          "END {",
          "  printf \"files=%d total=%d\\n\", files, NR",
          "  for (s in count) {",
          "    printf \"%s:%d:%d:%d\\n\", s, count[s], sum[s], errs[s] + 0",
          "  }",
          "}' /logs/day1.log /logs/day2.log | sort",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "auth:2:30:0",
        "files=2 total=6",
        "payments:3:240:2",
        "search:1:15:0",
      ]);
    });
  });

  it("2. awk user-defined functions, match()/substr(), and getline from a lookup table", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/data/rates.tsv",
        ["USD\t1.0", "EUR\t1.1", "GBP\t1.3"].join("\n") + "\n"
      );
      await h.writeText(
        "/data/tx.txt",
        ["tx1 amount=100USD", "tx2 amount=200EUR", "tx3 amount=50GBP"].join("\n") + "\n"
      );

      const res = await h.exec(
        [
          "awk '",
          "function to_usd(val, cur) { return val * rate[cur] }",
          "BEGIN {",
          "  while ((getline < \"/data/rates.tsv\") > 0) {",
          "    rate[$1] = $2 + 0",
          "  }",
          "  close(\"/data/rates.tsv\")",
          "}",
          "{",
          "  if (match($2, /[0-9]+/)) {",
          "    num = substr($2, RSTART, RLENGTH) + 0",
          "    cur = substr($2, RSTART + RLENGTH)",
          "    printf \"%s=%.0f\\n\", $1, to_usd(num, cur)",
          "  }",
          "}' /data/tx.txt",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "tx1=100\ntx2=220\ntx3=65\n");
    });
  });

  it("3. sed hold-space reversal (1!G;h;$!d) and multi-line continuation joining (:loop; /\\\\$/ { N; s/\\\\\\n//; b loop })", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/work/lines.txt",
        ["first", "second", "third", "fourth"].join("\n") + "\n"
      );
      const rev = await h.exec("sed '1!G;h;$!d' /work/lines.txt");
      assert.equal(rev.exitCode, 0, rev.stderr);
      assert.equal(rev.stdout, "fourth\nthird\nsecond\nfirst\n");

      await h.writeText(
        "/work/continued.sh",
        [
          "cmd --alpha \\",
          "  --beta \\",
          "  --gamma",
          "echo done",
        ].join("\n") + "\n"
      );
      const joined = await h.exec("sed ':a; /\\\\$/ { N; s/[[:space:]]*\\\\\\n[[:space:]]*/ /; ba }' /work/continued.sh");
      assert.equal(joined.exitCode, 0, joined.stderr);
      assert.equal(joined.stdout, "cmd --alpha --beta --gamma\necho done\n");
    });
  });

  it("4. sed address ranges, in-place editing (-i), and branch-on-substitution (t)", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/work/config.ini",
        [
          "[staging]",
          "host = old.example.com",
          "port = 8080",
          "[production]",
          "host = old.example.com",
          "port = 9090",
        ].join("\n") + "\n"
      );

      const res = await h.exec(
        [
          "sed -i '/^\\[production\\]/,/^\\[/ s/old\\.example\\.com/prod.example.com/' /work/config.ini",
          "cat /work/config.ini",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "[staging]",
          "host = old.example.com",
          "port = 8080",
          "[production]",
          "host = prod.example.com",
          "port = 9090",
        ].join("\n") + "\n"
      );
    });
  });

  it("5. jq recursive descent (..), paths, setpath/delpaths, and reduce aggregation", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/data/tree.json",
        JSON.stringify({
          name: "root",
          cost: 10,
          secret: "redact-1",
          children: [
            { name: "child-a", cost: 25, secret: "redact-2" },
            { name: "child-b", cost: 40, children: [{ name: "leaf", cost: 15, secret: "redact-3" }] },
          ],
        })
      );

      const total = await h.exec("jq '[.. | objects | .cost? // empty] | add' /data/tree.json");
      assert.equal(total.exitCode, 0, total.stderr);
      assert.equal(total.stdout.trim(), "90");

      const redacted = await h.exec(
        "jq 'delpaths([paths | select(.[-1] == \"secret\")]) | [.. | objects | .secret? // empty] | length' /data/tree.json"
      );
      assert.equal(redacted.exitCode, 0, redacted.stderr);
      assert.equal(redacted.stdout.trim(), "0");
    });
  });

  it("6. jq custom recursive functions (def), group_by, and @csv/@tsv/@base64/@uri formatters", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/data/items.json",
        JSON.stringify([
          { team: "core", user: "alice", score: 12 },
          { team: "edge", user: "bob", score: 19 },
          { team: "core", user: "carol", score: 28 },
        ])
      );

      const res = await h.exec(
        [
          "jq -r '",
          "  def summarize: group_by(.team) | map({",
          "    team: .[0].team,",
          "    members: (map(.user) | join(\"+\")),",
          "    total: (map(.score) | add),",
          "    b64: (.[0].team | @base64),",
          "    uri: ((\"team=\" + .[0].team + \"&ok=1\") | @uri)",
          "  });",
          "  summarize[] | [.team, .members, (.total | tostring), .b64, .uri] | @tsv",
          "' /data/items.json",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "core\talice+carol\t40\tY29yZQ==\tteam%3Dcore%26ok%3D1",
        "edge\tbob\t19\tZWRnZQ==\tteam%3Dedge%26ok%3D1",
      ]);
    });
  });

  it("7. xan headers inspects single and multi-file schemas with -j, --csv, and -s start index", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/xan/one.csv", "id,name,role\n1,ada,admin\n");
      await h.writeText("/xan/two.tsv", "id\tname\tdept\n1\tada\trd\n");

      const names = await h.exec("xan headers -j /xan/one.csv");
      assert.equal(names.exitCode, 0, names.stderr);
      assert.deepEqual(names.stdout.trim().split("\n"), ["id", "name", "role"]);

      const startIdx = await h.exec("xan headers -s 10 /xan/one.csv");
      assert.equal(startIdx.exitCode, 0, startIdx.stderr);
      assert.deepEqual(startIdx.stdout.trim().split("\n"), ["10 id", "11 name", "12 role"]);

      const csvMulti = await h.exec("xan headers --csv /xan/one.csv /xan/two.tsv");
      assert.equal(csvMulti.exitCode, 0, csvMulti.stderr);
      assert.deepEqual(csvMulti.stdout.trim().split("\n"), [
        "/xan/one.csv,/xan/two.tsv",
        "id,id",
        "name,name",
        "role,dept",
      ]);
    });
  });

  it("8. xan count handles -n (no-headers), -H (human-readable), and -c (alignment validation)", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/xan/clean.csv",
        ["k,v", "a,1", "b,2", "c,3", "d,4"].join("\n") + "\n"
      );
      await h.writeText(
        "/xan/broken.csv",
        ["k,v", "a,1", "b,2,extra", "c,3"].join("\n") + "\n"
      );

      const c1 = await h.exec("xan count -c /xan/clean.csv");
      assert.equal(c1.exitCode, 0, c1.stderr);
      assert.equal(c1.stdout.trim(), "4");

      const cNoHdr = await h.exec("xan count -n /xan/clean.csv");
      assert.equal(cNoHdr.exitCode, 0, cNoHdr.stderr);
      assert.equal(cNoHdr.stdout.trim(), "5");

      const cBroken = await h.exec("xan count -c /xan/broken.csv");
      assert.notEqual(cBroken.exitCode, 0);
    });
  });

  it("9. xan select supports column globs, ranges, complement (!col), and index reordering", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/xan/wide.csv",
        [
          "id,host,metric_cpu,metric_mem,token,region",
          "1,web-1,42,68,sec-a,us-east",
          "2,web-2,81,90,sec-b,eu-west",
        ].join("\n") + "\n"
      );

      const globRes = await h.exec("xan select 'host,metric_*' /xan/wide.csv");
      assert.equal(globRes.exitCode, 0, globRes.stderr);
      assert.deepEqual(globRes.stdout.trim().split("\n"), [
        "host,metric_cpu,metric_mem",
        "web-1,42,68",
        "web-2,81,90",
      ]);

      const exclRes = await h.exec("xan select '!token,id' /xan/wide.csv");
      assert.equal(exclRes.exitCode, 0, exclRes.stderr);
      assert.deepEqual(exclRes.stdout.trim().split("\n"), [
        "host,metric_cpu,metric_mem,region",
        "web-1,42,68,us-east",
        "web-2,81,90,eu-west",
      ]);

      const idxRes = await h.exec("xan select '5,1:2' /xan/wide.csv");
      assert.equal(idxRes.exitCode, 0, idxRes.stderr);
      assert.deepEqual(idxRes.stdout.trim().split("\n"), [
        "region,host,metric_cpu",
        "us-east,web-1,42",
        "eu-west,web-2,81",
      ]);
    });
  });

  it("10. xan slice supports -s/-l windows, -i single index, -I index lists, and -S/-E expressions", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/xan/stream.csv",
        [
          "seq,phase,val",
          "0,boot,10",
          "1,warmup,20",
          "2,active,30",
          "3,active,40",
          "4,drain,50",
          "5,off,60",
        ].join("\n") + "\n"
      );

      const byIdx = await h.exec("xan slice -I 1,3,5 /xan/stream.csv");
      assert.equal(byIdx.exitCode, 0, byIdx.stderr);
      assert.deepEqual(byIdx.stdout.trim().split("\n"), [
        "seq,phase,val",
        "1,warmup,20",
        "3,active,40",
        "5,off,60",
      ]);

      const singleIdx = await h.exec("xan slice -i 4 /xan/stream.csv");
      assert.equal(singleIdx.exitCode, 0, singleIdx.stderr);
      assert.deepEqual(singleIdx.stdout.trim().split("\n"), [
        "seq,phase,val",
        "4,drain,50",
      ]);

      const cond = await h.exec("xan slice -S 'phase == \"active\"' -E 'phase == \"drain\"' /xan/stream.csv");
      assert.equal(cond.exitCode, 0, cond.stderr);
      assert.deepEqual(cond.stdout.trim().split("\n"), [
        "seq,phase,val",
        "2,active,30",
        "3,active,40",
      ]);
    });
  });

  it("11. csvcut and csvgrep filter and project CSV datasets with regex, inverse (-i), and line numbers (-l)", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/csv/services.csv",
        [
          "id,service,env,latency",
          "10,auth-api,prod,14",
          "20,legacy-worker,staging,210",
          "30,payment-api,prod,29",
          "40,search-api,dev,11",
        ].join("\n") + "\n"
      );

      const res = await h.exec(
        "csvgrep -c service -r '.*-api$' /csv/services.csv | csvgrep -c env -m dev -i | csvcut -c id,service,latency"
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "id,service,latency",
        "10,auth-api,14",
        "30,payment-api,29",
      ]);
    });
  });

  it("12. csvclean repairs or separates malformed rows and csvformat converts delimiters (-D, -T)", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/csv/dirty.csv",
        [
          "id,name,score",
          "1,alice,95",
          "2,bob,80,unexpected",
          "3,carol,88",
        ].join("\n") + "\n"
      );

      const cleanRes = await h.exec("csvclean -a --omit-error-rows /csv/dirty.csv 2>/csv/dirty_err.csv | csvformat -D '|'");
      assert.equal(cleanRes.exitCode, 0, cleanRes.stderr);
      assert.deepEqual(cleanRes.stdout.trim().split("\n"), [
        "id|name|score",
        "1|alice|95",
        "3|carol|88",
      ]);

      const errs = await h.readText("/csv/dirty_err.csv");
      assert.ok(errs.includes("bob"));
    });
  });

  it("13. csvjoin performs inner, --left, and --outer relational joins across multi-file CSVs", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/csv/users.csv",
        ["uid,handle", "u1,ada", "u2,grace", "u3,linus"].join("\n") + "\n"
      );
      await h.writeText(
        "/csv/quotas.csv",
        ["uid,quota_gb", "u1,50", "u3,200", "u4,10"].join("\n") + "\n"
      );

      const inner = await h.exec("csvjoin -c uid /csv/users.csv /csv/quotas.csv | csvcut -c uid,handle,quota_gb");
      assert.equal(inner.exitCode, 0, inner.stderr);
      assert.deepEqual(inner.stdout.trim().split("\n"), [
        "uid,handle,quota_gb",
        "u1,ada,50",
        "u3,linus,200",
      ]);

      const left = await h.exec("csvjoin --left -c uid /csv/users.csv /csv/quotas.csv | csvcut -c uid,handle,quota_gb");
      assert.equal(left.exitCode, 0, left.stderr);
      assert.deepEqual(left.stdout.trim().split("\n"), [
        "uid,handle,quota_gb",
        "u1,ada,50",
        "u2,grace,",
        "u3,linus,200",
      ]);
    });
  });

  it("14. csvstack combines regional partitions with group labels (-g, -n) and csvsort orders by numeric column", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/csv/us.csv", "sku,units\nA1,40\nA2,120\n");
      await h.writeText("/csv/apac.csv", "sku,units\nA3,85\nA4,15\n");

      const res = await h.exec(
        "csvstack -g US,APAC -n region /csv/us.csv /csv/apac.csv | csvsort -c units -r"
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "region,sku,units",
        "US,A2,120",
        "APAC,A3,85",
        "US,A1,40",
        "APAC,A4,15",
      ]);
    });
  });

  it("15. csvjson and in2csv round-trip keyed JSON objects (-k) and NDJSON streams (--stream)", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/csv/hosts.csv",
        ["hostname,cores,active", "node-a,8,true", "node-b,16,false"].join("\n") + "\n"
      );

      const keyed = await h.exec("csvjson -k hostname /csv/hosts.csv | jq -c '.[\"node-b\"]'");
      assert.equal(keyed.exitCode, 0, keyed.stderr);
      const parsed = JSON.parse(keyed.stdout.trim());
      assert.equal(parsed.cores, 16);
      assert.equal(parsed.active, false);

      const streamRt = await h.exec(
        "csvjson -I --stream /csv/hosts.csv | in2csv -I -f ndjson | csvcut -c hostname,cores"
      );
      assert.equal(streamRt.exitCode, 0, streamRt.stderr);
      assert.deepEqual(streamRt.stdout.trim().split("\n"), [
        "hostname,cores",
        "node-a,8",
        "node-b,16",
      ]);
    });
  });

  it("16. csvstat computes column statistics (--count, --sum, --mean, --max, --min) and csvlook renders markdown/box tables", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/csv/scores.csv",
        ["player,points", "ada,10", "bob,20", "carol,30", "dan,40"].join("\n") + "\n"
      );

      const sumRes = await h.exec("csvstat -c points --sum /csv/scores.csv");
      assert.equal(sumRes.exitCode, 0, sumRes.stderr);
      assert.match(sumRes.stdout.trim(), /100/);

      const lookRes = await h.exec("csvlook /csv/scores.csv");
      assert.equal(lookRes.exitCode, 0, lookRes.stderr);
      assert.ok(lookRes.stdout.includes("player"));
      assert.ok(lookRes.stdout.includes("carol"));
    });
  });

  it("17. csvsql generates DDL schemas with inferred types and constraints (--tables, --no-constraints)", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/csv/emp.csv",
        [
          "emp_id,dept,salary,active",
          "1,eng,120.5,true",
          "2,eng,140.0,false",
          "3,sales,95.25,true",
        ].join("\n") + "\n"
      );

      const ddl = await h.exec("csvsql --tables employees /csv/emp.csv");
      assert.equal(ddl.exitCode, 0, ddl.stderr);
      assert.match(ddl.stdout, /CREATE TABLE employees/i);
      assert.match(ddl.stdout, /emp_id/i);
      assert.match(ddl.stdout, /salary/i);
    });
  });

  it("18. multi-stage awk -> sed -> jq -> in2csv -> xan pipeline transforms unstructured access logs into filtered CSV metrics", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/logs/raw.log",
        [
          "[2026-10-04] GET /api/users -> 200 (15ms)",
          "[2026-10-04] POST /api/orders -> 201 (45ms)",
          "[2026-10-04] GET /api/orders -> 503 (180ms)",
          "[2026-10-04] DELETE /api/cache -> 204 (8ms)",
        ].join("\n") + "\n"
      );

      const res = await h.exec(
        [
          "tr -d '[]()' < /logs/raw.log \\",
          "  | awk '{ sub(/ms$/, \"\", $6); printf \"{\\\"method\\\":\\\"%s\\\",\\\"path\\\":\\\"%s\\\",\\\"status\\\":%d,\\\"ms\\\":%d}\\n\", $2, $3, $5, $6 }' \\",
          "  | jq -s 'sort_by(-.ms)' \\",
          "  | in2csv -f json \\",
          "  | xan slice -s 0 -l 3 \\",
          "  | xan select method,path,status,ms",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "method,path,status,ms",
        "GET,/api/orders,503,180",
        "POST,/api/orders,201,45",
        "GET,/api/users,200,15",
      ]);
    });
  });

  it("19. jq foreach state machine and awk BEGIN/END field width & OFS/ORS formatting", async () => {
    await withE2EHarness({}, async (h) => {
      const jqRes = await h.exec(
        "printf '[10, -3, 7, 5]\\n' | jq -c '[foreach .[] as $x (0; . + $x; {delta: $x, running: .})]'"
      );
      assert.equal(jqRes.exitCode, 0, jqRes.stderr);
      assert.deepEqual(JSON.parse(jqRes.stdout.trim()), [
        { delta: 10, running: 10 },
        { delta: -3, running: 7 },
        { delta: 7, running: 14 },
        { delta: 5, running: 19 },
      ]);

      const awkRes = await h.exec(
        "printf 'a:b:c\\nd:e:f\\n' | awk 'BEGIN { FS=\":\"; OFS=\"|\"; ORS=\";\" } { $2 = toupper($2); print $1, $2, $3 }'"
      );
      assert.equal(awkRes.exitCode, 0, awkRes.stderr);
      assert.equal(awkRes.stdout, "a|B|c;d|E|f;");
    });
  });

  it("20. csvstack + csvjson + jq + in2csv + xan reconciliation pipeline aggregates partitioned ledgers", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/recon/part1.csv",
        ["tx_id,acct,cents", "t1,A,1050", "t2,B,2300"].join("\n") + "\n"
      );
      await h.writeText(
        "/recon/part2.csv",
        ["tx_id,acct,cents", "t3,A,450", "t4,C,900", "t5,B,700"].join("\n") + "\n"
      );

      const res = await h.exec(
        [
          "csvstack /recon/part1.csv /recon/part2.csv \\",
          "  | csvjson -I \\",
          "  | jq 'group_by(.acct) | map({acct: .[0].acct, n: length, total_cents: (map(.cents | tonumber) | add)}) | sort_by(.acct)' \\",
          "  | in2csv -I -f json \\",
          "  | xan select acct,n,total_cents",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "acct,n,total_cents",
        "A,2,1500",
        "B,2,3000",
        "C,1,900",
      ]);
    });
  });
});
