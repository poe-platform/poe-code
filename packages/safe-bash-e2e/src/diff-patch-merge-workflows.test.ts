import assert from "node:assert/strict";
import test from "node:test";
import { createMonorepoFixture } from "./fixtures.js";
import { withE2EHarness } from "./harness.js";

test("diff -u generates unified diff and patch applies and reverses (-R) cleanly", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/v1.ts": [
          "export function compute(a: number, b: number): number {",
          "  const sum = a + b;",
          "  return sum;",
          "}",
          "",
        ].join("\n"),
        "/workspace/v2.ts": [
          "export function compute(a: number, b: number, scale = 1): number {",
          "  const sum = (a + b) * scale;",
          "  return sum;",
          "}",
          "",
        ].join("\n"),
      },
    },
    async (h) => {
      const script = [
        "cp /workspace/v1.ts /workspace/target.ts",
        "diff -u /workspace/v1.ts /workspace/v2.ts > /workspace/change.patch || true",
        "patch /workspace/target.ts < /workspace/change.patch >/dev/null",
        "cmp -s /workspace/target.ts /workspace/v2.ts && echo 'forward:ok'",
        "patch -R /workspace/target.ts < /workspace/change.patch >/dev/null",
        "cmp -s /workspace/target.ts /workspace/v1.ts && echo 'reverse:ok'",
      ].join("\n");

      await h.expectOk(script, ["forward:ok", "reverse:ok", ""].join("\n"));
    },
  );
});

test("diff -uNr across directory trees and patch -p1 reconstructs added, modified, and deleted files", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/tree_a/keep.txt": "unchanged\n",
        "/workspace/tree_a/modify.txt": "line1\nold_line\nline3\n",
        "/workspace/tree_a/remove.txt": "to_be_deleted\n",
        "/workspace/tree_b/keep.txt": "unchanged\n",
        "/workspace/tree_b/modify.txt": "line1\nnew_line\nline3\n",
        "/workspace/tree_b/sub/added.txt": { content: "brand_new_file\n", mode: 0o644 },
      },
    },
    async (h) => {
      const expectedSnap = await h.snapshotTree("/workspace/tree_b");

      const script = [
        "cd /workspace",
        "diff -uNr tree_a tree_b > tree.patch || true",
        "cp -r tree_a tree_applied",
        "cd /workspace/tree_applied && patch -p1 < /workspace/tree.patch >/dev/null",
        "test ! -e /workspace/tree_applied/remove.txt && echo 'removed:yes'",
        "cat /workspace/tree_applied/sub/added.txt",
      ].join("\n");

      await h.expectOk(
        script,
        ["removed:yes", "brand_new_file", ""].join("\n"),
      );

      const appliedSnap = await h.snapshotTree("/workspace/tree_applied");
      assert.deepEqual(appliedSnap, expectedSnap);
    },
  );
});

test("diff whitespace and case flags (-w, -b, -B, -i, -q, -s)", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/f1.txt": "Alpha   Beta\n\nGamma\n",
        "/workspace/f2.txt": "alpha beta\ngamma\n",
      },
    },
    async (h) => {
      const script = [
        "diff -q /workspace/f1.txt /workspace/f2.txt >/dev/null || echo 'raw_differs:yes'",
        "diff -w -B -i -s /workspace/f1.txt /workspace/f2.txt | grep -c 'identical'",
      ].join("\n");

      await h.expectOk(script, ["raw_differs:yes", "1", ""].join("\n"));
    },
  );
});

test("diff -c context format and normal format round-trip through patch", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/orig.cfg": "host=127.0.0.1\nport=8080\ntls=false\n",
        "/workspace/next.cfg": "host=0.0.0.0\nport=8443\ntls=true\n",
      },
    },
    async (h) => {
      const script = [
        "cp /workspace/orig.cfg /workspace/ctx_target.cfg",
        "cp /workspace/orig.cfg /workspace/norm_target.cfg",
        "diff -c /workspace/orig.cfg /workspace/next.cfg > /workspace/ctx.patch || true",
        "diff /workspace/orig.cfg /workspace/next.cfg > /workspace/norm.patch || true",
        "patch /workspace/ctx_target.cfg < /workspace/ctx.patch >/dev/null",
        "patch /workspace/norm_target.cfg < /workspace/norm.patch >/dev/null",
        "cmp -s /workspace/ctx_target.cfg /workspace/next.cfg && echo 'context:ok'",
        "cmp -s /workspace/norm_target.cfg /workspace/next.cfg && echo 'normal:ok'",
      ].join("\n");

      await h.expectOk(script, ["context:ok", "normal:ok", ""].join("\n"));
    },
  );
});

test("patch applies hunks with line-offset shifting when header lines are inserted above hunk", async () => {
  const baseLines = Array.from({ length: 20 }, (_, i) => `line_${i + 1}`);
  const modifiedLines = [...baseLines];
  modifiedLines[14] = "line_15_patched";

  await withE2EHarness(
    {
      files: {
        "/workspace/base.txt": baseLines.join("\n") + "\n",
        "/workspace/modified.txt": modifiedLines.join("\n") + "\n",
        "/workspace/shifted.txt":
          ["header_a", "header_b", "header_c", ...baseLines].join("\n") + "\n",
      },
    },
    async (h) => {
      const script = [
        "diff -u /workspace/base.txt /workspace/modified.txt > /workspace/hunk.patch || true",
        "patch /workspace/shifted.txt < /workspace/hunk.patch >/dev/null",
        "grep -n 'line_15_patched' /workspace/shifted.txt",
      ].join("\n");

      await h.expectOk(script, "18:line_15_patched\n");
    },
  );
});

test("patch --dry-run validates patch applicability without modifying target files", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/a.txt": "hello\nworld\n",
        "/workspace/b.txt": "hello\nsafe-bash\n",
      },
    },
    async (h) => {
      const script = [
        "diff -u /workspace/a.txt /workspace/b.txt > /workspace/ab.patch || true",
        "patch --dry-run /workspace/a.txt < /workspace/ab.patch >/dev/null",
        "cat /workspace/a.txt",
      ].join("\n");

      await h.expectOk(script, "hello\nworld\n");
    },
  );
});

test("diff3 -m performs clean 3-way merge when changes occur in non-overlapping regions", async () => {
  const ancestor = [
    "section_1: original_top",
    "section_2: shared_middle_a",
    "section_3: shared_middle_b",
    "section_4: shared_middle_c",
    "section_5: original_bottom",
    "",
  ].join("\n");

  const ours = [
    "section_1: OUR_UPDATED_TOP",
    "section_2: shared_middle_a",
    "section_3: shared_middle_b",
    "section_4: shared_middle_c",
    "section_5: original_bottom",
    "",
  ].join("\n");

  const theirs = [
    "section_1: original_top",
    "section_2: shared_middle_a",
    "section_3: shared_middle_b",
    "section_4: shared_middle_c",
    "section_5: THEIR_UPDATED_BOTTOM",
    "",
  ].join("\n");

  await withE2EHarness(
    {
      files: {
        "/workspace/base.txt": ancestor,
        "/workspace/ours.txt": ours,
        "/workspace/theirs.txt": theirs,
      },
    },
    async (h) => {
      await h.expectOk(
        "diff3 -m /workspace/ours.txt /workspace/base.txt /workspace/theirs.txt",
        [
          "section_1: OUR_UPDATED_TOP",
          "section_2: shared_middle_a",
          "section_3: shared_middle_b",
          "section_4: shared_middle_c",
          "section_5: THEIR_UPDATED_BOTTOM",
          "",
        ].join("\n"),
      );
    },
  );
});

test("diff3 -m emits conflict markers and exits with code 1 on overlapping 3-way edits", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/base.txt": "line_1\nconflict_target\nline_3\n",
        "/workspace/ours.txt": "line_1\nour_version\nline_3\n",
        "/workspace/theirs.txt": "line_1\ntheir_version\nline_3\n",
      },
    },
    async (h) => {
      const res = await h.exec(
        "diff3 -m /workspace/ours.txt /workspace/base.txt /workspace/theirs.txt",
      );
      assert.equal(res.exitCode, 1);
      assert.match(res.stdout, /<{7}/);
      assert.match(res.stdout, /our_version/);
      assert.match(res.stdout, /={7}/);
      assert.match(res.stdout, /their_version/);
      assert.match(res.stdout, />{7}/);
    },
  );
});

test("apply_patch adds, updates, moves, and deletes files atomically in a single patch transaction", async () => {
  await withE2EHarness({ files: createMonorepoFixture() }, async (h) => {
    const script = [
      "apply_patch <<'PATCH'",
      "*** Begin Patch",
      "*** Add File: /workspace/packages/core/src/health.ts",
      "+export function isHealthy(): boolean {",
      "+  return true;",
      "+}",
      "*** Update File: /workspace/package.json",
      "@@",
      '-  "version": "2.4.0",',
      '+  "version": "2.5.0",',
      "*** Delete File: /workspace/docs/architecture.md",
      "*** End Patch",
      "PATCH",
      "jq -r '.version' /workspace/package.json",
      "test -f /workspace/packages/core/src/health.ts && echo 'added:yes'",
      "test ! -e /workspace/docs/architecture.md && echo 'deleted:yes'",
    ].join("\n");

    const res = await h.exec(script);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /2\.5\.0/);
    assert.match(res.stdout, /added:yes/);
    assert.match(res.stdout, /deleted:yes/);
  });
});

test("apply_patch with '*** Move to:' renames a file and updates its contents in one step", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/src/legacy.ts": "export const mode = 'legacy';\n",
      },
    },
    async (h) => {
      const script = [
        "apply_patch <<'PATCH'",
        "*** Begin Patch",
        "*** Update File: /workspace/src/legacy.ts",
        "*** Move to: /workspace/src/modern.ts",
        "@@",
        "-export const mode = 'legacy';",
        "+export const mode = 'modern';",
        "*** End Patch",
        "PATCH",
        "test ! -e /workspace/src/legacy.ts && echo 'old_gone:yes'",
        "cat /workspace/src/modern.ts",
      ].join("\n");

      const res = await h.exec(script);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /old_gone:yes/);
      assert.match(res.stdout, /export const mode = 'modern';/);
    },
  );
});

test("apply_patch rolls back or rejects invalid hunk context without partial corruption", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/a.txt": "alpha\nbeta\n",
        "/workspace/b.txt": "one\ntwo\n",
      },
    },
    async (h) => {
      const before = await h.snapshotTree("/workspace");

      await h.expectFail(
        [
          "apply_patch <<'PATCH'",
          "*** Begin Patch",
          "*** Update File: /workspace/a.txt",
          "@@",
          "-alpha",
          "+ALPHA",
          "*** Update File: /workspace/b.txt",
          "@@",
          "-nonexistent_context_line",
          "+TWO",
          "*** End Patch",
          "PATCH",
        ].join("\n"),
      );

      const after = await h.snapshotTree("/workspace");
      assert.deepEqual(after, before, "failed multi-file apply_patch must not leave partial edits");
    },
  );
});

test("apply_patch multi-chunk update within a single file", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/module.ts": [
          "const HEADER = 'v1';",
          "function a() {",
          "  return 1;",
          "}",
          "function b() {",
          "  return 2;",
          "}",
          "const FOOTER = 'end-v1';",
          "",
        ].join("\n"),
      },
    },
    async (h) => {
      const script = [
        "apply_patch <<'PATCH'",
        "*** Begin Patch",
        "*** Update File: /workspace/module.ts",
        "@@",
        "-const HEADER = 'v1';",
        "+const HEADER = 'v2';",
        "@@ function b() {",
        "-  return 2;",
        "+  return 20;",
        " }",
        " const FOOTER = 'end-v1';",
        "*** End Patch",
        "PATCH",
        "cat /workspace/module.ts",
      ].join("\n");

      const res = await h.exec(script);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /const HEADER = 'v2';/);
      assert.match(res.stdout, /return 20;/);
    },
  );
});

test("git-style diff generation and selective hunk filtering pipeline", async () => {
  await withE2EHarness({ files: createMonorepoFixture() }, async (h) => {
    const script = [
      "cp -r /workspace/packages/core /workspace/core_orig",
      "sed -i 's/computeChecksum/computeFnv1a/g' /workspace/packages/core/src/token.ts",
      "diff -u /workspace/core_orig/src/token.ts /workspace/packages/core/src/token.ts > /workspace/token.diff || true",
      "grep -E '^[+-][^+-]' /workspace/token.diff | wc -l | tr -d ' '",
    ].join("\n");

    const res = await h.exec(script);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.ok(Number(res.stdout.trim()) >= 2);
  });
});

test("comm -12, -23, -13 set operations compared against diff of sorted lists", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/set_a.txt": "alpha\nbeta\ndelta\nepsilon\n",
        "/workspace/set_b.txt": "beta\ndelta\ngamma\nzeta\n",
      },
    },
    async (h) => {
      const script = [
        "comm -12 /workspace/set_a.txt /workspace/set_b.txt | paste -sd ',' -",
        "comm -23 /workspace/set_a.txt /workspace/set_b.txt | paste -sd ',' -",
        "comm -13 /workspace/set_a.txt /workspace/set_b.txt | paste -sd ',' -",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "beta,delta",
          "alpha,epsilon",
          "gamma,zeta",
          "",
        ].join("\n"),
      );
    },
  );
});

test("patch creates a new file when unified diff old header is /dev/null", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "cat <<'DIFF' > /workspace/create.patch",
      "--- /dev/null\t2025-01-01 00:00:00.000000000 +0000",
      "+++ b/created_by_patch.txt\t2025-01-01 00:00:00.000000000 +0000",
      "@@ -0,0 +1,3 @@",
      "+firstcreated",
      "+secondcreated",
      "+thirdcreated",
      "DIFF",
      "cd /workspace && patch -p1 < /workspace/create.patch >/dev/null",
      "cat /workspace/created_by_patch.txt",
    ].join("\n");

    await h.expectOk(
      script,
      ["firstcreated", "secondcreated", "thirdcreated", ""].join("\n"),
    );
  });
});

test("patch deletes an existing file when unified diff new header is /dev/null", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/delete_me.txt": "bye_1\nbye_2\n",
      },
    },
    async (h) => {
      const script = [
        "cat <<'DIFF' > /workspace/delete.patch",
        "--- a/delete_me.txt\t2025-01-01 00:00:00.000000000 +0000",
        "+++ /dev/null\t2025-01-01 00:00:00.000000000 +0000",
        "@@ -1,2 +0,0 @@",
        "-bye_1",
        "-bye_2",
        "DIFF",
        "cd /workspace && patch -p1 < /workspace/delete.patch >/dev/null",
        "test ! -e /workspace/delete_me.txt && echo 'deleted_by_patch:yes'",
      ].join("\n");

      await h.expectOk(script, "deleted_by_patch:yes\n");
    },
  );
});

test("diff3 -E and -A conflict reporting modes", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/old.txt": "a\nb\nc\n",
        "/workspace/mine.txt": "a\nmine_b\nc\n",
        "/workspace/yours.txt": "a\nyours_b\nc\n",
      },
    },
    async (h) => {
      const resE = await h.exec(
        "diff3 -m -E /workspace/mine.txt /workspace/old.txt /workspace/yours.txt",
      );
      assert.equal(resE.exitCode, 1);
      assert.match(resE.stdout, /mine_b/);
      assert.match(resE.stdout, /yours_b/);

      const resA = await h.exec(
        "diff3 -m -A /workspace/mine.txt /workspace/old.txt /workspace/yours.txt",
      );
      assert.equal(resA.exitCode, 1);
      assert.match(resA.stdout, /\|\|\|\|\|\|\|/);
    },
  );
});

test("diff -r reports file-only presence in either directory ('Only in ...')", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/d1/shared.txt": "same\n",
        "/workspace/d1/only_left.txt": "left\n",
        "/workspace/d2/shared.txt": "same\n",
        "/workspace/d2/only_right.txt": "right\n",
      },
    },
    async (h) => {
      const res = await h.exec("diff -r /workspace/d1 /workspace/d2");
      assert.equal(res.exitCode, 1);
      assert.match(res.stdout, /Only in \/workspace\/d1: only_left\.txt/);
      assert.match(res.stdout, /Only in \/workspace\/d2: only_right\.txt/);
    },
  );
});

test("apply_patch via literal command argument instead of stdin", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/note.txt": "status: draft\n",
      },
    },
    async (h) => {
      const script = [
        "patch_body=$(cat <<'EOF'",
        "*** Begin Patch",
        "*** Update File: /workspace/note.txt",
        "@@",
        "-status: draft",
        "+status: published",
        "*** End Patch",
        "EOF",
        ")",
        'apply_patch "$patch_body" >/dev/null',
        "cat /workspace/note.txt",
      ].join("\n");

      await h.expectOk(script, "status: published\n");
    },
  );
});

test("end-to-end code review & patch cycle: rg -> apply_patch -> diff -u -> patch -R restore", async () => {
  await withE2EHarness({ files: createMonorepoFixture() }, async (h) => {
    const beforeSnap = await h.snapshotTree("/workspace/packages/api");

    const script = [
      "cp -r /workspace/packages/api /workspace/api_backup",
      "apply_patch <<'PATCH'",
      "*** Begin Patch",
      "*** Update File: /workspace/packages/api/src/router.ts",
      "@@",
      "-export function routeRequest(path: string, token: string): string {",
      "+export function routeRequest(path: string, token: string, traceId = 'none'): string {",
      "*** End Patch",
      "PATCH",
      "rg -c 'traceId' /workspace/packages/api/src/router.ts",
      "diff -u /workspace/api_backup/src/router.ts /workspace/packages/api/src/router.ts > /workspace/revert.patch || true",
      "patch -R /workspace/packages/api/src/router.ts < /workspace/revert.patch >/dev/null",
    ].join("\n");

    await h.expectOk(script, ["Success. Updated the following files:", "M /workspace/packages/api/src/router.ts", "1", ""].join("\n"));

    const afterSnap = await h.snapshotTree("/workspace/packages/api");
    assert.deepEqual(afterSnap, beforeSnap);
  });
});
