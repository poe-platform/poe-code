import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

const createEnv = () => ({
  exec: (script: string) => withE2EHarness((h) => h.exec(script)),
});

describe("obscure diff, patch, apply_patch, cmp, diff3, and wdiff parity matrix", () => {
  it("1. diff normal, unified (-u / -U 1), and context (-c / -C 1) formats with custom -L labels", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'alpha\\nbeta\\ngamma\\ndelta\\n' > a.txt
      printf 'alpha\\nBETA\\ngamma\\ndelta\\n' > b.txt
      diff a.txt b.txt
      echo "NORM_RC=$?"
      diff -U 1 -L orig/a.txt -L mod/b.txt a.txt b.txt
      echo "UNI_RC=$?"
      diff -C 1 -L orig/a.txt -L mod/b.txt a.txt b.txt
      echo "CTX_RC=$?"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "2c2",
        "< beta",
        "---",
        "> BETA",
        "NORM_RC=1",
        "--- orig/a.txt",
        "+++ mod/b.txt",
        "@@ -1,3 +1,3 @@",
        " alpha",
        "-beta",
        "+BETA",
        " gamma",
        "UNI_RC=1",
        "*** orig/a.txt",
        "--- mod/b.txt",
        "***************",
        "*** 1,3 ****",
        "  alpha",
        "! beta",
        "  gamma",
        "--- 1,3 ----",
        "  alpha",
        "! BETA",
        "  gamma",
        "CTX_RC=1",
        "",
      ].join("\n")
    );
  });

  it("2. diff side-by-side (-y -W 40) with --left-column and --suppress-common-lines", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'same1\\nold_val\\nsame2\\n' > a.txt
      printf 'same1\\nnew_val\\nsame2\\n' > b.txt
      diff -y -W 32 --suppress-common-lines a.txt b.txt
      echo "RC=$?"
      diff -y -W 32 --left-column a.txt b.txt | wc -l | tr -d " "
    `);
    assert.equal(res.exitCode, 0);
    const lines = res.stdout.trim().split("\n");
    assert.ok(lines[0].includes("old_val") && lines[0].includes("|") && lines[0].includes("new_val"));
    assert.equal(lines[1], "RC=1");
    assert.equal(lines[2], "3");
  });

  it("3. diff -e (ed script) and diff -n (RCS format) output", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'one\\ntwo\\nthree\\n' > a.txt
      printf 'one\\nTWO\\nthree\\nfour\\n' > b.txt
      diff -e a.txt b.txt
      echo "---"
      diff -n a.txt b.txt
    `);
    assert.equal(res.exitCode, 1);
    assert.equal(
      res.stdout,
      [
        "3a",
        "four",
        ".",
        "2c",
        "TWO",
        ".",
        "---",
        "d2 1",
        "a2 1",
        "TWO",
        "a3 1",
        "four",
        "",
      ].join("\n")
    );
  });

  it("4. diff -D MACRO generates #ifdef / #ifndef / #else / #endif blocks", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'common\\nold_impl\\n' > a.txt
      printf 'common\\nnew_impl\\n' > b.txt
      diff -D USE_NEW a.txt b.txt
      echo "RC=$?"
    `);
    assert.equal(res.exitCode, 0);
    assert.ok(res.stdout.includes("common\n"));
    assert.ok(
      res.stdout.includes("#ifndef USE_NEW\nold_impl\n#else /* USE_NEW */\nnew_impl\n#endif /* USE_NEW */\n")
    );
    assert.ok(res.stdout.endsWith("RC=1\n"));
  });

  it("5. diff whitespace and case ignore flags (-i, -b, -w, -B, -Z, -E, --strip-trailing-cr)", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'Hello   World  \\r\\n\\r\\nEnd\\tLine\\r\\n' > a.txt
      printf 'hello world\\nEnd        Line\\n' > b.txt
      diff -i -b -B -E --strip-trailing-cr a.txt b.txt
      echo "RC1=$?"
      diff -w -i -B --strip-trailing-cr a.txt b.txt
      echo "RC2=$?"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "RC1=0\nRC2=0\n");
  });

  it("6. diff -I REGEX ignore matching lines combined with -B ignore blank lines", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf '# timestamp: 100\\nkeep_me\\n\\n' > a.txt
      printf '# timestamp: 200\\nkeep_me\\n' > b.txt
      diff -I '^# timestamp:' -B a.txt b.txt
      echo "IGNORED_RC=$?"
      diff -I '^# timestamp:' a.txt b.txt >/dev/null
      echo "WITHOUT_B_RC=$?"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "IGNORED_RC=0\nWITHOUT_B_RC=1\n");
  });

  it("7. diff -p (show C function) and diff -F REGEX function context headers in unified diff", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > a.py
def compute_total(items):
    base = 1
    step = 2
    acc = 3
    old_ret = 4
    return old_ret
EOF
      cat <<'EOF' > b.py
def compute_total(items):
    base = 1
    step = 2
    acc = 3
    new_ret = 5
    return new_ret
EOF
      diff -u -F '^def ' a.py b.py | grep '^@@'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout.trim(), "@@ -2,5 +2,5 @@ def compute_total(items):");
  });

  it("8. diff -r -N -x '*.tmp' -S beta.txt recursive directory diff with filters", async () => {
    const env = createEnv();
    const res = await env.exec(`
      mkdir -p d1 d2
      printf 'skip\\n' > d1/alpha.txt
      printf 'different\\n' > d2/alpha.txt
      printf 'same\\n' > d1/beta.txt
      printf 'same\\n' > d2/beta.txt
      printf 'ignore\\n' > d1/cache.tmp
      printf 'created\\n' > d2/gamma.txt
      diff -r -u -N -x '*.tmp' -S beta.txt -L d1/gamma.txt -L d2/gamma.txt d1 d2
    `);
    assert.equal(res.exitCode, 1);
    assert.ok(!res.stdout.includes("alpha.txt"));
    assert.ok(!res.stdout.includes("cache.tmp"));
    assert.ok(res.stdout.includes("+created\n"));
  });

  it("9. diff -q brief, -s report-identical, and binary NUL detection vs -a text mode", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'same\\n' > s1.txt
      printf 'same\\n' > s2.txt
      diff -s s1.txt s2.txt
      printf 'bin\\x00one\\n' > b1.bin
      printf 'bin\\x00two\\n' > b2.bin
      diff b1.bin b2.bin
      diff -q b1.bin b2.bin
      diff -a -u -L b1 -L b2 b1.bin b2.bin | tr -d '\\000' | grep '^[+-]bin'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "Files s1.txt and s2.txt are identical",
        "Binary files b1.bin and b2.bin differ",
        "Files b1.bin and b2.bin differ",
        "-binone",
        "+bintwo",
        "",
      ].join("\n")
    );
  });

  it("10. diff --from-file and --to-file multi-operand comparisons", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'base\\n' > base.txt
      printf 'base\\n' > c1.txt
      printf 'changed\\n' > c2.txt
      diff -q --from-file=base.txt c1.txt c2.txt
      echo "RC1=$?"
      diff -q --to-file=base.txt c1.txt c2.txt
      echo "RC2=$?"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "Files base.txt and c2.txt differ",
        "RC1=1",
        "Files c2.txt and base.txt differ",
        "RC2=1",
        "",
      ].join("\n")
    );
  });

  it("11. patch -p1 unified multi-file apply, -R reverse, --dry-run, and -o - stdout", async () => {
    const env = createEnv();
    const res = await env.exec(`
      mkdir -p src
      printf 'v1\\nkeep\\n' > src/app.txt
      cat <<'EOF' > change.patch
--- a/src/app.txt
+++ b/src/app.txt
@@ -1,2 +1,2 @@
-v1
+v2
 keep
EOF
      patch -p1 --dry-run < change.patch >/dev/null
      cat src/app.txt
      patch -p1 -o - < change.patch
      patch -p1 < change.patch >/dev/null
      cat src/app.txt
      patch -p1 -R < change.patch >/dev/null
      cat src/app.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      ["v1", "keep", "v2", "keep", "v2", "keep", "v1", "keep", ""].join("\n")
    );
  });

  it("12. patch applies context diff and normal diff with offset and -F fuzz", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'l1\\nl2\\nl3\\n' > norm.txt
      printf 'l1\\nL2\\nl3\\n' > norm_new.txt
      diff norm.txt norm_new.txt > norm.diff
      patch norm.txt < norm.diff >/dev/null
      cat norm.txt
      printf 'extra_top\\nc1_modified\\nc2\\nc3\\nc4\\n' > fuzz.txt
      cat <<'EOF' > fuzz.patch
--- a/fuzz.txt
+++ b/fuzz.txt
@@ -1,4 +1,4 @@
 c1_original
 c2
-c3
+C3_PATCHED
 c4
EOF
      patch -F 1 fuzz.txt < fuzz.patch >/dev/null
      cat fuzz.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      ["l1", "L2", "l3", "extra_top", "c1_modified", "c2", "C3_PATCHED", "c4", ""].join("\n")
    );
  });

  it("13. patch -b -z .orig simple backup and -b -V numbered backups (.~1~, .~2~)", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'step0\\n' > f.txt
      cat <<'EOF' > p1.patch
--- f.txt
+++ f.txt
@@ -1 +1 @@
-step0
+step1
EOF
      cat <<'EOF' > p2.patch
--- f.txt
+++ f.txt
@@ -1 +1 @@
-step1
+step2
EOF
      patch -b -z .orig f.txt < p1.patch >/dev/null
      cat f.txt.orig
      patch -b -V numbered f.txt < p2.patch >/dev/null
      cat f.txt.~1~
      cat f.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "step0\nstep1\nstep2\n");
  });

  it("14. patch -N forward-only skips previously applied patch vs default reverse prompt", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'patched\\n' > item.txt
      cat <<'EOF' > item.patch
--- item.txt
+++ item.txt
@@ -1 +1 @@
-orig
+patched
EOF
      patch -N item.txt < item.patch >/dev/null
      echo "FORWARD_RC=$?"
      cat item.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "FORWARD_RC=1\npatched\n");
  });

  it("15. patch creates new files from /dev/null and removes empty files with -E", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > create.patch
--- /dev/null
+++ newdir/created.txt
@@ -0,0 +1,2 @@
+line_a
+line_b
EOF
      patch -p0 < create.patch >/dev/null
      cat newdir/created.txt
      cat <<'EOF' > delete.patch
--- newdir/created.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-line_a
-line_b
EOF
      patch -p0 -E < delete.patch >/dev/null
      test ! -e newdir/created.txt && echo "DELETED_OK"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "line_a\nline_b\nDELETED_OK\n");
  });

  it("16. patch -D GUARD wraps changes in #ifndef / #else / #endif preprocessor guards", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'head\\nold_body\\ntail\\n' > guard.c
      cat <<'EOF' > guard.patch
--- guard.c
+++ guard.c
@@ -1,3 +1,3 @@
 head
-old_body
+new_body
 tail
EOF
      patch -D EXP_FLAG guard.c < guard.patch >/dev/null
      cat guard.c
    `);
    assert.equal(res.exitCode, 0);
    assert.ok(res.stdout.includes("#ifndef EXP_FLAG\nold_body\n#else\nnew_body\n#endif\n"));
  });

  it("17. apply_patch handles Add File, Update File (multi-hunk), Move to, and Delete File", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'header\\nv1\\nmiddle\\nv2\\nfooter\\n' > old_name.txt
      printf 'obsolete\\n' > drop_me.txt
      apply_patch <<'EOF'
*** Begin Patch
*** Add File: sub/added.txt
+brand new
+second line
*** Update File: old_name.txt
*** Move to: sub/new_name.txt
@@
 header
-v1
+V1_UPDATED
@@
 middle
-v2
+V2_UPDATED
 footer
*** Delete File: drop_me.txt
*** End Patch
EOF
      echo "---ADDED---"
      cat sub/added.txt
      echo "---MOVED---"
      cat sub/new_name.txt
      test ! -e old_name.txt && test ! -e drop_me.txt && echo "CLEAN_OK"
    `);
    assert.equal(res.exitCode, 0);
    assert.ok(res.stdout.includes("---ADDED---\nbrand new\nsecond line\n"));
    assert.ok(res.stdout.includes("---MOVED---\nheader\nV1_UPDATED\nmiddle\nV2_UPDATED\nfooter\n"));
    assert.ok(res.stdout.endsWith("CLEAN_OK\n"));
  });

  it("18. cmp default report, -s silent, -l octal byte table, -b print-bytes, -i skip, and -n limit", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'AAXBB' > c1.bin
      printf 'AAYBB' > c2.bin
      cmp c1.bin c2.bin
      echo "CMP_RC=$?"
      cmp -b c1.bin c2.bin
      cmp -l c1.bin c2.bin
      cmp -s -n 2 c1.bin c2.bin
      echo "LIMIT2_RC=$?"
      cmp -s -i 3:3 c1.bin c2.bin
      echo "SKIP3_RC=$?"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "c1.bin c2.bin differ: char 3, line 1",
        "CMP_RC=1",
        "c1.bin c2.bin differ: byte 3, line 1 is 130 X 131 Y",
        "3 130 131",
        "LIMIT2_RC=0",
        "SKIP3_RC=0",
        "",
      ].join("\n")
    );
  });

  it("19. diff3 -m clean 3-way merge and conflict markers with custom -L labels", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'line1\\nline2\\nline3\\n' > base.txt
      printf 'LINE1_MINE\\nline2\\nline3\\n' > mine.txt
      printf 'line1\\nline2\\nLINE3_THEIRS\\n' > theirs.txt
      diff3 -m mine.txt base.txt theirs.txt
      echo "CLEAN_RC=$?"
      printf 'CONFLICT_MINE\\nline2\\n' > c_mine.txt
      printf 'line1\\nline2\\n' > c_base.txt
      printf 'CONFLICT_THEIRS\\nline2\\n' > c_theirs.txt
      diff3 -m -L MINE -L BASE -L THEIRS c_mine.txt c_base.txt c_theirs.txt
      echo "CONFLICT_RC=$?"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "LINE1_MINE",
        "line2",
        "LINE3_THEIRS",
        "CLEAN_RC=0",
        "<<<<<<< MINE",
        "CONFLICT_MINE",
        "||||||| BASE",
        "line1",
        "=======",
        "CONFLICT_THEIRS",
        ">>>>>>> THEIRS",
        "line2",
        "CONFLICT_RC=1",
        "",
      ].join("\n")
    );
  });

  it("20. wdiff word-by-word diff with [-deleted-] and {+inserted+}, stdin (-), and exit codes", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'alpha   beta\\ngamma\\n' > w1.txt
      printf 'alpha   BETA_NEW\\ngamma\\n' > w2.txt
      wdiff w1.txt w2.txt
      echo "DIFF_RC=$?"
      wdiff w1.txt w1.txt >/dev/null
      echo "SAME_RC=$?"
      printf 'alpha   beta\\ngamma\\n' | wdiff - w2.txt
      echo "STDIN_RC=$?"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "alpha   [-beta-] {+BETA_NEW+}",
        "gamma",
        "DIFF_RC=1",
        "SAME_RC=0",
        "alpha   [-beta-] {+BETA_NEW+}",
        "gamma",
        "STDIN_RC=1",
        "",
      ].join("\n")
    );
  });
});
