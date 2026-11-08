import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("sed, awk, and jq advanced program matrix", () => {
  it("1. sed branching (:label, b, t, T) implements iterative comma-grouping and loop termination", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/nums.txt": "1234567\n9876543210\n42\n1000\n",
      },
    });
    const res = await h.exec(
      "sed -E ':loop; s/([0-9])([0-9]{3}(\\b|,))/\\1,\\2/; t loop' /work/nums.txt",
    );
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "1,234,567\n9,876,543,210\n42\n1,000\n");

    const resT = await h.exec(
      "printf 'alpha=1\\nbeta\\ngamma=3\\n' | sed -E 's/=/:/; T skip; s/^/[kv] /; :skip'",
    );
    assert.equal(resT.exitCode, 0);
    assert.equal(resT.stdout, "[kv] alpha:1\nbeta\n[kv] gamma:3\n");
  });

  it("2. sed hold space operations (h, H, g, G, x, z) reverse lines and join paragraphs", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/lines.txt": "first\nsecond\nthird\nfourth\n",
      },
    });
    const rev = await h.exec("sed -n '1!G; h; $p' /work/lines.txt");
    assert.equal(rev.exitCode, 0);
    assert.equal(rev.stdout, "fourth\nthird\nsecond\nfirst\n");

    const zap = await h.exec("printf 'keep\\nwipe\\nlast\\n' | sed '2{h; z; s/^$/<cleared>/; x; G}'");
    assert.equal(zap.exitCode, 0);
    assert.equal(zap.stdout, "keep\nwipe\n<cleared>\nlast\n");
  });

  it("3. sed multiline window (N, P, D) collapses consecutive duplicate lines and sliding 2-line joins", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/ paragraphs.txt": "line1\nline2\nline3\nline4\n",
      },
    });
    const res = await h.exec(
      "printf 'a\\nb\\nc\\nd\\n' | sed 'N; s/\\n/:/; P; D'",
    );
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "a:b\nc:d\n");
  });

  it("4. sed GNU address extensions (0,/re/, first~step, addr,+N, addr,~N) select exact line subsets", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/seq.txt": "1\n2\n3\n4\n5\n6\n7\n8\n",
      },
    });
    const zeroRange = await h.exec("sed '0,/3/s/^/>/' /work/seq.txt");
    assert.equal(zeroRange.exitCode, 0);
    assert.equal(zeroRange.stdout, ">1\n>2\n>3\n4\n5\n6\n7\n8\n");

    const zeroFirstLine = await h.exec("sed '0,/1/s/^/>/' /work/seq.txt");
    assert.equal(zeroFirstLine.exitCode, 0);
    assert.equal(zeroFirstLine.stdout, ">1\n2\n3\n4\n5\n6\n7\n8\n");

    const stepAddr = await h.exec("sed -n '1~3p' /work/seq.txt");
    assert.equal(stepAddr.exitCode, 0);
    assert.equal(stepAddr.stdout, "1\n4\n7\n");

    const plusAddr = await h.exec("sed -n '2,+2p' /work/seq.txt");
    assert.equal(plusAddr.exitCode, 0);
    assert.equal(plusAddr.stdout, "2\n3\n4\n");

    const tildeAddr = await h.exec("sed -n '2,~4p' /work/seq.txt");
    assert.equal(tildeAddr.exitCode, 0);
    assert.equal(tildeAddr.stdout, "2\n3\n4\n");
  });

  it("5. sed file commands (r, w, s///w) and transliteration (y///) with escapes", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/main.txt": "head\ninsert-here\ntail\n",
        "/work/snippet.txt": "  + injected-1\n  + injected-2\n",
      },
    });
    const res = await h.exec(
      "sed -e '/insert-here/r /work/snippet.txt' -e 's/head/HEAD/w /work/matched.txt' -e '3w /work/line3.txt' /work/main.txt",
    );
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "HEAD\ninsert-here\n  + injected-1\n  + injected-2\ntail\n",
    );
    assert.equal(await h.readText("/work/matched.txt"), "HEAD\n");
    assert.equal(await h.readText("/work/line3.txt"), "tail\n");

    const trRes = await h.exec("printf 'a\\tb\\nc\\n' | sed 'y/ab\\t/AB:/'");
    assert.equal(trRes.exitCode, 0);
    assert.equal(trRes.stdout, "A:B\nc\n");
  });

  it("6. sed in-place editing (-i.bak), separate file mode (-s), null-data (-z), and quit status (q/Q)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/f1.txt": "a1\na2\n",
        "/work/f2.txt": "b1\nb2\n",
        "/work/nul.bin": "one\0two\0three\0",
      },
    });
    const sep = await h.exec("sed -n -s '1p; $p' /work/f1.txt /work/f2.txt");
    assert.equal(sep.exitCode, 0);
    assert.equal(sep.stdout, "a1\na2\nb1\nb2\n");

    const inp = await h.exec("sed -i.bak '1s/^/[top] /' /work/f1.txt /work/f2.txt");
    assert.equal(inp.exitCode, 0);
    assert.equal(await h.readText("/work/f1.txt"), "[top] a1\na2\n");
    assert.equal(await h.readText("/work/f2.txt"), "[top] b1\nb2\n");
    assert.equal(await h.readText("/work/f1.txt.bak"), "a1\na2\n");

    const nul = await h.exec("sed -z 's/two/TWO/' /work/nul.bin");
    assert.equal(nul.exitCode, 0);
    assert.equal(nul.stdout, "one\0TWO\0three\0");

    const qRes = await h.exec("printf '1\\n2\\n3\\n' | sed '2q 17'");
    assert.equal(qRes.exitCode, 17);
    assert.equal(qRes.stdout, "1\n2\n");

    const QRes = await h.exec("printf '1\\n2\\n3\\n' | sed '2Q 23'");
    assert.equal(QRes.exitCode, 23);
    assert.equal(QRes.stdout, "1\n");
  });

  it("7. sed l (unambiguous list), = (line number), F (filename), and a/i/c range change commands", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/item.txt": "alpha\nbeta\ngamma\ndelta\n",
      },
    });
    const aic = await h.exec(
      "sed -e '1i HEADER' -e '2,3c REPLACED_2_3' -e '$a FOOTER' /work/item.txt",
    );
    assert.equal(aic.exitCode, 0);
    assert.equal(aic.stdout, "HEADER\nalpha\nREPLACED_2_3\ndelta\nFOOTER\n");

    const meta = await h.exec("sed -n '1{F; =; l}' /work/item.txt");
    assert.equal(meta.exitCode, 0);
    assert.equal(meta.stdout, "/work/item.txt\n1\nalpha$\n");
  });

  it("8. awk associative arrays, multidimensional SUBSEP keys, delete, and 'in' membership", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/sales.tsv": "east\tq1\t10\neast\tq2\t15\nwest\tq1\t20\neast\tq1\t5\nwest\tq2\t99\n",
      },
    });
    const res = await h.exec(`awk 'BEGIN { FS = "\t" }
      {
        grid[$1, $2] += $3
        regions[$1] = 1
      }
      END {
        delete grid["west", "q2"]
        printf "has_west_q2=%d has_east_q1=%d\\n", (("west", "q2") in grid), (("east", "q1") in grid)
        printf "east_q1=%d east_q2=%d west_q1=%d\\n", grid["east", "q1"], grid["east", "q2"], grid["west", "q1"]
        delete regions
        c = 0
        for (k in regions) c++
        printf "regions_after_clear=%d\\n", c
      }
    ' /work/sales.tsv`);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "has_west_q2=0 has_east_q1=1\neast_q1=15 east_q2=15 west_q1=20\nregions_after_clear=0\n",
    );
  });

  it("9. awk user-defined recursive functions with local parameter shadowing and array pass-by-reference", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(`awk '
      function fib(n,    a, b) {
        if (n <= 1) return n
        a = fib(n - 1)
        b = fib(n - 2)
        return a + b
      }
      function push_squares(arr, count,    i) {
        for (i = 1; i <= count; i++) arr[i] = i * i
      }
      BEGIN {
        i = 999
        push_squares(sq, 5)
        printf "fib7=%d sq4=%d sq5=%d outer_i=%d\\n", fib(7), sq[4], sq[5], i
      }
    '`);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "fib7=13 sq4=16 sq5=25 outer_i=999\n");
  });

  it("10. awk string builtins (split, match, RSTART, RLENGTH, sub, gsub, substr, index, tolower, toupper, sprintf)", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(`awk '
      BEGIN {
        s = "Order-2026-ABCD-99"
        n = split(s, parts, "-")
        m = match(s, /[A-Z]{4}/)
        tok = substr(s, RSTART, RLENGTH)
        t = s
        c1 = sub(/[0-9]+/, "YYYY", t)
        c2 = gsub(/-/, "/", t)
        printf "n=%d p2=%s m=%d len=%d tok=%s c1=%d c2=%d t=%s idx=%d\\n",
          n, parts[2], m, RLENGTH, tolower(tok), c1, c2, toupper(t), index(s, "ABCD")
      }
    '`);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "n=4 p2=2026 m=12 len=4 tok=abcd c1=1 c2=3 t=ORDER/YYYY/ABCD/99 idx=12\n",
    );
  });

  it("11. awk getline from external file, close() re-read, main-stream getline, and nextfile", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/lookup.txt": "k1=alpha\nk2=beta\n",
        "/work/a.txt": "a1\nSKIP_REST\na3\n",
        "/work/b.txt": "b1\nb2\n",
      },
    });
    const res = await h.exec(`awk '
      BEGIN {
        while ((getline line < "/work/lookup.txt") > 0) {
          sep = first_pass ? "," : ""; first_pass = first_pass sep line
        }
        close("/work/lookup.txt")
        getline first_again < "/work/lookup.txt"
        close("/work/lookup.txt")
        printf "lookup=%s again=%s\\n", first_pass, first_again
      }
      /SKIP_REST/ { nextfile }
      {
        if ($0 == "b1") {
          getline nxt
          printf "file=%s cur=%s nxt=%s FNR=%d NR=%d\\n", FILENAME, $0, nxt, FNR, NR
        } else {
          printf "file=%s cur=%s FNR=%d NR=%d\\n", FILENAME, $0, FNR, NR
        }
      }
    ' /work/a.txt /work/b.txt`);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "lookup=k1=alpha,k2=beta again=k1=alpha\nfile=/work/a.txt cur=a1 FNR=1 NR=1\nfile=/work/b.txt cur=b1 nxt=b2 FNR=2 NR=4\n",
    );
  });

  it("12. awk -v assignments, between-file operand assignments, and -l ordchr extension", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/f1.txt": "row1\n",
        "/work/f2.txt": "row2\n",
      },
    });
    const res = await h.exec(
      `awk -l ordchr -v tag=init '{ printf "%s:%s:%d:%s\\n", tag, $0, ord("A"), chr(66) }' tag=first /work/f1.txt tag=second /work/f2.txt`,
    );
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "first:row1:65:B\nsecond:row2:65:B\n");
  });

  it("13. awk field mutation recomputes $0 with OFS and assigning $0 recomputes NF and $1..$NF", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(`awk '
      BEGIN {
        OFS = "|"
        $0 = "one   two  three"
        printf "nf1=%d f2=%s\\n", NF, $2
        $2 = "TWO"
        $4 = "FOUR"
        printf "nf2=%d rec=%s\\n", NF, $0
        NF = 2
        printf "nf3=%d rec=%s\\n", NF, $0
      }
    '`);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "nf1=3 f2=two\nnf2=4 rec=one|TWO|three|FOUR\nnf3=2 rec=one|TWO\n",
    );
  });

  it("14. jq reduce and foreach with state accumulation and intermediate emission", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(`jq -n -c '
      {
        sum: (reduce (1, 2, 3, 4, 5) as $x (0; . + $x)),
        running: [foreach (10, 20, 30) as $x (0; . + $x; {step: $x, total: .})],
         histogram: (reduce ("a", "b", "a", "c", "a", "b") as $k ({}; .[$k] += 1))
      }
    '`);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      '{"sum":15,"running":[{"step":10,"total":10},{"step":20,"total":30},{"step":30,"total":60}],"histogram":{"a":3,"b":2,"c":1}}\n',
    );
  });

  it("15. jq path, getpath, setpath, delpaths, and recursive walk transformations", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(`jq -n -c '
      ({a: {b: [10, 20, {c: 30}]}, z: null})
      | setpath(["a", "b", 1]; 99)
      | delpaths([["z"], ["a", "b", 0]])
      | walk(if type == "number" then . * 2 else . end)
      | {tree: ., paths: [paths(scalars)]}
    '`);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      '{"tree":{"a":{"b":[198,{"c":60}]}},"paths":[["a","b",0],["a","b",1,"c"]]}\n',
    );
  });

  it("16. jq --stream event extraction and recurse tree traversal on nested JSON structures", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/doc.json": '{"users":[{"name":"ada","roles":["admin","dev"]},{"name":"bob","roles":["user"]}]}\n',
      },
    });
    const res = await h.exec(
      `jq -c 'select(length == 2) | {path: .[0], leaf: .[1]}' --stream /work/doc.json`,
    );
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        '{"path":["users",0,"name"],"leaf":"ada"}',
        '{"path":["users",0,"roles",0],"leaf":"admin"}',
        '{"path":["users",0,"roles",1],"leaf":"dev"}',
        '{"path":["users",1,"name"],"leaf":"bob"}',
        '{"path":["users",1,"roles",0],"leaf":"user"}',
        "",
      ].join("\n"),
    );
  });

  it("17. jq try/catch error handling, custom error(), and label/break early exit", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(`jq -n -c '
      def check($x):
        if $x < 0 then error({code: "NEG", val: $x}) else $x * 10 end;
      {
        caught: [1, -5, 3 | try check(.) catch "err:\\(.code):\\(.val)"],
        broken: [label $out | foreach (1, 2, 3, 4, 5) as $n (0; . + $n; if . > 5 then ., break $out else . end)]
      }
    '`);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      '{"caught":[10,"err:NEG:-5",30],"broken":[1,3,6]}\n',
    );
  });

  it("18. jq recursive def functions, closures (filter arguments), and destructuring bindings", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(`jq -n -c '
      def map_by(f): [.[] | f];
      def flatten_tree:
        recurse(.children[]?) | .id;
      ({id: "root", children: [{id: "c1", children: [{id: "c1a"}]}, {id: "c2"}]}) as $tree
      | ({pt: [3, 4], meta: {label: "origin"}}) as {pt: [$x, $y], meta: {label: $lbl}}
      | {
          nodes: [$tree | flatten_tree],
          mapped: ([1, 2, 3] | map_by(. * .)),
          destructured: "\\($lbl):\\($x + $y)"
        }
    '`);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      '{"nodes":["root","c1","c1a","c2"],"mapped":[1,4,9],"destructured":"origin:7"}\n',
    );
  });

  it("19. jq --arg, --argjson, --rawfile, --slurpfile, --args, and $ARGS variable bindings", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/raw.txt": "line-one\nline-two",
        "/work/items.jsonl": '{"k":"a","v":1}\n{"k":"b","v":2}\n',
      },
    });
    const res = await h.exec(
      `jq -n -c --arg env "prod" --argjson count 42 --rawfile raw /work/raw.txt --slurpfile items /work/items.jsonl '{env: $env, count: $count, raw: $raw, items: $items, pos: $ARGS.positional}' --args p1 p2`,
    );
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      '{"env":"prod","count":42,"raw":"line-one\\nline-two","items":[{"k":"a","v":1},{"k":"b","v":2}],"pos":["p1","p2"]}\n',
    );
  });

  it("20. end-to-end sed -> awk -> jq pipeline transforming raw log streams into structured analytics", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/access.log": [
          "[2026-10-04] svc=auth status=200 ms=12",
          "# comment line to strip",
          "[2026-10-04] svc=api status=500 ms=140",
          "[2026-10-04] svc=auth status=200 ms=18",
          "[2026-10-04] svc=api status=200 ms=40",
          "",
        ].join("\n"),
      },
    });
    const res = await h.exec(`
      sed -E -e '/^#/d' -e 's/^\\[[0-9-]+\\] svc=([a-z]+) status=([0-9]+) ms=([0-9]+)$/\\1:\\2:\\3/' /work/access.log \\
        | awk -F: '{
            cnt[$1]++
            ms[$1] += $3
            if ($2 >= 500) err[$1]++
          }
          END {
            for (s in cnt) {
              printf "{\\"svc\\":\\"%s\\",\\"count\\":%d,\\"total_ms\\":%d,\\"errors\\":%d}\\n", s, cnt[s], ms[s], err[s] + 0
            }
          }' \\
        | jq -s -c 'sort_by(.svc) | map(. + {avg_ms: (.total_ms / .count)})'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      '[{"svc":"api","count":2,"total_ms":180,"errors":1,"avg_ms":90},{"svc":"auth","count":2,"total_ms":30,"errors":0,"avg_ms":15}]\n',
    );
  });
});
