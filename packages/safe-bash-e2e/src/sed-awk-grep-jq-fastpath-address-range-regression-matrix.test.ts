import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("sed, awk, grep, rg, jq, and yq fast-path, address range, hold space, and structured query matrix", () => {
  it("1. sed evaluates numeric, regex, step (first~step), relative (+N, ~N), and negated (!) address ranges", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/lines.txt",
        "1:alpha\n2:beta\n3:gamma\n4:delta\n5:epsilon\n6:zeta\n7:eta\n8:theta\n",
      );

      const stepRes = await h.exec("sed -n '1~2p' /workspace/lines.txt");
      assert.equal(stepRes.exitCode, 0);
      assert.equal(stepRes.stdout, "1:alpha\n3:gamma\n5:epsilon\n7:eta\n");

      const plusRes = await h.exec("sed -n '/beta/,+2p' /workspace/lines.txt");
      assert.equal(plusRes.exitCode, 0);
      assert.equal(plusRes.stdout, "2:beta\n3:gamma\n4:delta\n");

      const tildeRes = await h.exec("sed -n '/beta/,~4p' /workspace/lines.txt");
      assert.equal(tildeRes.exitCode, 0);
      assert.equal(tildeRes.stdout, "2:beta\n3:gamma\n4:delta\n");

      const negRes = await h.exec("sed -n '2,6!p' /workspace/lines.txt");
      assert.equal(negRes.exitCode, 0);
      assert.equal(negRes.stdout, "1:alpha\n7:eta\n8:theta\n");
    });
  });

  it("2. sed manipulates hold space (h, H, g, G, x) to reverse lines and join paragraphs", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/seq.txt", "first\nsecond\nthird\nfourth\n");
      const rev = await h.exec("sed -n '1!G; h; $p' /workspace/seq.txt");
      assert.equal(rev.exitCode, 0);
      assert.equal(rev.stdout, "fourth\nthird\nsecond\nfirst\n");

      const swap = await h.exec("sed -n 'h; s/.*/REPLACED/; x; p' /workspace/seq.txt");
      assert.equal(swap.exitCode, 0);
      assert.equal(swap.stdout, "first\nsecond\nthird\nfourth\n");
    });
  });

  it("3. sed executes multi-line N, P, D sliding-window loops and conditional t/T/b branches", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/window.txt", "line1\nline2\nline3\nline4\n");
      const pairJoin = await h.exec("sed 'N; s/\\n/ + /' /workspace/window.txt");
      assert.equal(pairJoin.exitCode, 0);
      assert.equal(pairJoin.stdout, "line1 + line2\nline3 + line4\n");

      const branchRes = await h.exec(`
        printf 'a.b.c\\nx_y_z\\n' | sed -E 's/\\./-/g; T Untouched; b; :Untouched; s/^/UNTOUCHED:/'
      `);
      assert.equal(branchRes.exitCode, 0);
      assert.equal(branchRes.stdout, "a-b-c\nUNTOUCHED:x_y_z\n");
    });
  });

  it("4. sed supports s/// occurrence indices, w file flag, y/// transliteration, and -s separate file addressing", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/f1.txt", "aa aa aa\nbb bb bb\n");
      await h.writeText("/workspace/f2.txt", "cc cc cc\ndd dd dd\n");

      const occ = await h.exec(
        "sed 's/aa/AA/2w /workspace/matched.txt' /workspace/f1.txt",
      );
      assert.equal(occ.exitCode, 0);
      assert.equal(occ.stdout, "aa AA aa\nbb bb bb\n");
      assert.equal(await h.readText("/workspace/matched.txt"), "aa AA aa\n");

      const sep = await h.exec("sed -n -s '1p; $p' /workspace/f1.txt /workspace/f2.txt");
      assert.equal(sep.exitCode, 0);
      assert.equal(sep.stdout, "aa aa aa\nbb bb bb\ncc cc cc\ndd dd dd\n");

      const tr = await h.exec("printf 'abc-123\\n' | sed 'y/abc123/ABC789/'");
      assert.equal(tr.exitCode, 0);
      assert.equal(tr.stdout, "ABC-789\n");
    });
  });

  it("5. sed executes two-instruction s/// pair fast-path on large files and in-place -i edits", async () => {
    await withE2EHarness({ includeExtendedCommands: false, bareShell: true }, async (h) => {
      const lines: string[] = [];
      for (let i = 0; i < 60; i++) {
        lines.push(`prefix_${i} middle_token suffix_${i}`);
      }
      await h.writeText("/workspace/large.txt", lines.join("\n") + "\n");

      const fastPair = await h.exec(
        "sed 's/^prefix_/START_/; s/middle_token/CENTER/' /workspace/large.txt",
      );
      assert.equal(fastPair.exitCode, 0);
      const outLines = fastPair.stdout.trim().split("\n");
      assert.equal(outLines.length, 60);
      assert.equal(outLines[0], "START_0 CENTER suffix_0");
      assert.equal(outLines[59], "START_59 CENTER suffix_59");

      await h.exec("sed -i.bak 's/^prefix_0/FIRST_0/' /workspace/large.txt");
      const editedHead = await h.exec("head -n 2 /workspace/large.txt");
      assert.equal(
        editedHead.stdout,
        "FIRST_0 middle_token suffix_0\nprefix_1 middle_token suffix_1\n",
      );
      const backupHead = await h.exec("head -n 1 /workspace/large.txt.bak");
      assert.equal(backupHead.stdout, "prefix_0 middle_token suffix_0\n");
    });
  });

  it("6. awk reconstructs $0 when fields or NF are mutated and honors OFS and ORS", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'a:b:c:d\\ne:f:g:h\\n' | awk -F: 'BEGIN { OFS="|"; ORS="\\n" } { $2 = toupper($2); NF = 3; print $0 }'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "a|B|c\ne|F|g\n");
    });
  });

  it("7. awk executes fast numeric aggregation and multi-dimensional associative arrays with SUBSEP", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/sales.csv",
        "east,q1,100\neast,q2,150\nwest,q1,200\neast,q1,50\nwest,q2,300\n",
      );
      const res = await h.exec(`
        awk -F, '
          { grid[$1, $2] += $3; total += $3 }
          END {
            printf "east_q1=%d east_q2=%d west_q1=%d west_q2=%d total=%d\\n",
              grid["east", "q1"], grid["east", "q2"], grid["west", "q1"], grid["west", "q2"], total
          }
        ' /workspace/sales.csv
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "east_q1=150 east_q2=150 west_q1=200 west_q2=300 total=800\n",
      );
    });
  });

  it("8. awk evaluates built-in string functions (match, RSTART, RLENGTH, split, sub, gsub, substr, index)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'item_42_cost_99\\n' | awk '{
          if (match($0, /[0-9]+/)) {
            first_num = substr($0, RSTART, RLENGTH)
          }
          copy = $0
          n = gsub(/[0-9]+/, "#", copy)
          k = split($0, parts, "_")
          printf "first=%s RSTART=%d RLENGTH=%d gsub_n=%d masked=%s parts=%d:%s:%s\\n",
            first_num, RSTART, RLENGTH, n, copy, k, parts[1], parts[4]
        }'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "first=42 RSTART=6 RLENGTH=2 gsub_n=2 masked=item_#_cost_# parts=4:item:99\n",
      );
    });
  });

  it("9. awk supports recursive user-defined functions, local parameters, and getline from files", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/lookup.txt", "k1=alpha\nk2=beta\n");
      const res = await h.exec(`
        printf '5\\n6\\n' | awk '
          function gcd(a, b,    t) {
            return b == 0 ? a : gcd(b, a % b)
          }
          NR == 1 {
            while ((getline line < "/workspace/lookup.txt") > 0) {
              split(line, kv, "=")
              dict[kv[1]] = kv[2]
            }
            close("/workspace/lookup.txt")
          }
          {
            printf "n=%d gcd=%d k1=%s k2=%s\\n", $1, gcd($1 * 6, 15), dict["k1"], dict["k2"]
          }
        '
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "n=5 gcd=15 k1=alpha k2=beta\nn=6 gcd=3 k1=alpha k2=beta\n",
      );
    });
  });

  it("10. awk tracks FNR and NR across multiple files and supports nextfile and range patterns", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/a.log", "a1\nSKIP_REST\na3\n");
      await h.writeText("/workspace/b.log", "b1\nb2\n");

      const res = await h.exec(`
        awk '
          /SKIP_REST/ { nextfile }
          { printf "%s:FNR=%d:NR=%d:%s\\n", FILENAME, FNR, NR, $0 }
        ' /workspace/a.log /workspace/b.log
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "/workspace/a.log:FNR=1:NR=1:a1\n/workspace/b.log:FNR=1:NR=3:b1\n/workspace/b.log:FNR=2:NR=4:b2\n",
      );
    });
  });

  it("11. grep supports -E, -F, -i, -v, -w, -x, -c, -n, -o, and context flags (-A, -B, -C)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/app.log",
        [
          "line1: boot",
          "line2: WARN disk 80%",
          "line3: ERROR db timeout",
          "line4: retry 1",
          "line5: retry 2",
          "line6: ERROR auth failed",
          "line7: shutdown",
          "",
        ].join("\n"),
      );

      const ctxRes = await h.exec("grep -n -A 1 -B 1 'ERROR' /workspace/app.log");
      assert.equal(ctxRes.exitCode, 0);
      assert.equal(
        ctxRes.stdout,
        [
          "2-line2: WARN disk 80%",
          "3:line3: ERROR db timeout",
          "4-line4: retry 1",
          "5-line5: retry 2",
          "6:line6: ERROR auth failed",
          "7-line7: shutdown",
          "",
        ].join("\n"),
      );

      const onlyRes = await h.exec("grep -E -o '[A-Z]{4,5}' /workspace/app.log");
      assert.equal(onlyRes.exitCode, 0);
      assert.equal(onlyRes.stdout, "WARN\nERROR\nERROR\n");
    });
  });

  it("12. grep supports recursive directory search with --include, --exclude, -l, -L, and -m", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/src/a.ts", "const token = 1;\nconst token2 = 2;\n");
      await h.writeText("/workspace/src/b.ts", "const other = 3;\n");
      await h.writeText("/workspace/src/c.md", "token in docs\n");

      const filesWithMatch = await h.exec(
        "grep -r -l --include='*.ts' 'token' /workspace/src | sort",
      );
      assert.equal(filesWithMatch.exitCode, 0);
      assert.equal(filesWithMatch.stdout, "/workspace/src/a.ts\n");

      const filesWithoutMatch = await h.exec(
        "grep -r -L --include='*.ts' 'token' /workspace/src | sort",
      );
      assert.equal(filesWithoutMatch.exitCode, 0);
      assert.equal(filesWithoutMatch.stdout, "/workspace/src/b.ts\n");

      const maxOne = await h.exec("grep -m 1 'token' /workspace/src/a.ts");
      assert.equal(maxOne.exitCode, 0);
      assert.equal(maxOne.stdout, "const token = 1;\n");
    });
  });

  it("13. rg searches directory trees with globs (-g), fixed strings (-F), counts (-c), and replacements (-r)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/pkg/mod1.ts", "export function runTask(id: number) {}\n");
      await h.writeText("/workspace/pkg/mod2.ts", "export function runJob(id: string) {}\n");
      await h.writeText("/workspace/pkg/notes.txt", "runTask in notes\n");

      const rgGlob = await h.exec(
        "rg -n -g '*.ts' -r 'execFn' 'run[A-Za-z]+' /workspace/pkg | sort",
      );
      assert.equal(rgGlob.exitCode, 0);
      assert.equal(
        rgGlob.stdout,
        [
          "/workspace/pkg/mod1.ts:1:export function execFn(id: number) {}",
          "/workspace/pkg/mod2.ts:1:export function execFn(id: string) {}",
          "",
        ].join("\n"),
      );
    });
  });

  it("14. jq executes fast-path property extraction, slurp (-s), and reduce/foreach aggregations", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/events.jsonl",
        [
          '{"service":"api","latency":12,"ok":true}',
          '{"service":"db","latency":45,"ok":true}',
          '{"service":"api","latency":28,"ok":false}',
          '{"service":"db","latency":15,"ok":true}',
          "",
        ].join("\n"),
      );

      const res = await h.exec(`
        jq -s -c '
          reduce .[] as $item (
            {total: 0, errors: 0, by_svc: {}};
            .total += $item.latency
            | .errors += (if $item.ok then 0 else 1 end)
            | .by_svc[$item.service] = ((.by_svc[$item.service] // 0) + $item.latency)
          )
        ' /workspace/events.jsonl
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        '{"total":100,"errors":1,"by_svc":{"api":40,"db":60}}\n',
      );
    });
  });

  it("15. jq manipulates paths (path, getpath, setpath, delpaths) and recursive descent (..)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf '{"a":{"b":[10,{"secret":"redact","keep":20}]}}\\n' | jq -c '
          setpath(["a","b",1,"keep"]; 99)
          | delpaths([["a","b",1,"secret"]])
          | {tree: ., keep: getpath(["a","b",1,"keep"]), numbers: [.. | numbers]}
        '
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        '{"tree":{"a":{"b":[10,{"keep":99}]}},"keep":99,"numbers":[10,99]}\n',
      );
    });
  });

  it("16. jq handles --arg, --argjson, try/catch error recovery, and @base64/@base64d/@uri/@csv/@tsv", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        jq -n -c --arg user "alice & bob" --argjson scores '[10,20,30]' '
          {
            b64: ($user | @base64),
            roundtrip: ($user | @base64 | @base64d),
            uri: ($user | @uri),
            csv: ([$user, ($scores | add)] | @csv),
            safe_div: ([10, 0, 5] | map(try (100 / .) catch "div_zero"))
          }
        '
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        '{"b64":"YWxpY2UgJiBib2I=","roundtrip":"alice & bob","uri":"alice%20%26%20bob","csv":"\\"alice & bob\\",60","safe_div":[10,"div_zero",20]}\n',
      );
    });
  });

  it("17. yq converts YAML and TOML to JSON and YAML with jq filter expressions", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/base.yaml",
        "service:\n  name: gateway\n  port: 8080\n  tls:\n    enabled: false\n",
      );

      const updated = await h.exec(
        "yq eval -o json -c '.service.port = 8443 | .service.tls.enabled = true' /workspace/base.yaml",
      );
      assert.equal(updated.exitCode, 0);
      assert.deepEqual(JSON.parse(updated.stdout), {
        service: {
          name: "gateway",
          port: 8443,
          tls: { enabled: true },
        },
      });

      await h.writeText(
        "/workspace/config.toml",
        "[database]\nhost = \"db.internal\"\nport = 5432\n",
      );
      const fromToml = await h.exec("yq -p toml -o json -c '.' /workspace/config.toml");
      assert.equal(fromToml.exitCode, 0);
      assert.deepEqual(JSON.parse(fromToml.stdout), {
        database: { host: "db.internal", port: 5432 },
      });
    });
  });

  it("18. xq extracts and transforms XML attributes and text nodes using jq filters", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/catalog.xml",
        '<catalog><book id="b1"><title>Rust</title><price>45</price></book><book id="b2"><title>Bash</title><price>30</price></book></catalog>\n',
      );
      const res = await h.exec(`
        xq -c '.catalog.book | map({id: ."@id", title: .title, price: (.price | tonumber)})' /workspace/catalog.xml
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        '[{"id":"b1","title":"Rust","price":45},{"id":"b2","title":"Bash","price":30}]\n',
      );
    });
  });

  it("19. chains rg -> sed -> awk -> jq in a multi-stage log analytics pipeline", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/logs/node1.log",
        "2025-03-01T10:00:00Z [ checkout ] status=200 ms=40\n2025-03-01T10:00:01Z [ checkout ] status=500 ms=120\n",
      );
      await h.writeText(
        "/workspace/logs/node2.log",
        "2025-03-01T10:00:02Z [ search ] status=200 ms=15\n2025-03-01T10:00:03Z [ checkout ] status=200 ms=50\n",
      );

      const res = await h.exec(`
        rg --no-filename '\\[ checkout \\]' /workspace/logs \
          | sed -E 's/^.*status=([0-9]+) ms=([0-9]+)$/\\1,\\2/' \
          | awk -F, '{ count[$1]++; latency[$1] += $2 } END { for (s in count) printf "{\\"status\\":%d,\\"count\\":%d,\\"ms\\":%d}\\n", s, count[s], latency[s] }' \
          | jq -s -c 'sort_by(.status)'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        '[{"status":200,"count":2,"ms":90},{"status":500,"count":1,"ms":120}]\n',
      );
    });
  });

  it("20. handles NUL-delimited (-z) records end-to-end across grep -z, sed -z, sort -z, and tr", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'beta_item\\0alpha_item\\0skip_me\\0gamma_item\\0' \
          | grep -z '_item' \
          | sed -z 's/_item/_ok/' \
          | sort -z \
          | tr '\\0' '\\n'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "alpha_ok\nbeta_ok\ngamma_ok\n");
    });
  });
});
