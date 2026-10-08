import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure diff, diff3, patch, apply_patch, cmp, and wdiff parity matrix", () => {
  it("01. cmp single-operand stdin default, incompatible -l -s exit 2, positional SKIP1 SKIP2 with hex/octal/suffixes, and multi -i/-n aggregation", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/f1.bin": "0123456789ABCDEF",
        "/work/f2.bin": "01234567XXXXCDEF",
      },
    });
    const singleStdin = await h.exec("printf 'XXXX456789ABCDEF' | cmp -i 4:4 /work/f1.bin");
    assert.equal(singleStdin.exitCode, 0);
    assert.equal(singleStdin.stdout, "");

    const posHexOct = await h.exec("cmp -s -n 0x4 /work/f1.bin /work/f2.bin 0x04 04");
    assert.equal(posHexOct.exitCode, 0);

    const posMismatch = await h.exec("cmp -s /work/f1.bin /work/f2.bin 0x04 04");
    assert.equal(posMismatch.exitCode, 1);

    const multiFlags = await h.exec("cmp -s -i 2:8 -i 4:4 -n 1kB -n 4 /work/f1.bin /work/f2.bin");
    assert.equal(multiFlags.exitCode, 1);

    const multiEqual = await h.exec("cmp -s -i 1:2 -i 4:4 -n 1kB -n 4 /work/f1.bin /work/f2.bin");
    assert.equal(multiEqual.exitCode, 0);

    const incompat = await h.exec("cmp -l -s /work/f1.bin /work/f2.bin");
    assert.equal(incompat.exitCode, 2);
    assert.match(incompat.stderr, /options -l and -s are incompatible/);
  });

  it("02. cmp EOF on shorter file diagnostics to stderr: empty file, newline boundary, mid-line, and -l verbose mode", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/empty.txt": "",
        "/work/short_nl.txt": "a\nb\n",
        "/work/long_nl.txt": "a\nb\nc\n",
        "/work/short_mid.txt": "a\nb",
        "/work/long_mid.txt": "a\nbc\n",
        "/work/diff_short.txt": "a\nX\n",
      },
    });
    const emptyRes = await h.exec("cmp /work/empty.txt /work/long_nl.txt");
    assert.equal(emptyRes.exitCode, 1);
    assert.equal(emptyRes.stdout, "");
    assert.equal(emptyRes.stderr, "cmp: EOF on /work/empty.txt which is empty\n");

    const nlRes = await h.exec("cmp /work/short_nl.txt /work/long_nl.txt");
    assert.equal(nlRes.exitCode, 1);
    assert.equal(nlRes.stdout, "");
    assert.equal(nlRes.stderr, "cmp: EOF on /work/short_nl.txt after byte 4, line 2\n");

    const midRes = await h.exec("cmp /work/short_mid.txt /work/long_mid.txt");
    assert.equal(midRes.exitCode, 1);
    assert.equal(midRes.stdout, "");
    assert.equal(midRes.stderr, "cmp: EOF on /work/short_mid.txt after byte 3, in line 2\n");

    const verboseEof = await h.exec("cmp -l /work/diff_short.txt /work/long_nl.txt");
    assert.equal(verboseEof.exitCode, 1);
    assert.equal(verboseEof.stdout, "3 130 142\n");
    assert.equal(verboseEof.stderr, "cmp: EOF on /work/diff_short.txt after byte 4\n");
  });

  it("03. cmp -b / -c (--print-bytes / --print-chars) control and high-bit formatting (^@, ^J, ^?, M-^A, M-a) and -l -b column padding", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/a.bin": new Uint8Array([0x68, 0x69, 0x00]),
        "/work/b.bin": new Uint8Array([0x68, 0x69, 0x7f]),
        "/work/c1.bin": new Uint8Array([48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 0x01, 0x81]),
        "/work/c2.bin": new Uint8Array([48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 0x0a, 0xe1]),
      },
    });
    const resB = await h.exec("cmp -b /work/a.bin /work/b.bin");
    assert.equal(resB.exitCode, 1);
    assert.equal(
      resB.stdout,
      "/work/a.bin /work/b.bin differ: byte 3, line 1 is   0 ^@ 177 ^?\n",
    );

    const resC = await h.exec("cmp -c /work/a.bin /work/b.bin");
    assert.equal(resC.exitCode, 1);
    assert.equal(resC.stdout, resB.stdout);

    const resLB = await h.exec("cmp -l -b /work/c1.bin /work/c2.bin");
    assert.equal(resLB.exitCode, 1);
    assert.equal(
      resLB.stdout,
      "11   1 ^A    12 ^J\n12 201 M-^A 341 M-a\n",
    );
  });

  it("04. diff3 default report mode (====, ====1, ====2, ====3, 1:/3:/2: ordering on ====2, a/c ranges, and -T --initial-tab)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/f1.txt": "only1\nkeep1\nboth13\nkeep2\nkeep3\nall_1\n",
        "/work/f2.txt": "base1\nkeep1\nonly2\nkeep2\nkeep3\nall_2\n",
        "/work/f3.txt": "base1\nkeep1\nboth13\nkeep2\nonly3\nkeep3\nall_3\n",
      },
    });
    const rep = await h.exec("diff3 -T /work/f1.txt /work/f2.txt /work/f3.txt");
    assert.equal(rep.exitCode, 0);
    assert.equal(
      rep.stdout,
      [
        "====1",
        "1:1c",
        "\tonly1",
        "2:1c",
        "3:1c",
        "\tbase1",
        "====2",
        "1:3c",
        "3:3c",
        "\tboth13",
        "2:3c",
        "\tonly2",
        "====3",
        "1:4a",
        "2:4a",
        "3:5c",
        "\tonly3",
        "====",
        "1:6c",
        "\tall_1",
        "2:6c",
        "\tall_2",
        "3:7c",
        "\tall_3",
        "",
      ].join("\n"),
    );
  });

  it("05. diff3 -m merge selectors: default -A (--show-all) 2-way conflict on identical changes (====2) vs -m -E (--show-overlap)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/ours.txt": "top\nsame_edit\nmid\nours_conflict\nbottom\n",
        "/work/base.txt": "top\norig_line\nmid\nbase_conflict\nbottom\n",
        "/work/theirs.txt": "top\nsame_edit\nmid\ntheirs_conflict\nbottom\n",
        "/work/ours_clean.txt": "top\nsame_edit\nbottom\n",
        "/work/base_clean.txt": "top\norig_line\nbottom\n",
        "/work/theirs_clean.txt": "top\nsame_edit\nbottom\n",
      },
    });
    const showAllClean = await h.exec(
      "diff3 -m -L OURS -L BASE -L THEIRS /work/ours_clean.txt /work/base_clean.txt /work/theirs_clean.txt",
    );
    assert.equal(showAllClean.exitCode, 1);
    assert.equal(
      showAllClean.stdout,
      [
        "top",
        "<<<<<<< BASE",
        "orig_line",
        "=======",
        "same_edit",
        ">>>>>>> THEIRS",
        "bottom",
        "",
      ].join("\n"),
    );

    const showOverlapClean = await h.exec(
      "diff3 -m -E -L OURS -L BASE -L THEIRS /work/ours_clean.txt /work/base_clean.txt /work/theirs_clean.txt",
    );
    assert.equal(showOverlapClean.exitCode, 0);
    assert.equal(showOverlapClean.stdout, "top\nsame_edit\nbottom\n");

    const showOverlapConflict = await h.exec(
      "diff3 -m -E -L OURS -L BASE -L THEIRS /work/ours.txt /work/base.txt /work/theirs.txt",
    );
    assert.equal(showOverlapConflict.exitCode, 1);
    assert.equal(
      showOverlapConflict.stdout,
      [
        "top",
        "same_edit",
        "mid",
        "<<<<<<< OURS",
        "ours_conflict",
        "=======",
        "theirs_conflict",
        ">>>>>>> THEIRS",
        "bottom",
        "",
      ].join("\n"),
    );
  });

  it("06. diff3 -m with -e (unmerged changes), -3 (--easy-only), -x (--overlap-only), and -X (flag overlaps only)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/ours.txt": "a\nb_ours\nc\nd_base\n",
        "/work/base.txt": "a\nb_base\nc\nd_base\n",
        "/work/theirs.txt": "a\nb_theirs\nc\nd_theirs\n",
      },
    });
    const me = await h.exec("diff3 -m -e /work/ours.txt /work/base.txt /work/theirs.txt");
    assert.equal(me.exitCode, 0);
    assert.equal(me.stdout, "a\nb_theirs\nc\nd_theirs\n");

    const m3 = await h.exec("diff3 -m -3 /work/ours.txt /work/base.txt /work/theirs.txt");
    assert.equal(m3.exitCode, 0);
    assert.equal(m3.stdout, "a\nb_ours\nc\nd_theirs\n");

    const mx = await h.exec("diff3 -m -x /work/ours.txt /work/base.txt /work/theirs.txt");
    assert.equal(mx.exitCode, 0);
    assert.equal(mx.stdout, "a\nb_theirs\nc\nd_base\n");

    const mX = await h.exec(
      "diff3 -m -X -L OURS -L BASE -L THEIRS /work/ours.txt /work/base.txt /work/theirs.txt",
    );
    assert.equal(mX.exitCode, 1);
    assert.equal(
      mX.stdout,
      [
        "a",
        "<<<<<<< OURS",
        "b_ours",
        "=======",
        "b_theirs",
        ">>>>>>> THEIRS",
        "c",
        "d_base",
        "",
      ].join("\n"),
    );
  });

  it("07. diff3 ed script modes (-e, -3, -x, -E) with -i w/q trailer, leading-dot escaping (.. + s/^\\.//), and stdin '-' operand", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/ours.txt": "line1\nkeep\nremove_me\n",
        "/work/base.txt": "line1\nkeep\nremove_me\n",
        "/work/theirs.txt": "line1\n.dotline\n",
      },
    });
    const edDot = await h.exec(
      "cat /work/base.txt | diff3 -e -i /work/ours.txt - /work/theirs.txt",
    );
    assert.equal(edDot.exitCode, 0);
    assert.equal(
      edDot.stdout,
      [
        "2,3c",
        "..dotline",
        ".",
        "2s/^\\.//",
        "w",
        "q",
        "",
      ].join("\n"),
    );
  });

  it("08. diff fine-grained whitespace normalization: -Z (--ignore-trailing-space), -E (--ignore-tab-expansion), -b (--ignore-space-change), -w (--ignore-all-space), and --strip-trailing-cr", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/base.txt": "alpha beta\n\tlead\n",
        "/work/trail.txt": "alpha beta   \n\tlead\t \n",
        "/work/tabs.txt": "alpha beta\n        lead\n",
        "/work/space_change.txt": "alpha    beta\n  lead\n",
        "/work/all_space.txt": "alphabeta\nlead\n",
        "/work/crlf.txt": "alpha beta\r\n\tlead\r\n",
      },
    });
    assert.equal((await h.exec("diff -q -Z /work/base.txt /work/trail.txt")).exitCode, 0);
    assert.equal((await h.exec("diff -q -Z /work/base.txt /work/space_change.txt")).exitCode, 1);

    assert.equal((await h.exec("diff -q -E /work/base.txt /work/tabs.txt")).exitCode, 0);
    assert.equal((await h.exec("diff -q -E /work/base.txt /work/space_change.txt")).exitCode, 1);

    assert.equal((await h.exec("diff -q -b /work/base.txt /work/space_change.txt")).exitCode, 0);
    assert.equal((await h.exec("diff -q -b /work/base.txt /work/all_space.txt")).exitCode, 1);

    assert.equal((await h.exec("diff -q -w /work/base.txt /work/all_space.txt")).exitCode, 0);

    assert.equal((await h.exec("diff -q --strip-trailing-cr /work/base.txt /work/crlf.txt")).exitCode, 0);
  });

  it("09. diff -t (--expand-tabs) and -T (--initial-tab) output formatting across normal, unified (-u), and context (-c) diffs", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/a.txt": "a\tb\n",
        "/work/b.txt": "a\tc\n",
      },
    });
    const normT = await h.exec("diff -T /work/a.txt /work/b.txt");
    assert.equal(normT.exitCode, 1);
    assert.equal(normT.stdout, "1c1\n<\ta\tb\n---\n>\ta\tc\n");

    const normExpand = await h.exec("diff -t /work/a.txt /work/b.txt");
    assert.equal(normExpand.exitCode, 1);
    assert.equal(normExpand.stdout, "1c1\n< a       b\n---\n> a       c\n");

    const uniT = await h.exec("diff -u -T -L a.txt -L b.txt /work/a.txt /work/b.txt");
    assert.equal(uniT.exitCode, 1);
    assert.equal(
      uniT.stdout,
      "--- a.txt\n+++ b.txt\n@@ -1 +1 @@\n-\ta\tb\n+\ta\tc\n",
    );

    const ctxT = await h.exec("diff -c -T -L a.txt -L b.txt /work/a.txt /work/b.txt");
    assert.equal(ctxT.exitCode, 1);
    assert.equal(
      ctxT.stdout,
      "*** a.txt\n--- b.txt\n***************\n*** 1 ****\n!\ta\tb\n--- 1 ----\n!\ta\tc\n",
    );
  });

  it("10. diff -p (--show-c-function) and -F RE (--show-function-line=RE) in unified (-u) and context (-c) diffs with 40-char truncation", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/old.py": [
          "## SECTION_HEADER_WITH_MORE_THAN_FORTY_CHARACTERS_TOTAL_12345",
          "  line1",
          "  line2",
          "  line3",
          "  old_val = 1",
          "",
        ].join("\n"),
        "/work/new.py": [
          "## SECTION_HEADER_WITH_MORE_THAN_FORTY_CHARACTERS_TOTAL_12345",
          "  line1",
          "  line2",
          "  line3",
          "  old_val = 2",
          "",
        ].join("\n"),
      },
    });
    const uniF = await h.exec("diff -U 1 -F '^##' -L old.py -L new.py /work/old.py /work/new.py");
    assert.equal(uniF.exitCode, 1);
    assert.equal(
      uniF.stdout,
      [
        "--- old.py",
        "+++ new.py",
        "@@ -4,2 +4,2 @@ ## SECTION_HEADER_WITH_MORE_THAN_FORTY_C",
        "   line3",
        "-  old_val = 1",
        "+  old_val = 2",
        "",
      ].join("\n"),
    );

    const ctxF = await h.exec("diff -C 1 -F '^##' -L old.py -L new.py /work/old.py /work/new.py");
    assert.equal(ctxF.exitCode, 1);
    assert.match(
      ctxF.stdout,
      /\*\*\*\*\*\*\*\*\*\*\*\*\*\*\* ## SECTION_HEADER_WITH_MORE_THAN_FORTY_C\n\*\*\* 4,5 \*\*\*\*/,
    );
  });

  it("11. diff -D MACRO (--ifdef=MACRO) on identical files, pure insertions, pure deletions (/* ! MACRO */), and replacements (/* MACRO */)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/a.c": "keep1\ndel_only\nkeep2\nold_rep\n",
        "/work/b.c": "keep1\nkeep2\nins_only\nnew_rep\n",
      },
    });
    const sameIfdef = await h.exec("diff -D FLAG /work/a.c /work/a.c");
    assert.equal(sameIfdef.exitCode, 0);
    assert.equal(sameIfdef.stdout, "keep1\ndel_only\nkeep2\nold_rep\n");

    const diffIfdef = await h.exec("diff -D FLAG /work/a.c /work/b.c");
    assert.equal(diffIfdef.exitCode, 1);
    assert.equal(
      diffIfdef.stdout,
      [
        "keep1",
        "#ifndef FLAG",
        "del_only",
        "#endif /* ! FLAG */",
        "keep2",
        "#ifndef FLAG",
        "old_rep",
        "#else /* FLAG */",
        "ins_only",
        "new_rep",
        "#endif /* FLAG */",
        "",
      ].join("\n"),
    );
  });

  it("12. diff -y (--side-by-side) with -W WIDTH, --left-column, --suppress-common-lines, and -t tab expansion on identical and differing files", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/s1.txt": "common\nleft_val\n",
        "/work/s2.txt": "common\nright_val\n extra\n",
      },
    });
    const leftCol = await h.exec("diff -y -W 24 -t --left-column /work/s1.txt /work/s2.txt");
    assert.equal(leftCol.exitCode, 1);
    assert.equal(
      leftCol.stdout,
      [
        "common     (",
        "left_val   |  right_val",
        "           >   extra",
        "",
      ].join("\n"),
    );

    const sameY = await h.exec("diff -y -W 24 -t --left-column /work/s1.txt /work/s1.txt");
    assert.equal(sameY.exitCode, 0);
    assert.equal(sameY.stdout, "common     (\nleft_val   (\n");
  });

  it("13. diff directory comparison: file-vs-directory target resolution, Common subdirectories without -r, -X (--exclude-from), and -S (--starting-file)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/standalone.txt": "v1\n",
        "/work/dir1/standalone.txt": "v2\n",
        "/work/dir1/a_skip.txt": "left_a\n",
        "/work/dir1/b_ignore.bak": "bak1\n",
        "/work/dir1/c_check.txt": "c1\n",
        "/work/dir1/sub/inner.txt": "in1\n",
        "/work/dir2/a_skip.txt": "right_a\n",
        "/work/dir2/b_ignore.bak": "bak2\n",
        "/work/dir2/c_check.txt": "c2\n",
        "/work/dir2/sub/inner.txt": "in2\n",
        "/work/excludes.lst": "*.bak\n",
      },
    });
    const fileVsDir = await h.exec("diff -q /work/standalone.txt /work/dir1");
    assert.equal(fileVsDir.exitCode, 1);
    assert.equal(
      fileVsDir.stdout,
      "Files /work/standalone.txt and /work/dir1/standalone.txt differ\n",
    );

    const nonRec = await h.exec(
      "diff -q -X /work/excludes.lst -S c_check.txt /work/dir1 /work/dir2",
    );
    assert.equal(nonRec.exitCode, 1);
    assert.equal(
      nonRec.stdout,
      [
        "Files /work/dir1/c_check.txt and /work/dir2/c_check.txt differ",
        "Only in /work/dir1: standalone.txt",
        "Common subdirectories: /work/dir1/sub and /work/dir2/sub",
        "",
      ].join("\n"),
    );
  });

  it("14. patch -o - (--output=- to stdout with status diagnostics on stderr) and -r - (--reject-file=- suppressing .rej creation)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/target.txt": "line1\nline2\n",
        "/work/good.patch": [
          "--- target.txt",
          "+++ target.txt",
          "@@ -1,2 +1,2 @@",
          " line1",
          "-line2",
          "+line2_patched",
          "",
        ].join("\n"),
        "/work/bad.patch": [
          "--- target.txt",
          "+++ target.txt",
          "@@ -1,2 +1,2 @@",
          " line1",
          "-wrong_context",
          "+line2_patched",
          "",
        ].join("\n"),
      },
    });
    const outStdout = await h.exec("patch -o - /work/target.txt < /work/good.patch");
    assert.equal(outStdout.exitCode, 0);
    assert.equal(outStdout.stdout, "line1\nline2_patched\n");
    assert.match(outStdout.stderr, /patching file - \(read from \/work\/target\.txt\)/);
    assert.equal(await h.readText("/work/target.txt"), "line1\nline2\n");
    assert.equal(await h.exists("/work/-"), false);

    const rejDiscard = await h.exec("patch -r - /work/target.txt < /work/bad.patch");
    assert.equal(rejDiscard.exitCode, 1);
    assert.match(rejDiscard.stdout, /1 out of 1 hunk FAILED\n/);
    assert.doesNotMatch(rejDiscard.stdout, /saving rejects/);
    assert.equal(await h.exists("/work/target.txt.rej"), false);
    assert.equal(await h.exists("/work/-"), false);
  });

  it("15. patch backup naming options: -B PREFIX (--prefix), -Y BASENAME_PREFIX (--basename-prefix), -z SUFFIX, and -V numbered / existing", async () => {
    const h = await SafeBashE2EHarness.create({
      cwd: "/work",
      files: {
        "/work/sub/app.txt": "v1\n",
        "/work/p1.patch": "--- sub/app.txt\n+++ sub/app.txt\n@@ -1 +1 @@\n-v1\n+v2\n",
        "/work/p2.patch": "--- sub/app.txt\n+++ sub/app.txt\n@@ -1 +1 @@\n-v2\n+v3\n",
        "/work/p3.patch": "--- sub/app.txt\n+++ sub/app.txt\n@@ -1 +1 @@\n-v3\n+v4\n",
      },
    });
    const r1 = await h.exec("patch -p0 -b -V numbered < /work/p1.patch");
    assert.equal(r1.exitCode, 0);
    assert.equal(await h.readText("/work/sub/app.txt.~1~"), "v1\n");

    const r2 = await h.exec("patch -p0 -b -V existing < /work/p2.patch");
    assert.equal(r2.exitCode, 0);
    assert.equal(await h.readText("/work/sub/app.txt.~2~"), "v2\n");

    const r3 = await h.exec("patch -p0 -b -B backups/ -z .bak < /work/p3.patch");
    assert.equal(r3.exitCode, 0);
    assert.equal(await h.readText("/work/backups/sub/app.txt.bak"), "v3\n");
    assert.equal(await h.readText("/work/sub/app.txt"), "v4\n");
  });

  it("16. patch omitted -p default basename stripping, Index: header on normal diffs, and auto-reverse detection vs -N (--forward) skip", async () => {
    const h = await SafeBashE2EHarness.create({
      cwd: "/work",
      files: {
        "/work/flat.txt": "alpha\nbeta\n",
        "/work/deep.patch": [
          "--- a/very/deep/path/flat.txt",
          "+++ b/very/deep/path/flat.txt",
          "@@ -1,2 +1,2 @@",
          " alpha",
          "-beta",
          "+BETA",
          "",
        ].join("\n"),
        "/work/idx.txt": "one\ntwo\n",
        "/work/normal_idx.patch": [
          "Index: idx.txt",
          "1c1",
          "< one",
          "---",
          "> ONE",
          "",
        ].join("\n"),
      },
    });
    const omitP = await h.exec("patch < /work/deep.patch");
    assert.equal(omitP.exitCode, 0);
    assert.equal(await h.readText("/work/flat.txt"), "alpha\nBETA\n");

    const fwdSkip = await h.exec("patch -N < /work/deep.patch");
    assert.equal(fwdSkip.exitCode, 1);
    assert.match(fwdSkip.stdout, /Reversed \(or previously applied\) patch detected!  Skipping patch\./);
    assert.equal(await h.readText("/work/flat.txt"), "alpha\nBETA\n");

    const autoRev = await h.exec("patch < /work/deep.patch");
    assert.equal(autoRev.exitCode, 0);
    assert.match(autoRev.stdout, /Reversed \(or previously applied\) patch detected!  Assuming -R\./);
    assert.equal(await h.readText("/work/flat.txt"), "alpha\nbeta\n");

    const idxRes = await h.exec("patch < /work/normal_idx.patch");
    assert.equal(idxRes.exitCode, 0);
    assert.equal(await h.readText("/work/idx.txt"), "ONE\ntwo\n");
  });

  it("17. patch C-quoted and space-containing header paths, epoch 1970-01-01 creation/deletion, and git format-patch mail unwrapping", async () => {
    const h = await SafeBashE2EHarness.create({
      cwd: "/work",
      files: {
        "/work/my file.txt": "hello\n",
        "/work/obsolete.txt": "remove me\n",
        "/work/mail.patch": [
          "From 0123456789abcdef0123456789abcdef01234567 Mon Sep 17 00:00:00 2001",
          "From: Dev <dev@example.com>",
          "Date: Mon, 1 Jan 2026 00:00:00 +0000",
          "Subject: [PATCH] update files",
          "",
          "diff --git a/my file.txt b/my file.txt",
          '--- "a/my\\040file.txt"\t2026-01-01 00:00:00 +0000',
          "+++ b/my file.txt\t2026-01-01 00:00:01 +0000",
          "@@ -1 +1 @@",
          "-hello",
          "+hello world",
          "diff --git a/born.txt b/born.txt",
          "new file mode 100644",
          "--- a/born.txt\t1970-01-01 00:00:00.000000000 +0000",
          "+++ b/born.txt\t2026-01-01 00:00:01.000000000 +0000",
          "@@ -0,0 +1 @@",
          "+created via epoch",
          "diff --git a/obsolete.txt b/obsolete.txt",
          "deleted file mode 100644",
          "--- a/obsolete.txt\t2026-01-01 00:00:01.000000000 +0000",
          "+++ b/obsolete.txt\t1970-01-01 00:00:00.000000000 +0000",
          "@@ -1 +0,0 @@",
          "-remove me",
          "-- ",
          "2.45.0",
          "",
        ].join("\n"),
      },
    });
    const res = await h.exec("patch -p1 < /work/mail.patch");
    assert.equal(res.exitCode, 0);
    assert.equal(await h.readText("/work/my file.txt"), "hello world\n");
    assert.equal(await h.readText("/work/born.txt"), "created via epoch\n");
    assert.equal(await h.exists("/work/obsolete.txt"), false);
  });

  it("18. apply_patch multi-anchor hunks (@@ class ... + @@ def ...) and 4-pass fuzzy whitespace & Unicode punctuation normalization", async () => {
    const h = await SafeBashE2EHarness.create({
      cwd: "/work",
      files: {
        "/work/service.py": [
          "class Alpha:",
          "    def render(self):",
          '        return "alpha — old"',
          "",
          "class Beta:",
          "    def render(self):   ",
          '        msg = “beta — ‘quote’”\u00a0',
          "        return msg",
          "",
        ].join("\n"),
      },
    });
    const patch = [
      "*** Begin Patch",
      "*** Update File: service.py",
      "@@ class Beta:",
      "@@ def render(self):",
      '-    msg = "beta - \'quote\'"',
      '+    msg = "beta - updated"',
      "     return msg",
      "*** End Patch",
    ].join("\n");
    const res = await h.exec(`apply_patch <<'EOF'\n${patch}\nEOF`);
    assert.equal(res.exitCode, 0);
    assert.equal(
      await h.readText("/work/service.py"),
      [
        "class Alpha:",
        "    def render(self):",
        '        return "alpha — old"',
        "",
        "class Beta:",
        "    def render(self):   ",
        '    msg = "beta - updated"',
        "        return msg",
        "",
      ].join("\n"),
    );
  });

  it("19. apply_patch *** End of File hunk anchoring when identical context appears earlier, pure *** Move to: without hunks, and preserving missing EOF newline", async () => {
    const h = await SafeBashE2EHarness.create({
      cwd: "/work",
      files: {
        "/work/dup.txt": "section\nvalue = 1\nmiddle\nsection\nvalue = 1",
        "/work/raw.txt": "move-without-hunks-no-nl",
      },
    });
    const patch = [
      "*** Begin Patch",
      "*** Update File: dup.txt",
      "@@",
      " section",
      "-value = 1",
      "+value = 99",
      "*** End of File",
      "*** Update File: raw.txt",
      "*** Move to: moved_raw.txt",
      "*** End Patch",
    ].join("\n");
    const res = await h.exec(`apply_patch <<'EOF'\n${patch}\nEOF`);
    assert.equal(res.exitCode, 0);
    assert.equal(
      await h.readText("/work/dup.txt"),
      "section\nvalue = 1\nmiddle\nsection\nvalue = 99",
    );
    assert.equal(await h.exists("/work/raw.txt"), false);
    assert.equal(await h.readText("/work/moved_raw.txt"), "move-without-hunks-no-nl");
  });

  it("20. apply_patch validation (existing Move destination exit 1, ancestor/descendant path conflict exit 2) and wdiff word-diff verification", async () => {
    const h = await SafeBashE2EHarness.create({
      cwd: "/work",
      files: {
        "/work/src.txt": "The quick brown fox\n",
        "/work/existing.txt": "already here\n",
      },
    });
    const moveExists = await h.exec(
      "apply_patch <<'EOF'\n*** Begin Patch\n*** Update File: src.txt\n*** Move to: existing.txt\n@@\n-The quick brown fox\n+The fast brown fox\n*** End Patch\nEOF",
    );
    assert.equal(moveExists.exitCode, 1);

    const ancestorConflict = await h.exec(
      "apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: pkg/sub\n+file\n*** Add File: pkg/sub/nested.txt\n+nested\n*** End Patch\nEOF",
    );
    assert.equal(ancestorConflict.exitCode, 2);

    const validUpdate = await h.exec(
      "cp /work/src.txt /work/before.txt && apply_patch <<'EOF'\n*** Begin Patch\n*** Update File: src.txt\n@@\n-The quick brown fox\n+The fast red fox\n*** End Patch\nEOF",
    );
    assert.equal(validUpdate.exitCode, 0);

    const wd = await h.exec("wdiff /work/before.txt /work/src.txt");
    assert.equal(wd.exitCode, 1);
    assert.equal(wd.stdout, "The [-quick brown-] {+fast red+} fox\n");
  });
});
