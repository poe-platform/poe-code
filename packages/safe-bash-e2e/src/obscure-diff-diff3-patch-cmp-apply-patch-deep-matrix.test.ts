import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure diff, diff3, patch, cmp, apply_patch, and wdiff deep parity matrix", () => {
  it("01. diff conflicting format/style options (-u -c, -U 2 -U 4), invalid arguments (-U -1, -W 0, >2 -L, --from-file+--to-file, --color=bogus), and -- end-of-options with -file operands", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/a.txt", "one\ntwo\n");
      await h.writeText("/work/b.txt", "one\nthree\n");
      await h.writeText("/work/-left.txt", "alpha\nbeta\n");
      await h.writeText("/work/-right.txt", "alpha\ngamma\n");

      const conflictFmt = await h.exec("diff -u -c /work/a.txt /work/b.txt");
      assert.equal(conflictFmt.exitCode, 2);
      assert.match(conflictFmt.stderr, /conflicting output format options/);

      const conflictStyle = await h.exec("diff -U 2 -U 4 /work/a.txt /work/b.txt");
      assert.equal(conflictStyle.exitCode, 2);
      assert.match(conflictStyle.stderr, /conflicting output style options/);

      const badCtx = await h.exec("diff -U -1 /work/a.txt /work/b.txt");
      assert.equal(badCtx.exitCode, 2);
      assert.match(badCtx.stderr, /invalid context length/);

      const badWidth = await h.exec("diff -y -W 0 /work/a.txt /work/b.txt");
      assert.equal(badWidth.exitCode, 2);
      assert.match(badWidth.stderr, /invalid width/);

      const threeLabels = await h.exec("diff -u -L l1 -L l2 -L l3 /work/a.txt /work/b.txt");
      assert.equal(threeLabels.exitCode, 2);
      assert.match(threeLabels.stderr, /at most two labels are supported/);

      const bothFromTo = await h.exec("diff --from-file=/work/a.txt --to-file=/work/b.txt /work/a.txt");
      assert.equal(bothFromTo.exitCode, 2);
      assert.match(bothFromTo.stderr, /--from-file and --to-file may not both be specified/);

      const badColor = await h.exec("diff --color=bogus /work/a.txt /work/b.txt");
      assert.equal(badColor.exitCode, 2);
      assert.match(badColor.stderr, /invalid color/);

      const dashOperands = await h.exec("cd /work && diff -u -L LEFT -L RIGHT -- -left.txt -right.txt");
      assert.equal(dashOperands.exitCode, 1);
      assert.equal(
        dashOperands.stdout,
        ["--- LEFT", "+++ RIGHT", "@@ -1,2 +1,2 @@", " alpha", "-beta", "+gamma", ""].join("\n")
      );
    });
  });

  it("02. diff legacy numeric context (-u0, -1 -u, -c1), default context format on -p/-F without -u/-c, and clustered options with attached args (-uLOLD -LNEW, -I^#)", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/work/old.c",
        ["int compute_value(int x) {", "  int a = 1;", "  int b = 2;", "  int c = 3;", "  return x + c;", "}", ""].join("\n")
      );
      await h.writeText(
        "/work/new.c",
        ["int compute_value(int x) {", "  int a = 1;", "  int b = 2;", "  int c = 30;", "  return x + c;", "}", ""].join("\n")
      );

      const u0 = await h.exec("diff -u0 -L A -L B /work/old.c /work/new.c");
      assert.equal(u0.exitCode, 1);
      assert.equal(u0.stdout, ["--- A", "+++ B", "@@ -4 +4 @@", "-  int c = 3;", "+  int c = 30;", ""].join("\n"));

      const u1 = await h.exec("diff -1 -u -L A -L B /work/old.c /work/new.c");
      assert.equal(u1.exitCode, 1);
      assert.equal(
        u1.stdout,
        ["--- A", "+++ B", "@@ -3,3 +3,3 @@", "   int b = 2;", "-  int c = 3;", "+  int c = 30;", "   return x + c;", ""].join("\n")
      );

      const pDefaultCtx = await h.exec("diff -p -C 1 -L OLD -L NEW /work/old.c /work/new.c");
      assert.equal(pDefaultCtx.exitCode, 1);
      assert.equal(
        pDefaultCtx.stdout,
        [
          "*** OLD",
          "--- NEW",
          "*************** int compute_value(int x) {",
          "*** 3,5 ****",
          "    int b = 2;",
          "!   int c = 3;",
          "    return x + c;",
          "--- 3,5 ----",
          "    int b = 2;",
          "!   int c = 30;",
          "    return x + c;",
          "",
        ].join("\n")
      );

      await h.writeText("/work/c1.txt", "# comment 1\nkeep\n");
      await h.writeText("/work/c2.txt", "# comment 2\nkeep\n");
      const clustered = await h.exec("diff -uLOLD -LNEW -I'^#' /work/c1.txt /work/c2.txt");
      assert.equal(clustered.exitCode, 0);
      assert.equal(clustered.stdout, "");
    });
  });

  it("03. diff CRLF vs LF sensitivity without --strip-trailing-cr vs with --strip-trailing-cr", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/crlf.txt", "alpha\r\nbeta\r\n");
      await h.writeText("/work/lf.txt", "alpha\nbeta\n");

      const raw = await h.exec("diff -u -L CRLF -L LF /work/crlf.txt /work/lf.txt");
      assert.equal(raw.exitCode, 1);
      assert.equal(
        raw.stdout,
        ["--- CRLF", "+++ LF", "@@ -1,2 +1,2 @@", "-alpha\r", "-beta\r", "+alpha", "+beta", ""].join("\n")
      );

      const stripped = await h.exec("diff -u -s --strip-trailing-cr -L CRLF -L LF /work/crlf.txt /work/lf.txt");
      assert.equal(stripped.exitCode, 0);
      assert.equal(stripped.stdout, "Files CRLF and LF are identical\n");
    });
  });

  it("04. diff per-hunk -I (--ignore-matching-lines) and -B (--ignore-blank-lines) partial hunk suppression across unified, normal, and ed formats", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText(
        "/work/f1.txt",
        ["# header v1", "line2", "line3", "line4", "line5", "line6", "line7", "line8", "line9", "val=old", "line11", ""].join("\n")
      );
      await h.writeText(
        "/work/f2.txt",
        ["# header v2", "", "line2", "line3", "line4", "line5", "line6", "line7", "line8", "line9", "val=new", "line11", ""].join("\n")
      );

      const uni = await h.exec("diff -u -B -I '^#' -L A -L B /work/f1.txt /work/f2.txt");
      assert.equal(uni.exitCode, 1);
      assert.equal(
        uni.stdout,
        [
          "--- A",
          "+++ B",
          "@@ -7,5 +8,5 @@",
          " line7",
          " line8",
          " line9",
          "-val=old",
          "+val=new",
          " line11",
          "",
        ].join("\n")
      );

      const norm = await h.exec("diff -B -I '^#' /work/f1.txt /work/f2.txt");
      assert.equal(norm.exitCode, 1);
      assert.equal(norm.stdout, ["10c11", "< val=old", "---", "> val=new", ""].join("\n"));

      const ed = await h.exec("diff -e -B -I '^#' /work/f1.txt /work/f2.txt");
      assert.equal(ed.exitCode, 1);
      assert.equal(ed.stdout, ["10c", "val=new", ".", ""].join("\n"));
    });
  });

  it("05. diff -e (--ed) escaping of literal '.' line (.. + . + s/.// + a) and missing trailing newline diagnostic on stderr (exit 2)", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/base.txt", "start\nend\n");
      await h.writeText("/work/mid_dot.txt", "start\n.\nafter_dot\nend\n");
      await h.writeText("/work/end_dot.txt", "start\nbefore_dot\n.\nend\n");
      await h.writeText("/work/nonl.txt", "start\nend");

      const midDot = await h.exec("diff -e /work/base.txt /work/mid_dot.txt");
      assert.equal(midDot.exitCode, 1);
      assert.equal(midDot.stdout, ["1a", "..", ".", "s/.//", "a", "after_dot", ".", ""].join("\n"));

      const endDot = await h.exec("diff -e /work/base.txt /work/end_dot.txt");
      assert.equal(endDot.exitCode, 1);
      assert.equal(endDot.stdout, ["1a", "before_dot", "..", ".", "s/.//", ""].join("\n"));

      const noNlEd = await h.exec("diff -e /work/nonl.txt /work/base.txt");
      assert.equal(noNlEd.exitCode, 2);
      assert.match(noNlEd.stderr, /diff: \/work\/nonl\.txt: No newline at end of file/);
    });
  });

  it("06. diff missing trailing newline ('\\ No newline at end of file') in normal, context (-c), unified (-u), and whitespace-ignored (-b) modes", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/no_nl.txt", "first\nlast");
      await h.writeText("/work/with_nl.txt", "first\nlast\n");

      const norm = await h.exec("diff /work/no_nl.txt /work/with_nl.txt");
      assert.equal(norm.exitCode, 1);
      assert.equal(
        norm.stdout,
        ["2c2", "< last", "\\ No newline at end of file", "---", "> last", ""].join("\n")
      );

      const ctx = await h.exec("diff -c -L A -L B /work/no_nl.txt /work/with_nl.txt");
      assert.equal(ctx.exitCode, 1);
      assert.equal(
        ctx.stdout,
        [
          "*** A",
          "--- B",
          "***************",
          "*** 1,2 ****",
          "  first",
          "! last",
          "\\ No newline at end of file",
          "--- 1,2 ----",
          "  first",
          "! last",
          "",
        ].join("\n")
      );

      const uni = await h.exec("diff -u -L A -L B /work/no_nl.txt /work/with_nl.txt");
      assert.equal(uni.exitCode, 1);
      assert.equal(
        uni.stdout,
        ["--- A", "+++ B", "@@ -1,2 +1,2 @@", " first", "-last", "\\ No newline at end of file", "+last", ""].join("\n")
      );

      const ignSpace = await h.exec("diff -u -b /work/no_nl.txt /work/with_nl.txt");
      assert.equal(ignSpace.exitCode, 0);
      assert.equal(ignSpace.stdout, "");
    });
  });

  it("07. diff --from-file and --to-file with multiple operands (both =FILE and separate FILE argument)", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/base.txt", "common\nv0\n");
      await h.writeText("/work/v1.txt", "common\nv1\n");
      await h.writeText("/work/v2.txt", "common\nv2\n");

      const fromRes = await h.exec("cd /work && diff --from-file base.txt v1.txt v2.txt");
      assert.equal(fromRes.exitCode, 1);
      assert.equal(
        fromRes.stdout,
        ["2c2", "< v0", "---", "> v1", "2c2", "< v0", "---", "> v2", ""].join("\n")
      );

      const toRes = await h.exec("cd /work && diff --to-file=base.txt v1.txt v2.txt");
      assert.equal(toRes.exitCode, 1);
      assert.equal(
        toRes.stdout,
        ["2c2", "< v1", "---", "> v0", "2c2", "< v2", "---", "> v0", ""].join("\n")
      );
    });
  });

  it("08. diff binary file detection (NUL bytes) vs -a (--text), -q (--brief), and -s (--report-identical-files)", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeBytes("/work/bin1.dat", new Uint8Array([0x61, 0x00, 0x62, 0x0a]));
      await h.writeBytes("/work/bin2.dat", new Uint8Array([0x61, 0x00, 0x63, 0x0a]));
      await h.writeBytes("/work/bin1_copy.dat", new Uint8Array([0x61, 0x00, 0x62, 0x0a]));

      const defBin = await h.exec("cd /work && diff bin1.dat bin2.dat");
      assert.equal(defBin.exitCode, 1);
      assert.equal(defBin.stdout, "Binary files bin1.dat and bin2.dat differ\n");

      const briefBin = await h.exec("cd /work && diff -q bin1.dat bin2.dat");
      assert.equal(briefBin.exitCode, 1);
      assert.equal(briefBin.stdout, "Files bin1.dat and bin2.dat differ\n");

      const sameBin = await h.exec("cd /work && diff -s bin1.dat bin1_copy.dat");
      assert.equal(sameBin.exitCode, 0);
      assert.equal(sameBin.stdout, "Files bin1.dat and bin1_copy.dat are identical\n");

      const textBin = await h.exec("cd /work && diff -a bin1.dat bin2.dat");
      assert.equal(textBin.exitCode, 1);
      assert.equal(textBin.stdout, "1c1\n< a\0b\n---\n> a\0c\n");
    });
  });

  it("09. diff -r recursive directory header lines, --ignore-file-name-case, and file-vs-directory type mismatch diagnostics", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/d1/Readme.txt", "hello\n");
      await h.writeText("/work/d2/readme.txt", "world\n");
      await h.writeText("/work/d1/kind/inside.txt", "x\n");
      await h.writeText("/work/d2/kind", "not a dir\n");

      const caseSens = await h.exec("cd /work && diff -r d1 d2");
      assert.equal(caseSens.exitCode, 1);
      assert.equal(
        caseSens.stdout,
        [
          "Only in d1: Readme.txt",
          "File d1/kind is a directory while file d2/kind is a regular file",
          "Only in d2: readme.txt",
          "",
        ].join("\n")
      );

      const caseInsens = await h.exec("cd /work && diff -r --ignore-file-name-case d1 d2");
      assert.equal(caseInsens.exitCode, 1);
      assert.equal(
        caseInsens.stdout,
        [
          "File d1/kind is a directory while file d2/kind is a regular file",
          "diff -r --ignore-file-name-case d1/Readme.txt d2/readme.txt",
          "1c1",
          "< hello",
          "---",
          "> world",
          "",
        ].join("\n")
      );
    });
  });

  it("10. diff3 option validation (incompatible selectors, -m -i conflict, labels without flagging mode, >3 labels, multiple '-' stdin) and clustered short flags (-mE, -eT, --)", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/-ours.txt", "a\nours\nc\n");
      await h.writeText("/work/base.txt", "a\nbase\nc\n");
      await h.writeText("/work/theirs.txt", "a\ntheirs\nc\n");

      const badSel = await h.exec("diff3 -e -A /work/-ours.txt /work/base.txt /work/theirs.txt");
      assert.equal(badSel.exitCode, 2);

      const badMergeWrite = await h.exec("diff3 -m -i /work/-ours.txt /work/base.txt /work/theirs.txt");
      assert.equal(badMergeWrite.exitCode, 2);

      const badLblMode = await h.exec("diff3 -e -L L1 /work/-ours.txt /work/base.txt /work/theirs.txt");
      assert.equal(badLblMode.exitCode, 2);

      const fourLabels = await h.exec("diff3 -m -L L1 -L L2 -L L3 -L L4 /work/-ours.txt /work/base.txt /work/theirs.txt");
      assert.equal(fourLabels.exitCode, 2);

      const twoStdins = await h.exec("printf 'x\\n' | diff3 -m - - /work/theirs.txt");
      assert.equal(twoStdins.exitCode, 2);

      const clustered = await h.exec("cd /work && diff3 -mE -L MINE -L BASE -L YOURS -- -ours.txt base.txt theirs.txt");
      assert.equal(clustered.exitCode, 1);
      assert.equal(
        clustered.stdout,
        ["a", "<<<<<<< MINE", "ours", "=======", "theirs", ">>>>>>> YOURS", "c", ""].join("\n")
      );
    });
  });

  it("11. diff3 --strip-trailing-cr and missing trailing newline in report mode, ed script mode (stderr warning), and -m merge mode", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/ours.txt", "line1\nlast_ours\n");
      await h.writeText("/work/base.txt", "line1\nlast_base\n");
      await h.writeText("/work/theirs_nonl.txt", "line1\nlast_theirs");

      const report = await h.exec("cd /work && diff3 ours.txt base.txt theirs_nonl.txt");
      assert.equal(report.exitCode, 0);
      assert.equal(
        report.stdout,
        [
          "====",
          "1:2c",
          "  last_ours",
          "2:2c",
          "  last_base",
          "3:2c",
          "  last_theirs",
          "\\ No newline at end of file",
          "",
        ].join("\n")
      );

      const edMode = await h.exec("cd /work && diff3 -e ours.txt base.txt theirs_nonl.txt");
      assert.equal(edMode.exitCode, 0);
      assert.equal(edMode.stderr, "diff3: No newline at end of file\n");
      assert.equal(edMode.stdout, "2c\nlast_theirs\n.\n");

      await h.writeText("/work/crlf_theirs.txt", "line1\r\nlast_ours\r\n");
      const crlfNoStrip = await h.exec("cd /work && diff3 -mE ours.txt base.txt crlf_theirs.txt");
      assert.equal(crlfNoStrip.exitCode, 1);
      const crlfMerge = await h.exec("cd /work && diff3 -mE --strip-trailing-cr ours.txt base.txt crlf_theirs.txt");
      assert.equal(crlfMerge.exitCode, 0);
      assert.equal(crlfMerge.stdout, "line1\nlast_ours\n");
    });
  });

  it("12. cmp long option prefix abbreviations, POSIXLY_CORRECT operand option-stopping, -v/--version, directory EISDIR even under -s, and shared '-' stdin", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/a.txt", "xxABC\n");
      await h.writeText("/work/b.txt", "xxABD\n");
      await h.exec("mkdir -p /work/sub");

      const abbrev = await h.exec("cd /work && cmp --print-b --ignore-i=2 --by=3 a.txt b.txt");
      assert.equal(abbrev.exitCode, 1);
      assert.equal(abbrev.stdout, "a.txt b.txt differ: byte 3, line 1 is 103 C 104 D\n");

      const ambig = await h.exec("cd /work && cmp --ver a.txt b.txt");
      assert.equal(ambig.exitCode, 2);
      assert.match(ambig.stderr, /ambiguous/);

      const ver = await h.exec("cmp -v");
      assert.equal(ver.exitCode, 0);
      assert.match(ver.stdout, /^cmp /);

      const posixStop = await h.exec("cd /work && POSIXLY_CORRECT=1 cmp a.txt -l");
      assert.equal(posixStop.exitCode, 2);
      assert.match(posixStop.stderr, /-l: No such file or directory/);

      const dirSilent = await h.exec("cd /work && cmp -s sub a.txt");
      assert.equal(dirSilent.exitCode, 2);
      assert.match(dirSilent.stderr, /sub: Is a directory/);

      const sharedStdin = await h.exec("printf 'abcdef' | cmp -i 0:2 - -");
      assert.equal(sharedStdin.exitCode, 0);
      assert.equal(sharedStdin.stdout, "");
    });
  });

  it("13. patch --dry-run ('checking file ...' status, no file/backup/reject writes, no '-- saving rejects to file' suffix on failure)", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/app.txt", "one\ntwo\nthree\n");
      await h.writeText(
        "/work/ok.patch",
        ["--- app.txt", "+++ app.txt", "@@ -1,3 +1,3 @@", " one", "-two", "+TWO", " three", ""].join("\n")
      );
      await h.writeText(
        "/work/bad.patch",
        ["--- app.txt", "+++ app.txt", "@@ -1,2 +1,2 @@", "-missing", "+NEW", " two", ""].join("\n")
      );

      const okDry = await h.exec("cd /work && patch --dry-run app.txt < ok.patch");
      assert.equal(okDry.exitCode, 0);
      assert.equal(okDry.stdout, "checking file app.txt\n");
      assert.equal(await h.readText("/work/app.txt"), "one\ntwo\nthree\n");

      const badDry = await h.exec("cd /work && patch --dry-run app.txt < bad.patch");
      assert.equal(badDry.exitCode, 1);
      assert.equal(
        badDry.stdout,
        ["checking file app.txt", "Hunk #1 FAILED at 1.", "1 out of 1 hunk FAILED", ""].join("\n")
      );
      const ls = await h.exec("ls /work");
      assert.ok(!ls.stdout.includes("app.txt.rej"), "dry-run must not write .rej file");
    });
  });

  it("14. patch hunk status reporting (offset line/lines, with fuzz F, Hunk #N FAILED at L.) and default fuzz=2 vs -F 0", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/shifted.txt", " extra\none\ntwo\nthree\n");
      await h.writeText(
        "/work/shift.patch",
        ["--- shifted.txt", "+++ shifted.txt", "@@ -1,3 +1,3 @@", " one", "-two", "+TWO", " three", ""].join("\n")
      );

      const shiftRes = await h.exec("cd /work && patch shifted.txt < shift.patch");
      assert.equal(shiftRes.exitCode, 0);
      assert.equal(
        shiftRes.stdout,
        ["patching file shifted.txt", "Hunk #1 succeeded at 2 (offset 1 line).", ""].join("\n")
      );

      await h.writeText("/work/fuzzy.txt", "changed_outer_top\nc2\ntarget\nc3\nc4\n");
      await h.writeText(
        "/work/fuzz1.patch",
        ["--- fuzzy.txt", "+++ fuzzy.txt", "@@ -1,5 +1,5 @@", " c1", " c2", "-target", "+TARGET", " c3", " c4", ""].join("\n")
      );

      const f0Res = await h.exec("cd /work && patch -F 0 --no-backup-if-mismatch -r - fuzzy.txt < fuzz1.patch");
      assert.equal(f0Res.exitCode, 1);
      assert.equal(
        f0Res.stdout,
        ["patching file fuzzy.txt", "Hunk #1 FAILED at 1.", "1 out of 1 hunk FAILED", ""].join("\n")
      );
      assert.equal(await h.readText("/work/fuzzy.txt"), "changed_outer_top\nc2\ntarget\nc3\nc4\n");

      const defFuzzRes = await h.exec("cd /work && patch fuzzy.txt < fuzz1.patch");
      assert.equal(defFuzzRes.exitCode, 0);
      assert.equal(
        defFuzzRes.stdout,
        ["patching file fuzzy.txt", "Hunk #1 succeeded at 1 with fuzz 1.", ""].join("\n")
      );
      assert.equal(await h.readText("/work/fuzzy.txt"), "changed_outer_top\nc2\nTARGET\nc3\nc4\n");
    });
  });

  it("15. patch backup policies: default --backup-if-mismatch vs --no-backup-if-mismatch vs --posix vs -b (--backup)", async () => {
    await withE2EHarness({}, async (h) => {
      const exactPatch = ["--- f.txt", "+++ f.txt", "@@ -1,2 +1,2 @@", " a", "-b", "+B", ""].join("\n");
      const offsetPatch = ["--- f.txt", "+++ f.txt", "@@ -1,2 +1,2 @@", " a", "-b", "+B", ""].join("\n");
      await h.writeText("/work/exact.patch", exactPatch);
      await h.writeText("/work/offset.patch", offsetPatch);

      // 1. Exact match without -b -> no .orig backup
      await h.writeText("/work/f.txt", "a\nb\n");
      await h.exec("cd /work && patch f.txt < exact.patch");
      let ls = await h.exec("ls /work");
      assert.ok(!ls.stdout.includes("f.txt.orig"));

      // 2. Exact match WITH -b -> writes f.txt.orig
      await h.writeText("/work/f.txt", "a\nb\n");
      await h.exec("cd /work && patch -b f.txt < exact.patch");
      assert.equal(await h.readText("/work/f.txt.orig"), "a\nb\n");
      await h.exec("rm -f /work/f.txt.orig");

      // 3. Offset match with default (--backup-if-mismatch) -> writes f.txt.orig
      await h.writeText("/work/f.txt", "pre1\npre2\na\nb\n");
      await h.exec("cd /work && patch f.txt < offset.patch");
      assert.equal(await h.readText("/work/f.txt.orig"), "pre1\npre2\na\nb\n");
      await h.exec("rm -f /work/f.txt.orig");

      // 4. Offset match with --no-backup-if-mismatch -> no f.txt.orig
      await h.writeText("/work/f.txt", "pre1\npre2\na\nb\n");
      await h.exec("cd /work && patch --no-backup-if-mismatch f.txt < offset.patch");
      ls = await h.exec("ls /work");
      assert.ok(!ls.stdout.includes("f.txt.orig"));

      // 5. Offset match with --posix -> no f.txt.orig
      await h.writeText("/work/f.txt", "pre1\npre2\na\nb\n");
      await h.exec("cd /work && patch --posix f.txt < offset.patch");
      ls = await h.exec("ls /work");
      assert.ok(!ls.stdout.includes("f.txt.orig"));
    });
  });

  it("16. patch -D MACRO (--ifdef=MACRO) on pure insertion (#ifdef), pure deletion (#ifndef), and replacement (#ifndef ... #else ... #endif) preserving context lines", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/code.c", "ctx1\nold_val\nctx2\ndel_me\nctx3\n");
      await h.writeText(
        "/work/ifdef.patch",
        [
          "--- code.c",
          "+++ code.c",
          "@@ -1,5 +1,5 @@",
          " ctx1",
          "-old_val",
          "+new_val",
          " ctx2",
          "-del_me",
          " ctx3",
          "+added_line",
          "",
        ].join("\n")
      );

      const res = await h.exec("cd /work && patch -D FEATURE code.c < ifdef.patch");
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        await h.readText("/work/code.c"),
        [
          "ctx1",
          "#ifndef FEATURE",
          "old_val",
          "#else",
          "new_val",
          "#endif",
          "ctx2",
          "#ifndef FEATURE",
          "del_me",
          "#endif",
          "ctx3",
          "#ifdef FEATURE",
          "added_line",
          "#endif",
          "",
        ].join("\n")
      );
    });
  });

  it("17. patch .rej file headers (--- / +++ + @@) and multi-file patch where an earlier file fails and a later file succeeds", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/first.txt", "actual_first\nkeep\n");
      await h.writeText("/work/second.txt", "old_second\nkeep\n");
      await h.writeText(
        "/work/multi.patch",
        [
          "--- first.txt",
          "+++ first.txt",
          "@@ -1,2 +1,2 @@",
          "-wrong_first",
          "+NEW_FIRST",
          " keep",
          "--- second.txt",
          "+++ second.txt",
          "@@ -1,2 +1,2 @@",
          "-old_second",
          "+NEW_SECOND",
          " keep",
          "",
        ].join("\n")
      );

      const res = await h.exec("cd /work && patch -p0 < multi.patch");
      assert.equal(res.exitCode, 1);
      assert.equal(
        res.stdout,
        [
          "patching file first.txt",
          "Hunk #1 FAILED at 1.",
          "1 out of 1 hunk FAILED -- saving rejects to file first.txt.rej",
          "patching file second.txt",
          "",
        ].join("\n")
      );
      assert.equal(await h.readText("/work/first.txt"), "actual_first\nkeep\n");
      assert.equal(await h.readText("/work/second.txt"), "NEW_SECOND\nkeep\n");
      assert.equal(
        await h.readText("/work/first.txt.rej"),
        ["--- first.txt", "+++ first.txt", "@@ -1,2 +1,2 @@", "-wrong_first", "+NEW_FIRST", " keep", ""].join("\n")
      );
    });
  });

  it("18. patch normal diff (0a1, NcM, NdM) forward application and -R reverse roundtrip", async () => {
    await withE2EHarness({}, async (h) => {
      const orig = "alpha\nbeta\ngamma\ndelta\n";
      const updated = "hdr\nalpha\nBETA\ngamma\n";
      await h.writeText("/work/orig.txt", orig);
      await h.writeText("/work/updated.txt", updated);

      const gen = await h.exec("cd /work && diff orig.txt updated.txt > normal.diff");
      assert.equal(gen.exitCode, 1);
      assert.equal(
        await h.readText("/work/normal.diff"),
        ["0a1", "> hdr", "2c3", "< beta", "---", "> BETA", "4d4", "< delta", ""].join("\n")
      );

      await h.writeText("/work/target.txt", orig);
      const fwd = await h.exec("cd /work && patch target.txt < normal.diff");
      assert.equal(fwd.exitCode, 0, fwd.stderr);
      assert.equal(await h.readText("/work/target.txt"), updated);

      const rev = await h.exec("cd /work && patch -R target.txt < normal.diff");
      assert.equal(rev.exitCode, 0, rev.stderr);
      assert.equal(await h.readText("/work/target.txt"), orig);
    });
  });

  it("19. patch context diff (diff -c) with pure insertion, pure deletion, and replacement hunks plus --reject-format=context", async () => {
    await withE2EHarness({}, async (h) => {
      const a = ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L9", "L10", "del_tail", ""].join("\n");
      const b = ["ins_head", "L1", "L2", "L3", "L4", "L5_MOD", "L6", "L7", "L8", "L9", "L10", ""].join("\n");
      await h.writeText("/work/a.txt", a);
      await h.writeText("/work/b.txt", b);

      const ctxDiff = await h.exec("cd /work && diff -c -L target.txt -L target.txt a.txt b.txt > ctx.patch");
      assert.equal(ctxDiff.exitCode, 1);

      await h.writeText("/work/target.txt", a);
      const applyCtx = await h.exec("cd /work && patch -p0 < ctx.patch");
      assert.equal(applyCtx.exitCode, 0, applyCtx.stderr);
      assert.equal(await h.readText("/work/target.txt"), b);

      const revCtx = await h.exec("cd /work && patch -R -p0 < ctx.patch");
      assert.equal(revCtx.exitCode, 0, revCtx.stderr);
      assert.equal(await h.readText("/work/target.txt"), a);

      await h.writeText("/work/mismatch.txt", "completely\ndifferent\ncontent\n");
      const rejCtx = await h.exec("cd /work && patch --reject-format=context mismatch.txt < ctx.patch");
      assert.equal(rejCtx.exitCode, 1);
      const rejText = await h.readText("/work/mismatch.txt.rej");
      assert.match(rejText, /^\*\*\* target\.txt\n--- target\.txt\n\*{15}/);
    });
  });

  it("20. apply_patch strict envelope/syntax validation (missing envelope exit 2, >1 args exit 2, body on Delete File exit 2, invalid hunk line exit 2) and wdiff '--' with '-file' operand", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/victim.txt", "keep\n");

      const noEnvelope = await h.exec(
        "cd /work && apply_patch <<'EOF'\n--- victim.txt\n+++ victim.txt\n@@ -1 +1 @@\n-keep\n+hacked\nEOF"
      );
      assert.equal(noEnvelope.exitCode, 2);
      assert.equal(await h.readText("/work/victim.txt"), "keep\n");

      const twoArgs = await h.exec("apply_patch 'a' 'b'");
      assert.equal(twoArgs.exitCode, 2);

      const deleteWithBody = await h.exec(
        "cd /work && apply_patch <<'EOF'\n*** Begin Patch\n*** Delete File: victim.txt\n-keep\n*** End Patch\nEOF"
      );
      assert.equal(deleteWithBody.exitCode, 2);
      assert.equal(await h.readText("/work/victim.txt"), "keep\n");

      const badHunkLine = await h.exec(
        "cd /work && apply_patch <<'EOF'\n*** Begin Patch\n*** Update File: victim.txt\n@@\n*bad_prefix\n*** End Patch\nEOF"
      );
      assert.equal(badHunkLine.exitCode, 2);

      await h.writeText("/work/-old.txt", "alpha beta gamma\n");
      await h.writeText("/work/new.txt", "alpha BETA delta\n");
      const wdiffDash = await h.exec("cd /work && wdiff -- -old.txt new.txt");
      assert.equal(wdiffDash.exitCode, 1);
      assert.equal(wdiffDash.stdout, "alpha [-beta gamma-] {+BETA delta+}\n");
    });
  });
});
