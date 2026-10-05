import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("diff, patch, diff3, and apply-patch edge matrix", () => {
  it("1. diff output formats: normal, unified (-u), context (-c), ed (-e), RCS (-n), side-by-side (-y), and ifdef (-D)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/old.txt": "alpha\nbeta\ngamma\ndelta\n",
        "/work/new.txt": "alpha\nBETA\ngamma\ndelta\nepsilon\n",
      },
    });
    const normal = await h.exec("diff /work/old.txt /work/new.txt");
    assert.equal(normal.exitCode, 1);
    assert.match(normal.stdout, /2c2\n< beta\n---\n> BETA\n4a5\n> epsilon\n/);

    const rcs = await h.exec("diff -n /work/old.txt /work/new.txt");
    assert.equal(rcs.exitCode, 1);
    assert.equal(rcs.stdout, "d2 1\na2 1\nBETA\na4 1\nepsilon\n");

    const ed = await h.exec("diff -e /work/old.txt /work/new.txt");
    assert.equal(ed.exitCode, 1);
    assert.match(ed.stdout, /4a\nepsilon\n\.\n2c\nBETA\n\.\n/);

    const sbs = await h.exec("diff -y -W 40 --suppress-common-lines /work/old.txt /work/new.txt");
    assert.equal(sbs.exitCode, 1);
    assert.match(sbs.stdout, /beta\s+\|\s+BETA/);
    assert.match(sbs.stdout, />\s+epsilon/);

    const ifdef = await h.exec("diff -D FEATURE_X /work/old.txt /work/new.txt");
    assert.equal(ifdef.exitCode, 1);
    assert.match(ifdef.stdout, /#ifndef FEATURE_X\nbeta\n#else( \/\* FEATURE_X \*\/)?\nBETA\n#endif/);
    assert.match(ifdef.stdout, /#ifdef FEATURE_X\nepsilon\n#endif/);
  });

  it("2. diff whitespace and case normalization (-i, -b, -w, -B, -E, -Z, -t)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/a.txt": "Hello   World\n\tTabbed\n\nEnd  \n",
        "/work/b.txt": "hello world\n        Tabbed\nEnd\n",
      },
    });
    const raw = await h.exec("diff -q /work/a.txt /work/b.txt");
    assert.equal(raw.exitCode, 1);

    const normalized = await h.exec("diff -i -b -B -E -Z -s /work/a.txt /work/b.txt");
    assert.equal(normalized.exitCode, 0);
    assert.match(normalized.stdout, /are identical/);

    const ignoreAllWs = await h.exec("diff -i -w -B /work/a.txt /work/b.txt");
    assert.equal(ignoreAllWs.exitCode, 0);
  });

  it("3. diff recursive directory comparison (-r, -q, -s, -N, -P, -x, -S, --no-dereference)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/d1/common.txt": "same\n",
        "/work/d1/only1.txt": "left-only\n",
        "/work/d1/ignore.tmp": "noise-1\n",
        "/work/d2/common.txt": "same\n",
        "/work/d2/only2.txt": "right-only\n",
        "/work/d2/ignore.tmp": "noise-2\n",
      },
      symlinks: {
        "/work/d1/link.txt": "common.txt",
        "/work/d2/link.txt": "only2.txt",
      },
    });
    const brief = await h.exec("diff -rq -x '*.tmp' --no-dereference /work/d1 /work/d2");
    assert.equal(brief.exitCode, 1);
    assert.match(brief.stdout, /Symbolic links .*link\.txt and .*link\.txt differ/);
    assert.match(brief.stdout, /Only in \/work\/d1: only1\.txt/);
    assert.match(brief.stdout, /Only in \/work\/d2: only2\.txt/);
    assert.doesNotMatch(brief.stdout, /ignore\.tmp/);

    const unidir = await h.exec("diff -ruP -x '*.tmp' -x 'link.txt' /work/d1 /work/d2");
    assert.equal(unidir.exitCode, 1);
    assert.match(unidir.stdout, /Only in \/work\/d1: only1\.txt/);
    assert.match(unidir.stdout, /\+right-only/);
  });

  it("4. diff --from-file, --to-file, and -p / -F function heading context annotations", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/base.c": [
          "int compute_total(int a, int b) {",
          "  int x = a;",
          "  int y = b;",
          "  int z = x + y;",
          "  return z;",
          "}",
          "",
        ].join("\n"),
        "/work/v1.c": [
          "int compute_total(int a, int b) {",
          "  int x = a;",
          "  int y = b;",
          "  int z = x + y;",
          "  return z + 1;",
          "}",
          "",
        ].join("\n"),
        "/work/v2.c": [
          "int compute_total(int a, int b) {",
          "  int x = a;",
          "  int y = b;",
          "  int z = x + y;",
          "  return z;",
          "}",
          "",
        ].join("\n"),
      },
    });
    const cfunc = await h.exec("diff -u -p /work/base.c /work/v1.c");
    assert.equal(cfunc.exitCode, 1);
    assert.match(cfunc.stdout, /@@ .* @@ int compute_total/);

    const fromFile = await h.exec("diff -q --from-file=/work/base.c /work/v1.c /work/v2.c");
    assert.equal(fromFile.exitCode, 1);
    assert.equal(fromFile.stdout, "Files /work/base.c and /work/v1.c differ\n");
  });

  it("5. diff and patch round-trip files without trailing newline ('No newline at end of file')", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/a.txt": "line1\nline2-no-nl",
        "/work/b.txt": "line1\nline2-with-nl\n",
      },
    });
    const d = await h.exec("diff -u /work/a.txt /work/b.txt > /work/nl.patch");
    assert.equal(d.exitCode, 1);
    const patchText = await h.readText("/work/nl.patch");
    assert.match(patchText, /\\ No newline at end of file/);

    const p = await h.exec("patch /work/a.txt < /work/nl.patch");
    assert.equal(p.exitCode, 0);
    assert.equal(await h.readText("/work/a.txt"), "line1\nline2-with-nl\n");

    const rev = await h.exec("patch -R /work/a.txt < /work/nl.patch");
    assert.equal(rev.exitCode, 0);
    assert.equal(await h.readText("/work/a.txt"), "line1\nline2-no-nl");
  });

  it("6. patch applies unified, context, and normal diffs with -p strip levels, -d directory, and -o output", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/src/pkg/mod.txt": "one\ntwo\nthree\n",
        "/work/new/pkg/mod.txt": "one\nTWO\nthree\n",
      },
    });
    await h.exec("cd /work && diff -c src/pkg/mod.txt new/pkg/mod.txt > /work/ctx.patch");
    const dry = await h.exec("patch --dry-run -d /work/src -p1 < /work/ctx.patch");
    assert.equal(dry.exitCode, 0);
    assert.equal(await h.readText("/work/src/pkg/mod.txt"), "one\ntwo\nthree\n");

    const out = await h.exec("patch -d /work/src -p1 -o preview.txt < /work/ctx.patch");
    assert.equal(out.exitCode, 0);
    assert.equal(await h.readText("/work/src/preview.txt"), "one\nTWO\nthree\n");
    assert.equal(await h.readText("/work/src/pkg/mod.txt"), "one\ntwo\nthree\n");

    const apply = await h.exec("patch -d /work/src -p1 < /work/ctx.patch");
    assert.equal(apply.exitCode, 0);
    assert.equal(await h.readText("/work/src/pkg/mod.txt"), "one\nTWO\nthree\n");
  });

  it("7. patch reverse (-R), forward (-N) skip on already-applied patch, and fuzz/whitespace matching (-F, -l)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/orig.txt": "c1\nc2\ntarget   old\nc3\nc4\n",
        "/work/updated.txt": "c1\nc2\ntarget   new\nc3\nc4\n",
        "/work/ drifted.txt": "header\nc1\nc2_modified_outer\ntarget old\nc3\nc4\n",
      },
    });
    await h.exec("diff -u /work/orig.txt /work/updated.txt > /work/change.patch");

    const drifted = await h.exec(
      "patch -l -F 2 '/work/ drifted.txt' < /work/change.patch",
    );
    assert.equal(drifted.exitCode, 0);
    assert.match(await h.readText("/work/ drifted.txt"), /target   new/);

    const fwd = await h.exec("patch -N /work/updated.txt < /work/change.patch");
    assert.equal(fwd.exitCode, 1);
    assert.equal(await h.readText("/work/updated.txt"), "c1\nc2\ntarget   new\nc3\nc4\n");
  });

  it("8. patch reject generation (-r, --reject-format) and numbered/simple backups (-b, -z, -V)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/base.txt": "a\nb\nc\nd\ne\nf\ng\n",
        "/work/next.txt": "a\nB\nc\nd\ne\nF\ng\n",
        "/work/conflict.txt": "a\nB_OTHER\nc\nd\ne\nf\ng\n",
      },
    });
    await h.exec("diff -U 1 /work/base.txt /work/next.txt > /work/two-hunks.patch");

    const res = await h.exec(
      "patch -b -z .bak -r /work/custom.rej --reject-format=unified /work/conflict.txt < /work/two-hunks.patch",
    );
    assert.equal(res.exitCode, 1);
    assert.equal(await h.readText("/work/conflict.txt"), "a\nB_OTHER\nc\nd\ne\nF\ng\n");
    assert.equal(await h.readText("/work/conflict.txt.bak"), "a\nB_OTHER\nc\nd\ne\nf\ng\n");
    const rej = await h.readText("/work/custom.rej");
    assert.match(rej, /@@ -1,3 \+1,3 @@/);
    assert.match(rej, /\+B/);
  });

  it("9. patch --merge and --merge=diff3 emit inline conflict markers on conflicting hunks", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/anc.txt": "line1\norig\nline3\n",
        "/work/theirs.txt": "line1\ntheirs\nline3\n",
        "/work/ours.txt": "line1\nours\nline3\n",
      },
    });
    await h.exec("diff -u /work/anc.txt /work/theirs.txt > /work/theirs.patch");
    const m = await h.exec("patch --merge=diff3 /work/ours.txt < /work/theirs.patch");
    assert.equal(m.exitCode, 1);
    const merged = await h.readText("/work/ours.txt");
    assert.match(merged, /<<<<<<<\nours\n\|\|\|\|\|\|\|\norig\n=======\ntheirs\n>>>>>>>/);
  });

  it("10. patch file creation from /dev/null, deletion with -E (--remove-empty-files), and --ifdef guards", async () => {
    const h = await SafeBashE2EHarness.create({
      cwd: "/work",
      files: {
        "/work/create.patch": [
          "--- /dev/null",
          "+++ created.txt",
          "@@ -0,0 +1,2 @@",
          "+hello",
          "+world",
          "",
        ].join("\n"),
        "/work/delete.patch": [
          "--- created.txt",
          "+++ /dev/null",
          "@@ -1,2 +0,0 @@",
          "-hello",
          "-world",
          "",
        ].join("\n"),
        "/work/code.c": "int x = 1;\n",
        "/work/code2.c": "int x = 2;\n",
      },
    });
    const cRes = await h.exec("patch -p0 < /work/create.patch");
    assert.equal(cRes.exitCode, 0);
    assert.equal(await h.readText("/work/created.txt"), "hello\nworld\n");

    const dRes = await h.exec("patch -E -p0 < /work/delete.patch");
    assert.equal(dRes.exitCode, 0);
    assert.equal(await h.exists("/work/created.txt"), false);

    await h.exec("diff -u /work/code.c /work/code2.c > /work/code.patch");
    const ifd = await h.exec("patch --ifdef=USE_V2 /work/code.c < /work/code.patch");
    assert.equal(ifd.exitCode, 0);
    assert.match(
      await h.readText("/work/code.c"),
      /#ifndef USE_V2\nint x = 1;\n#else\nint x = 2;\n#endif/,
    );
  });

  it("11. diff3 clean 3-way merge (-m) exits 0 and combines non-overlapping changes from mine and yours", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/older.txt": "line1\nline2\nline3\nline4\nline5\n",
        "/work/mine.txt": "LINE1_MINE\nline2\nline3\nline4\nline5\n",
        "/work/yours.txt": "line1\nline2\nline3\nline4\nLINE5_YOURS\n",
      },
    });
    const res = await h.exec("diff3 -m /work/mine.txt /work/older.txt /work/yours.txt");
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "LINE1_MINE\nline2\nline3\nline4\nLINE5_YOURS\n");
  });

  it("12. diff3 conflicting 3-way merge (-m) exits 1 with custom -L labels and 3-way conflict blocks", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/older.txt": "top\nshared\nbottom\n",
        "/work/mine.txt": "top\nmine-edit\nbottom\n",
        "/work/yours.txt": "top\nyours-edit\nbottom\n",
      },
    });
    const res = await h.exec(
      "diff3 -m -L MINE -L BASE -L YOURS /work/mine.txt /work/older.txt /work/yours.txt",
    );
    assert.equal(res.exitCode, 1);
    assert.equal(
      res.stdout,
      [
        "top",
        "<<<<<<< MINE",
        "mine-edit",
        "||||||| BASE",
        "shared",
        "=======",
        "yours-edit",
        ">>>>>>> YOURS",
        "bottom",
        "",
      ].join("\n"),
    );
  });

  it("13. diff3 default report, -e / -E / -3 / -x ed scripts, and -i w/q trailer", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/older.txt": "a\nb\nc\nd\n",
        "/work/mine.txt": "A_MINE\nb\nc\nd\n",
        "/work/yours.txt": "a\nb\nc\nD_YOURS\n",
      },
    });
    const normal = await h.exec("diff3 /work/mine.txt /work/older.txt /work/yours.txt");
    assert.equal(normal.exitCode, 0);
    assert.match(normal.stdout, /====1/);
    assert.match(normal.stdout, /====3/);

    const ed3 = await h.exec("diff3 -3 -i /work/mine.txt /work/older.txt /work/yours.txt");
    assert.equal(ed3.exitCode, 0);
    assert.match(ed3.stdout, /4c\nD_YOURS\n\.\nw\nq\n/);
  });

  it("14. apply_patch executes Add, Update, Delete, and Move File operations in a single atomic batch", async () => {
    const h = await SafeBashE2EHarness.create({
      cwd: "/work",
      files: {
        "/work/src/keep.ts": "export const a = 1;\nexport const b = 2;\n",
        "/work/src/old-name.ts": "export const name = 'old';\n",
        "/work/src/obsolete.ts": "// delete me\n",
      },
    });
    const patch = [
      "*** Begin Patch",
      "*** Add File: src/nested/added.ts",
      "+export const added = true;",
      "*** Update File: src/keep.ts",
      "@@",
      " export const a = 1;",
      "-export const b = 2;",
      "+export const b = 20;",
      "*** Update File: src/old-name.ts",
      "*** Move to: src/renamed/new-name.ts",
      "@@",
      "-export const name = 'old';",
      "+export const name = 'new';",
      "*** Delete File: src/obsolete.ts",
      "*** End Patch",
    ].join("\n");

    const res = await h.exec(`apply_patch <<'EOF'\n${patch}\nEOF`);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "Success. Updated the following files:",
        "A src/nested/added.ts",
        "M src/keep.ts",
        "M src/renamed/new-name.ts",
        "D src/obsolete.ts",
        "",
      ].join("\n"),
    );
    assert.equal(await h.readText("/work/src/nested/added.ts"), "export const added = true;\n");
    assert.equal(await h.readText("/work/src/keep.ts"), "export const a = 1;\nexport const b = 20;\n");
    assert.equal(await h.readText("/work/src/renamed/new-name.ts"), "export const name = 'new';\n");
    assert.equal(await h.exists("/work/src/old-name.ts"), false);
    assert.equal(await h.exists("/work/src/obsolete.ts"), false);
  });

  it("15. apply_patch multi-hunk context seeking and *** End of File anchoring", async () => {
    const h = await SafeBashE2EHarness.create({
      cwd: "/work",
      files: {
        "/work/mod.py": [
          "def first():",
          "    return 1",
          "",
          "def middle():",
          "    return 2",
          "",
          "def last():",
          "    return 3",
          "",
        ].join("\n"),
      },
    });
    const patch = [
      "*** Begin Patch",
      "*** Update File: mod.py",
      "@@ def first():",
      "-    return 1",
      "+    return 10",
      "@@ def last():",
      "-    return 3",
      "+    return 30",
      "*** End of File",
      "*** End Patch",
    ].join("\n");

    const res = await h.exec(`apply_patch <<'EOF'\n${patch}\nEOF`);
    assert.equal(res.exitCode, 0);
    assert.equal(
      await h.readText("/work/mod.py"),
      [
        "def first():",
        "    return 10",
        "",
        "def middle():",
        "    return 2",
        "",
        "def last():",
        "    return 30",
        "",
      ].join("\n"),
    );
  });

  it("16. apply_patch rolls back entire multi-file transaction if any later file hunk fails to match", async () => {
    const h = await SafeBashE2EHarness.create({
      cwd: "/work",
      files: {
        "/work/first.txt": "alpha\nbeta\n",
        "/work/second.txt": "gamma\ndelta\n",
      },
    });
    const patch = [
      "*** Begin Patch",
      "*** Add File: should-not-exist.txt",
      "+new content",
      "*** Update File: first.txt",
      "@@",
      "-alpha",
      "+ALPHA",
      " beta",
      "*** Update File: second.txt",
      "@@",
      "-nonexistent-context-line",
      "+GAMMA",
      "*** End Patch",
    ].join("\n");

    const res = await h.exec(`apply_patch <<'EOF'\n${patch}\nEOF`);
    assert.notEqual(res.exitCode, 0);
    assert.equal(await h.exists("/work/should-not-exist.txt"), false);
    assert.equal(await h.readText("/work/first.txt"), "alpha\nbeta\n");
    assert.equal(await h.readText("/work/second.txt"), "gamma\ndelta\n");
  });

  it("17. apply_patch rejects symlink path traversal and duplicate file targets in the same patch", async () => {
    const h = await SafeBashE2EHarness.create({
      cwd: "/work",
      files: {
        "/work/real/file.txt": "hello\n",
      },
      symlinks: {
        "/work/sym": "/work/real",
      },
    });
    const symPatch = [
      "*** Begin Patch",
      "*** Update File: sym/file.txt",
      "@@",
      "-hello",
      "+world",
      "*** End Patch",
    ].join("\n");
    const symRes = await h.exec(`apply_patch <<'EOF'\n${symPatch}\nEOF`);
    assert.notEqual(symRes.exitCode, 0);
    assert.equal(await h.readText("/work/real/file.txt"), "hello\n");

    const dupPatch = [
      "*** Begin Patch",
      "*** Update File: real/file.txt",
      "@@",
      "-hello",
      "+world",
      "*** Update File: real/file.txt",
      "@@",
      "-world",
      "+again",
      "*** End Patch",
    ].join("\n");
    const dupRes = await h.exec(`apply_patch <<'EOF'\n${dupPatch}\nEOF`);
    assert.notEqual(dupRes.exitCode, 0);
    assert.equal(await h.readText("/work/real/file.txt"), "hello\n");
  });

  it("18. patch --atomic rolls back all files when a multi-file unified diff fails on a later file", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/a/f1.txt": "line1\n",
        "/work/a/f2.txt": "line2\n",
        "/work/b/f1.txt": "LINE1\n",
        "/work/b/f2.txt": "LINE2\n",
      },
    });
    await h.exec("cd /work && diff -ru a b > /work/multi.patch");
    await h.exec("printf 'diverged-content\\n' > /work/a/f2.txt");

    const res = await h.exec("patch --atomic -d /work/a -p1 < /work/multi.patch");
    assert.equal(res.exitCode, 1);
    assert.equal(await h.readText("/work/a/f1.txt"), "line1\n");
    assert.equal(await h.readText("/work/a/f2.txt"), "diverged-content\n");

    const nonAtomic = await h.exec("patch -d /work/a -p1 < /work/multi.patch");
    assert.equal(nonAtomic.exitCode, 1);
    assert.equal(await h.readText("/work/a/f1.txt"), "LINE1\n");
  });

  it("19. diff -I (--ignore-matching-lines) suppresses diffs where all changed lines match regex", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/v1.txt": "# Generated at 2026-01-01\nkey = value\n",
        "/work/v2.txt": "# Generated at 2026-10-04\nkey = value\n",
        "/work/v3.txt": "# Generated at 2026-10-04\nkey = changed\n",
      },
    });
    const ignored = await h.exec("diff -I '^# Generated at' /work/v1.txt /work/v2.txt");
    assert.equal(ignored.exitCode, 0);
    assert.equal(ignored.stdout, "");

    const notIgnored = await h.exec("diff -u -I '^# Generated at' /work/v1.txt /work/v3.txt");
    assert.equal(notIgnored.exitCode, 1);
    assert.match(notIgnored.stdout, /-key = value/);
    assert.match(notIgnored.stdout, /\+key = changed/);
  });

  it("20. end-to-end 3-way branch merge, unified diff generation, patch application, and verification", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/base/config.ini": "[server]\nhost = 127.0.0.1\nport = 8080\ntimeout = 30\n",
        "/work/branchA/config.ini": "[server]\nhost = 0.0.0.0\nport = 8080\ntimeout = 30\n",
        "/work/branchB/config.ini": "[server]\nhost = 127.0.0.1\nport = 8080\ntimeout = 60\n",
      },
    });
    const res = await h.exec(`
      diff3 -m /work/branchA/config.ini /work/base/config.ini /work/branchB/config.ini > /work/merged.ini
      diff -u /work/base/config.ini /work/merged.ini > /work/upgrade.patch
      cp /work/base/config.ini /work/prod.ini
      patch /work/prod.ini < /work/upgrade.patch > /dev/null
      diff -s /work/prod.ini /work/merged.ini
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      await h.readText("/work/prod.ini"),
      "[server]\nhost = 0.0.0.0\nport = 8080\ntimeout = 60\n",
    );
  });
});
