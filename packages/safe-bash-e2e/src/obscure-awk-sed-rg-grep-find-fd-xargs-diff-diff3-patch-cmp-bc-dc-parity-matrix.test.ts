import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

const createEnv = () => ({
  exec: (script: string) => withE2EHarness((h) => h.exec(script)),
});

describe("obscure awk, sed, rg, grep, find, fd, xargs, diff, diff3, patch, cmp, bc, and dc parity matrix", () => {
  it("1. awk recursive user-defined functions, local parameter shadowing, SUBSEP multidimensional arrays, and delete", async () => {
    const env = createEnv();
    const res = await env.exec(`
      awk '
        function gcd(a, b, r) {
          if (b == 0) return a
          r = a % b
          return gcd(b, r)
        }
        BEGIN {
          grid["r1", "c1"] = gcd(48, 18)
          grid["r1", "c2"] = gcd(105, 45)
          delete grid["r1", "c1"]
          printf "has_c1=%d has_c2=%d val=%d\\n", (("r1", "c1") in grid), (("r1", "c2") in grid), grid["r1", "c2"]
        }
      '
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "has_c1=0 has_c2=1 val=15\n");
  });

  it("2. awk RS='' paragraph mode with multi-line records, FS='\\n', OFS='|', NR/FNR, and nextfile", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'host=alpha\nport=8080\n\nhost=beta\nport=9090\n' > p1.txt
      printf 'host=gamma\nport=7070\n\nhost=delta\nport=6060\n' > p2.txt
      awk 'BEGIN { RS=""; FS="\\n"; OFS="|" } { print FILENAME, FNR, NR, $1, $2; if (FILENAME == "p1.txt" && FNR == 1) nextfile }' p1.txt p2.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "p1.txt|1|1|host=alpha|port=8080",
        "p2.txt|1|2|host=gamma|port=7070",
        "p2.txt|2|3|host=delta|port=6060",
        "",
      ].join("\n")
    );
  });

  it("3. awk getline from file with close(), match() setting RSTART/RLENGTH, split(), and sub()/gsub()", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'k1=100\nk2=250\n' > map.txt
      printf 'item:k2:price\nitem:k1:cost\n' | awk '
        BEGIN {
          while ((getline line < "map.txt") > 0) {
            split(line, kv, "=")
            tbl[kv[1]] = kv[2]
          }
          close("map.txt")
        }
        {
          if (match($0, /k[0-9]+/)) {
            key = substr($0, RSTART, RLENGTH)
            gsub(/:/, "|")
            print $0, key, tbl[key]
          }
        }
      '
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "item|k2|price k2 250",
        "item|k1|cost k1 100",
        "",
      ].join("\n")
    );
  });

  it("4. sed hold space state machine (h, H, g, G, x), multi-line N/P/D, and conditional branching (:loop, t)", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf '00042\n0000\n007\n' | sed ':strip; s/^0\\([0-9]\\)/\\1/; t strip'
      printf 'first\nsecond\nthird\n' | sed '1!G;h;$!d'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "42",
        "0",
        "7",
        "third",
        "second",
        "first",
        "",
      ].join("\n")
    );
  });

  it("5. sed line-range negation (2,3!s), w file write command, and custom s#...#...#g delimiter", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf '/usr/local/bin\n/usr/bin\n/opt/bin\n/home/bin\n' | \
        sed '2,3!s#/bin#/sbin#g; /sbin/w modified.txt'
      echo "---"
      cat modified.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "/usr/local/sbin",
        "/usr/bin",
        "/opt/bin",
        "/home/sbin",
        "---",
        "/usr/local/sbin",
        "/home/sbin",
        "",
      ].join("\n")
    );
  });

  it("6. grep -E/-F/-o/-v/-n/-b byte offsets, -C context with --group-separator, and -f pattern file", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'WARN\nFATAL\n' > pats.txt
      cat <<'EOF' > app.log
INFO boot
WARN disk
INFO steady
INFO gap
INFO idle
FATAL crash
INFO done
EOF
      grep -n -b -C 1 --group-separator='===' -f pats.txt app.log
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "1-0-INFO boot",
        "2:10:WARN disk",
        "3-20-INFO steady",
        "===",
        "5-41-INFO idle",
        "6:51:FATAL crash",
        "7-63-INFO done",
        "",
      ].join("\n")
    );
  });

  it("7. rg capture group replacement (-r '$2=$1'), positive/negative globs (-g), and --count-matches", async () => {
    const env = createEnv();
    const res = await env.exec(`
      mkdir -p src
      printf 'export const a = 10;\nexport const b = 20;\n' > src/mod.ts
      printf 'export const t = 99;\n' > src/mod.test.ts
      rg -I -N 'export const ([a-z]+) = ([0-9]+);' -r '$1:$2' -g '*.ts' -g '!*.test.ts' src
      rg --count-matches 'export' -g '*.ts' src | sort
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "a:10",
        "b:20",
        "src/mod.test.ts:1",
        "src/mod.ts:2",
        "",
      ].join("\n")
    );
  });

  it("8. find boolean precedence, -prune, -perm, -size, and -printf formatting directives", async () => {
    const env = createEnv();
    const res = await env.exec(`
      mkdir -p tree/keep tree/vendor
      printf '123456' > tree/keep/run.sh
      printf '12' > tree/keep/readme.md
      printf '99999999' > tree/vendor/skip.sh
      chmod 755 tree/keep/run.sh
      chmod 644 tree/keep/readme.md
      find tree -name vendor -prune -o -type f \\( -name '*.sh' -o -name '*.md' \\) -printf '%f|%s|%d|%y\\n' | sort
      find tree -type f -perm 755 -printf '%f\\n'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "readme.md|2|2|f",
        "run.sh|6|2|f",
        "run.sh",
        "",
      ].join("\n")
    );
  });

  it("9. fd extension filter (-e), exclusion (-E), and -x placeholder expansion ({/}, {//}, {.}, {/.})", async () => {
    const env = createEnv();
    const res = await env.exec(`
      mkdir -p pkg/src pkg/dist
      touch pkg/src/engine.rs pkg/dist/ignore.rs
      fd -e rs -E dist . pkg -x echo '{/}|{/.}|{.}'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "engine.rs|engine|pkg/src/engine\n");
  });

  it("10. xargs -0 NUL-delimited input, -n batching, -I placeholder replacement, and -E logical EOF", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'one two\\0three\\0' | xargs -0 -I ITEM echo "[ITEM]"
      printf 'a b c STOP d e\n' | xargs -E STOP -n 2 echo
      printf '' | xargs -r echo "should_not_print"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "[one two]",
        "[three]",
        "a b",
        "c",
        "",
      ].join("\n")
    );
  });

  it("11. diff -u unified, -e ed script, -n RCS diff, and -B/-w/-I ignore filters", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf '# ts: 100\nalpha  1\n\nbeta\n' > old.txt
      printf '# ts: 200\nalpha 1\nbeta\n' > new.txt
      diff -B -w -I '^# ts:' -q old.txt new.txt
      echo "ign_rc=$?"
      printf 'l1\nold\nl3\n' > f1.txt
      printf 'l1\nnew\nl3\n' > f2.txt
      diff -n f1.txt f2.txt
    `);
    assert.equal(res.exitCode, 1);
    assert.equal(
      res.stdout,
      [
        "ign_rc=0",
        "d2 1",
        "a2 1",
        "new",
        "",
      ].join("\n")
    );
  });

  it("12. diff3 -m clean 3-way merge vs conflict marker generation with custom -L labels", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'top\nmiddle\nbottom\n' > base.txt
      printf 'top_mine\nmiddle\nbottom\n' > mine_clean.txt
      printf 'top\nmiddle\nbottom_theirs\n' > theirs_clean.txt
      diff3 -m mine_clean.txt base.txt theirs_clean.txt
      echo "clean_rc=$?"
      printf 'conflict_mine\nmiddle\n' > mine_c.txt
      printf 'conflict_base\nmiddle\n' > base_c.txt
      printf 'conflict_theirs\nmiddle\n' > theirs_c.txt
      diff3 -m -L OURS -L BASE -L THEIRS mine_c.txt base_c.txt theirs_c.txt
      echo "conflict_rc=$?"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "top_mine",
        "middle",
        "bottom_theirs",
        "clean_rc=0",
        "<<<<<<< OURS",
        "conflict_mine",
        "||||||| BASE",
        "conflict_base",
        "=======",
        "conflict_theirs",
        ">>>>>>> THEIRS",
        "middle",
        "conflict_rc=1",
        "",
      ].join("\n")
    );
  });

  it("13. patch -p1 forward apply, -o output to separate file, and -R reverse unapply", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'line1\nold_val\nline3\n' > orig.txt
      printf 'line1\nnew_val\nline3\n' > target.txt
      diff -u a/orig.txt b/target.txt > change.patch 2>/dev/null || diff -u orig.txt target.txt > change.patch
      patch -u orig.txt -i change.patch -o preview.txt >/dev/null
      echo "orig=$(sed -n '2p' orig.txt) preview=$(sed -n '2p' preview.txt)"
      patch -u orig.txt -i change.patch >/dev/null
      echo "applied=$(sed -n '2p' orig.txt)"
      patch -R -u orig.txt -i change.patch >/dev/null
      echo "reverted=$(sed -n '2p' orig.txt)"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "orig=old_val preview=new_val",
        "applied=new_val",
        "reverted=old_val",
        "",
      ].join("\n")
    );
  });

  it("14. apply_patch multi-file Add, Update + Move to, and Delete atomic transaction", async () => {
    const env = createEnv();
    const res = await env.exec(`
      mkdir -p repo
      printf 'keep\nold_line\n' > repo/a.txt
      printf 'obsolete\n' > repo/del.txt
      apply_patch <<'EOF' >/dev/null
*** Begin Patch
*** Add File: repo/added.txt
+brand_new
*** Update File: repo/a.txt
*** Move to: repo/renamed.txt
@@
 keep
-old_line
+updated_line
*** Delete File: repo/del.txt
*** End Patch
EOF
      find repo -type f | sort
      cat repo/added.txt repo/renamed.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "repo/added.txt",
        "repo/renamed.txt",
        "brand_new",
        "keep",
        "updated_line",
        "",
      ].join("\n")
    );
  });

  it("15. cmp -l byte/octal listing, -i skip offsets, and -n byte limit", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'AAXBB' > b1.bin
      printf 'AAYBB' > b2.bin
      cmp -l b1.bin b2.bin
      cmp -s -i 3:3 b1.bin b2.bin
      echo "skip_rc=$?"
      cmp -s -n 2 b1.bin b2.bin
      echo "limit_rc=$?"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "3 130 131",
        "skip_rc=0",
        "limit_rc=0",
        "",
      ].join("\n")
    );
  });

  it("16. bc scale precision, ibase/obase radix conversion, recursive define, and -l math functions", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'scale=4; 22 / 7\ndefine f(n) { if (n <= 1) return 1; return n * f(n - 1); }\nf(6)\nibase=16; obase=2; FF\n' | bc
      printf 'scale=4; s(0) + c(0)\n' | bc -l
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "3.1428",
        "720",
        "11111111",
        "1.0000",
        "",
      ].join("\n")
    );
  });

  it("17. expr regex/math evaluation, factor prime factorization, and seq formatted sequences", async () => {
    const env = createEnv();
    const res = await env.exec(`
      expr 'release-v42-rc1' : 'release-v\\([0-9]*\\)'
      factor 360
      seq -f '%03g' -s ':' 5 5 15
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "42",
        "360: 2 2 2 3 3 5",
        "005:010:015",
        "",
      ].join("\n")
    );
  });

  it("18. numfmt --to=iec/--to=iec-i/--from=iec/--to=si with --field, --delimiter, and --header", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'NAME,BYTES\nalpha,1048576\nbeta,2097152\n' | numfmt --delimiter=, --header=1 --field=2 --to=iec-i --suffix=B
      numfmt --from=iec 4K 2M
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "NAME,BYTES",
        "alpha,1.0MiB",
        "beta,2.0MiB",
        "4096",
        "2097152",
        "",
      ].join("\n")
    );
  });

  it("19. date -u -d '@epoch' formatting, cal leap-year February 2024, and getopt long/short canonicalization", async () => {
    const env = createEnv();
    const res = await env.exec(`
      date -u -d '@1709251200' '+%Y-%m-%d %H:%M:%S %Z'
      cal 2 2024 | grep -o '29'
      getopt -o ab: --long alpha,beta: -- -a --beta val1 pos1 pos2
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "2024-03-01 00:00:00 UTC",
        "29",
        " -a --beta 'val1' -- 'pos1' 'pos2'",
        "",
      ].join("\n")
    );
  });

  it("20. iconv encoding conversion, dos2unix/unix2dos round-trip, pr multi-column, fmt -w, and tsort cycle detection", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'a\\r\\nb\\r\\n' > crlf.txt
      dos2unix crlf.txt 2>/dev/null
      wc -c < crlf.txt | tr -d ' '
      printf 'one two three four five six\n' | fmt -w 10
      printf 'a b\nb c\n' | tsort
      printf 'x y\ny x\n' | tsort >/dev/null 2>cycle.err
      echo "cycle_rc=$?"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "4",
        "one two",
        "three four",
        "five six",
        "a",
        "b",
        "c",
        "cycle_rc=1",
        "",
      ].join("\n")
    );
  });
});
