import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("diff, diff3, patch, apply_patch, cmp, comm, join, and paste merge/conflict/relational matrix", () => {
  it("1. diff generates unified (-u/-U) and context (-c/-C) diffs with custom --label headers", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/old.txt", "alpha\nbeta\ngamma\ndelta\n");
      await h.writeText("/workspace/new.txt", "alpha\nbeta-mod\ngamma\ndelta\n");

      const unified = await h.exec(
        "diff -U 1 --label orig/file.txt --label mod/file.txt /workspace/old.txt /workspace/new.txt",
      );
      assert.equal(unified.exitCode, 1);
      assert.match(unified.stdout, /^--- orig\/file\.txt/m);
      assert.match(unified.stdout, /^\+\+\+ mod\/file\.txt/m);
      assert.match(unified.stdout, /^-beta\n\+beta-mod$/m);

      const contextDiff = await h.exec("diff -C 1 /workspace/old.txt /workspace/new.txt");
      assert.equal(contextDiff.exitCode, 1);
      assert.match(contextDiff.stdout, /^\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*/m);
      assert.match(contextDiff.stdout, /^! beta-mod$/m);
    });
  });

  it("2. diff generates ed scripts (-e), RCS normal diffs (-n), and side-by-side (-y) views", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/a.txt", "one\ntwo\nthree\n");
      await h.writeText("/workspace/b.txt", "one\nTWO\nthree\nfour\n");

      const edScript = await h.exec("diff -e /workspace/a.txt /workspace/b.txt");
      assert.equal(edScript.exitCode, 1);
      assert.match(edScript.stdout, /3a\nfour\n\.\n2c\nTWO\n\./);

      const rcs = await h.exec("diff -n /workspace/a.txt /workspace/b.txt");
      assert.equal(rcs.exitCode, 1);
      assert.match(rcs.stdout, /d2 1\na2 1\nTWO\na3 1\nfour/);

      const sideBySide = await h.exec(
        "diff -y --suppress-common-lines /workspace/a.txt /workspace/b.txt",
      );
      assert.equal(sideBySide.exitCode, 1);
      assert.match(sideBySide.stdout, /two\s+\|\s+TWO/);
      assert.match(sideBySide.stdout, />\s+four/);
    });
  });

  it("3. diff honors -i (ignore case), -b/-w (ignore whitespace), -B (ignore blank lines), and -I (ignore regex)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/f1.txt", "Hello   World\n# comment 1\nkeep\n");
      await h.writeText("/workspace/f2.txt", "hello world\n\n# comment 2\nkeep\n");

      const res = await h.exec(
        "diff -i -b -B -I '^# comment' /workspace/f1.txt /workspace/f2.txt",
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "");
    });
  });

  it("4. diff -r -u -N recursively diffs directory trees with new/deleted files and -x exclusions", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/dirA/common.txt", "line1\n");
      await h.writeText("/workspace/dirA/onlyA.txt", "bye\n");
      await h.writeText("/workspace/dirA/ignore.tmp", "noise A\n");

      await h.writeText("/workspace/dirB/common.txt", "line1\nline2\n");
      await h.writeText("/workspace/dirB/onlyB.txt", "hello\n");
      await h.writeText("/workspace/dirB/ignore.tmp", "noise B\n");

      const res = await h.exec(
        "diff -r -u -N -x '*.tmp' /workspace/dirA /workspace/dirB",
      );
      assert.equal(res.exitCode, 1);
      assert.match(res.stdout, /\+line2/);
      assert.match(res.stdout, /-bye/);
      assert.match(res.stdout, /\+hello/);
      assert.doesNotMatch(res.stdout, /noise/);
    });
  });

  it("5. diff -q (brief) and -s (report identical) produce expected diagnostics and exit codes", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/same1.txt", "exact\n");
      await h.writeText("/workspace/same2.txt", "exact\n");
      await h.writeText("/workspace/diff.txt", "other\n");

      const sameRes = await h.exec("diff -s /workspace/same1.txt /workspace/same2.txt");
      assert.equal(sameRes.exitCode, 0);
      assert.match(sameRes.stdout, /are identical/);

      const briefDiff = await h.exec("diff -q /workspace/same1.txt /workspace/diff.txt");
      assert.equal(briefDiff.exitCode, 1);
      assert.match(briefDiff.stdout, /differ/);
    });
  });

  it("6. patch -p1 applies multi-file unified diffs, creates new files, and removes empty files with -E", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/v1/mod.txt", "a\nb\n");
      await h.writeText("/workspace/v1/del.txt", "remove-me\n");
      await h.writeText("/workspace/v2/mod.txt", "a\nB\nc\n");
      await h.writeText("/workspace/v2/add.txt", "brand-new\n");

      await h.exec("cd /workspace && diff -r -u -N v1 v2 > changes.patch");

      await h.writeText("/workspace/target/mod.txt", "a\nb\n");
      await h.writeText("/workspace/target/del.txt", "remove-me\n");

      const applyRes = await h.exec(
        "patch -d /workspace/target -p1 -E -i /workspace/changes.patch",
      );
      assert.equal(applyRes.exitCode, 0);
      assert.equal(await h.readText("/workspace/target/mod.txt"), "a\nB\nc\n");
      assert.equal(await h.readText("/workspace/target/add.txt"), "brand-new\n");
      assert.equal(await h.exists("/workspace/target/del.txt"), false);
    });
  });

  it("7. patch --dry-run validates hunks without mutating files, and patch -R reverses applied patches", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/src.txt", "v1\n");
      await h.writeText("/workspace/dst.txt", "v2\n");
      await h.exec("diff -u /workspace/src.txt /workspace/dst.txt > /workspace/up.patch");

      const dry = await h.exec("patch --dry-run /workspace/src.txt /workspace/up.patch");
      assert.equal(dry.exitCode, 0);
      assert.equal(await h.readText("/workspace/src.txt"), "v1\n");

      const forward = await h.exec("patch /workspace/src.txt /workspace/up.patch");
      assert.equal(forward.exitCode, 0);
      assert.equal(await h.readText("/workspace/src.txt"), "v2\n");

      const reverse = await h.exec("patch -R /workspace/src.txt /workspace/up.patch");
      assert.equal(reverse.exitCode, 0);
      assert.equal(await h.readText("/workspace/src.txt"), "v1\n");
    });
  });

  it("8. patch -l ignores whitespace changes and writes reject files (-r) when hunks fail", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/orig.txt", "keep   spaces\nmiddle\nend\n");
      await h.writeText("/workspace/next.txt", "keep spaces\nMIDDLE\nend\n");
      await h.exec("diff -u /workspace/orig.txt /workspace/next.txt > /workspace/ws.patch");

      await h.writeText("/workspace/ drifted.txt".replace(" ", ""), "keep\t\tspaces\nmiddle\nend\n");
      const wsApply = await h.exec("patch -l /workspace/drifted.txt /workspace/ws.patch");
      assert.equal(wsApply.exitCode, 0);
      assert.match(await h.readText("/workspace/drifted.txt"), /MIDDLE/);

      await h.writeText("/workspace/conflict.txt", "completely\ndifferent\nfile\n");
      const conflictRes = await h.exec(
        "patch -f -r /workspace/custom.rej /workspace/conflict.txt /workspace/ws.patch",
      );
      assert.notEqual(conflictRes.exitCode, 0);
      assert.equal(await h.exists("/workspace/custom.rej"), true);
    });
  });

  it("9. patch -b -z creates backup files and -o writes patched result to a separate output file", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/code.txt", "old\n");
      await h.writeText("/workspace/code_new.txt", "new\n");
      await h.exec("diff -u /workspace/code.txt /workspace/code_new.txt > /workspace/code.patch");

      const outRes = await h.exec(
        "patch -o /workspace/preview.txt /workspace/code.txt /workspace/code.patch",
      );
      assert.equal(outRes.exitCode, 0);
      assert.equal(await h.readText("/workspace/code.txt"), "old\n");
      assert.equal(await h.readText("/workspace/preview.txt"), "new\n");

      const bakRes = await h.exec(
        "patch -b -z .orig /workspace/code.txt /workspace/code.patch",
      );
      assert.equal(bakRes.exitCode, 0);
      assert.equal(await h.readText("/workspace/code.txt"), "new\n");
      assert.equal(await h.readText("/workspace/code.txt.orig"), "old\n");
    });
  });

  it("10. apply_patch atomically adds, updates, moves, and deletes files from a structured patch", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/existing.txt", "line1\nline2\nline3\n");
      await h.writeText("/workspace/obsolete.txt", "dead\n");

      const res = await h.exec(`apply_patch <<'PATCH'
*** Begin Patch
*** Add File: created.txt
+hello world
*** Update File: existing.txt
*** Move to: renamed.txt
@@
 line1
-line2
+LINE_TWO
 line3
*** Delete File: obsolete.txt
*** End Patch
PATCH`);
      assert.equal(res.exitCode, 0);
      assert.equal(await h.readText("/workspace/created.txt"), "hello world\n");
      assert.equal(await h.readText("/workspace/renamed.txt"), "line1\nLINE_TWO\nline3\n");
      assert.equal(await h.exists("/workspace/existing.txt"), false);
      assert.equal(await h.exists("/workspace/obsolete.txt"), false);
    });
  });

  it("11. diff3 -m performs a clean 3-way merge when changes in mine and yours do not overlap", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/base.txt", "top\nmiddle\nbottom\n");
      await h.writeText("/workspace/mine.txt", "TOP_MINE\nmiddle\nbottom\n");
      await h.writeText("/workspace/yours.txt", "top\nmiddle\nBOTTOM_YOURS\n");

      const res = await h.exec(
        "diff3 -m /workspace/mine.txt /workspace/base.txt /workspace/yours.txt",
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "TOP_MINE\nmiddle\nBOTTOM_YOURS\n");
    });
  });

  it("12. diff3 -m emits conflict markers with custom -L labels and exit code 1 on overlapping edits", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/base.txt", "header\nshared\nfooter\n");
      await h.writeText("/workspace/mine.txt", "header\nOURS\nfooter\n");
      await h.writeText("/workspace/yours.txt", "header\nTHEIRS\nfooter\n");

      const res = await h.exec(
        "diff3 -m -L OUR_BRANCH -L BASE_REV -L THEIR_BRANCH /workspace/mine.txt /workspace/base.txt /workspace/yours.txt",
      );
      assert.equal(res.exitCode, 1);
      assert.match(res.stdout, /^<<<<<<< OUR_BRANCH$/m);
      assert.match(res.stdout, /^OURS$/m);
      assert.match(res.stdout, /^=======$/m);
      assert.match(res.stdout, /^THEIRS$/m);
      assert.match(res.stdout, /^>>>>>>> THEIR_BRANCH$/m);
    });
  });

  it("13. diff3 -e and -3 generate ed scripts for unmerged or file-3-only changes", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/base.txt", "a\nb\nc\n");
      await h.writeText("/workspace/mine.txt", "A\nb\nc\n");
      await h.writeText("/workspace/yours.txt", "a\nb\nC\n");

      const res = await h.exec(
        "diff3 -3 /workspace/mine.txt /workspace/base.txt /workspace/yours.txt",
      );
      assert.equal(res.exitCode, 0);
      assert.match(res.stdout, /3c\nC\n\./);
    });
  });

  it("14. cmp compares files byte-by-byte with -s (silent), -b (print-bytes), and -l (verbose octal)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/b1.bin", "ABCD");
      await h.writeText("/workspace/b2.bin", "ABXD");

      const silentSame = await h.exec("cmp -s /workspace/b1.bin /workspace/b1.bin");
      assert.equal(silentSame.exitCode, 0);
      assert.equal(silentSame.stdout, "");

      const printBytes = await h.exec("cmp -b /workspace/b1.bin /workspace/b2.bin");
      assert.equal(printBytes.exitCode, 1);
      assert.match(printBytes.stdout, /byte 3, line 1 is 103 C 130 X/);

      const verbose = await h.exec("cmp -l /workspace/b1.bin /workspace/b2.bin");
      assert.equal(verbose.exitCode, 1);
      assert.match(verbose.stdout, /^\s*3\s+103\s+130\n$/);
    });
  });

  it("15. cmp -i SKIP1:SKIP2 and -n LIMIT compare slices of binary files", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/s1.bin", "XXXXHELLO_WORLD_111");
      await h.writeText("/workspace/s2.bin", "YYHELLO_WORLD_222");

      const sliceEqual = await h.exec(
        "cmp -i 4:2 -n 11 /workspace/s1.bin /workspace/s2.bin",
      );
      assert.equal(sliceEqual.exitCode, 0);
      assert.equal(sliceEqual.stdout, "");

      const sliceDiff = await h.exec(
        "cmp -i 4:2 -n 15 /workspace/s1.bin /workspace/s2.bin",
      );
      assert.equal(sliceDiff.exitCode, 1);
    });
  });

  it("16. comm computes set difference (-23), intersection (-12), --total, and --output-delimiter", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/setA.txt", "apple\nbanana\ncherry\n");
      await h.writeText("/workspace/setB.txt", "banana\ndate\nfig\n");

      const intersection = await h.exec("comm -12 /workspace/setA.txt /workspace/setB.txt");
      assert.equal(intersection.exitCode, 0);
      assert.equal(intersection.stdout, "banana\n");

      const onlyA = await h.exec("comm -23 /workspace/setA.txt /workspace/setB.txt");
      assert.equal(onlyA.exitCode, 0);
      assert.equal(onlyA.stdout, "apple\ncherry\n");

      const withTotal = await h.exec(
        "comm --total --output-delimiter='|' /workspace/setA.txt /workspace/setB.txt",
      );
      assert.equal(withTotal.exitCode, 0);
      assert.match(withTotal.stdout, /2\|2\|1\|total\n$/);
    });
  });

  it("17. comm enforces --check-order on unsorted files and allows unsorted input with --nocheck-order", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/u1.txt", "b\na\n");
      await h.writeText("/workspace/u2.txt", "a\nb\n");

      const strictOrder = await h.exec("comm --check-order /workspace/u1.txt /workspace/u2.txt");
      assert.equal(strictOrder.exitCode, 1);
      assert.match(strictOrder.stderr, /not in sorted order/);

      const noCheck = await h.exec("comm --nocheck-order /workspace/u1.txt /workspace/u2.txt");
      assert.equal(noCheck.exitCode, 0);
    });
  });

  it("18. join performs relational inner joins on custom fields (-1, -2), delimiter (-t), and format (-o)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/users.csv", "alice,10,admin\nbob,20,user\ncharlie,30,guest\n");
      await h.writeText("/workspace/depts.csv", "10,Security\n20,Platform\n40,Legal\n");

      const res = await h.exec(
        "join -t , -1 2 -2 1 -o 1.1,1.3,2.2 /workspace/users.csv /workspace/depts.csv",
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "alice,admin,Security\nbob,user,Platform\n");
    });
  });

  it("19. join supports outer joins (-a), unpairable rows (-v), missing placeholders (-e), --header, and -i", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/left.txt", "KEY VAL1\nalpha 100\nBeta 200\ngamma 300\n");
      await h.writeText("/workspace/right.txt", "KEY VAL2\nALPHA X\nbeta Y\ndelta Z\n");

      const outer = await h.exec(
        "join --header -i -a 1 -a 2 -e MISSING -o 0,1.2,2.2 /workspace/left.txt /workspace/right.txt",
      );
      assert.equal(outer.exitCode, 0);
      assert.equal(
        outer.stdout,
        "KEY VAL1 VAL2\nalpha 100 X\nBeta 200 Y\ndelta MISSING Z\ngamma 300 MISSING\n",
      );

      const unpairableLeft = await h.exec(
        "join --header -i -v 1 /workspace/left.txt /workspace/right.txt",
      );
      assert.equal(unpairableLeft.exitCode, 0);
      assert.equal(unpairableLeft.stdout, "KEY VAL1 VAL2\ngamma 300\n");
    });
  });

  it("20. paste merges files in parallel and serial (-s) modes with cyclic delimiters (-d) in a diff/patch/join pipeline", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/keys.txt", "k1\nk2\nk3\n");
      await h.writeText("/workspace/vals.txt", "10\n20\n30\n");
      await h.writeText("/workspace/tags.txt", "prod\nstaging\ndev\n");

      const parallel = await h.exec(
        "paste -d ':=' /workspace/keys.txt /workspace/vals.txt /workspace/tags.txt",
      );
      assert.equal(parallel.exitCode, 0);
      assert.equal(parallel.stdout, "k1:10=prod\nk2:20=staging\nk3:30=dev\n");

      const serial = await h.exec("paste -s -d ',' /workspace/keys.txt /workspace/vals.txt");
      assert.equal(serial.exitCode, 0);
      assert.equal(serial.stdout, "k1,k2,k3\n10,20,30\n");
    });
  });
});
