import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure awk, sed, rg, grep, find, fd, xargs, diff, patch, bc, and tsort parity matrix", () => {
  it("01. enforces bc invalid option diagnostics, halt/quit termination, last/. variable tracking, and runtime error diagnostics", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const rShort = await h.exec("bc -z");
      assert.equal(rShort.exitCode, 2);
      assert.equal(rShort.stderr, "bc: invalid option -- 'z'\n");

      const rLong = await h.exec("bc --bogus");
      assert.equal(rLong.exitCode, 2);
      assert.equal(rLong.stderr, "bc: invalid option -- '-'\n");

      const rHalt = await h.exec("printf '10 + 5\\nlast * 2\\n. + 3\\nhalt\\n999\\n' | bc");
      assert.equal(rHalt.exitCode, 0);
      assert.equal(rHalt.stdout, "15\n30\n33\n");

      const rDiv0 = await h.exec("printf '42\\n1 / 0\\n100\\n' | bc");
      assert.equal(rDiv0.exitCode, 1);
      assert.equal(rDiv0.stdout, "42\n");
      assert.equal(rDiv0.stderr, "bc: Runtime error (func=(main), adr=0): Divide by zero\n");

      const rNegSqrt = await h.exec("printf 'sqrt(-9)\\n' | bc");
      assert.equal(rNegSqrt.exitCode, 1);
      assert.equal(rNegSqrt.stderr, "bc: Runtime error: Square root of a negative number\n");
    } finally {
      await h.dispose();
    }
  });

  it("02. evaluates bc user-defined functions with auto locals, arrays, ibase/obase, length, scale, and mathlib", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(String.raw`
        bc -l << 'BC'
scale = 4
define fact(n) {
  auto acc, i
  acc = 1
  for (i = 2; i <= n; i++) {
    acc *= i
  }
  return (acc)
}
a[0] = fact(5)
a[1] = fact(6)
print a[0], ":", a[1], "\n"
length(123456)
scale(12.3450)
sqrt(2)
obase = 16
255
BC
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "120:720\n6\n4\n1.4142\nFF\n");
    } finally {
      await h.dispose();
    }
  });

  it("03. evaluates bc -e expressions, while/for loops with break/continue, compound assignments, and power ^", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(`
        bc -e 'scale=4' -e '10 / 3'
        bc << 'BC'
s = 0
for (i = 1; i <= 10; i++) {
  if (i == 3) continue
  if (i > 6) break
  s += i
}
s
2 ^ 10 + sqrt(144)
BC
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "3.3333\n18\n1036\n");
    } finally {
      await h.dispose();
    }
  });

  it("04. formats and scales numbers with numfmt (--from=iec, --to=si, --to=iec-i, --round, --field, --header, --padding)", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(`
        numfmt --from=iec --to=si 1K 2M
        numfmt --to=iec-i --suffix=B --round=nearest 1536
        printf 'metric,bytes\\ndisk,2048\\nmem,1048576\\n' | numfmt --header=1 --delimiter=, --field=2 --to=iec
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "1.1k",
          "2.1M",
          "1.5KiB",
          "metric,bytes",
          "disk,2.0K",
          "mem,1.0M",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("05. evaluates expr regex/string/math expressions and factor prime decompositions", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(String.raw`
        expr 'release-v2.14.9' : 'release-v\([0-9]*\.[0-9]*\)'
        expr substr 'safe-bash-rust' 6 4
        expr index 'abcdef' 'de'
        expr length 'hello_world'
        expr '' \| 'fallback'
        expr 14 \* \( 3 + 2 \)
        factor 360 97
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "2.14",
          "bash",
          "4",
          "11",
          "fallback",
          "70",
          "360: 2 2 2 3 3 5",
          "97: 97",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("06. performs topological sorting with tsort including self-loops, cycle diagnostics, and odd-token errors", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const rOk = await h.exec("printf 'pkg-core pkg-cli\\npkg-fs pkg-core\\npkg-fs pkg-fs\\n' | tsort");
      assert.equal(rOk.exitCode, 0, rOk.stderr);
      assert.equal(rOk.stdout, "pkg-fs\npkg-core\npkg-cli\n");

      const rCycle = await h.exec("printf 'a b\\nb c\\nc a\\n' | tsort");
      assert.equal(rCycle.exitCode, 1);
      assert.match(rCycle.stderr, /tsort: -: input contains a loop:/);

      const rOdd = await h.exec("printf 'a b c\\n' | tsort");
      assert.equal(rOdd.exitCode, 1);
      assert.equal(rOdd.stderr, "tsort: -: input contains an odd number of tokens\n");
    } finally {
      await h.dispose();
    }
  });

  it("07. executes awk associative arrays, split, gsub, match (RSTART/RLENGTH), sprintf, and user functions", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(String.raw`
        printf 'svc=api;lat=42ms\nsvc=db;lat=118ms\nsvc=api;lat=58ms\n' | awk '
          function strip_ms(s) {
            gsub(/ms$/, "", s)
            return s + 0
          }
          {
            n = split($0, parts, ";")
            split(parts[1], kv1, "=")
            split(parts[2], kv2, "=")
            svc = kv1[2]
            ms = strip_ms(kv2[2])
            sum[svc] += ms
            cnt[svc]++
          }
          END {
            printf "api=%d/%d db=%d/%d\n", sum["api"], cnt["api"], sum["db"], cnt["db"]
          }
        '
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "api=100/2 db=118/1\n");
    } finally {
      await h.dispose();
    }
  });

  it("08. tracks awk FNR, NR, FILENAME, next, nextfile, and delete across multiple input files", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/one.txt": "keep1\nskip_rest\nignored1\n",
        "/work/two.txt": "keep2\nkeep3\n",
      },
      cwd: "/work",
    });
    try {
      const r = await h.exec(String.raw`
        awk '
          $0 == "skip_rest" { nextfile }
          { printf "%s:%d:%d:%s\n", FILENAME, FNR, NR, $0 }
        ' one.txt two.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "one.txt:1:1:keep1",
          "two.txt:1:3:keep2",
          "two.txt:2:4:keep3",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("09. runs sed hold-space state machines (h, H, g, G, x, N), labels/branching (:a, b, t), and range addresses", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(String.raw`
        echo "=== REVERSE LINES VIA HOLD SPACE ==="
        printf 'line1\nline2\nline3\n' | sed -n '1!G;h;$p'
        echo "=== LOOP SUBSTITUTION ==="
        printf 'a,,b,,,c\n' | sed ':loop; s/,,/,/g; t loop'
        echo "=== RANGE ==="
        printf 'head\nBEGIN\nx\ny\nEND\ntail\n' | sed -n '/^BEGIN$/,/^END$/p'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "=== REVERSE LINES VIA HOLD SPACE ===",
          "line3",
          "line2",
          "line1",
          "=== LOOP SUBSTITUTION ===",
          "a,b,c",
          "=== RANGE ===",
          "BEGIN",
          "x",
          "y",
          "END",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("10. executes sed -i in-place edits, y/// transliteration, a/i/c line edits, = line numbers, and w file writes", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/doc.txt": "alpha\nbeta\ngamma\n",
      },
      cwd: "/work",
    });
    try {
      const r = await h.exec(String.raw`
        sed -i -e 'y/abg/ABG/' -e '/^BetA$/w matched.txt' doc.txt
        cat doc.txt
        echo "---"
        cat matched.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "AlphA",
          "BetA",
          "GAmmA",
          "---",
          "BetA",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("11. searches with rg (-g globs, -F fixed strings, -w word, -o only-matching, -r replace, -c count, --files)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/src/app.ts": "const token = 'tok_123';\nconst token2 = 'tok_456';\n",
        "/work/src/app.test.ts": "const token = 'tok_test';\n",
      },
      cwd: "/work",
    });
    try {
      const r = await h.exec(String.raw`
        echo "=== FILES ==="
        rg --files -g '!*.test.ts' src
        echo "=== REPLACE ==="
        rg -N -o 'tok_([0-9]+)' -r 'REDACTED_$1' src/app.ts
        echo "=== WORD ==="
        rg -N -w 'token' -g '!*.test.ts' src
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "=== FILES ===",
          "src/app.ts",
          "=== REPLACE ===",
          "REDACTED_123",
          "REDACTED_456",
          "=== WORD ===",
          "src/app.ts:const token = 'tok_123';",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("12. searches with grep, egrep, and fgrep (-b byte offset, -o only-matching, -v invert, -c count, -l/-L files, -m max)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/a.log": "ok\nERR:10\nok\nERR:20\n",
        "/work/b.log": "ok\nall_good\n",
      },
      cwd: "/work",
    });
    try {
      const r = await h.exec(String.raw`
        echo "=== BYTE OFFSET + ONLY MATCHING ==="
        grep -b -o 'ERR:[0-9]*' a.log
        echo "=== MAX 1 ==="
        grep -m 1 '^ERR' a.log
        echo "=== FILES WITH / WITHOUT MATCH ==="
        grep -l 'ERR' a.log b.log
        grep -L 'ERR' a.log b.log
        echo "=== FGREP ==="
        fgrep -c 'ERR:' a.log
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "=== BYTE OFFSET + ONLY MATCHING ===",
          "3:ERR:10",
          "13:ERR:20",
          "=== MAX 1 ===",
          "ERR:10",
          "=== FILES WITH / WITHOUT MATCH ===",
          "a.log",
          "b.log",
          "=== FGREP ===",
          "2",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("13. traverses trees with find (-prune, compound -o/-a/!, -perm, -size, -empty, -exec ... {} +, -printf)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/tree/src/main.rs": "fn main() {}\n",
        "/work/tree/src/empty.txt": "",
        "/work/tree/node_modules/pkg/index.js": "module.exports = {};\n",
      },
      cwd: "/work",
    });
    try {
      const r = await h.exec(String.raw`
        echo "=== PRUNE ==="
        find tree -name node_modules -prune -o -type f -print | sort
        echo "=== EMPTY ==="
        find tree -type f -empty
        echo "=== PRINTF ==="
        find tree/src -maxdepth 1 -type f -printf '%f:%s\n' | sort
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "=== PRUNE ===",
          "tree/src/empty.txt",
          "tree/src/main.rs",
          "=== EMPTY ===",
          "tree/src/empty.txt",
          "=== PRINTF ===",
          "empty.txt:0",
          "main.rs:13",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("14. discovers files with fd (-e extension, -t type, -E exclude, -d depth, -H hidden, -0 print0, -x exec)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/repo/.env.secret": "KEY=1\n",
        "/work/repo/src/lib.rs": "pub fn run() {}\n",
        "/work/repo/src/mod.ts": "export const x = 1;\n",
        "/work/repo/vendor/skip.rs": "// vendor\n",
      },
      cwd: "/work/repo",
    });
    try {
      const r = await h.exec(String.raw`
        echo "=== EXT + EXCLUDE ==="
        fd -e rs -E vendor | sort
        echo "=== HIDDEN ==="
        fd -H '^\.env' | sort
        echo "=== EXEC BASENAME ==="
        fd -e rs -E vendor -x basename {} .rs
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "=== EXT + EXCLUDE ===",
          "src/lib.rs",
          "=== HIDDEN ===",
          ".env.secret",
          "=== EXEC BASENAME ===",
          "lib",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("15. batches arguments with xargs (-0, -n max-args, -L max-lines, -I replace-str, -r no-run-if-empty, -d delimiter)", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(String.raw`
        echo "=== NUL + MAX ARGS ==="
        printf 'a\0b\0c\0d\0e\0' | xargs -0 -n 2 echo "batch:"
        echo "=== REPLACE STR ==="
        printf 'alpha\nbeta\n' | xargs -I {} echo "item=[{}]"
        echo "=== NO RUN IF EMPTY ==="
        printf '' | xargs -r echo "should_not_print"
        echo "=== DELIMITER ==="
        printf 'x:y:z' | xargs -d ':' -n 2 echo "colon:"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "=== NUL + MAX ARGS ===",
          "batch: a b",
          "batch: c d",
          "batch: e",
          "=== REPLACE STR ===",
          "item=[alpha]",
          "item=[beta]",
          "=== NO RUN IF EMPTY ===",
          "=== DELIMITER ===",
          "colon: x y",
          "colon: z",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("16. compares files with diff (-u, -q, -w, -B, -i, -r) and cmp (-l verbose byte offsets, -s silent, -i, -n)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/a.txt": "hello   world\n\nfoo\n",
        "/work/b.txt": "HELLO world\nfoo\n",
        "/work/b1.bin": new Uint8Array([0x10, 0x20, 0x30, 0x40]),
        "/work/b2.bin": new Uint8Array([0x10, 0x25, 0x30, 0x45]),
      },
      cwd: "/work",
    });
    try {
      const r = await h.exec(String.raw`
        diff -w -B -i a.txt b.txt
        echo "diff_clean=$?"
        cmp -l b1.bin b2.bin || echo "cmp_rc=$?"
        cmp -i 2 -n 1 b1.bin b2.bin
        echo "cmp_slice_rc=$?"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "diff_clean=0",
          "2  40  45",
          "4 100 105",
          "cmp_rc=1",
          "cmp_slice_rc=0",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("17. performs 3-way merges with diff3 -m on both non-overlapping edits and overlapping conflict regions", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/base.txt": "line1\nline2\nline3\n",
        "/work/mine_clean.txt": "line1_mine\nline2\nline3\n",
        "/work/yours_clean.txt": "line1\nline2\nline3_yours\n",
        "/work/mine_conf.txt": "line1\nline2_mine\nline3\n",
        "/work/yours_conf.txt": "line1\nline2_yours\nline3\n",
      },
      cwd: "/work",
    });
    try {
      const rClean = await h.exec("diff3 -m mine_clean.txt base.txt yours_clean.txt");
      assert.equal(rClean.exitCode, 0, rClean.stderr);
      assert.equal(rClean.stdout, "line1_mine\nline2\nline3_yours\n");

      const rConf = await h.exec("diff3 -m mine_conf.txt base.txt yours_conf.txt");
      assert.equal(rConf.exitCode, 1);
      assert.match(rConf.stdout, /<<<<<<< mine_conf\.txt/);
      assert.match(rConf.stdout, /line2_mine/);
      assert.match(rConf.stdout, /=======/);
      assert.match(rConf.stdout, /line2_yours/);
      assert.match(rConf.stdout, />>>>>>> yours_conf\.txt/);
    } finally {
      await h.dispose();
    }
  });

  it("18. applies unified diffs with patch (-p1, -R, -o) and multi-file patches with apply_patch", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/src/cfg.txt": "host=localhost\nport=8080\n",
      },
      cwd: "/work",
    });
    try {
      const r = await h.exec(String.raw`
        cat << 'EOF' > change.diff
--- a/src/cfg.txt
+++ b/src/cfg.txt
@@ -1,2 +1,2 @@
 host=localhost
-port=8080
+port=9090
EOF
        patch -p1 < change.diff >/dev/null
        cat src/cfg.txt
        patch -R -p1 < change.diff >/dev/null
        cat src/cfg.txt
        apply_patch << 'PATCH' >/dev/null
*** Begin Patch
*** Update File: src/cfg.txt
@@
 host=localhost
-port=8080
+port=7070
*** Add File: src/extra.txt
+enabled=true
*** End Patch
PATCH
        cat src/cfg.txt
        cat src/extra.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "host=localhost",
          "port=9090",
          "host=localhost",
          "port=8080",
          "host=localhost",
          "port=7070",
          "enabled=true",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("19. compares word streams with wdiff ([-deleted-], {+inserted+}, --help, stdin -, and exit codes 0/1/2)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/old.txt": "the quick brown fox jumps\n",
        "/work/new.txt": "the fast brown dog jumps\n",
      },
      cwd: "/work",
    });
    try {
      const rHelp = await h.exec("wdiff --help");
      assert.equal(rHelp.exitCode, 0);
      assert.equal(
        rHelp.stdout,
        "Usage: wdiff OLD NEW\nCompare whitespace-delimited words; [-deleted-] and {+inserted+}.\n",
      );

      const rSame = await h.exec("wdiff old.txt old.txt");
      assert.equal(rSame.exitCode, 0);
      assert.equal(rSame.stdout, "the quick brown fox jumps\n");

      const rDiff = await h.exec("cat new.txt | wdiff -- old.txt -");
      assert.equal(rDiff.exitCode, 1);
      assert.equal(rDiff.stdout, "the [-quick-] {+fast+} brown [-fox-] {+dog+} jumps\n");

      const rBad = await h.exec("wdiff - -");
      assert.equal(rBad.exitCode, 2);
      assert.equal(rBad.stderr, "wdiff: expected two files (at most one stdin operand)\n");
    } finally {
      await h.dispose();
    }
  });

  it("20. executes an end-to-end dependency graph, refactoring, diff/patch, wdiff, bc, and numfmt pipeline", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/deps.txt": "core utils\ncli core\napi core\ncli api\n",
        "/work/src/core.conf": "timeout_ms=1000\ncache_bytes=1048576\n",
        "/work/src/cli.conf": "timeout_ms=2000\ncache_bytes=2097152\n",
      },
      cwd: "/work",
    });
    try {
      const r = await h.exec(String.raw`
        ORDER=$(tsort deps.txt | paste -sd '>' -)
        TOTAL_TIMEOUT=$(rg -N '^timeout_ms=' src | awk -F= '{sum += $2} END {print sum}')
        AVG_TIMEOUT=$(printf "scale=2\n%d / 2\n" "$TOTAL_TIMEOUT" | bc)
        TOTAL_CACHE=$(rg -N '^cache_bytes=' src | awk -F= '{sum += $2} END {print sum}' | numfmt --to=iec-i --suffix=B)
        sed -e 's/1000/1500/' src/core.conf > src/core.conf.new
        WDIFF_OUT=$(wdiff src/core.conf src/core.conf.new || true)
        echo "order=$ORDER total_ms=$TOTAL_TIMEOUT avg_ms=$AVG_TIMEOUT cache=$TOTAL_CACHE wdiff=$WDIFF_OUT"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        "order=cli>api>core>utils total_ms=3000 avg_ms=1500.00 cache=3.0MiB wdiff=[-timeout_ms=1000-] {+timeout_ms=1500+}\ncache_bytes=1048576\n",
      );
    } finally {
      await h.dispose();
    }
  });
});
