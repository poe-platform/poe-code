import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

function buildDataTxt(rows = 200): string {
  return Array.from(
    { length: rows },
    (_, i) =>
      `${i % 3 === 0 ? "alpha" : i % 3 === 1 ? "beta" : "gamma"}:val_${String((i * 17) % 97).padStart(2, "0")}:${i}\n`,
  ).join("");
}

function buildItemsJsonl(rows = 120): string {
  return Array.from(
    { length: rows },
    (_, i) =>
      `{"id":${i},"active":${i % 2 === 0},"score":${(i * 7) % 100},"tag":"t_${i % 10}"}\n`,
  ).join("");
}

describe("safe-bash e2e: synchronous fast-path shell, loop, redirect, and pipeline matrix", () => {
  it("1. executes integer-register brace-range for loops across ascending, stepped, descending, and negative ranges on warm shell", async () => {
    await withE2EHarness({ bareShell: true }, async (h) => {
      const script = [
        "acc=0; i=0; for i in {1..500}; do acc=$((acc + i)); done",
        "step_acc=0; for k in {1..200..3}; do step_acc=$((step_acc + k)); done",
        "desc_acc=0; for m in {100..1..-4}; do desc_acc=$((desc_acc + m)); done",
        "neg_acc=0; for n in {-25..25}; do neg_acc=$((neg_acc + n * n)); done",
        'echo "$acc:$step_acc:$desc_acc:$neg_acc:$i:$k:$m:$n"',
      ].join("\n");

      // Run 3 times to exercise first parse, warm parse cache, and tryRunCachedSyncForScript
      const r1 = await h.expectOk(script);
      const r2 = await h.expectOk(script);
      const r3 = await h.expectOk(script);

      assert.equal(r1.stdout, "125250:6700:1300:11050:500:199:4:25\n");
      assert.equal(r2.stdout, r1.stdout);
      assert.equal(r3.stdout, r1.stdout);
    });
  });

  it("2. executes C-style arithmetic for ((...)) loops with compound updates, bitwise ops, ternary, break, and continue", async () => {
    await withE2EHarness({ bareShell: true }, async (h) => {
      const script = [
        "sum=0; mask=0",
        "for ((i = 1; i <= 250; i++)); do",
        "  if (( i % 7 == 0 )); then continue; fi",
        "  if (( i > 180 )); then break; fi",
        "  sum=$((sum + (i & 1 ? i * 2 : i / 2)))",
        "  mask=$(((mask ^ (i * 13)) & 65535))",
        "done",
        'echo "$sum:$mask:$i"',
      ].join("\n");

      const warmRes = await h.expectOk(script);
      const warmRes2 = await h.expectOk(script);
      assert.equal(warmRes.stdout, warmRes2.stdout);

      await withE2EHarness({ shellExtensions: true }, async (asyncH) => {
        const slowRes = await asyncH.expectOk(script);
        assert.equal(warmRes.stdout, slowRes.stdout);
      });
    });
  });

  it("3. executes while and until arithmetic loops for Collatz stopping times and Euclidean GCD/LCM", async () => {
    await withE2EHarness({ bareShell: true }, async (h) => {
      const script = [
        "n=27; steps=0; peak=27",
        "while (( n > 1 )); do",
        "  if (( (n & 1) == 0 )); then n=$((n >> 1)); else n=$((3 * n + 1)); fi",
        "  if (( n > peak )); then peak=$n; fi",
        "  steps=$((steps + 1))",
        "done",
        "a=1071; b=462",
        "until (( b == 0 )); do",
        "  t=$((a % b)); a=$b; b=$t",
        "done",
        'echo "collatz=$steps:$peak gcd=$a"',
      ].join("\n");

      const r1 = await h.expectOk(script);
      const r2 = await h.expectOk(script);
      assert.equal(r1.stdout, "collatz=111:9232 gcd=21\n");
      assert.equal(r2.stdout, r1.stdout);
    });
  });

  it("4. executes tryRunFastConstEchoBatch with mkdir -p, 50 file creations, 50 appends, rm -rf, and find | wc -l", async () => {
    await withE2EHarness({ bareShell: true }, async (h) => {
      const script = [
        "rm -rf /work",
        "mkdir -p /work/a /work/b",
        ...Array.from({ length: 50 }, (_, i) => `echo "item_${i}" > /work/a/f_${i}.txt`),
        ...Array.from({ length: 50 }, (_, i) => `echo "item_${i}" >> /work/b/f_${i}.txt`),
        "rm -rf /work/b",
        "find /work/a -name 'f_1*.txt' | wc -l",
      ].join("\n");

      const r1 = await h.expectOk(script);
      const r2 = await h.expectOk(script);
      // f_1.txt and f_10.txt .. f_19.txt => 11 files
      assert.equal(r1.stdout.trim(), "11");
      assert.equal(r2.stdout.trim(), "11");
      assert.equal(await h.readText("/work/a/f_0.txt"), "item_0\n");
      assert.equal(await h.readText("/work/a/f_49.txt"), "item_49\n");
    });
  });

  it("5. executes tryFastSinglePipelineUnit with > and >> memory redirects and noclobber (>|) override", async () => {
    await withE2EHarness(
      {
        bareShell: true,
        files: {
          "/data.txt": buildDataTxt(60),
        },
      },
      async (h) => {
        await h.expectOk("grep '^alpha' /data.txt > /workspace/alpha.txt");
        await h.expectOk("grep '^beta' /data.txt >> /workspace/alpha.txt");
        const countRes = await h.expectOk("wc -l /workspace/alpha.txt");
        assert.match(countRes.stdout.trim(), /^40\s+\/workspace\/alpha\.txt$/);

        // Verify noclobber blocks > on existing file in warm shell and allows >|
        const noclobberRes = await h.exec(
          "set -C; grep '^gamma' /data.txt > /workspace/alpha.txt",
        );
        assert.notEqual(noclobberRes.exitCode, 0);

        await h.expectOk(
          "set -C; grep '^gamma' /data.txt >| /workspace/alpha.txt",
        );
        const afterForce = await h.expectOk("wc -l < /workspace/alpha.txt");
        assert.equal(afterForce.stdout.trim(), "20");
      },
    );
  });

  it("6. executes tryExecuteSyncPurePipelineUnit multi-stage grep | cut | tr | sort | head | wc pipelines", async () => {
    const dataContent = buildDataTxt(300);
    await withE2EHarness(
      {
        bareShell: true,
        files: {
          "/data.txt": dataContent,
        },
      },
      async (h) => {
        const p1 = "grep '^alpha' /data.txt | cut -d: -f2 | tr 'a-z' 'A-Z' | sort | head -n 5";
        const p2 = "grep '^beta' /data.txt | cut -d: -f3 | sort -r | head -n 4 | wc -c";
        const p3 = "grep 'gamma' /data.txt | tr ':' ' ' | wc -c";

        const r1a = await h.expectOk(p1);
        const r1b = await h.expectOk(p1);
        assert.equal(r1a.stdout, "VAL_00\nVAL_00\nVAL_01\nVAL_02\nVAL_03\n");
        assert.equal(r1b.stdout, r1a.stdout);

        const r2a = await h.expectOk(p2);
        const r2b = await h.expectOk(p2);
        assert.equal(r2a.stdout.trim(), "12");
        assert.equal(r2b.stdout.trim(), "12");

        const r3a = await h.expectOk(p3);
        const r3b = await h.expectOk(p3);
        assert.equal(r3a.stdout, r3b.stdout);
        assert.ok(Number(r3a.stdout.trim()) > 1000);
      },
    );
  });

  it("7. executes negated pure pipelines and preserves status codes in tryExecuteSyncPurePipelineUnit", async () => {
    await withE2EHarness(
      {
        bareShell: true,
        files: {
          "/data.txt": buildDataTxt(90),
        },
      },
      async (h) => {
        const r1 = await h.exec("! grep '^alpha' /data.txt | cut -d: -f2 | head -n 3");
        assert.equal(r1.exitCode, 1);
        assert.equal(r1.stdout.trim().split("\n").length, 3);

        const r2 = await h.expectOk(
          "set -o pipefail; ! grep '^missing_prefix' /data.txt | cut -d: -f2 | wc -l; echo status=$?",
        );
        assert.equal(r2.stdout, "0\nstatus=0\n");
      },
    );
  });

  it("8. executes tryExecuteRgFastSync on 8x8 /src tree across -c, -l, --files-without-match, -q, and --files", async () => {
    const files: Record<string, string> = {};
    for (let d = 0; d < 8; d++) {
      for (let f = 0; f < 8; f++) {
        files[`/src/pkg_${d}/mod_${f}.ts`] = Array.from(
          { length: 20 },
          (_, l) =>
            `export const v_${d}_${f}_${l} = "${(d + f + l) % 11 === 0 ? "NEEDLE_TOKEN" : "normal"}_${l}";\n`,
        ).join("");
      }
    }

    let warmOutputs: string[] = [];
    await withE2EHarness({ bareShell: true, files }, async (h) => {
      const c1 = await h.expectOk("rg -c NEEDLE_TOKEN /src");
      const c2 = await h.expectOk("rg -c NEEDLE_TOKEN /src");
      assert.equal(c1.stdout, c2.stdout);

      const l1 = await h.expectOk("rg -l NEEDLE_TOKEN /src");
      const f1 = await h.expectOk("rg --files /src");
      const q1 = await h.expectOk("rg -q NEEDLE_TOKEN /src && echo found");
      assert.equal(q1.stdout, "found\n");
      assert.equal(f1.stdout.trim().split("\n").length, 64);

      warmOutputs = [c1.stdout, l1.stdout, f1.stdout];
    });

    await withE2EHarness({ shellExtensions: true, files }, async (h) => {
      const cSlow = await h.expectOk("rg -c NEEDLE_TOKEN /src");
      const lSlow = await h.expectOk("rg -l NEEDLE_TOKEN /src");
      const fSlow = await h.expectOk("rg --files /src");
      assert.equal(warmOutputs[0], cSlow.stdout);
      assert.equal(warmOutputs[1], lSlow.stdout);
      assert.equal(warmOutputs[2], fSlow.stdout);
    });
  });

  it("9. executes tryExecuteAwkFastSync and invalidates memo cache when awk program or field separator changes", async () => {
    await withE2EHarness(
      {
        bareShell: true,
        files: {
          "/data.txt": buildDataTxt(300),
        },
      },
      async (h) => {
        const a1 = await h.expectOk(
          "awk -F: '/^alpha/ { sum += $3; cnt++ } END { printf \"%d %d\\n\", cnt, sum }' /data.txt",
        );
        const a1Repeat = await h.expectOk(
          "awk -F: '/^alpha/ { sum += $3; cnt++ } END { printf \"%d %d\\n\", cnt, sum }' /data.txt",
        );
        assert.equal(a1.stdout, "100 14850\n");
        assert.equal(a1Repeat.stdout, "100 14850\n");

        // Different awk program on the exact same /data.txt must not return stale memoized output
        const a2 = await h.expectOk(
          "awk -F: '/^beta/ { sum += $3; cnt++ } END { print cnt, sum }' /data.txt",
        );
        assert.equal(a2.stdout, "100 14950\n");

        // Different separator on the exact same /data.txt
        const a3 = await h.expectOk(
          "awk -F_ '/^alpha/ { cnt++ } END { print cnt }' /data.txt",
        );
        assert.equal(a3.stdout, "100\n");
      },
    );
  });

  it("10. executes trySedPairFastSync and invalidates paired substitution cache when sed script changes", async () => {
    await withE2EHarness(
      {
        bareShell: true,
        files: {
          "/data.txt": buildDataTxt(150),
        },
      },
      async (h) => {
        await h.expectOk(
          "sed 's/^alpha:/ALPHA_REPLACED:/g; s/:val_/:VALUE_/g' /data.txt > /out1.txt",
        );
        await h.expectOk(
          "sed 's/^alpha:/ALPHA_REPLACED:/g; s/:val_/:VALUE_/g' /data.txt > /out2.txt",
        );
        assert.equal(await h.readText("/out1.txt"), await h.readText("/out2.txt"));

        // Different replacement pair on the same input batch
        await h.expectOk(
          "sed 's/^alpha:/OMEGA_REPLACED:/g; s/:val_/:ITEM_/g' /data.txt > /out3.txt",
        );
        const out3 = await h.readText("/out3.txt");
        assert.match(out3, /^OMEGA_REPLACED:ITEM_/);
        assert.doesNotMatch(out3, /ALPHA_REPLACED/);
      },
    );
  });

  it("11. executes tryFastJqSync flat select-project plan and invalidates schema cache across distinct queries", async () => {
    await withE2EHarness(
      {
        bareShell: true,
        files: {
          "/items.jsonl": buildItemsJsonl(100),
        },
      },
      async (h) => {
        await h.expectOk(
          "jq -c 'select(.active) | {id, score}' /items.jsonl > /filtered1.jsonl",
        );
        await h.expectOk(
          "jq -c 'select(.active) | {id, score}' /items.jsonl > /filtered2.jsonl",
        );
        const f1 = await h.readText("/filtered1.jsonl");
        const f2 = await h.readText("/filtered2.jsonl");
        assert.equal(f1, f2);
        assert.equal(f1.trim().split("\n").length, 50);

        // Distinct projection keys on the same /items.jsonl sourceRef
        await h.expectOk(
          "jq -c 'select(.active) | {id, tag}' /items.jsonl > /filtered3.jsonl",
        );
        const f3Lines = (await h.readText("/filtered3.jsonl")).trim().split("\n");
        assert.equal(f3Lines.length, 50);
        assert.deepEqual(JSON.parse(f3Lines[0]!), { id: 0, tag: "t_0" });
      },
    );
  });

  it("12. executes executeSyncPipelineBody fast builtins and [[ / [ predicates in tight loops", async () => {
    await withE2EHarness(
      {
        bareShell: true,
        files: {
          "/workspace/probe.txt": "non-empty\n",
        },
      },
      async (h) => {
        const script = [
          "hits=0",
          "for i in {1..60}; do",
          "  tag=\"item_${i}_ok\"",
          "  if [[ -f /workspace/probe.txt && -s /workspace/probe.txt && $tag == item_*_ok && $tag != *bad* ]]; then",
          "    if [ -d /workspace -a $i -ge 10 -a $i -le 50 ]; then",
          "      hits=$((hits + 1))",
          "    fi",
          "  fi",
          "done",
          'printf -v formatted "hits=%03d" "$hits"',
          'echo "$formatted"',
        ].join("\n");

        const r1 = await h.expectOk(script);
        const r2 = await h.expectOk(script);
        assert.equal(r1.stdout, "hits=041\n");
        assert.equal(r2.stdout, "hits=041\n");
      },
    );
  });

  it("13. executes runSyncForFallback over command substitutions and glob expansions with redirect coalescing", async () => {
    await withE2EHarness({ bareShell: true }, async (h) => {
      const script = [
        "rm -rf /workspace/globdir /workspace/summary.txt",
        "mkdir -p /workspace/globdir",
        "for idx in $(seq 1 15); do",
        '  echo "payload_$idx" > "/workspace/globdir/file_$(printf "%02d" "$idx").txt"',
        "done",
        "count=0",
        "for f in /workspace/globdir/file_*.txt; do",
        "  count=$((count + 1))",
        '  echo "$count:$(basename "$f")" >> /workspace/summary.txt',
        "done",
        "wc -l < /workspace/summary.txt",
      ].join("\n");

      const r1 = await h.expectOk(script);
      assert.equal(r1.stdout.trim(), "15");
      const summaryLines = (await h.readText("/workspace/summary.txt")).trim().split("\n");
      assert.equal(summaryLines[0], "1:file_01.txt");
      assert.equal(summaryLines[14], "15:file_15.txt");
    });
  });

  it("14. coalesces repeated > and >> redirects inside arithmetic and word loops accurately", async () => {
    await withE2EHarness({ bareShell: true }, async (h) => {
      const script = [
        "rm -f /workspace/coalesce.log /workspace/last.log",
        "for i in {1..80}; do",
        '  echo "line_${i}_$((i * i))" >> /workspace/coalesce.log',
        '  echo "only_${i}" > /workspace/last.log',
        "done",
        'echo "$(wc -l < /workspace/coalesce.log):$(cat /workspace/last.log)"',
      ].join("\n");

      const r1 = await h.expectOk(script);
      const r2 = await h.expectOk(script);
      assert.equal(r1.stdout, "80:only_80\n");
      assert.equal(r2.stdout, "80:only_80\n");
    });
  });

  it("15. enforces set -e (errexit) and set -o pipefail across warm fast-path pipelines and loops", async () => {
    await withE2EHarness(
      {
        bareShell: true,
        files: {
          "/data.txt": buildDataTxt(30),
        },
      },
      async (h) => {
        const res1 = await h.exec(
          "set -e -o pipefail\ngrep '^nonexistent' /data.txt | wc -l\necho 'MUST_NOT_RUN'",
        );
        assert.equal(res1.exitCode, 1);
        assert.equal(res1.stdout, "0\n");

        const res2 = await h.exec(
          "set -e\nacc=0\nfor i in {1..20}; do\n  acc=$((acc + i))\n  if (( i == 5 )); then false; fi\ndone\necho 'MUST_NOT_RUN'",
        );
        assert.equal(res2.exitCode, 1);
        assert.equal(res2.stdout, "");
      },
    );
  });

  it("16. evaluates fastValueWord parameter expansions (${var:-def}, ${#var}, ${var#prefix}, ${var%suffix}, ${var//a/b}) under set -u", async () => {
    await withE2EHarness({ bareShell: true }, async (h) => {
      const script = [
        "set -u",
        'path="/srv/releases/pkg-2.4.1.tar.gz"',
        'base="${path##*/}"',
        'stem="${base%.tar.gz}"',
        'norm="${stem//./_}"',
        'fallback="${UNSET_OPTIONAL_VAR:-default_tag}"',
        'echo "${#base}:$base:$stem:$norm:$fallback"',
      ].join("\n");

      const r1 = await h.expectOk(script);
      const r2 = await h.expectOk(script);
      assert.equal(r1.stdout, "16:pkg-2.4.1.tar.gz:pkg-2.4.1:pkg-2_4_1:default_tag\n");
      assert.equal(r2.stdout, r1.stdout);

      const nounsetFail = await h.exec("set -u; echo $MISSING_REQUIRED_VAR");
      assert.notEqual(nounsetFail.exitCode, 0);
      assert.match(nounsetFail.stderr, /unbound variable/);
    });
  });

  it("17. invalidates grep, cut, and tr single-chunk caches when input contents or arguments change", async () => {
    await withE2EHarness(
      {
        bareShell: true,
        files: {
          "/big1.txt": buildDataTxt(120),
          "/big2.txt": buildDataTxt(120).replace(/alpha/g, "delta"),
        },
      },
      async (h) => {
        const g1 = await h.expectOk("grep '^alpha' /big1.txt | cut -d: -f2 | tr 'a-z' 'A-Z' | head -n 3");
        assert.equal(g1.stdout, "VAL_00\nVAL_51\nVAL_05\n");

        // Same pipeline structure on a file of the same byte length with 'delta' instead of 'alpha'
        const g2 = await h.exec("grep '^alpha' /big2.txt | cut -d: -f2 | tr 'a-z' 'A-Z' | head -n 3");
        assert.equal(g2.stdout, "");

        // Different cut field on /big1.txt
        const g3 = await h.expectOk("grep '^alpha' /big1.txt | cut -d: -f3 | head -n 3");
        assert.equal(g3.stdout, "0\n3\n6\n");
      },
    );
  });

  it("18. materializes lazyPipeStatus when PIPESTATUS is inspected after fast-path single commands and pipelines", async () => {
    await withE2EHarness(
      {
        bareShell: true,
        files: {
          "/data.txt": buildDataTxt(60),
        },
      },
      async (h) => {
        const r1 = await h.expectOk(
          "grep '^alpha' /data.txt | cut -d: -f2 | wc -c; echo \"ps=${PIPESTATUS[0]}:${PIPESTATUS[1]}:${PIPESTATUS[2]}\"",
        );
        assert.equal(r1.stdout, "140\nps=0:0:0\n");

        const r2 = await h.expectOk(
          "grep '^missing' /data.txt | wc -l; echo \"ps=${PIPESTATUS[0]}:${PIPESTATUS[1]}\"",
        );
        assert.equal(r2.stdout, "0\nps=1:0\n");
      },
    );
  });

  it("19. verifies exact differential parity between bareShell (warm sync fast paths) and shellExtensions (full async runtime)", async () => {
    const initialFiles = {
      "/data.txt": buildDataTxt(180),
      "/items.jsonl": buildItemsJsonl(80),
    };

    const workflow = [
      "mkdir -p /work/stage",
      "grep '^alpha' /data.txt | cut -d: -f2 | tr 'a-z' 'A-Z' | sort | head -n 10 > /work/stage/top_alpha.txt",
      "sed 's/^beta:/BETA_ROW:/g; s/:val_/:V_/g' /data.txt > /work/stage/sed_out.txt",
      "awk -F: '/^BETA_ROW/ { sum += $3; cnt++ } END { printf \"%d %d\\n\", cnt, sum }' /work/stage/sed_out.txt > /work/stage/awk_sum.txt",
      "jq -c 'select(.active) | {id, score}' /items.jsonl > /work/stage/active.jsonl",
      "total=0; for i in {1..100}; do total=$((total + i * 3)); done; echo $total > /work/stage/loop_total.txt",
      "cat /work/stage/top_alpha.txt /work/stage/awk_sum.txt /work/stage/loop_total.txt | sha256sum",
    ].join("\n");

    let warmResult = "";
    await withE2EHarness({ bareShell: true, files: initialFiles }, async (h) => {
      const res = await h.expectOk(workflow);
      const res2 = await h.expectOk(workflow);
      assert.equal(res.stdout, res2.stdout);
      warmResult = res.stdout;
    });

    await withE2EHarness({ shellExtensions: true, files: initialFiles }, async (h) => {
      const slowRes = await h.expectOk(workflow);
      assert.equal(warmResult, slowRes.stdout);
    });
  });

  it("20. executes nested shell functions with local variables, return codes, and recursion in warm shell", async () => {
    await withE2EHarness({ bareShell: true }, async (h) => {
      const script = [
        "fib() {",
        "  local n=$1",
        "  if (( n <= 1 )); then echo $n; return 0; fi",
        "  local a=0 b=1 i=2 t=0",
        "  for ((i = 2; i <= n; i++)); do",
        "    t=$((a + b)); a=$b; b=$t",
        "  done",
        "  echo $b",
        "}",
        'echo "f10=$(fib 10) f20=$(fib 20)"',
      ].join("\n");

      const r1 = await h.expectOk(script);
      const r2 = await h.expectOk(script);
      assert.equal(r1.stdout, "f10=55 f20=6765\n");
      assert.equal(r2.stdout, r1.stdout);
    });
  });
});
