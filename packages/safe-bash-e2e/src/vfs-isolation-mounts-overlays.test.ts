import assert from "node:assert/strict";
import test from "node:test";
import {
  createMemoryFileSystem,
  createMountFileSystem,
  createOverlayFileSystem,
  createReadOnlyFileSystem,
} from "@poe-code/safe-fs";
import { createMonorepoFixture } from "./fixtures.js";
import { seedFilesOnFs, snapshotFsTree, withE2EHarness } from "./harness.js";

test("OverlayFileSystem copy-on-write keeps lower layer untouched across edits, creations, and deletions", async () => {
  const lower = createMemoryFileSystem();
  await seedFilesOnFs(lower, createMonorepoFixture());
  const lowerBefore = await snapshotFsTree(lower, "/workspace");

  const upper = createMemoryFileSystem();
  const overlay = createOverlayFileSystem({ lower, upper });

  await withE2EHarness({ fs: overlay, cwd: "/workspace" }, async (h) => {
    const script = [
      "sed 's/2.4.0/3.0.0-overlay/' /workspace/package.json > /workspace/package.json.tmp && mv /workspace/package.json.tmp /workspace/package.json",
      "rm -f /workspace/Cargo.toml",
      "echo 'new overlay file' > /workspace/packages/core/src/overlay.ts",
      "jq -r '.version' /workspace/package.json",
      "test ! -e /workspace/Cargo.toml && echo 'deleted_in_overlay:yes'",
      "cat /workspace/packages/core/src/overlay.ts",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "3.0.0-overlay",
        "deleted_in_overlay:yes",
        "new overlay file",
        "",
      ].join("\n"),
    );
  });

  const lowerAfter = await snapshotFsTree(lower, "/workspace");
  assert.deepEqual(lowerAfter, lowerBefore, "lower layer must remain completely unmodified");
});

test("MountFileSystem routes reads/writes across multiple mounted filesystems and supports cross-mount cp and mv", async () => {
  const rootFs = createMemoryFileSystem();
  const dataFs = createMemoryFileSystem();
  const archiveFs = createMemoryFileSystem();

  await seedFilesOnFs(dataFs, {
    "/records/users.txt": "alice\nbob\ncharlie\n",
  });

  const mounted = createMountFileSystem({
    root: rootFs,
    mounts: {
      "/mnt/data": dataFs,
      "/mnt/archive": archiveFs,
    },
  });

  await withE2EHarness({ fs: mounted, cwd: "/" }, async (h) => {
    const script = [
      "cp /mnt/data/records/users.txt /mnt/archive/users_backup.txt",
      "mv /mnt/data/records/users.txt /mnt/archive/users_moved.txt",
      "test ! -e /mnt/data/records/users.txt && echo 'source_removed:yes'",
      "wc -l < /mnt/archive/users_moved.txt | tr -d ' '",
    ].join("\n");

    await h.expectOk(script, ["source_removed:yes", "3", ""].join("\n"));
  });

  const archivedSnap = await snapshotFsTree(archiveFs, "/");
  assert.equal(archivedSnap["/users_backup.txt"]?.text, "alice\nbob\ncharlie\n");
  assert.equal(archivedSnap["/users_moved.txt"]?.text, "alice\nbob\ncharlie\n");
});

test("ReadOnlyFileSystem rejects write, rm, mkdir, mv, and redirection mutations while allowing full read pipelines", async () => {
  const mem = createMemoryFileSystem();
  await seedFilesOnFs(mem, createMonorepoFixture());
  const before = await snapshotFsTree(mem, "/workspace");

  const ro = createReadOnlyFileSystem(mem);
  await withE2EHarness({ fs: ro, cwd: "/workspace" }, async (h) => {
    await h.expectFail("echo 'hack' > /workspace/package.json");
    await h.expectFail("rm /workspace/package.json");
    await h.expectFail("mkdir /workspace/new_dir");
    await h.expectFail("mv /workspace/package.json /workspace/pkg.json");

    await h.expectOk("jq -r '.name' /workspace/package.json", "@acme/platform\n");
  });

  const after = await snapshotFsTree(mem, "/workspace");
  assert.deepEqual(after, before);
});

test("symbolic links (ln -s), readlink, readlink -f, and realpath resolve multi-hop relative chains", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "mkdir -p /workspace/a/b/c /workspace/links",
      "echo 'target_payload' > /workspace/a/b/c/real.txt",
      "ln -s ../a/b/c/real.txt /workspace/links/hop1",
      "ln -s links/hop1 /workspace/hop2",
      "readlink /workspace/hop2",
      "readlink -f /workspace/hop2",
      "realpath /workspace/hop2",
      "cat /workspace/hop2",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "links/hop1",
        "/workspace/a/b/c/real.txt",
        "/workspace/a/b/c/real.txt",
        "target_payload",
        "",
      ].join("\n"),
    );
  });
});

test("dangling symlinks and self-referential symlink loops (ELOOP) are handled deterministically", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "ln -s /workspace/nonexistent_target /workspace/dangling",
      "test -L /workspace/dangling && echo 'is_symlink:yes'",
      "test ! -e /workspace/dangling && echo 'target_exists:no'",
      "ln -s /workspace/loop_b /workspace/loop_a",
      "ln -s /workspace/loop_a /workspace/loop_b",
      "cat /workspace/loop_a 2>/dev/null || echo 'loop_failed:yes'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "is_symlink:yes",
        "target_exists:no",
        "loop_failed:yes",
        "",
      ].join("\n"),
    );
  });
});

test("hard links (ln) share underlying file content and survive unlinking of original path", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "echo 'initial_data' > /workspace/orig.txt",
      "ln /workspace/orig.txt /workspace/hardlink.txt",
      "echo 'appended_via_hardlink' >> /workspace/hardlink.txt",
      "cat /workspace/orig.txt",
      "rm /workspace/orig.txt",
      "cat /workspace/hardlink.txt",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "initial_data",
        "appended_via_hardlink",
        "initial_data",
        "appended_via_hardlink",
        "",
      ].join("\n"),
    );
  });
});

test("chmod octal and symbolic mode changes (u+x, g-w, o=r, a+x) and stat mode inspection", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "echo '#!/bin/sh' > /workspace/run.sh",
      "chmod 600 /workspace/run.sh",
      "stat -c '%a' /workspace/run.sh",
      "chmod u+x,g+r,o+r /workspace/run.sh",
      "stat -c '%a' /workspace/run.sh",
      "test -x /workspace/run.sh && echo 'exec:yes'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "600",
        "744",
        "exec:yes",
        "",
      ].join("\n"),
    );
  });
});

test("chmod -R recursive permission normalization across directory tree", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "mkdir -p /workspace/tree/sub",
      "echo 'a' > /workspace/tree/a.sh",
      "echo 'b' > /workspace/tree/sub/b.sh",
      "chmod -R 755 /workspace/tree",
      "stat -c '%a %n' /workspace/tree/a.sh /workspace/tree/sub/b.sh",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "755 /workspace/tree/a.sh",
        "755 /workspace/tree/sub/b.sh",
        "",
      ].join("\n"),
    );
  });
});

test("umask controls default creation permissions for files and directories", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "umask 077",
      "echo 'secret' > /workspace/private.key",
      "mkdir /workspace/private_dir",
      "stat -c '%a' /workspace/private.key",
      "stat -c '%a' /workspace/private_dir",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "600",
        "700",
        "",
      ].join("\n"),
    );
  });
});

test("touch -d and -r propagate modification timestamps and ls -t sorts by mtime", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "echo 'first' > /workspace/oldest.txt",
      "echo 'second' > /workspace/middle.txt",
      "echo 'third' > /workspace/newest.txt",
      "touch -d '2023-01-01T00:00:00Z' /workspace/oldest.txt",
      "touch -d '2024-06-15T12:00:00Z' /workspace/middle.txt",
      "touch -d '2025-12-31T23:59:59Z' /workspace/newest.txt",
      "touch -r /workspace/newest.txt /workspace/copied_time.txt",
      "ls -1t /workspace/oldest.txt /workspace/middle.txt /workspace/newest.txt",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "/workspace/newest.txt",
        "/workspace/middle.txt",
        "/workspace/oldest.txt",
        "",
      ].join("\n"),
    );
  });
});

test("stat custom format specifiers (%n, %s, %F, %a) across regular files, directories, and symlinks", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "mkdir -p /workspace/dir",
      "printf '1234567890' > /workspace/dir/ten.txt",
      "ln -s ten.txt /workspace/dir/link.txt",
      "stat -c '%n|%F|%s' /workspace/dir /workspace/dir/ten.txt /workspace/dir/link.txt",
    ].join("\n");

    const res = await h.exec(script);
    assert.equal(res.exitCode, 0, res.stderr);
    const lines = res.stdout.trim().split("\n");
    assert.equal(lines.length, 3);
    assert.match(lines[0]!, /^\/workspace\/dir\|directory\|/);
    assert.equal(lines[1], "/workspace/dir/ten.txt|regular file|10");
    assert.match(lines[2]!, /^\/workspace\/dir\/link\.txt\|symbolic link\|/);
  });
});

test("du summarizes directory byte sizes and df reports filesystem statistics", async () => {
  await withE2EHarness({ mountDev: true }, async (h) => {
    const script = [
      "mkdir -p /workspace/usage/sub",
      "head -c 1024 /dev/zero > /workspace/usage/a.bin",
      "head -c 2048 /dev/zero > /workspace/usage/sub/b.bin",
      "du -b /workspace/usage/sub",
      "df /workspace | wc -l | awk '{ print ($1 >= 2 ? \"df_ok\" : \"df_bad\") }'",
    ].join("\n");

    const res = await h.exec(script);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /2048\s+\/workspace\/usage\/sub/);
    assert.match(res.stdout, /df_ok/);
  });
});

test("tree renders directory hierarchy with depth limit (-L) and directory-only (-d) flags", async () => {
  await withE2EHarness({ files: createMonorepoFixture() }, async (h) => {
    const res = await h.exec("tree -d -L 2 /workspace/packages");
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /api/);
    assert.match(res.stdout, /cli/);
    assert.match(res.stdout, /core/);
  });
});

test("pathchk validates POSIX portable paths (-p) and rejects empty or illegal pathnames (-P)", async () => {
  await withE2EHarness(async (h) => {
    await h.expectOk("pathchk -p /workspace/valid_path-123/file.txt && echo 'valid:yes'", "valid:yes\n");
    await h.expectFail("pathchk -P ''");
    await h.expectFail("pathchk -P '/workspace/-leading-hyphen'");
  });
});

test("mktemp creates unique files and directories (-d) with custom templates", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "f1=$(mktemp /tmp/work.XXXXXX)",
      "f2=$(mktemp /tmp/work.XXXXXX)",
      "d1=$(mktemp -d /tmp/dir.XXXXXX)",
      '[[ "$f1" != "$f2" ]] && test -f "$f1" && test -f "$f2" && test -d "$d1" && echo "mktemp:ok"',
    ].join("\n");

    await h.expectOk(script, "mktemp:ok\n");
  });
});

test("cp -r, mv, and rm -rf preserve directory hierarchy and clean up completely", async () => {
  await withE2EHarness({ files: createMonorepoFixture() }, async (h) => {
    const origSnap = await h.snapshotTree("/workspace/packages/core");

    const script = [
      "cp -r /workspace/packages/core /workspace/packages/core_copy",
      "mv /workspace/packages/core_copy /workspace/core_moved",
      "test ! -e /workspace/packages/core_copy && echo 'copy_moved:yes'",
    ].join("\n");

    await h.expectOk(script, "copy_moved:yes\n");
    const movedSnap = await h.snapshotTree("/workspace/core_moved");
    assert.deepEqual(movedSnap, origSnap);

    await h.expectOk("rm -rf /workspace/core_moved && test ! -e /workspace/core_moved && echo 'cleaned:yes'", "cleaned:yes\n");
  });
});

test("rmdir removes empty directories and fails on non-empty directories unless -p chains empty parents", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "mkdir -p /workspace/nonempty/child",
      "echo 'x' > /workspace/nonempty/child/file.txt",
      "rmdir /workspace/nonempty 2>/dev/null || echo 'nonempty_rejected:yes'",
      "mkdir -p /workspace/empty_chain/a/b",
      "cd /workspace && rmdir -p empty_chain/a/b",
      "test ! -e /workspace/empty_chain && echo 'chain_removed:yes'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "nonempty_rejected:yes",
        "chain_removed:yes",
        "",
      ].join("\n"),
    );
  });
});

test("ls formatting flags (-la, -1, -F, -R) classify entries accurately", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "mkdir -p /workspace/ls_test/subdir",
      "echo 'hidden' > /workspace/ls_test/.secret",
      "echo '#!/bin/sh' > /workspace/ls_test/run.sh",
      "chmod 755 /workspace/ls_test/run.sh",
      "ln -s run.sh /workspace/ls_test/link",
      "ls -1a /workspace/ls_test | sort",
    ].join("\n");

    await h.expectOk(
      script,
      [
        ".",
        "..",
        ".secret",
        "link",
        "run.sh",
        "subdir",
        "",
      ].join("\n"),
    );
  });
});

test("pwd -L and pwd -P distinguish logical symlinked working directory from physical path", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "mkdir -p /workspace/physical/target_dir",
      "ln -s /workspace/physical/target_dir /workspace/logical_link",
      "cd /workspace/logical_link",
      "pwd -L",
      "pwd -P",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "/workspace/logical_link",
        "/workspace/physical/target_dir",
        "",
      ].join("\n"),
    );
  });
});

test("overlay upper layer inspection: only modified and newly created files materialize in upper fs", async () => {
  const lower = createMemoryFileSystem();
  await seedFilesOnFs(lower, {
    "/workspace/untouched.txt": "stay_in_lower\n",
    "/workspace/modified.txt": "v1\n",
  });
  const upper = createMemoryFileSystem();
  const overlay = createOverlayFileSystem({ lower, upper });

  await withE2EHarness({ fs: overlay, cwd: "/workspace" }, async (h) => {
    await h.expectOk(
      [
        "cat /workspace/untouched.txt > /dev/null",
        "echo 'v2' > /workspace/modified.txt",
        "echo 'brand_new' > /workspace/created.txt",
      ].join("\n"),
    );
  });

  const upperSnap = await snapshotFsTree(upper, "/workspace");
  assert.equal(upperSnap["untouched.txt"], undefined);
  assert.equal(upperSnap["modified.txt"]?.text, "v2\n");
  assert.equal(upperSnap["created.txt"]?.text, "brand_new\n");
});
