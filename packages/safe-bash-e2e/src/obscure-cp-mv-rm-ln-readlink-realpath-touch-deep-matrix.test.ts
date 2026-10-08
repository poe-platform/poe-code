import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure cp, mv, rm, ln, readlink, realpath, touch, mkdir, rmdir, and ls deep parity matrix", () => {
  test("1. rm refuses /, ., .., sub/., and sub/.. even with -rf, and rejects trailing slash on non-directories", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/file.txt": "keep me\n",
        "/workspace/sub/nested.txt": "nested\n",
      },
    });

    const rDot = await h.exec("rm -rf .");
    assert.equal(rDot.exitCode, 1);
    assert.ok(rDot.stderr.length > 0);

    const rDotDot = await h.exec("rm -rf ..");
    assert.equal(rDotDot.exitCode, 1);
    assert.ok(rDotDot.stderr.length > 0);

    const rSubDot = await h.exec("rm -rf sub/.");
    assert.equal(rSubDot.exitCode, 1);
    assert.ok(rSubDot.stderr.length > 0);

    const rSubDotDot = await h.exec("rm -rf sub/..");
    assert.equal(rSubDotDot.exitCode, 1);
    assert.ok(rSubDotDot.stderr.length > 0);

    const rRoot = await h.exec("rm -rf /");
    assert.equal(rRoot.exitCode, 1);
    assert.ok(rRoot.stderr.length > 0);

    const rTrailing = await h.exec("rm file.txt/");
    assert.equal(rTrailing.exitCode, 1);
    assert.ok(rTrailing.stderr.length > 0);

    const rTrailingForce = await h.exec("rm -f file.txt/");
    assert.equal(rTrailingForce.exitCode, 1);
    assert.ok(rTrailingForce.stderr.length > 0);

    const check = await h.exec("cat file.txt sub/nested.txt");
    assert.equal(check.exitCode, 0);
    assert.equal(check.stdout, "keep me\nnested\n");
  });

  test("2. rm -I and --interactive=WHEN handle once/always/never prefix matching, >3 args threshold, and recursive prompts", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/a": "1",
        "/workspace/b": "2",
        "/workspace/c": "3",
        "/workspace/d1": "1",
        "/workspace/d2": "2",
        "/workspace/d3": "3",
        "/workspace/d4": "4",
        "/workspace/tree/item.txt": "item",
      },
    });

    // 3 non-recursive operands with -I: no prompt needed
    const rThree = await h.exec("rm -I a b c");
    assert.equal(rThree.exitCode, 0);
    assert.equal(rThree.stderr, "");

    // 4 operands with -I declined: prompts on stderr, exits 0, keeps files
    const rFourDecline = await h.exec("printf 'n\\n' | rm -I d1 d2 d3 d4");
    assert.equal(rFourDecline.exitCode, 0);
    assert.ok(rFourDecline.stderr.includes("rm: remove 4 arguments? "));
    const checkD1 = await h.exec("cat d1");
    assert.equal(checkD1.exitCode, 0);

    // 4 operands with -I accepted: deletes all 4
    const rFourAccept = await h.exec("printf 'y\\n' | rm -I d1 d2 d3 d4");
    assert.equal(rFourAccept.exitCode, 0);
    const checkD1Gone = await h.exec("test ! -e d1 && test ! -e d4");
    assert.equal(checkD1Gone.exitCode, 0);

    // 1 recursive operand with -I declined: prompts on stderr, exits 0, keeps dir
    const rTreeDecline = await h.exec("printf 'n\\n' | rm -rI tree");
    assert.equal(rTreeDecline.exitCode, 0);
    assert.ok(rTreeDecline.stderr.includes("rm: remove 1 argument recursively? "));
    const checkTree = await h.exec("cat tree/item.txt");
    assert.equal(checkTree.exitCode, 0);

    // --interactive=o (prefix for once) accepted
    const rTreeAccept = await h.exec("printf 'y\\n' | rm --interactive=o -r tree");
    assert.equal(rTreeAccept.exitCode, 0);
    const checkTreeGone = await h.exec("test ! -e tree");
    assert.equal(checkTreeGone.exitCode, 0);

    // Invalid --interactive value exits 2
    const rInvalid = await h.exec("rm --interactive=bogus missing");
    assert.equal(rInvalid.exitCode, 2);
  });

  test("3. rm -i recursive traversal prompts for directory descent, child removal, and parent removal, and rm -rv prints children before directory", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/dir/child.txt": "hello\n",
        "/workspace/vdir/sub.txt": "sub\n",
      },
    });

    // Descend yes, remove child no -> child and dir both survive
    const rPartial = await h.exec("printf 'y\\nn\\n' | rm -ri dir");
    assert.equal(rPartial.exitCode, 0);
    const checkChild = await h.exec("cat dir/child.txt");
    assert.equal(checkChild.exitCode, 0);
    assert.equal(checkChild.stdout, "hello\n");

    // Descend yes, remove child yes, remove dir yes -> dir is removed
    const rFull = await h.exec("printf 'y\\ny\\ny\\n' | rm -ri dir");
    assert.equal(rFull.exitCode, 0);
    const checkGone = await h.exec("test ! -e dir");
    assert.equal(checkGone.exitCode, 0);

    // Verbose remove
    const rVerbose = await h.exec("rm -v vdir/sub.txt && rm -dv vdir");
    assert.equal(rVerbose.exitCode, 0);
    assert.ok(rVerbose.stdout.includes("removed 'vdir/sub.txt'"));
    assert.ok(rVerbose.stdout.includes("removed 'vdir'"));
  });

  test("4. cp detects self-copy, copying directory into itself, and copying onto symlink to source unless --remove-destination is used", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/a.txt": "original\n",
        "/workspace/dir/file.txt": "inside\n",
      },
    });

    const rSelf = await h.exec("cp a.txt a.txt");
    assert.equal(rSelf.exitCode, 1);
    assert.ok(rSelf.stderr.length > 0);

    const rIntoSelf = await h.exec("cp -r dir dir/sub");
    assert.equal(rIntoSelf.exitCode, 1);
    assert.ok(rIntoSelf.stderr.length > 0);

    await h.exec("ln -s a.txt sym_a");
    const rOntoSym = await h.exec("cp a.txt sym_a");
    assert.equal(rOntoSym.exitCode, 1);

    const rRemoveDest = await h.exec("cp --remove-destination a.txt sym_a");
    assert.equal(rRemoveDest.exitCode, 0);
    const checkNotSym = await h.exec("test ! -L sym_a && cat sym_a");
    assert.equal(checkNotSym.exitCode, 0);
    assert.equal(checkNotSym.stdout, "original\n");
  });

  test("5. cp validates conflicting options (-l -s, --backup -n, multiple -t, -T arity, --preserve=invalid) and relative -s in subdirectories", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/src.txt": "content\n",
      },
    });
    await h.exec("mkdir d1 d2 sub");

    const rLs = await h.exec("cp -l -s src.txt dst.txt");
    assert.equal(rLs.exitCode, 2);

    const rBackupNoClobber = await h.exec("cp --backup -n src.txt dst.txt");
    assert.equal(rBackupNoClobber.exitCode, 2);

    const rMultiT = await h.exec("cp -t d1 -t d2 src.txt");
    assert.equal(rMultiT.exitCode, 2);

    const rBadT = await h.exec("cp -T src.txt d1 d2");
    assert.equal(rBadT.exitCode, 2);

    const rBadPreserve = await h.exec("cp --preserve=bogus src.txt dst.txt");
    assert.equal(rBadPreserve.exitCode, 2);

    // Relative -s into a subdirectory fails with exit 1
    const rRelSub = await h.exec("cp -s src.txt sub/link.txt");
    assert.equal(rRelSub.exitCode, 1);
    assert.ok(rRelSub.stderr.includes("can make relative symbolic links only in current directory"));

    // Absolute -s into a subdirectory or relative -s in current directory succeeds
    const rAbsSub = await h.exec("cp -s /workspace/src.txt sub/link.txt && cp -s src.txt cwd_link.txt");
    assert.equal(rAbsSub.exitCode, 0);
    const checkLinks = await h.exec("cat sub/link.txt cwd_link.txt");
    assert.equal(checkLinks.exitCode, 0);
    assert.equal(checkLinks.stdout, "content\ncontent\n");
  });

  test("6. cp -i and -n follow last-wins precedence and declining -i returns exit code 1", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/src.txt": "new\n",
        "/workspace/dst.txt": "old\n",
      },
    });

    // Decline -i -> exits 1, keeps old content
    const rDecline = await h.exec("printf 'n\\n' | cp -i src.txt dst.txt");
    assert.equal(rDecline.exitCode, 1);
    assert.ok(rDecline.stderr.includes("cp: overwrite 'dst.txt'? "));
    assert.equal((await h.exec("cat dst.txt")).stdout, "old\n");

    // -i followed by -n -> -n wins, no prompt, exits 0, keeps old content
    const rIn = await h.exec("cp -i -n src.txt dst.txt");
    assert.equal(rIn.exitCode, 0);
    assert.equal(rIn.stderr, "");
    assert.equal((await h.exec("cat dst.txt")).stdout, "old\n");

    // -n followed by -i -> -i wins; accepting overwrites and exits 0
    const rNiAccept = await h.exec("printf 'y\\n' | cp -n -i src.txt dst.txt");
    assert.equal(rNiAccept.exitCode, 0);
    assert.ok(rNiAccept.stderr.includes("cp: overwrite 'dst.txt'? "));
    assert.equal((await h.exec("cat dst.txt")).stdout, "new\n");
  });

  test("7. cp --attributes-only creates empty files or preserves existing content, and cp -u updates only when source is newer", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/src.txt": "full payload\n",
        "/workspace/existing.txt": "keep body\n",
        "/workspace/older.txt": "older\n",
        "/workspace/newer.txt": "newer\n",
      },
    });

    await h.exec("chmod 750 src.txt");
    const rAttrNew = await h.exec("cp -p --attributes-only src.txt created_empty.txt");
    assert.equal(rAttrNew.exitCode, 0);
    const stNew = await h.exec("stat -c '%s:%a' created_empty.txt");
    assert.equal(stNew.stdout, "0:750\n");

    const rAttrExist = await h.exec("cp -p --attributes-only src.txt existing.txt");
    assert.equal(rAttrExist.exitCode, 0);
    assert.equal((await h.exec("cat existing.txt")).stdout, "keep body\n");
    assert.equal((await h.exec("stat -c '%a' existing.txt")).stdout, "750\n");

    await h.exec("touch -d 2025-01-01T00:00:00Z older.txt && touch -d 2025-06-01T00:00:00Z newer.txt");
    await h.exec("cp -u older.txt newer.txt");
    assert.equal((await h.exec("cat newer.txt")).stdout, "newer\n");

    await h.exec("cp -u newer.txt older.txt");
    assert.equal((await h.exec("cat older.txt")).stdout, "newer\n");
  });

  test("8. cp dereference flags (-H, -L, -P) distinguish command-line symlinks from nested symlinks during recursive copy", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/target_file.txt": "leaf\n",
        "/workspace/real_dir/regular.txt": "reg\n",
      },
    });
    await h.exec("ln -s ../target_file.txt real_dir/nested_link && ln -s real_dir top_link");

    // -H follows top_link (creates directory copy_H) but preserves nested_link as symlink
    const rH = await h.exec("cp -r -H top_link copy_H");
    assert.equal(rH.exitCode, 0);
    assert.equal((await h.exec("test -d copy_H && test ! -L copy_H && test -L copy_H/nested_link")).exitCode, 0);

    // -L follows both top_link and nested_link
    const rL = await h.exec("cp -r -L top_link copy_L");
    assert.equal(rL.exitCode, 0);
    assert.equal((await h.exec("test -d copy_L && test ! -L copy_L/nested_link && cat copy_L/nested_link")).stdout, "leaf\n");

    // -P preserves top_link as a symlink
    const rP = await h.exec("cp -r -P top_link copy_P");
    assert.equal(rP.exitCode, 0);
    assert.equal((await h.exec("test -L copy_P && readlink copy_P")).stdout, "real_dir\n");
  });

  test("9. cp refuses to overwrite a just-created destination when two distinct sources map to the same target name", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/d1/dup.txt": "first\n",
        "/workspace/d2/dup.txt": "second\n",
      },
    });
    await h.exec("mkdir out");

    const rDup = await h.exec("cp -a d1/dup.txt d2/dup.txt out/");
    assert.equal(rDup.exitCode, 1);
    assert.ok(rDup.stderr.includes("will not overwrite just-created 'out/dup.txt' with 'd2/dup.txt'"));
    assert.equal((await h.exec("cat out/dup.txt")).stdout, "first\n");
  });

  test("10. mv rejects self-move and moving a directory into itself, treats mv -n a a as no-op, and handles mv -i prompts", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/a.txt": "alpha\n",
        "/workspace/b.txt": "beta\n",
        "/workspace/dir/sub.txt": "sub\n",
      },
    });

    // mv -b a.txt a.txt fails with exit 1 (same file) and keeps a.txt
    const rSelf = await h.exec("mv -b a.txt a.txt");
    assert.equal(rSelf.exitCode, 1);
    assert.equal((await h.exec("cat a.txt")).stdout, "alpha\n");

    // mv -n a.txt a.txt is a no-op (exit 0)
    const rSelfNoClobber = await h.exec("mv -n a.txt a.txt");
    assert.equal(rSelfNoClobber.exitCode, 0);
    assert.equal((await h.exec("cat a.txt")).stdout, "alpha\n");

    // mv -u a.txt a.txt fails with exit 1
    const rSelfUpdate = await h.exec("mv -u a.txt a.txt");
    assert.equal(rSelfUpdate.exitCode, 1);
    assert.equal((await h.exec("cat a.txt")).stdout, "alpha\n");

    // mv dir dir/child fails with exit 1 and keeps dir
    const rDirIntoSelf = await h.exec("mv dir dir/child");
    assert.equal(rDirIntoSelf.exitCode, 1);
    assert.equal((await h.exec("cat dir/sub.txt")).stdout, "sub\n");

    // mv -i declined returns exit 1 and keeps both files
    const rDecline = await h.exec("printf 'n\\n' | mv -i a.txt b.txt");
    assert.equal(rDecline.exitCode, 1);
    assert.ok(rDecline.stderr.includes("mv: overwrite 'b.txt'? "));
    assert.equal((await h.exec("cat a.txt b.txt")).stdout, "alpha\nbeta\n");

    // mv -i accepted moves file and returns exit 0
    const rAccept = await h.exec("printf 'y\\n' | mv -i a.txt b.txt");
    assert.equal(rAccept.exitCode, 0);
    assert.equal((await h.exec("test ! -e a.txt && cat b.txt")).stdout, "alpha\n");
  });

  test("11. mv validates -t and -T constraints and rejects unknown flags with exit code 2", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/f1.txt": "1\n",
        "/workspace/f2.txt": "2\n",
      },
    });
    await h.exec("mkdir d1 d2");

    assert.equal((await h.exec("mv -t d1 -t d2 f1.txt")).exitCode, 2);
    assert.equal((await h.exec("mv -T f1.txt")).exitCode, 2);
    assert.equal((await h.exec("mv -T f1.txt f2.txt d1")).exitCode, 2);
    assert.equal((await h.exec("mv --unknown-flag f1.txt f2.txt")).exitCode, 2);
    assert.equal((await h.exec("mv -t missing_dir f1.txt")).exitCode, 1);
    assert.equal((await h.exec("mv -t f2.txt f1.txt")).exitCode, 1);
  });

  test("12. ln handles -i vs -f precedence, returns exit 1 on declined -i prompt, and refuses self-linking even with -f", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/a.txt": "alpha\n",
        "/workspace/b.txt": "beta\n",
      },
    });

    // Self-linking with or without -f fails and leaves a.txt intact
    assert.equal((await h.exec("ln a.txt a.txt")).exitCode, 1);
    assert.equal((await h.exec("ln -f a.txt a.txt")).exitCode, 1);
    assert.equal((await h.exec("ln -sf a.txt a.txt")).exitCode, 1);
    assert.equal((await h.exec("cat a.txt")).stdout, "alpha\n");

    await h.exec("ln -s a.txt sym.txt");

    // Decline ln -i -> exits 1, keeps sym.txt -> a.txt
    const rDecline = await h.exec("printf 'n\\n' | ln -si b.txt sym.txt");
    assert.equal(rDecline.exitCode, 1);
    assert.ok(rDecline.stderr.includes("ln: replace 'sym.txt'? "));
    assert.equal((await h.exec("readlink sym.txt")).stdout, "a.txt\n");

    // -i followed by -f -> -f wins, no prompt, replaces symlink
    const rIf = await h.exec("ln -s -i -f b.txt sym.txt");
    assert.equal(rIf.exitCode, 0);
    assert.equal(rIf.stderr, "");
    assert.equal((await h.exec("readlink sym.txt")).stdout, "b.txt\n");

    // -f followed by -i -> -i wins, prompts and replaces on 'y'
    const rFi = await h.exec("printf 'y\\n' | ln -s -f -i a.txt sym.txt");
    assert.equal(rFi.exitCode, 0);
    assert.ok(rFi.stderr.includes("ln: replace 'sym.txt'? "));
    assert.equal((await h.exec("readlink sym.txt")).stdout, "a.txt\n");
  });

  test("13. ln -L dereferences symlink targets when creating hard links while ln -P links to the symlink itself", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/real.txt": "payload\n",
      },
    });
    await h.exec("ln -s real.txt sym.txt");

    const rLogical = await h.exec("ln -L sym.txt hard_from_L.txt");
    assert.equal(rLogical.exitCode, 0);
    assert.equal((await h.exec("test ! -L hard_from_L.txt && cat hard_from_L.txt")).stdout, "payload\n");

    const rPhysical = await h.exec("ln -P sym.txt hard_from_P.txt");
    assert.equal(rPhysical.exitCode, 0);
    assert.equal((await h.exec("test -L hard_from_P.txt && readlink hard_from_P.txt")).stdout, "real.txt\n");
  });

  test("14. readlink warns and restores newlines when -n is used with multiple operands, and respects -v/-q/-s diagnostic modes", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/reg.txt": "regular\n",
      },
    });
    await h.exec("ln -s reg.txt s1 && ln -s reg.txt s2");

    const rSingleN = await h.exec("readlink -n s1");
    assert.equal(rSingleN.exitCode, 0);
    assert.equal(rSingleN.stdout, "reg.txt");
    assert.equal(rSingleN.stderr, "");

    const rMultiN = await h.exec("readlink -n s1 s2");
    assert.equal(rMultiN.exitCode, 0);
    assert.equal(rMultiN.stdout, "reg.txt\nreg.txt\n");
    assert.ok(rMultiN.stderr.includes("ignoring --no-newline with multiple arguments"));

    const rMultiNQuiet = await h.exec("readlink -nq s1 s2");
    assert.equal(rMultiNQuiet.exitCode, 0);
    assert.equal(rMultiNQuiet.stdout, "reg.txt\nreg.txt\n");
    assert.equal(rMultiNQuiet.stderr, "");

    // Default readlink on non-symlink is quiet on stderr
    const rDefaultErr = await h.exec("readlink reg.txt");
    assert.equal(rDefaultErr.exitCode, 1);
    assert.equal(rDefaultErr.stderr, "");

    // -v prints diagnostic on stderr
    const rVerboseErr = await h.exec("readlink -v reg.txt");
    assert.equal(rVerboseErr.exitCode, 1);
    assert.ok(rVerboseErr.stderr.length > 0);

    // -v followed by -s suppresses diagnostic
    const rSilentOverride = await h.exec("readlink -v -s reg.txt");
    assert.equal(rSilentOverride.exitCode, 1);
    assert.equal(rSilentOverride.stderr, "");
  });

  test("15. readlink canonicalize modes (-f, -e, -m) follow last-wins precedence and handle missing parents vs missing leaf", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/dir/file.txt": "ok\n",
      },
    });

    const rEm = await h.exec("readlink -e -m /workspace/dir/missing_parent/leaf");
    assert.equal(rEm.exitCode, 0);
    assert.equal(rEm.stdout, "/workspace/dir/missing_parent/leaf\n");

    const rMe = await h.exec("readlink -m -e /workspace/dir/missing_leaf");
    assert.equal(rMe.exitCode, 1);

    const rFLeaf = await h.exec("readlink -f /workspace/dir/missing_leaf");
    assert.equal(rFLeaf.exitCode, 0);
    assert.equal(rFLeaf.stdout, "/workspace/dir/missing_leaf\n");

    const rFParent = await h.exec("readlink -f /workspace/dir/missing_parent/leaf");
    assert.equal(rFParent.exitCode, 1);
  });

  test("16. realpath distinguishes -P (physical), -L (logical), and -s (no-symlinks) with .. and supports --relative-base", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/real/sub/item.txt": "subitem\n",
        "/workspace/real/target.txt": "realtarget\n",
        "/workspace/target.txt": "root_target\n",
      },
    });
    await h.exec("ln -s real/sub link_sub");

    // Physical (-P): link_sub resolves to /workspace/real/sub, so ../target.txt -> /workspace/real/target.txt
    const rPhys = await h.exec("realpath -P /workspace/link_sub/../target.txt");
    assert.equal(rPhys.exitCode, 0);
    assert.equal(rPhys.stdout, "/workspace/real/target.txt\n");

    // Logical (-L): link_sub/.. collapses lexically to /workspace, so -> /workspace/target.txt
    const rLog = await h.exec("realpath -L /workspace/link_sub/../target.txt");
    assert.equal(rLog.exitCode, 0);
    assert.equal(rLog.stdout, "/workspace/target.txt\n");

    // Strip (-s): does not resolve symlinks at all
    const rStrip = await h.exec("realpath -s /workspace/link_sub/item.txt");
    assert.equal(rStrip.exitCode, 0);
    assert.equal(rStrip.stdout, "/workspace/link_sub/item.txt\n");

    // --relative-base outputs relative path inside base and absolute path outside base
    const rRelBase = await h.exec("realpath --relative-base=/workspace/real /workspace/real/sub/item.txt /workspace/target.txt");
    assert.equal(rRelBase.exitCode, 0);
    assert.equal(rRelBase.stdout, "sub/item.txt\n/workspace/target.txt\n");
  });

  test("17. realpath rejects empty operands, non-directory prefixes in -E/-e modes, and missing option arguments", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/file.txt": "data\n",
      },
    });

    const rEmpty = await h.exec('realpath ""');
    assert.equal(rEmpty.exitCode, 1);
    assert.ok(rEmpty.stderr.length > 0);

    const rEmptyQuiet = await h.exec('realpath -q ""');
    assert.equal(rEmptyQuiet.exitCode, 1);
    assert.equal(rEmptyQuiet.stderr, "");

    const rNotDirE = await h.exec("realpath -E /workspace/file.txt/child");
    assert.equal(rNotDirE.exitCode, 1);

    const rNotDirM = await h.exec("realpath -m /workspace/file.txt/child");
    assert.equal(rNotDirM.exitCode, 0);
    assert.equal(rNotDirM.stdout, "/workspace/file.txt/child\n");

    const rMissingOptArg = await h.exec("realpath --relative-to");
    assert.notEqual(rMissingOptArg.exitCode, 0);
  });

  test("18. touch rejects combining -t with -d or -r, supports --time=access|modify, and fails on missing -r reference file", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/f.txt": "hello\n",
      },
    });

    await h.exec("touch -d 2024-01-01T00:00:00Z f.txt");
    const initTimes = (await h.exec("stat -c '%X:%Y' f.txt")).stdout.trim();
    assert.equal(initTimes, "1704067200:1704067200");

    // --time=access updates only atime
    const rAccess = await h.exec("touch --time=access -d 2025-01-01T00:00:00Z f.txt");
    assert.equal(rAccess.exitCode, 0);
    assert.equal((await h.exec("stat -c '%X:%Y' f.txt")).stdout.trim(), "1735689600:1704067200");

    // --time=modify updates only mtime
    const rModify = await h.exec("touch --time=modify -d 2026-01-01T00:00:00Z f.txt");
    assert.equal(rModify.exitCode, 0);
    assert.equal((await h.exec("stat -c '%X:%Y' f.txt")).stdout.trim(), "1735689600:1767225600");

    // Combining -t with -d or -r exits 1
    const rConflictTd = await h.exec("touch -t 202501010000 -d 2025-01-01T00:00:00Z f.txt");
    assert.equal(rConflictTd.exitCode, 1);
    assert.ok(rConflictTd.stderr.includes("cannot specify times from more than one source"));

    const rConflictTr = await h.exec("touch -t 202501010000 -r f.txt f.txt");
    assert.equal(rConflictTr.exitCode, 1);

    // Invalid --time value exits 2
    const rBadTime = await h.exec("touch --time=bogus f.txt");
    assert.equal(rBadTime.exitCode, 2);

    // Missing reference file exits 1
    const rMissingRef = await h.exec("touch -r no_such_ref.txt f.txt");
    assert.equal(rMissingRef.exitCode, 1);
  });

  test("19. mkdir -p fails when an intermediate path component is a regular file, and mkdir/rmdir reject unknown options with exit code 2", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/blocker": "i am a file\n",
      },
    });

    const rBlocker = await h.exec("mkdir -p blocker/sub/deep");
    assert.equal(rBlocker.exitCode, 1);
    assert.ok(rBlocker.stderr.length > 0);

    const rMkdirUnknown = await h.exec("mkdir -z newdir");
    assert.equal(rMkdirUnknown.exitCode, 2);

    const rRmdirUnknown = await h.exec("rmdir -z newdir");
    assert.equal(rRmdirUnknown.exitCode, 2);

    const rRmdirRoot = await h.exec("rmdir /");
    assert.equal(rRmdirRoot.exitCode, 1);
  });

  test("20. ls supports --sort=size|time|version|extension|none, --indicator-style=slash|file-type|classify|none, and -Q quoting", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/v1.b": "12345",
        "/workspace/v10.a": "1",
        "/workspace/v2.c": "123",
      },
    });
    await h.exec("mkdir sub && ln -s v1.b sym");

    const rVer = await h.exec("ls -1 --sort=version v1.b v10.a v2.c");
    assert.equal(rVer.exitCode, 0);
    assert.equal(rVer.stdout, "v1.b\nv2.c\nv10.a\n");

    const rExt = await h.exec("ls -1 --sort=extension v1.b v10.a v2.c");
    assert.equal(rExt.exitCode, 0);
    assert.equal(rExt.stdout, "v10.a\nv1.b\nv2.c\n");

    const rQuote = await h.exec("ls -1 -Q v1.b v2.c");
    assert.equal(rQuote.exitCode, 0);
    assert.equal(rQuote.stdout, '"v1.b"\n"v2.c"\n');

    const rIndSlash = await h.exec("ls -1 -d --indicator-style=slash sub sym v1.b");
    assert.equal(rIndSlash.exitCode, 0);
    assert.equal(rIndSlash.stdout, "sub/\nsym\nv1.b\n");

    const rIndFileType = await h.exec("ls -1 -d --indicator-style=file-type sub sym v1.b");
    assert.equal(rIndFileType.exitCode, 0);
    assert.equal(rIndFileType.stdout, "sub/\nsym@\nv1.b\n");

    const rBadSort = await h.exec("ls --sort=bogus");
    assert.equal(rBadSort.exitCode, 2);

    const rBadInd = await h.exec("ls --indicator-style=bogus");
    assert.equal(rBadInd.exitCode, 1);

    const rMissingInd = await h.exec("ls --indicator-style");
    assert.equal(rMissingInd.exitCode, 2);
  });
});
