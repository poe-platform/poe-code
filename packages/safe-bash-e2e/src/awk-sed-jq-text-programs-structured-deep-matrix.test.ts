import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("safe-bash e2e: awk, sed, and jq deep text-programs & structured matrix", () => {
  it("1. awk BEGIN/END with multi-file FNR vs NR and FILENAME transitions", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/work/f1.txt", "alpha 10\nbeta 20\n");
      await h.writeText("/work/f2.txt", "gamma 30\ndelta 40\nepsilon 50\n");
      const res = await h.exec(
        `awk 'BEGIN { total = 0 } FNR == 1 { files++ } { total += $2; printf "%s:%d:%d:%s\\n", FILENAME, FNR, NR, $1 } END { printf "SUMMARY:%d:%d:%d\\n", files, NR, total }' /work/f1.txt /work/f2.txt`,
      );
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "/work/f1.txt:1:1:alpha",
        "/work/f1.txt:2:2:beta",
        "/work/f2.txt:1:3:gamma",
        "/work/f2.txt:2:4:delta",
        "/work/f2.txt:3:5:epsilon",
        "SUMMARY:2:5:150",
      ]);
    });
  });

  it("2. awk associative arrays, multi-dimensional SUBSEP keys, and delete", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/work/sales.csv",
        "east,q1,100\neast,q2,150\nwest,q1,200\neast,q1,50\ndrop,q1,999\n",
      );
      const res = await h.exec(
        `awk -F, '{ grid[$1, $2] += $3; regions[$1] = 1 } END { delete grid["drop", "q1"]; delete regions["drop"]; for (r in regions) { printf "%s:q1=%d,q2=%d\\n", r, grid[r, "q1"], grid[r, "q2"] } }' /work/sales.csv | sort`,
      );
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "east:q1=150,q2=150",
        "west:q1=200,q2=0",
      ]);
    });
  });

  it("3. awk split, sub, gsub, match, substr, index, tolower, and toupper", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `printf '  Foo-Bar_Baz:123:456  \\n' | awk '{
          gsub(/^ +| +$/, "", $0);
          n = split($0, parts, ":");
          head = parts[1];
          sub(/_/, "-", head);
          if (match(head, /-[A-Za-z]+-/)) {
            mid = substr(head, RSTART + 1, RLENGTH - 2);
          }
          printf "n=%d head=%s mid=%s idx=%d sum=%d\\n", n, tolower(head), toupper(mid), index(head, "Baz"), parts[2] + parts[3]
        }'`,
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "n=3 head=foo-bar-baz mid=BAR idx=9 sum=579");
    });
  });

  it("4. awk user-defined recursive and iterative functions with local parameters", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `awk '
          function gcd(a, b) {
            return b == 0 ? a : gcd(b, a % b)
          }
          function fact(n, acc) {
            return n <= 1 ? acc : fact(n - 1, n * acc)
          }
          BEGIN {
            printf "gcd=%d fact=%d\\n", gcd(1071, 462), fact(6, 1)
          }
        '`,
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "gcd=21 fact=720");
    });
  });

  it("5. awk range patterns (/start/,/end/), next, and custom OFS/ORS", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/work/log.txt",
        "IGNORE 0\nBEGIN_SEC\nrow a 1\nSKIP_ME\nrow b 2\nEND_SEC\noutside 9\nBEGIN_SEC\nrow c 3\nEND_SEC\n",
      );
      const res = await h.exec(
        `awk 'BEGIN { OFS = "|"; ORS = ";\\n" } /BEGIN_SEC/,/END_SEC/ { if ($1 == "BEGIN_SEC" || $1 == "END_SEC" || $1 == "SKIP_ME") next; print $1, $2, $3 }' /work/log.txt`,
      );
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "row|a|1;",
        "row|b|2;",
        "row|c|3;",
      ]);
    });
  });

  it("6. awk getline from file and variable assignment via -v", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/work/lookup.txt", "k1=alpha\nk2=beta\nk3=gamma\n");
      await h.writeText("/work/keys.txt", "k2\nk1\nk3\n");
      const res = await h.exec(
        `awk -v prefix="ITEM" 'BEGIN { while ((getline line < "/work/lookup.txt") > 0) { split(line, kv, "="); map[kv[1]] = kv[2] } } { printf "%s:%s=%s\\n", prefix, $1, map[$1] }' /work/keys.txt`,
      );
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "ITEM:k2=beta",
        "ITEM:k1=alpha",
        "ITEM:k3=gamma",
      ]);
    });
  });

  it("7. awk field mutation ($2 = ...), NF recalculation, and $0 reconstruction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `printf 'a b c\\nd e f\\n' | awk 'BEGIN { OFS = ":" } { $2 = toupper($2); $4 = NR * 10; print NF, $0 }'`,
      );
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "4:a:B:c:10",
        "4:d:E:f:20",
      ]);
    });
  });

  it("8. sed address ranges, step addresses (1~2), last line ($), and negation (!)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/work/nums.txt", "1\n2\n3\n4\n5\n6\n");
      const oddRes = await h.exec(`sed -n '1~2p' /work/nums.txt`);
      assert.equal(oddRes.exitCode, 0);
      assert.deepEqual(oddRes.stdout.trim().split("\n"), ["1", "3", "5"]);

      const notRangeRes = await h.exec(`sed '2,5!s/^/EDGE:/' /work/nums.txt`);
      assert.equal(notRangeRes.exitCode, 0);
      assert.deepEqual(notRangeRes.stdout.trim().split("\n"), [
        "EDGE:1",
        "2",
        "3",
        "4",
        "5",
        "EDGE:6",
      ]);

      const lastRes = await h.exec(`sed '$s/6/LAST/' /work/nums.txt`);
      assert.equal(lastRes.exitCode, 0);
      assert.equal(lastRes.stdout.trim().split("\n").at(-1), "LAST");
    });
  });

  it("9. sed hold space operations (h, H, g, G, x) reversing lines and accumulating blocks", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/work/three.txt", "first\nsecond\nthird\n");
      const rev = await h.exec(`sed -n '1!G;h;$p' /work/three.txt`);
      assert.equal(rev.exitCode, 0);
      assert.deepEqual(rev.stdout.trim().split("\n"), ["third", "second", "first"]);
    });
  });

  it("10. sed branching (:label, b, t) and loop-based recursive substitution", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `printf '1234567890\\n9876543\\n' | sed -E ':loop; s/([0-9]+)([0-9]{3}(\\b|,))/\\1,\\2/; t loop'`,
      );
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "1,234,567,890",
        "9,876,543",
      ]);
    });
  });

  it("11. sed multi-line pattern space (N, P, D) joining continuation lines", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/work/cont.txt",
        "alpha \\\n  beta \\\n  gamma\nsingle\ndelta \\\n  epsilon\n",
      );
      const res = await h.exec(
        `sed ':a; /\\\\$/ { N; s/[ ]*\\\\\\n[ ]*/ /; ba }' /work/cont.txt`,
      );
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "alpha beta gamma",
        "single",
        "delta epsilon",
      ]);
    });
  });

  it("12. sed transliteration (y///), insert/append/change (i, a, c), and occurrence flags", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/work/items.txt", "aa bb aa bb aa\nmiddle\nlast\n");
      const res = await h.exec(
        `sed -e '1s/aa/AA/2' -e '2c\\REPLACED_MIDDLE' -e '3y/last/LAST/' /work/items.txt`,
      );
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "aa bb AA bb aa",
        "REPLACED_MIDDLE",
        "LAST",
      ]);
    });
  });

  it("13. sed in-place editing (-i and -i.bak) across multiple files", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/work/a.cfg", "port=8080\nhost=localhost\n");
      await h.writeText("/work/b.cfg", "port=8080\nhost=0.0.0.0\n");
      const res = await h.exec(`sed -i.bak 's/8080/9090/' /work/a.cfg /work/b.cfg`);
      assert.equal(res.exitCode, 0);

      const check = await h.exec(`cat /work/a.cfg /work/b.cfg /work/a.cfg.bak`);
      assert.deepEqual(check.stdout.trim().split("\n"), [
        "port=9090",
        "host=localhost",
        "port=9090",
        "host=0.0.0.0",
        "port=8080",
        "host=localhost",
      ]);
    });
  });

  it("14. jq reduce and foreach for cumulative state machines", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `jq -nc '[1, 2, 3, 4, 5] | {
          sum: (reduce .[] as $x (0; . + $x)),
          running: [foreach .[] as $x (0; . + $x; . * 10)]
        }'`,
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), `{"sum":15,"running":[10,30,60,100,150]}`);
    });
  });

  it("15. jq user-defined higher-order functions (def), walk, and recursive descent (..)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/work/tree.json",
        JSON.stringify({
          name: "root",
          val: 1,
          children: [
            { name: "left", val: 2, children: [{ name: "ll", val: 4, children: [] }] },
            { name: "right", val: 3, children: [] },
          ],
        }),
      );
      const res = await h.exec(
        `jq -c 'def sum_by(f): [.. | objects | f] | add; { total: sum_by(.val), names: [.. | objects | .name] }' /work/tree.json`,
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), `{"total":10,"names":["root","left","ll","right"]}`);
    });
  });

  it("16. jq paths, getpath, setpath, and delpaths structural editing", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `jq -nc '{"a":{"b":1,"c":2},"d":[10,20]} | setpath(["a","b"]; 99) | delpaths([["a","c"]]) | { updated: ., d1: getpath(["d", 1]), leaf_paths: [paths(scalars)] }'`,
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        `{"updated":{"a":{"b":99},"d":[10,20]},"d1":20,"leaf_paths":[["a","b"],["d",0],["d",1]]}`,
      );
    });
  });

  it("17. jq group_by, unique_by, sort_by, min_by, max_by, and bsearch", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/work/events.json",
        JSON.stringify([
          { team: "red", score: 15, user: "u1" },
          { team: "blue", score: 30, user: "u2" },
          { team: "red", score: 25, user: "u3" },
          { team: "blue", score: 10, user: "u2" },
        ]),
      );
      const res = await h.exec(
        `jq -c '{
          by_team: (group_by(.team) | map({ team: .[0].team, total: (map(.score) | add) })),
          unique_users: (unique_by(.user) | map(.user)),
          top: (max_by(.score).user),
          found_idx: ([10, 20, 30, 40] | bsearch(30))
        }' /work/events.json`,
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        `{"by_team":[{"team":"blue","total":40},{"team":"red","total":40}],"unique_users":["u1","u2","u3"],"top":"u2","found_idx":2}`,
      );
    });
  });

  it("18. jq format strings (@base64, @base64d, @uri, @csv, @tsv, @json)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `jq -nc '{
          b64: ("hello world" | @base64),
          rt: ("hello world" | @base64 | @base64d),
          uri: ("a b+c/d" | @uri),
          csv: (["a,b", "c\\"d", 42] | @csv),
          tsv: (["x\\ty", "z", 7] | @tsv)
        }'`,
      );
      assert.equal(res.exitCode, 0);
      const parsed = JSON.parse(res.stdout.trim());
      assert.equal(parsed.b64, "aGVsbG8gd29ybGQ=");
      assert.equal(parsed.rt, "hello world");
      assert.equal(parsed.uri, "a%20b%2Bc%2Fd");
      assert.equal(parsed.csv, `"a,b","c""d",42`);
      assert.equal(parsed.tsv, `x\\ty\tz\t7`);
    });
  });

  it("19. jq --arg, --argjson, --slurp (-s), --raw-input (-R), and try/catch (?)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/work/raw.txt", `{"ok":10}\nNOT_JSON\n{"ok":20}\n`);
      const res = await h.exec(
        `jq -R -s -c --arg env "prod" --argjson mult 3 '[split("\\n")[] | select(length > 0) | try (fromjson | .ok * $mult) catch "err"] | { env: $env, vals: . }' /work/raw.txt`,
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), `{"env":"prod","vals":[30,"err",60]}`);
    });
  });

  it("20. combined awk -> sed -> jq multi-stage log analytics pipeline", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/work/access.log",
        [
          "2026-10-04T10:00:01Z GET /api/v1/users 200 12ms",
          "2026-10-04T10:00:02Z POST /api/v1/users 201 45ms",
          "2026-10-04T10:00:03Z GET /api/v1/orders 500 130ms",
          "2026-10-04T10:00:04Z GET /api/v1/users 200 18ms",
          "2026-10-04T10:00:05Z GET /api/v1/orders 200 22ms",
        ].join("\n") + "\n",
      );
      const res = await h.exec(
        `sed -E 's/([0-9]+)ms$/\\1/' /work/access.log | awk '{ printf "{\\"method\\":\\"%s\\",\\"path\\":\\"%s\\",\\"status\\":%d,\\"ms\\":%d}\\n", $2, $3, $4, $5 }' | jq -s -c 'group_by(.path) | map({ path: .[0].path, count: length, avg_ms: ((map(.ms) | add) / length), errors: (map(select(.status >= 500)) | length) })'`,
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        `[{"path":"/api/v1/orders","count":2,"avg_ms":76,"errors":1},{"path":"/api/v1/users","count":3,"avg_ms":25,"errors":0}]`,
      );
    });
  });
});
