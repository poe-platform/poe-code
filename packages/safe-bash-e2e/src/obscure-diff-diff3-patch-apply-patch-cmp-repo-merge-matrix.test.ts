import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure diff, diff3, patch, apply_patch, cmp & repo merge matrix", () => {
  it("01: generates unified diff with diff -u and applies it cleanly with patch -p0", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'line1\\nline2\\nline3\\nline4\\n' > /workspace/orig.txt
        printf 'line1\\nline2-mod\\nline3\\nline4\\nline5\\n' > /workspace/new.txt
        diff -u /workspace/orig.txt /workspace/new.txt > /workspace/change.patch || true
        cp /workspace/orig.txt /workspace/target.txt
        patch -p0 /workspace/target.txt < /workspace/change.patch >/dev/null
        cmp -s /workspace/target.txt /workspace/new.txt && echo "MATCH"
        cat /workspace/target.txt
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "MATCH\nline1\nline2-mod\nline3\nline4\nline5\n");
    });
  });

  it("02: applies and reverses a unified diff with patch -R -p0 to restore original content", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'alpha\\nbeta\\ngamma\\ndelta\\n' > /workspace/a.txt
        printf 'alpha\\nBETA\\ngamma\\ndelta\\nepsilon\\n' > /workspace/b.txt
        diff -u /workspace/a.txt /workspace/b.txt > /workspace/ab.patch || true
        cp /workspace/b.txt /workspace/work.txt
        patch -R -p0 /workspace/work.txt < /workspace/ab.patch >/dev/null
        cmp -s /workspace/work.txt /workspace/a.txt && echo "REVERSED_OK"
        cat /workspace/work.txt
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "REVERSED_OK\nalpha\nbeta\ngamma\ndelta\n");
    });
  });

  it("03: strips multi-level path prefixes with patch -p1 across nested directory trees", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/src/pkg
        printf 'const x = 1;\\nconst y = 2;\\n' > /workspace/src/pkg/index.ts
        cat << 'PATCH' > /workspace/p1.patch
--- a/src/pkg/index.ts
+++ b/src/pkg/index.ts
@@ -1,2 +1,3 @@
 const x = 1;
-const y = 2;
+const y = 20;
+const z = 30;
PATCH
        cd /workspace && patch -p1 < /workspace/p1.patch >/dev/null
        cat /workspace/src/pkg/index.ts
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "const x = 1;\nconst y = 20;\nconst z = 30;\n");
    });
  });

  it("04: verifies patch --dry-run leaves target file untouched before applying for real", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'one\\ntwo\\nthree\\n' > /workspace/f.txt
        printf 'one\\nTWO\\nthree\\n' > /workspace/f2.txt
        diff -u /workspace/f.txt /workspace/f2.txt > /workspace/f.patch || true
        patch --dry-run -p0 /workspace/f.txt < /workspace/f.patch >/dev/null
        cat /workspace/f.txt
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "one\ntwo\nthree\n");
    });
  });

  it("05: merges non-overlapping 3-way changes cleanly with diff3 -m (exit code 0)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'line1\\nline2\\nline3\\nline4\\nline5\\n' > /workspace/base.txt
        printf 'LINE1_OURS\\nline2\\nline3\\nline4\\nline5\\n' > /workspace/ours.txt
        printf 'line1\\nline2\\nline3\\nline4\\nLINE5_THEIRS\\n' > /workspace/theirs.txt
        diff3 -m /workspace/ours.txt /workspace/base.txt /workspace/theirs.txt
        echo "EXIT=$?"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "LINE1_OURS\nline2\nline3\nline4\nLINE5_THEIRS\nEXIT=0\n");
    });
  });

  it("06: detects overlapping 3-way conflict with diff3 -m and exits with status 1 and conflict markers", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'header\\nshared\\nfooter\\n' > /workspace/base.txt
        printf 'header\\nours_change\\nfooter\\n' > /workspace/ours.txt
        printf 'header\\ntheirs_change\\nfooter\\n' > /workspace/theirs.txt
        set +e
        out=$(diff3 -m /workspace/ours.txt /workspace/base.txt /workspace/theirs.txt)
        rc=$?
        set -e
        echo "RC=$rc"
        printf '%s\\n' "$out" | grep -E '^(<<<<<<<|=======|>>>>>>>|ours_change|theirs_change|header|footer)'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "RC=1\nheader\n<<<<<<< /workspace/ours.txt\nours_change\n=======\ntheirs_change\n>>>>>>> /workspace/theirs.txt\nfooter\n",
      );
    });
  });

  it("07: performs multi-file Add, Update, and Delete in a single apply_patch invocation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/app
        printf 'old_a\\nkeep_b\\nold_c\\n' > /workspace/app/mod.txt
        printf 'obsolete\\n' > /workspace/app/remove_me.txt
        cd /workspace
        apply_patch << 'PATCH' >/dev/null
*** Begin Patch
*** Add File: app/added.txt
+hello new file
+second line
*** Update File: app/mod.txt
@@
-old_a
+new_a
 keep_b
-old_c
+new_c
*** Delete File: app/remove_me.txt
*** End Patch
PATCH
        test ! -e /workspace/app/remove_me.txt && echo "DELETED_OK"
        cat /workspace/app/added.txt
        echo "---"
        cat /workspace/app/mod.txt
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "DELETED_OK\nhello new file\nsecond line\n---\nnew_a\nkeep_b\nnew_c\n");
    });
  });

  it("08: moves and updates a file into a new nested directory via apply_patch *** Move to:", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/legacy
        printf 'v1\\nstatus=draft\\n' > /workspace/legacy/config.ini
        cd /workspace
        apply_patch << 'PATCH' >/dev/null
*** Begin Patch
*** Update File: legacy/config.ini
*** Move to: modern/settings.ini
@@
 v1
-status=draft
+status=active
*** End Patch
PATCH
        test ! -e /workspace/legacy/config.ini && echo "OLD_GONE"
        cat /workspace/modern/settings.ini
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "OLD_GONE\nv1\nstatus=active\n");
    });
  });

  it("09: compares binary and text files with cmp -s and cmp -l byte offset reporting", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'ABCDEF' > /workspace/b1.bin
        printf 'ABCDEF' > /workspace/b2.bin
        printf 'ABXDEF' > /workspace/b3.bin
        cmp -s /workspace/b1.bin /workspace/b2.bin && echo "SAME=0"
        set +e
        cmp -s /workspace/b1.bin /workspace/b3.bin
        echo "DIFF=$?"
        set -e
        cmp /workspace/b1.bin /workspace/b3.bin || true
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "SAME=0\nDIFF=1\n/workspace/b1.bin /workspace/b3.bin differ: char 3, line 1\n",
      );
    });
  });

  it("10: compares directory trees with diff -rq and diff -ru across modified and unique files", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/d1 /workspace/d2
        printf 'same\\n' > /workspace/d1/same.txt
        printf 'same\\n' > /workspace/d2/same.txt
        printf 'v1\\n' > /workspace/d1/mod.txt
        printf 'v2\\n' > /workspace/d2/mod.txt
        printf 'only1\\n' > /workspace/d1/only1.txt
        diff -rq /workspace/d1 /workspace/d2 | sort
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "Files /workspace/d1/mod.txt and /workspace/d2/mod.txt differ\nOnly in /workspace/d1: only1.txt\n",
      );
    });
  });

  it("11: ignores case (-i), whitespace changes (-b/-w), and blank lines (-B) in diff", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'Hello   World\\n\\nFoo Bar\\n' > /workspace/t1.txt
        printf 'hello world\\nfoo   bar\\n' > /workspace/t2.txt
        diff -iwB /workspace/t1.txt /workspace/t2.txt && echo "NO_DIFF_WITH_FLAGS"
        diff -q /workspace/t1.txt /workspace/t2.txt || echo "RAW_DIFFERS"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "NO_DIFF_WITH_FLAGS\nFiles /workspace/t1.txt and /workspace/t2.txt differ\nRAW_DIFFERS\n",
      );
    });
  });

  it("12: applies a multi-hunk unified patch when earlier lines have shifted (offset hunks)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        seq 1 20 > /workspace/base20.txt
        sed '5s/5/FIVE/; 16s/16/SIXTEEN/' /workspace/base20.txt > /workspace/mod20.txt
        diff -u /workspace/base20.txt /workspace/mod20.txt > /workspace/two_hunks.patch || true
        {
          echo "inserted_top_1"
          echo "inserted_top_2"
          cat /workspace/base20.txt
        } > /workspace/shifted.txt
        patch -p0 /workspace/shifted.txt < /workspace/two_hunks.patch >/dev/null
        grep -n -E '^(inserted_top_1|FIVE|SIXTEEN)$' /workspace/shifted.txt
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1:inserted_top_1\n7:FIVE\n18:SIXTEEN\n");
    });
  });

  it("13: applies multiple sequential patches and verifies SHA-256 manifest integrity", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'step0\\n' > /workspace/doc.txt
        printf 'step0\\nstep1\\n' > /workspace/doc1.txt
        printf 'step0\\nstep1\\nstep2\\n' > /workspace/doc2.txt
        diff -u /workspace/doc.txt /workspace/doc1.txt > /workspace/p1.patch || true
        diff -u /workspace/doc1.txt /workspace/doc2.txt > /workspace/p2.patch || true
        patch -p0 /workspace/doc.txt < /workspace/p1.patch >/dev/null
        patch -p0 /workspace/doc.txt < /workspace/p2.patch >/dev/null
        sha256sum /workspace/doc.txt /workspace/doc2.txt | awk '{print $1}' | uniq | wc -l | tr -d ' '
        cat /workspace/doc.txt
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1\nstep0\nstep1\nstep2\n");
    });
  });

  it("14: parses diff3 -m conflict markers with awk to auto-resolve ours, base, and theirs sections", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'a\\nours\\nc\\n' > /workspace/ours.txt
        printf 'a\\nbase\\nc\\n' > /workspace/base.txt
        printf 'a\\ntheirs\\nc\\n' > /workspace/theirs.txt
        diff3 -m /workspace/ours.txt /workspace/base.txt /workspace/theirs.txt > /workspace/merged.txt || true
        awk '
          /^<<<<<<</ { mode = "ours"; next }
          /^\\|\\|\\|\\|\\|\\|\\|/ { mode = "base"; next }
          /^=======/ { mode = "theirs"; next }
          /^>>>>>>>/ { mode = ""; next }
          mode == "ours" { print "OURS:" $0 }
          mode == "base" { print "BASE:" $0 }
          mode == "theirs" { print "THEIRS:" $0 }
          mode == "" { print "CLEAN:" $0 }
        ' /workspace/merged.txt
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "CLEAN:a\nOURS:ours\nBASE:base\nTHEIRS:theirs\nCLEAN:c\n");
    });
  });

  it("15: generates ed script with diff -e and normal diff output with line-range markers", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'a\\nb\\nc\\n' > /workspace/f1.txt
        printf 'a\\nB\\nc\\nd\\n' > /workspace/f2.txt
        diff /workspace/f1.txt /workspace/f2.txt || true
        echo "---ED---"
        diff -e /workspace/f1.txt /workspace/f2.txt || true
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "2c2\n< b\n---\n> B\n3a4\n> d\n---ED---\n3a\nd\n.\n2c\nB\n.\n");
    });
  });

  it("16: applies multi-hunk apply_patch update to a single source file with context disambiguation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat << 'SRC' > /workspace/math.py
def add(a, b):
    return a + b

def mul(a, b):
    return a * b

def sub(a, b):
    return a - b
SRC
        cd /workspace
        apply_patch << 'PATCH' >/dev/null
*** Begin Patch
*** Update File: math.py
@@ def add(a, b):
-    return a + b
+    return int(a) + int(b)
@@ def sub(a, b):
-    return a - b
+    return int(a) - int(b)
*** End Patch
PATCH
        cat /workspace/math.py
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "def add(a, b):\n    return int(a) + int(b)\n\ndef mul(a, b):\n    return a * b\n\ndef sub(a, b):\n    return int(a) - int(b)\n",
      );
    });
  });

  it("17: creates backup files with patch -b when patching in place", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'orig_line\\n' > /workspace/item.txt
        printf 'patched_line\\n' > /workspace/item_new.txt
        diff -u /workspace/item.txt /workspace/item_new.txt > /workspace/item.patch || true
        patch -b -p0 /workspace/item.txt < /workspace/item.patch >/dev/null
        cat /workspace/item.txt.orig
        cat /workspace/item.txt
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "orig_line\npatched_line\n");
    });
  });

  it("18: creates a brand-new file when patching against --- /dev/null", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cd /workspace
        cat << 'PATCH' > /workspace/newfile.patch
--- /dev/null
+++ created.txt
@@ -0,0 +1,3 @@
+created-1
+created-2
+created-3
PATCH
        patch -p0 < /workspace/newfile.patch >/dev/null
        cat /workspace/created.txt
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "created-1\ncreated-2\ncreated-3\n");
    });
  });

  it("19: combines comm, diff, and join to audit sorted manifest changes", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat << 'M1' | sort > /workspace/m1.txt
pkg-a 1.0.0
pkg-b 2.0.0
pkg-c 3.0.0
M1
        cat << 'M2' | sort > /workspace/m2.txt
pkg-a 1.0.0
pkg-b 2.1.0
pkg-d 1.0.0
M2
        echo "UNCHANGED:"
        comm -12 /workspace/m1.txt /workspace/m2.txt
        echo "CHANGED_VERSION:"
        join /workspace/m1.txt /workspace/m2.txt | awk '$2 != $3 { print $1 ": " $2 " -> " $3 }'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "UNCHANGED:\npkg-a 1.0.0\nCHANGED_VERSION:\npkg-b: 2.0.0 -> 2.1.0\n");
    });
  });

  it("20: summarizes unified diff hunk headers and line additions/deletions via awk", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        seq 1 15 > /workspace/old.txt
        sed '3s/3/THREE/; 12s/12/TWELVE/' /workspace/old.txt > /workspace/new.txt
        diff -u /workspace/old.txt /workspace/new.txt > /workspace/changes.patch || true
        awk '
          /^@@/ { hunks++ }
          /^\\+[^+]/ { added++ }
          /^-[^-]/ { removed++ }
          END { printf "hunks=%d added=%d removed=%d\\n", hunks, added, removed }
        ' /workspace/changes.patch
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "hunks=2 added=2 removed=2\n");
    });
  });
});
