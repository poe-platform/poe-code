import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withE2EHarness } from "./harness.js";

function createShell() {
  return {
    exec(script: string) {
      return withE2EHarness(async (h) => {
        await h.exec("mkdir -p /work");
        return h.exec(script);
      });
    }
  };
}

describe("obscure apply_patch, diff, diff3, patch, cmp, and wdiff parity matrix", () => {
  test("1. apply_patch anchored insertion, successive insertions, and unanchored insertion", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'first\\nsecond\\nthird\\n' > /work/f1.txt
      apply_patch <<'EOF' >/dev/null
*** Begin Patch
*** Update File: /work/f1.txt
@@ first
+inserted
*** End Patch
EOF
      cat /work/f1.txt
      echo "---"
      printf 'first\\nsecond\\nthird\\n' > /work/f2.txt
      apply_patch <<'EOF' >/dev/null
*** Begin Patch
*** Update File: /work/f2.txt
@@ first
+one
@@ second
+two
*** End Patch
EOF
      cat /work/f2.txt
      echo "---"
      printf 'first\\nsecond\\n' > /work/f3.txt
      apply_patch <<'EOF' >/dev/null
*** Begin Patch
*** Update File: /work/f3.txt
@@
+top
*** End Patch
EOF
      cat /work/f3.txt
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "first",
        "inserted",
        "second",
        "third",
        "---",
        "first",
        "one",
        "second",
        "two",
        "third",
        "---",
        "top",
        "first",
        "second",
        ""
      ].join("\n")
    );
  });

  test("2. apply_patch nested anchors, anchor context, and anchor deletion", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'first\\nsecond\\nthird\\n' > /work/a.txt
      apply_patch <<'EOF' >/dev/null
*** Begin Patch
*** Update File: /work/a.txt
@@ first
@@ second
-second
+changed
*** End Patch
EOF
      cat /work/a.txt
      echo "---"
      printf 'first\\nsecond\\nthird\\n' > /work/b.txt
      apply_patch <<'EOF' >/dev/null
*** Begin Patch
*** Update File: /work/b.txt
@@ first
-first
+FIRST_NEW
 second
*** End Patch
EOF
      cat /work/b.txt
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "first",
        "changed",
        "third",
        "---",
        "FIRST_NEW",
        "second",
        "third",
        ""
      ].join("\n")
    );
  });

  test("3. apply_patch missing context anchor and out-of-order anchor rejection", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'first\\nsecond\\nthird\\n' > /work/order.txt
      apply_patch <<'EOF' 2>/work/e1.txt
*** Begin Patch
*** Update File: /work/order.txt
@@ nonexistent
-second
+SECOND
*** End Patch
EOF
      echo "rc1=$?"
      apply_patch <<'EOF' 2>/work/e2.txt
*** Begin Patch
*** Update File: /work/order.txt
@@ third
-third
+THIRD
@@ first
-first
+FIRST
*** End Patch
EOF
      echo "rc2=$?"
      cat /work/e1.txt /work/e2.txt
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "rc1=1",
        "rc2=1",
        "apply_patch: context anchor not found: /work/order.txt",
        "apply_patch: context anchor not found: /work/order.txt",
        ""
      ].join("\n")
    );
  });

  test("4. apply_patch pure Move to preserves binary NUL/non-UTF8 bytes while hunk update rejects NUL/non-UTF8", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf '\\xff\\x00\\x80' > /work/raw.bin
      apply_patch <<'EOF' >/dev/null
*** Begin Patch
*** Update File: /work/raw.bin
*** Move to: /work/sub/moved.bin
*** End Patch
EOF
      echo "move_rc=$? old_exists=$([ -e /work/raw.bin ] && echo yes || echo no)"
      xxd -p /work/sub/moved.bin

      apply_patch <<'EOF' 2>/work/nul.err
*** Begin Patch
*** Update File: /work/sub/moved.bin
@@
-a
+b
*** End Patch
EOF
      echo "nul_rc=$?"
      cat /work/nul.err
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "move_rc=0 old_exists=no",
        "ff0080",
        "nul_rc=1",
        "apply_patch: NUL bytes are unsupported",
        ""
      ].join("\n")
    );
  });

  test("5. apply_patch blank context lines across LF and CRLF files and unmatched blank context error", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'a\\r\\n\\r\\nb\\r\\n' > /work/crlf.txt
      apply_patch <<'EOF' >/dev/null
*** Begin Patch
*** Update File: /work/crlf.txt
@@
 a

-b
+c
*** End Patch
EOF
      xxd -p /work/crlf.txt

      printf 'a\\nb\\n' > /work/noblank.txt
      apply_patch <<'EOF' 2>/work/noblank.err
*** Begin Patch
*** Update File: /work/noblank.txt
@@
 a

-b
+c
*** End Patch
EOF
      echo "nb_rc=$?"
      cat /work/noblank.err
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "610d0a0d0a630d0a",
        "nb_rc=1",
        "apply_patch: expected context not found: /work/noblank.txt",
        ""
      ].join("\n")
    );
  });

  test("6. apply_patch empty update hunk diagnostics across header and Move to combinations", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'first\\n' > /work/f.txt
      apply_patch <<'EOF' 2>/work/u1.err
*** Begin Patch
*** Update File: /work/f.txt
*** End Patch
EOF
      echo "rc1=$?"
      apply_patch <<'EOF' 2>/work/u2.err
*** Begin Patch
*** Update File: /work/f.txt
*** Move to: /work/f2.txt
@@ first
*** End Patch
EOF
      echo "rc2=$?"
      apply_patch <<'EOF' 2>/work/u3.err
*** Begin Patch
*** Update File: /work/f.txt
@@
@@
-first
+second
*** End Patch
EOF
      echo "rc3=$?"
      cat /work/u1.err /work/u2.err /work/u3.err
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "rc1=2",
        "rc2=2",
        "rc3=2",
        "apply_patch: Update requires a nonempty hunk",
        "apply_patch: Update requires a nonempty hunk",
        "apply_patch: empty update hunk",
        ""
      ].join("\n")
    );
  });

  test("7. apply_patch End of File constraints and anchored EOF insertion", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'first\\nsecond\\nthird\\n' > /work/eof.txt
      apply_patch <<'EOF' >/dev/null
*** Begin Patch
*** Update File: /work/eof.txt
@@ first
+tail_line
*** End of File
*** End Patch
EOF
      cat /work/eof.txt

      apply_patch <<'EOF' 2>/work/eof1.err
*** Begin Patch
*** Update File: /work/eof.txt
*** End of File
*** End Patch
EOF
      echo "rc1=$?"

      apply_patch <<'EOF' 2>/work/eof2.err
*** Begin Patch
*** Update File: /work/eof.txt
@@
-third
+3rd
*** End of File
@@
-first
+1st
*** End Patch
EOF
      echo "rc2=$?"
      cat /work/eof1.err /work/eof2.err
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "first",
        "second",
        "third",
        "tail_line",
        "rc1=2",
        "rc2=2",
        "apply_patch: EOF requires a nonempty hunk",
        "apply_patch: EOF must terminate the file's last hunk",
        ""
      ].join("\n")
    );
  });

  test("8. apply_patch path validation diagnostics (traversal, directory path, root target, conflict)", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      apply_patch <<'EOF' 2>/work/p1.err
*** Begin Patch
*** Add File: ../escape.txt
+x
*** End Patch
EOF
      echo "rc1=$?"
      apply_patch <<'EOF' 2>/work/p2.err
*** Begin Patch
*** Add File: /work/dir/
+x
*** End Patch
EOF
      echo "rc2=$?"
      apply_patch <<'EOF' 2>/work/p3.err
*** Begin Patch
*** Add File: /work/a
+x
*** Add File: /work/a/b
+y
*** End Patch
EOF
      echo "rc3=$?"
      cat /work/p1.err /work/p2.err /work/p3.err
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "rc1=2",
        "rc2=2",
        "rc3=2",
        "apply_patch: parent traversal is unsupported",
        "apply_patch: path names a directory",
        "apply_patch: duplicate or conflicting patch paths",
        ""
      ].join("\n")
    );
  });

  test("9. apply_patch filesystem preflight diagnostics (symlink, non-regular file, missing target, existing Move destination)", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      mkdir -p /work/real_dir
      printf 'hello\\n' > /work/real_dir/file.txt
      printf 'taken\\n' > /work/real_dir/taken.txt
      ln -s /work/real_dir /work/sym_dir

      apply_patch <<'EOF' 2>/work/f1.err
*** Begin Patch
*** Update File: /work/sym_dir/file.txt
@@
-hello
+world
*** End Patch
EOF
      echo "rc1=$?"

      apply_patch <<'EOF' 2>/work/f2.err
*** Begin Patch
*** Delete File: /work/real_dir
*** End Patch
EOF
      echo "rc2=$?"

      apply_patch <<'EOF' 2>/work/f3.err
*** Begin Patch
*** Delete File: /work/real_dir/missing.txt
*** End Patch
EOF
      echo "rc3=$?"

      apply_patch <<'EOF' 2>/work/f4.err
*** Begin Patch
*** Update File: /work/real_dir/file.txt
*** Move to: /work/real_dir/taken.txt
@@
-hello
+world
*** End Patch
EOF
      echo "rc4=$?"
      cat /work/f1.err /work/f2.err /work/f3.err /work/f4.err
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "rc1=1",
        "rc2=1",
        "rc3=1",
        "rc4=1",
        "apply_patch: symlink paths are unsupported: /work/sym_dir",
        "apply_patch: target is not a regular file: /work/real_dir",
        "apply_patch: missing target: /work/real_dir/missing.txt",
        "apply_patch: Move destination already exists: /work/real_dir/taken.txt",
        ""
      ].join("\n")
    );
  });

  test("10. diff recursive -r with -N, -q, -s, and -x exclude patterns", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      mkdir -p /work/d1 /work/d2
      printf 'same\\n' > /work/d1/same.txt
      printf 'same\\n' > /work/d2/same.txt
      printf 'old\\n' > /work/d1/mod.txt
      printf 'new\\n' > /work/d2/mod.txt
      printf 'ignore1\\n' > /work/d1/skip.bak
      printf 'ignore2\\n' > /work/d2/skip.bak
      diff -r -q -s -x '*.bak' /work/d1 /work/d2
      echo "rc=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "Files /work/d1/mod.txt and /work/d2/mod.txt differ",
        "Files /work/d1/same.txt and /work/d2/same.txt are identical",
        "rc=1",
        ""
      ].join("\n")
    );
  });

  test("11. diff -u with missing trailing newline indicator (\\\\ No newline at end of file)", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'line1\\nline2' > /work/n1.txt
      printf 'line1\\nline2\\n' > /work/n2.txt
      diff -u -L a.txt -L b.txt /work/n1.txt /work/n2.txt
      echo "rc=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "--- a.txt",
        "+++ b.txt",
        "@@ -1,2 +1,2 @@",
        " line1",
        "-line2",
        "\\ No newline at end of file",
        "+line2",
        "rc=1",
        ""
      ].join("\n")
    );
  });

  test("12. diff3 -E flagged ed script, -e unflagged ed script, -x overlap-only, -3 easy-only, and -i w/q trailer", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'a\\nb\\nc\\n' > /work/base.txt
      printf 'A_OURS\\nb\\nC_OURS\\n' > /work/ours.txt
      printf 'a\\nb\\nC_THEIRS\\n' > /work/theirs.txt
      diff3 -E -i /work/ours.txt /work/base.txt /work/theirs.txt
      echo "rc_E=$?"
      diff3 -3 /work/ours.txt /work/base.txt /work/theirs.txt
      echo "rc_3=$?"
      diff3 -x /work/ours.txt /work/base.txt /work/theirs.txt
      echo "rc_x=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "3a",
        "=======",
        "C_THEIRS",
        ">>>>>>> /work/theirs.txt",
        ".",
        "2a",
        "<<<<<<< /work/ours.txt",
        ".",
        "w",
        "q",
        "rc_E=0",
        "rc_3=0",
        "3c",
        "C_THEIRS",
        ".",
        "rc_x=0",
        ""
      ].join("\n")
    );
  });

  test("13. diff3 option validation diagnostics (incompatible selectors, -m with -i, labels)", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      diff3 -e -x a b c 2>/work/d1.err
      echo "rc1=$?"
      diff3 -m -i a b c 2>/work/d2.err
      echo "rc2=$?"
      diff3 -L l1 -L l2 -L l3 -L l4 -m a b c 2>/work/d3.err
      echo "rc3=$?"
      diff3 -L l1 a b c 2>/work/d4.err
      echo "rc4=$?"
      cat /work/d1.err /work/d2.err /work/d3.err /work/d4.err
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "rc1=2",
        "rc2=2",
        "rc3=2",
        "rc4=2",
        "diff3: Incompatible script selectors",
        "diff3: Incompatible options: merge and write/quit",
        "diff3: Too many file labels",
        "diff3: Labels require a flagging mode",
        ""
      ].join("\n")
    );
  });

  test("14. patch -b backup with -z suffix, -o output file, and --dry-run", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'one\\ntwo\\nthree\\n' > /work/target.txt
      cat <<'EOF' > /work/change.patch
--- /work/target.txt
+++ /work/target.txt
@@ -1,3 +1,3 @@
 one
-two
+TWO
 three
EOF
      patch --dry-run /work/target.txt < /work/change.patch >/dev/null
      cat /work/target.txt
      patch -o /work/preview.txt /work/target.txt < /work/change.patch >/dev/null
      cat /work/preview.txt
      patch -b -z .bak /work/target.txt < /work/change.patch >/dev/null
      cat /work/target.txt /work/target.txt.bak
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "one",
        "two",
        "three",
        "one",
        "TWO",
        "three",
        "one",
        "TWO",
        "three",
        "one",
        "two",
        "three",
        ""
      ].join("\n")
    );
  });

  test("15. patch -r reject file generation on failed hunk and -l ignore-whitespace matching", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'alpha   beta\\ngamma\\n' > /work/ws.txt
      cat <<'EOF' > /work/ws.patch
--- /work/ws.txt
+++ /work/ws.txt
@@ -1,2 +1,2 @@
 alpha beta
-gamma
+GAMMA_NEW
EOF
      patch -l /work/ws.txt < /work/ws.patch >/dev/null
      cat /work/ws.txt

      cat <<'EOF' > /work/bad.patch
--- /work/ws.txt
+++ /work/ws.txt
@@ -1,2 +1,2 @@
 nonexistent_context
-gamma
+FAIL
EOF
      patch -r /work/custom.rej /work/ws.txt < /work/bad.patch >/dev/null 2>&1
      echo "bad_rc=$? rej_exists=$([ -f /work/custom.rej ] && echo yes || echo no)"
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "alpha   beta",
        "GAMMA_NEW",
        "bad_rc=1 rej_exists=yes",
        ""
      ].join("\n")
    );
  });

  test("16. patch normal diff and context diff format application and -R reversal", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'a\\nb\\nc\\n' > /work/orig.txt
      printf 'a\\nB_MOD\\nc\\n' > /work/mod.txt
      diff -c /work/orig.txt /work/mod.txt > /work/ctx.patch
      cp /work/orig.txt /work/work.txt
      patch /work/work.txt < /work/ctx.patch >/dev/null
      cat /work/work.txt
      patch -R /work/work.txt < /work/ctx.patch >/dev/null
      cat /work/work.txt
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "a",
        "B_MOD",
        "c",
        "a",
        "b",
        "c",
        ""
      ].join("\n")
    );
  });

  test("17. cmp -b print-bytes control/meta formatting and EOF truncation diagnostic on stderr", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf '\\x01\\x7f' > /work/c1.bin
      printf '\\x81\\xff' > /work/c2.bin
      cmp -b /work/c1.bin /work/c2.bin
      echo "rc1=$?"
      printf 'short' > /work/s1.bin
      printf 'shorter' > /work/s2.bin
      cmp /work/s1.bin /work/s2.bin 2>/work/eof.err
      echo "rc2=$?"
      cat /work/eof.err
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "/work/c1.bin /work/c2.bin differ: byte 1, line 1 is   1 ^A 201 M-^A",
        "rc1=1",
        "rc2=1",
        "cmp: EOF on /work/s1.bin after byte 5, in line 1",
        ""
      ].join("\n")
    );
  });

  test("18. cmp -i SKIP1:SKIP2 with hex/octal/IEC suffixes and incompatible -l -s exit code 2", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'XXXXmatch' > /work/x1.bin
      printf 'YYmatch' > /work/x2.bin
      cmp -i 0x4:02 -n 5 /work/x1.bin /work/x2.bin
      echo "rc1=$?"
      cmp -l -s /work/x1.bin /work/x2.bin 2>/work/inc.err
      echo "rc2=$?"
      cat /work/inc.err
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "rc1=0",
        "rc2=2",
        "cmp: options -l and -s are incompatible",
        "cmp: Try 'cmp --help' for more information.",
        ""
      ].join("\n")
    );
  });

  test("19. wdiff word diffing with leading/trailing whitespace, -- separator, and --help", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      wdiff --help | head -n 1
      printf '  one\\ttwo  \\n' > /work/-w1.txt
      printf '  one\\tthree  \\n' > /work/-w2.txt
      cd /work
      wdiff -- -w1.txt -w2.txt
      echo "rc=$?"
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "Usage: wdiff OLD NEW",
        "  one\t[-two-] {+three+}  ",
        "rc=1",
        ""
      ].join("\n")
    );
  });

  test("20. wdiff validation diagnostics for operand count and double stdin (- -)", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      wdiff /work/only_one 2>/work/w1.err
      echo "rc1=$?"
      wdiff - - 2>/work/w2.err
      echo "rc2=$?"
      cat /work/w1.err /work/w2.err
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "rc1=2",
        "rc2=2",
        "wdiff: expected two files (at most one stdin operand)",
        "wdiff: expected two files (at most one stdin operand)",
        ""
      ].join("\n")
    );
  });
});
