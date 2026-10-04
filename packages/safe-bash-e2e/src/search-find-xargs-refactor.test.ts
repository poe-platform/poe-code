import assert from "node:assert/strict";
import test from "node:test";
import { createMonorepoFixture } from "./fixtures.js";
import { withE2EHarness } from "./harness.js";

function monorepoOptions() {
  return {
    files: createMonorepoFixture(),
    symlinks: {
      "/workspace/packages/cli/README.md": "../../docs/architecture.md",
    },
  };
}

test("rg respects .gitignore by default and --no-ignore / --hidden reveals ignored and hidden files", async () => {
  await withE2EHarness(monorepoOptions(), async (h) => {
    const script = [
      "default_hits=$(rg -l 'IGNORED_|PROD_SECRET_DO_NOT_COMMIT' /workspace | wc -l | tr -d ' ')",
      "all_hits=$(rg --no-ignore --hidden -l 'IGNORED_BUILD_ARTIFACT|IGNORED_CACHED_TOKEN|PROD_SECRET_DO_NOT_COMMIT' /workspace | sort | paste -sd ',' -)",
      'echo "default=$default_hits|all=$all_hits"',
    ].join("\n");

    await h.expectOk(
      script,
      "default=0|all=/workspace/.env.secret,/workspace/dist/bundle.js,/workspace/node_modules/fake-pkg/index.js\n",
    );
  });
});

test("rg todo/fixme audit across monorepo packages with counts and line numbers", async () => {
  await withE2EHarness(monorepoOptions(), async (h) => {
    const script = [
      "rg -n 'TODO|FIXME' /workspace/packages \\",
      "  | sort \\",
      "  | sed 's|/workspace/packages/||'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "api/src/router.ts:3:// FIXME(api): add rate limiting middleware",
        "cli/src/main.ts:3:// TODO(cli): add --json output flag",
        "core/src/metrics.ts:7:// FIXME: bound max samples to prevent unbounded growth",
        "core/src/token.ts:1:// TODO(security): migrate legacychecksum to sha256",
        "",
      ].join("\n"),
    );
  });
});

test("rg literal replacement (--replace) and only-matching (-o)", async () => {
  await withE2EHarness(monorepoOptions(), async (h) => {
    const script = [
      "rg -o 'TODO\\([a-z]+\\)|FIXME\\([a-z]+\\)' /workspace/packages \\",
      "  | sed 's|/workspace/packages/||' \\",
      "  | sort",
      "rg -o 'CORE_VERSION' -r 'VER_CONST' /workspace/packages/core/src/index.ts",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "api/src/router.ts:FIXME(api)",
        "cli/src/main.ts:TODO(cli)",
        "core/src/token.ts:TODO(security)",
        "VER_CONST",
        "",
      ].join("\n"),
    );
  });
});

test("rg glob filtering (-g) and context lines (-C / -A / -B)", async () => {
  await withE2EHarness(monorepoOptions(), async (h) => {
    const script = [
      "rg -g '*.ts' -g '!*router*' -g '!*main*' -n 'CORE_VERSION' /workspace/packages \\",
      "  | sed 's|/workspace/packages/||'",
    ].join("\n");

    await h.expectOk(
      script,
      "core/src/index.ts:3:export const CORE_VERSION = \"2.4.0\";\n",
    );
  });
});

test("rg fixed-strings (-F), word-regexp (-w), and case-insensitive (-i) modes", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/sample.txt": [
          "foo.bar(1)",
          "foobar(1)",
          "FOO_BAR",
          "foo",
          "foolish",
          "",
        ].join("\n"),
      },
    },
    async (h) => {
      const script = [
        "fixed=$(rg -F 'foo.bar(1)' /workspace/sample.txt)",
        "word=$(rg -w 'foo' /workspace/sample.txt | paste -sd ',' -)",
        "icase=$(rg -i 'foo_bar' /workspace/sample.txt)",
        'echo "fixed=$fixed|word=$word|icase=$icase"',
      ].join("\n");

      await h.expectOk(
        script,
        "fixed=foo.bar(1)|word=foo.bar(1),foo|icase=FOO_BAR\n",
      );
    },
  );
});

test("fd discovers files, directories, and symlinks with extension and exclude filters", async () => {
  await withE2EHarness(monorepoOptions(), async (h) => {
    const script = [
      "ts_files=$(fd -e ts . /workspace/packages | sort | sed 's|/workspace/packages/||' | paste -sd ',' -)",
      "symlinks=$(fd -t l . /workspace | sed 's|/workspace/||' | sort | paste -sd ',' -)",
      'echo "ts=$ts_files"',
      'echo "links=$symlinks"',
    ].join("\n");

    await h.expectOk(
      script,
      [
        "ts=api/src/router.ts,cli/src/main.ts,core/src/index.ts,core/src/metrics.ts,core/src/token.ts",
        "links=packages/cli/README.md",
        "",
      ].join("\n"),
    );
  });
});

test("find boolean expressions (-and, -or, -not, parentheses) and -prune", async () => {
  await withE2EHarness(monorepoOptions(), async (h) => {
    const script = [
      "find /workspace \\",
      "  \\( -name 'node_modules' -o -name 'dist' -o -name '.git' \\) -prune \\",
      "  -o -type f \\( -name '*.json' -o -name '*.sh' \\) -print \\",
      "  | sort \\",
      "  | sed 's|/workspace/||'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "package.json",
        "packages/api/package.json",
        "packages/cli/package.json",
        "packages/core/package.json",
        "scripts/release.sh",
        "",
      ].join("\n"),
    );
  });
});

test("find -exec with single-file (;) and batched (+) invocations", async () => {
  await withE2EHarness(monorepoOptions(), async (h) => {
    const script = [
      "find /workspace/packages -type f -name 'package.json' -exec jq -r '.name' {} + | sort",
    ].join("\n");

    await h.expectOk(
      script,
      ["@acme/api", "@acme/cli", "@acme/core", ""].join("\n"),
    );
  });
});

test("find by permission bits (-perm) and depth bounds (-mindepth / -maxdepth)", async () => {
  await withE2EHarness(monorepoOptions(), async (h) => {
    const script = [
      "exec_files=$(find /workspace -maxdepth 3 -type f -perm 0755 | sed 's|/workspace/||')",
      "top_files=$(find /workspace -mindepth 1 -maxdepth 1 -type f | sort | sed 's|/workspace/||' | paste -sd ',' -)",
      'echo "exec=$exec_files|top=$top_files"',
    ].join("\n");

    await h.expectOk(
      script,
      "exec=scripts/release.sh|top=.env.secret,.gitignore,Cargo.toml,package.json\n",
    );
  });
});

test("xargs -I {} and -n batching for multi-step file transformation", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/items.txt": "alpha\nbeta\ngamma\ndelta\nepsilon\n",
      },
    },
    async (h) => {
      const script = [
        "cat /workspace/items.txt | xargs -n 2 echo | tr ' ' ':' > /workspace/pairs.txt",
        "cat /workspace/items.txt | xargs -I {} sh -c 'echo \"item={}\"' > /workspace/tagged.txt",
        'echo "pairs=$(paste -sd "," /workspace/pairs.txt)"',
        'echo "tagged_count=$(wc -l < /workspace/tagged.txt | tr -d " ")"',
      ].join("\n");

      await h.expectOk(
        script,
        ["pairs=alpha:beta,gamma:delta,epsilon", "tagged_count=5", ""].join("\n"),
      );
    },
  );
});

test("end-to-end codebase refactoring: rg -l -> xargs sed -i -> diff -u -> patch -R rollback", async () => {
  await withE2EHarness(monorepoOptions(), async (h) => {
    const beforeSnapshot = await h.snapshotTree("/workspace/packages");

    const refactorScript = [
      "cp -r /workspace/packages /workspace/packages.orig",
      "rg -l 'CORE_VERSION' /workspace/packages | sort | xargs sed -i 's/CORE_VERSION/CURRENT_API_VERSION/g'",
      "sed -i 's/\"2.4.0\"/\"3.0.0\"/g' /workspace/packages/core/src/index.ts",
      "rg -c 'CURRENT_API_VERSION' /workspace/packages | sort | sed 's|/workspace/packages/||'",
    ].join("\n");

    await h.expectOk(
      refactorScript,
      [
        "api/src/router.ts:2",
        "cli/src/main.ts:2",
        "core/src/index.ts:1",
        "",
      ].join("\n"),
    );

    // Generate unified diffs for modified files and reverse-apply them with patch -R
    const rollbackScript = [
      "diff -u /workspace/packages.orig/core/src/index.ts /workspace/packages/core/src/index.ts > /workspace/core.patch || true",
      "diff -u /workspace/packages.orig/api/src/router.ts /workspace/packages/api/src/router.ts > /workspace/router.patch || true",
      "diff -u /workspace/packages.orig/cli/src/main.ts /workspace/packages/cli/src/main.ts > /workspace/cli.patch || true",
      "patch -R /workspace/packages/core/src/index.ts < /workspace/core.patch >/dev/null",
      "patch -R /workspace/packages/api/src/router.ts < /workspace/router.patch >/dev/null",
      "patch -R /workspace/packages/cli/src/main.ts < /workspace/cli.patch >/dev/null",
      "rm -rf /workspace/packages.orig /workspace/core.patch /workspace/router.patch /workspace/cli.patch",
      "rg -c 'CORE_VERSION' /workspace/packages | sort | sed 's|/workspace/packages/||'",
    ].join("\n");

    await h.expectOk(
      rollbackScript,
      [
        "api/src/router.ts:2",
        "cli/src/main.ts:2",
        "core/src/index.ts:1",
        "",
      ].join("\n"),
    );

    const afterSnapshot = await h.snapshotTree("/workspace/packages");
    assert.deepEqual(afterSnapshot, beforeSnapshot);
  });
});

test("apply_patch adds, updates, moves, and deletes files in a single atomic operation", async () => {
  await withE2EHarness(monorepoOptions(), async (h) => {
    const script = [
      "apply_patch <<'PATCH' >/dev/null",
      "*** Begin Patch",
      "*** Add File: /workspace/packages/core/src/version.ts",
      "+export const SCHEMA_VERSION = 42;",
      "*** Update File: /workspace/packages/core/src/index.ts",
      "@@",
      " export { RollingWindow, type WindowSample } from \"./metrics.js\";",
      "+export { SCHEMA_VERSION } from \"./version.js\";",
      " export const CORE_VERSION = \"2.4.0\";",
      "*** Delete File: /workspace/.env.secret",
      "*** End Patch",
      "PATCH",
      "cat /workspace/packages/core/src/version.ts",
      "grep 'SCHEMA_VERSION' /workspace/packages/core/src/index.ts",
      "test ! -e /workspace/.env.secret && echo 'secret_deleted:yes'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "export const SCHEMA_VERSION = 42;",
        'export { SCHEMA_VERSION } from "./version.js";',
        "secret_deleted:yes",
        "",
      ].join("\n"),
    );
  });
});

test("diff3 three-way merge resolves clean non-overlapping edits and flags overlapping conflicts", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/base.txt": ["line1", "line2", "line3", "line4", "line5", ""].join("\n"),
        "/workspace/ours.txt": ["line1_ours", "line2", "line3", "line4", "line5", ""].join("\n"),
        "/workspace/theirs.txt": ["line1", "line2", "line3", "line4", "line5_theirs", ""].join("\n"),
        "/workspace/conflict_theirs.txt": ["line1_conflict", "line2", "line3", "line4", "line5", ""].join("\n"),
      },
    },
    async (h) => {
      const cleanScript = "diff3 -m /workspace/ours.txt /workspace/base.txt /workspace/theirs.txt";
      await h.expectOk(
        cleanScript,
        ["line1_ours", "line2", "line3", "line4", "line5_theirs", ""].join("\n"),
      );

      const conflictRes = await h.exec(
        "diff3 -m /workspace/ours.txt /workspace/base.txt /workspace/conflict_theirs.txt",
      );
      assert.equal(conflictRes.exitCode, 1);
      assert.match(conflictRes.stdout, /<<<<<<< /);
      assert.match(conflictRes.stdout, />>>>>>> /);
      assert.match(conflictRes.stdout, /line1_ours/);
      assert.match(conflictRes.stdout, /line1_conflict/);
    },
  );
});

test("grep, egrep, and fgrep equivalence and inverted matching (-v) with line numbers (-n)", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/events.log": [
          "alpha:100:ok",
          "beta:200:fail",
          "gamma:300:ok",
          "delta:400:retry",
          "epsilon:500:fail",
          "",
        ].join("\n"),
      },
    },
    async (h) => {
      const script = [
        "egrep -n '(fail|retry)$' /workspace/events.log",
        "fgrep -v ':ok' /workspace/events.log | wc -l | tr -d ' '",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "2:beta:200:fail",
          "4:delta:400:retry",
          "5:epsilon:500:fail",
          "3",
          "",
        ].join("\n"),
      );
    },
  );
});

test("multi-package dependency graph audit combining find, jq, sort, and tsort", async () => {
  await withE2EHarness(monorepoOptions(), async (h) => {
    const script = [
      "for pkg in /workspace/packages/*/package.json; do",
      "  jq -r '.name as $n | (.dependencies // {} | keys[] | \"\\(.) \\($n)\")' \"$pkg\"",
      "done | sort -u | tsort",
    ].join("\n");

    await h.expectOk(
      script,
      ["@acme/core", "@acme/api", "@acme/cli", ""].join("\n"),
    );
  });
});

test("rg context lines (-B, -A, -C) and file-match count (-c)", async () => {
  await withE2EHarness(monorepoOptions(), async (h) => {
    const script = [
      "rg -B 1 -A 1 'RollingWindow \\{' /workspace/packages/core/src/metrics.ts",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "// FIXME: bound max samples to prevent unbounded growth",
        "export class RollingWindow {",
        "  readonly #samples: WindowSample[] = [];",
        "",
      ].join("\n"),
    );
  });
});

test("rg --files lists tracked non-ignored files in deterministic order", async () => {
  await withE2EHarness(monorepoOptions(), async (h) => {
    const script = [
      "rg --files /workspace/crates | sort | sed 's|/workspace/||'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "crates/engine/Cargo.toml",
        "crates/engine/src/lib.rs",
        "",
      ].join("\n"),
    );
  });
});

test("patch creates new file from /dev/null diff and deletes file to /dev/null", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/obsolete.txt": "remove_line_1\nremove_line_2\n",
      },
    },
    async (h) => {
      const script = [
        "cat <<'EOF' > /workspace/create.patch",
        "--- /dev/null",
        "+++ b/created.txt",
        "@@ -0,0 +1,2 @@",
        "+hello_new_1",
        "+hello_new_2",
        "EOF",
        "patch -p1 < /workspace/create.patch >/dev/null",
        "cat /workspace/created.txt",
      ].join("\n");

      await h.expectOk(script, "hello_new_1\nhello_new_2\n");
    },
  );
});

test("which resolves PATH executables with -a/-s flags while command -v resolves virtual commands", async () => {
  await withE2EHarness(monorepoOptions(), async (h) => {
    const script = [
      "PATH='/workspace/scripts:/usr/bin:/bin' which release.sh",
      "PATH='/workspace/scripts:/usr/bin:/bin' which -s release.sh && echo 'quiet_found:yes'",
      "PATH='/workspace/scripts:/usr/bin:/bin' which nonexistent_cmd_xyz >/dev/null 2>&1 || echo \"missing_rc=$?\"",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "/workspace/scripts/release.sh",
        "quiet_found:yes",
        "missing_rc=1",
        "",
      ].join("\n"),
    );
  });
});

test("find -size and -empty predicates locate empty files and large files", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/sz/empty.txt": "",
        "/workspace/sz/tiny.txt": "hi\n",
        "/workspace/sz/big.txt": "x".repeat(4096) + "\n",
      },
    },
    async (h) => {
      const script = [
        "empty=$(find /workspace/sz -type f -empty | sed 's|/workspace/sz/||')",
        "big=$(find /workspace/sz -type f -size +2k | sed 's|/workspace/sz/||')",
        'echo "empty=$empty|big=$big"',
      ].join("\n");

      await h.expectOk(script, "empty=empty.txt|big=big.txt\n");
    },
  );
});
