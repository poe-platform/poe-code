import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("safe-bash e2e: diff, patch, diff3, and apply_patch workflow matrix", () => {
  it("01. diff -u unified diff generation, patch application, and patch -R reverse roundtrip", async () => {
    const orig = ["line 1", "line 2", "line 3", "line 4", "line 5"].join("\n") + "\n";
    const updated = ["line 1", "line 2 modified", "line 2.5 inserted", "line 3", "line 5"].join("\n") + "\n";
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/orig.txt": orig,
        "/work/updated.txt": updated,
        "/work/target.txt": orig,
      },
    });
    const res = await h.exec(
      [
        "diff -u /work/orig.txt /work/updated.txt > /work/changes.patch || [ $? -eq 1 ]",
        "patch /work/target.txt < /work/changes.patch >/dev/null",
        "cmp -s /work/target.txt /work/updated.txt && echo 'APPLIED_OK'",
        "patch -R /work/target.txt < /work/changes.patch >/dev/null",
        "cmp -s /work/target.txt /work/orig.txt && echo 'REVERSED_OK'",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "APPLIED_OK\nREVERSED_OK\n");
  });

  it("02. diff -c context diff format and patch application", async () => {
    const v1 = ["alpha", "beta", "gamma", "delta", "epsilon"].join("\n") + "\n";
    const v2 = ["alpha", "BETA_NEW", "gamma", "delta", "epsilon", "zeta"].join("\n") + "\n";
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/v1.txt": v1,
        "/work/v2.txt": v2,
        "/work/apply.txt": v1,
      },
    });
    const res = await h.exec(
      [
        "diff -c /work/v1.txt /work/v2.txt > /work/ctx.patch || [ $? -eq 1 ]",
        "grep -q '^\\*\\*\\*' /work/ctx.patch && echo 'HAS_CTX_HEADER'",
        "patch /work/apply.txt < /work/ctx.patch >/dev/null",
        "cat /work/apply.txt",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "HAS_CTX_HEADER\n" + v2);
  });

  it("03. diff normal format (default) and patch roundtrip", async () => {
    const v1 = ["a", "b", "c", "d"].join("\n") + "\n";
    const v2 = ["a", "B", "c", "d", "e"].join("\n") + "\n";
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/v1.txt": v1,
        "/work/v2.txt": v2,
        "/work/copy.txt": v1,
      },
    });
    const res = await h.exec(
      [
        "diff /work/v1.txt /work/v2.txt > /work/normal.patch || [ $? -eq 1 ]",
        "patch /work/copy.txt < /work/normal.patch >/dev/null",
        "cmp -s /work/copy.txt /work/v2.txt && echo 'NORMAL_OK'",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "NORMAL_OK\n");
  });

  it("04. diff -e ed script generation and diff -n RCS format verification", async () => {
    const v1 = ["one", "two", "three"].join("\n") + "\n";
    const v2 = ["one", "TWO", "three", "four"].join("\n") + "\n";
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/v1.txt": v1,
        "/work/v2.txt": v2,
      },
    });
    const res = await h.exec(
      [
        "diff -e /work/v1.txt /work/v2.txt || [ $? -eq 1 ]",
        "echo '---'",
        "diff -n /work/v1.txt /work/v2.txt || [ $? -eq 1 ]",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
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
      ].join("\n"),
    );
  });

  it("05. diff whitespace and case-insensitivity flags (-i, -b, -w, -B, -q / --brief, -s)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/f1.txt": "Hello   World\n\nFoo Bar\n",
        "/work/f2.txt": "hello world\nFoo  Bar\n",
      },
    });
    const res = await h.exec(
      [
        "diff -q /work/f1.txt /work/f2.txt >/dev/null || echo \"raw_exit=$?\"",
        "diff -i -b -B -s /work/f1.txt /work/f2.txt >/dev/null && echo 'NORM_EQUAL'",
        "diff -i -w -B /work/f1.txt /work/f2.txt && echo 'IW_EQUAL'",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "raw_exit=1\nNORM_EQUAL\nIW_EQUAL\n");
  });

  it("06. diff -r -u -N recursive directory tree diff and patch -p1 across nested subdirectories", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/tree_a/src/lib.ts": "export const version = 1;\nexport const name = 'app';\n",
        "/work/tree_a/src/old.ts": "export const legacy = true;\n",
        "/work/tree_b/src/lib.ts": "export const version = 2;\nexport const name = 'app';\n",
        "/work/tree_b/src/new.ts": "export const feature = 'enabled';\n",
        "/work/live/src/lib.ts": "export const version = 1;\nexport const name = 'app';\n",
        "/work/live/src/old.ts": "export const legacy = true;\n",
      },
    });
    const res = await h.exec(
      [
        "cd /work",
        "diff -ruN tree_a tree_b > tree.patch || [ $? -eq 1 ]",
        "cd /work/live && patch -p1 < /work/tree.patch >/dev/null",
        "cat /work/live/src/lib.ts",
        "cat /work/live/src/new.ts",
        "test ! -e /work/live/src/old.ts && echo 'OLD_REMOVED'",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "export const version = 2;",
        "export const name = 'app';",
        "export const feature = 'enabled';",
        "OLD_REMOVED",
        "",
      ].join("\n"),
    );
  });

  it("07. patch with line-offset hunks, --dry-run verification, and -b backup creation", async () => {
    const base = ["c1", "c2", "c3", "target_old", "c4", "c5", "c6"].join("\n") + "\n";
    const modified = ["c1", "c2", "c3", "target_new", "c4", "c5", "c6"].join("\n") + "\n";
    const shifted = ["header_a", "header_b", "header_c", "c1", "c2", "c3", "target_old", "c4", "c5", "c6"].join("\n") + "\n";
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/base.txt": base,
        "/work/modified.txt": modified,
        "/work/shifted.txt": shifted,
      },
    });
    const res = await h.exec(
      [
        "diff -u /work/base.txt /work/modified.txt > /work/change.patch || [ $? -eq 1 ]",
        "patch --dry-run /work/shifted.txt < /work/change.patch >/dev/null",
        "grep -q '^target_old$' /work/shifted.txt && echo 'DRY_RUN_UNCHANGED'",
        "patch -b /work/shifted.txt < /work/change.patch >/dev/null",
        "grep -q '^target_new$' /work/shifted.txt && echo 'SHIFTED_PATCHED'",
        "grep -q '^target_old$' /work/shifted.txt.orig && echo 'BACKUP_PRESERVED'",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "DRY_RUN_UNCHANGED",
        "SHIFTED_PATCHED",
        "BACKUP_PRESERVED",
        "",
      ].join("\n"),
    );
  });

  it("08. patch hunk rejection (-r reject file) when target context conflicts", async () => {
    const v1 = ["line1", "line2", "line3", "line4"].join("\n") + "\n";
    const v2 = ["line1", "line2_patched", "line3", "line4"].join("\n") + "\n";
    const conflicting = ["line1", "completely_different_2", "completely_different_3", "line4"].join("\n") + "\n";
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/v1.txt": v1,
        "/work/v2.txt": v2,
        "/work/conflict.txt": conflicting,
      },
    });
    const res = await h.exec(
      [
        "diff -u /work/v1.txt /work/v2.txt > /work/conflict.patch || [ $? -eq 1 ]",
        "patch -f -r /work/custom.rej /work/conflict.txt < /work/conflict.patch >/dev/null 2>&1 || echo \"patch_exit=$?\"",
        "test -f /work/custom.rej && echo 'REJ_CREATED'",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /patch_exit=1\nREJ_CREATED\n/);
  });

  it("09. diff3 -m clean non-overlapping three-way merge (MYFILE, OLDFILE, YOURFILE)", async () => {
    const ancestor = [
      "fn main() {",
      "  let a = 1;",
      "  let b = 2;",
      "  let c = 3;",
      "  let d = 4;",
      "  let e = 5;",
      "}",
    ].join("\n") + "\n";
    const mine = [
      "fn main() {",
      "  let a = 100;",
      "  let b = 2;",
      "  let c = 3;",
      "  let d = 4;",
      "  let e = 5;",
      "}",
    ].join("\n") + "\n";
    const yours = [
      "fn main() {",
      "  let a = 1;",
      "  let b = 2;",
      "  let c = 3;",
      "  let d = 4;",
      "  let e = 500;",
      "}",
    ].join("\n") + "\n";
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/base.rs": ancestor,
        "/work/mine.rs": mine,
        "/work/yours.rs": yours,
      },
    });
    const res = await h.exec("diff3 -m /work/mine.rs /work/base.rs /work/yours.rs");
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "fn main() {",
        "  let a = 100;",
        "  let b = 2;",
        "  let c = 3;",
        "  let d = 4;",
        "  let e = 500;",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("10. diff3 -m overlapping conflict detection with custom -L labels and exit code 1", async () => {
    const base = ["header", "value = 10", "footer"].join("\n") + "\n";
    const mine = ["header", "value = 20", "footer"].join("\n") + "\n";
    const yours = ["header", "value = 30", "footer"].join("\n") + "\n";
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/base.cfg": base,
        "/work/mine.cfg": mine,
        "/work/yours.cfg": yours,
      },
    });
    const res = await h.exec(
      "diff3 -m -L OURS -L BASE -L THEIRS /work/mine.cfg /work/base.cfg /work/yours.cfg",
    );
    assert.equal(res.exitCode, 1);
    assert.match(res.stdout, /<<<<<<< OURS/);
    assert.match(res.stdout, /value = 20/);
    assert.match(res.stdout, />>>>>>> THEIRS/);
    assert.match(res.stdout, /value = 30/);
  });

  it("11. diff3 -A (show all changes with base) vs -E (unmerged overlaps only) and -3 / -x modes", async () => {
    const base = ["l1", "l2", "l3", "l4", "l5"].join("\n") + "\n";
    const mine = ["l1", "l2_mine", "l3", "l4", "l5"].join("\n") + "\n";
    const yours = ["l1", "l2_yours", "l3", "l4", "l5_yours"].join("\n") + "\n";
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/base.txt": base,
        "/work/mine.txt": mine,
        "/work/yours.txt": yours,
      },
    });
    const resA = await h.exec("diff3 -m -A -L MINE -L BASE -L YOURS /work/mine.txt /work/base.txt /work/yours.txt");
    assert.equal(resA.exitCode, 1);
    assert.match(resA.stdout, /\|\|\|\|\|\|\| BASE/);
    assert.match(resA.stdout, /l5_yours/);

    const resNormal = await h.exec("diff3 /work/mine.txt /work/base.txt /work/yours.txt");
    assert.equal(resNormal.exitCode, 0, resNormal.stderr);
    assert.match(resNormal.stdout, /====/);
  });

  it("12. diff3 -e ed script generation and -3 / -x selector modes", async () => {
    const base = ["alpha", "beta", "gamma", "delta"].join("\n") + "\n";
    const mine = ["alpha", "BETA_MINE", "gamma", "delta"].join("\n") + "\n";
    const yours = ["alpha", "beta", "gamma", "DELTA_YOURS"].join("\n") + "\n";
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/base.txt": base,
        "/work/mine.txt": mine,
        "/work/yours.txt": yours,
      },
    });
    const res = await h.exec(
      [
        "diff3 -e /work/mine.txt /work/base.txt /work/yours.txt",
        "echo '---'",
        "diff3 -3 /work/mine.txt /work/base.txt /work/yours.txt",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "4c",
        "DELTA_YOURS",
        ".",
        "---",
        "4c",
        "DELTA_YOURS",
        ".",
        "",
      ].join("\n"),
    );
  });

  it("13. apply_patch multi-file atomic Add, Update, and Delete in a single patch envelope", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/src/existing.ts": [
          "export function greet(name: string) {",
          "  return `Hello, ${name}`;",
          "}",
        ].join("\n") + "\n",
        "/workspace/src/obsolete.ts": "export const dead = true;\n",
      },
    });
    const patchText = [
      "*** Begin Patch",
      "*** Add File: src/added.ts",
      "+export const CREATED = 42;",
      "+export const TAG = 'v1';",
      "*** Update File: src/existing.ts",
      "@@",
      " export function greet(name: string) {",
      "-  return `Hello, ${name}`;",
      "+  return `Welcome, ${name}!`;",
      " }",
      "*** Delete File: src/obsolete.ts",
      "*** End Patch",
    ].join("\n") + "\n";

    const res = await h.exec(
      [
        `cat <<'PATCH' | apply_patch`,
        patchText.trimEnd(),
        "PATCH",
        "cat /workspace/src/added.ts",
        "cat /workspace/src/existing.ts",
        "test ! -e /workspace/src/obsolete.ts && echo 'OBSOLETE_DELETED'",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /export const CREATED = 42;/);
    assert.match(res.stdout, /return `Welcome, \$\{name\}!`;/);
    assert.match(res.stdout, /OBSOLETE_DELETED/);
  });

  it("14. apply_patch Update File with *** Move to: renaming and creating parent directories", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/old/module.ts": [
          "export const stage = 'alpha';",
          "export const count = 1;",
        ].join("\n") + "\n",
      },
    });
    const res = await h.exec(
      [
        "apply_patch <<'PATCH'",
        "*** Begin Patch",
        "*** Update File: old/module.ts",
        "*** Move to: new/nested/module.ts",
        "@@",
        "-export const stage = 'alpha';",
        "+export const stage = 'release';",
        " export const count = 1;",
        "*** End Patch",
        "PATCH",
        "test ! -e /workspace/old/module.ts && echo 'OLD_GONE'",
        "cat /workspace/new/nested/module.ts",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /OLD_GONE\nexport const stage = 'release';\nexport const count = 1;\n/);
  });

  it("15. apply_patch multi-hunk updates using @@ context anchors to disambiguate identical blocks", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/service.ts": [
          "class AlphaService {",
          "  run() {",
          "    return 'ok';",
          "  }",
          "}",
          "",
          "class BetaService {",
          "  run() {",
          "    return 'ok';",
          "  }",
          "}",
        ].join("\n") + "\n",
      },
    });
    const res = await h.exec(
      [
        "apply_patch <<'PATCH'",
        "*** Begin Patch",
        "*** Update File: service.ts",
        "@@ class BetaService {",
        "   run() {",
        "-    return 'ok';",
        "+    return 'beta-updated';",
        "   }",
        "*** End Patch",
        "PATCH",
        "cat /workspace/service.ts",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      await h.readText("/workspace/service.ts"),
      [
        "class AlphaService {",
        "  run() {",
        "    return 'ok';",
        "  }",
        "}",
        "",
        "class BetaService {",
        "  run() {",
        "    return 'beta-updated';",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("16. apply_patch preserves CRLF line endings and no-trailing-newline files on Update File", async () => {
    const crlfContent = "first = 1\r\nsecond = 2\r\nthird = 3\r\n";
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/win.ini": crlfContent,
      },
    });
    const res = await h.exec(
      [
        "apply_patch <<'PATCH'",
        "*** Begin Patch",
        "*** Update File: win.ini",
        "@@",
        " first = 1",
        "-second = 2",
        "+second = 200",
        "+inserted = 250",
        " third = 3",
        "*** End Patch",
        "PATCH",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      await h.readText("/workspace/win.ini"),
      "first = 1\r\nsecond = 200\r\ninserted = 250\r\nthird = 3\r\n",
    );
  });

  it("17. apply_patch rejects invalid or non-matching hunks without partially mutating earlier files in the batch", async () => {
    const initialA = "line A1\nline A2\n";
    const initialB = "line B1\nline B2\n";
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/a.txt": initialA,
        "/workspace/b.txt": initialB,
      },
    });
    const res = await h.exec(
      [
        "apply_patch <<'PATCH' 2>/dev/null || echo \"apply_failed=$?\"",
        "*** Begin Patch",
        "*** Update File: a.txt",
        "@@",
        "-line A1",
        "+line A1 mutated",
        " line A2",
        "*** Update File: b.txt",
        "@@",
        "-nonexistent line in b",
        "+replacement",
        "*** End Patch",
        "PATCH",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "apply_failed=1\n");
    assert.equal(await h.readText("/workspace/a.txt"), initialA);
    assert.equal(await h.readText("/workspace/b.txt"), initialB);
  });

  it("18. apply_patch passed as a single CLI argument instead of stdin", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/hello.txt": "hello\nworld\n",
      },
    });
    const res = await h.exec(
      [
        "PATCH_ARG=$(cat <<'EOF'",
        "*** Begin Patch",
        "*** Update File: hello.txt",
        "@@",
        " hello",
        "-world",
        "+rust world",
        "*** End Patch",
        "EOF",
        ")",
        "apply_patch \"$PATCH_ARG\"",
        "cat /workspace/hello.txt",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /hello\nrust world\n$/);
  });

  it("19. end-to-end git-style workflow: apply_patch -> diff -u -> patch -R -> diff3 -m rebase", async () => {
    const base = [
      "# Project Config",
      "host = 127.0.0.1",
      "port = 3000",
      "workers = 4",
      "tls = false",
    ].join("\n") + "\n";
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/base.conf": base,
        "/workspace/feature.conf": base,
        "/workspace/upstream.conf": base,
      },
    });
    const res = await h.exec(
      [
        "apply_patch <<'PATCH' >/dev/null",
        "*** Begin Patch",
        "*** Update File: feature.conf",
        "@@",
        " # Project Config",
        "-host = 127.0.0.1",
        "+host = 0.0.0.0",
        " port = 3000",
        "*** Update File: upstream.conf",
        "@@",
        " workers = 4",
        "-tls = false",
        "+tls = true",
        "*** End Patch",
        "PATCH",
        "diff3 -m /workspace/feature.conf /workspace/base.conf /workspace/upstream.conf > /workspace/merged.conf",
        "diff -u /workspace/base.conf /workspace/merged.conf > /workspace/combined.patch || [ $? -eq 1 ]",
        "patch -R /workspace/merged.conf < /workspace/combined.patch >/dev/null",
        "cmp -s /workspace/merged.conf /workspace/base.conf && echo 'WORKFLOW_ROUNDTRIP_OK'",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "WORKFLOW_ROUNDTRIP_OK\n");
  });

  it("20. diff and patch handling files without trailing newline ('\\ No newline at end of file')", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/no_nl_v1.txt": "alpha\nbeta\ngamma",
        "/work/no_nl_v2.txt": "alpha\nbeta_updated\ngamma",
        "/work/target.txt": "alpha\nbeta\ngamma",
      },
    });
    const res = await h.exec(
      [
        "diff -u /work/no_nl_v1.txt /work/no_nl_v2.txt > /work/no_nl.patch || [ $? -eq 1 ]",
        "grep -q 'No newline at end of file' /work/no_nl.patch && echo 'MARKER_PRESENT'",
        "patch /work/target.txt < /work/no_nl.patch >/dev/null",
        "cmp -s /work/target.txt /work/no_nl_v2.txt && echo 'EXACT_BYTES_MATCH'",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "MARKER_PRESENT\nEXACT_BYTES_MATCH\n");
  });
});
