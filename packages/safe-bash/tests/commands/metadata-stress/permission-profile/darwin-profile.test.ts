import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import * as host from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { createRealFileSystem } from "../../../../src/fs/real/index.js";
import { FsError } from "../../../../src/contracts/index.js";
import { namespace, oracle, oracleIdentity, run, sha256 } from "../helpers.js";

const sentinel = Uint8Array.of(0, 255, 10);

async function requireDarwinProfile() {
  assert.equal(process.platform, "darwin", "Darwin9.7/Node22 profile prerequisite: Darwin required; not a portable-profile pass");
  assert.equal(process.arch, "arm64", "Darwin9.7/Node22 profile prerequisite: arm64 required");
  assert.equal(process.version, "v22.22.2", "Darwin9.7/Node22 profile prerequisite: exact Node version required");
  assert.equal(process.versions.uv, "1.51.0", "Darwin9.7/Node22 profile prerequisite: exact libuv version required");
  assert.ok(process.getuid && process.getgid && process.geteuid && process.getegid && process.getgroups,
    "Darwin9.7/Node22 profile prerequisite: POSIX caller identity unavailable");
  assert.notEqual(process.getuid(), 0, "Darwin9.7/Node22 profile prerequisite: nonprivileged caller required");
  assert.equal(process.getuid(), process.geteuid(), "Darwin9.7/Node22 profile prerequisite: real/effective uid mismatch");
  assert.equal(process.getgid(), process.getegid(), "Darwin9.7/Node22 profile prerequisite: real/effective gid mismatch");
  assert.notEqual(process.getgid(), 0, "Darwin9.7/Node22 profile prerequisite: caller must not belong to group0");
  assert.equal(process.getgroups().includes(0), false, "Darwin9.7/Node22 profile prerequisite: caller must not belong to group0");
  const identity = oracleIdentity("chmod");
  assert.equal(await sha256(identity.path), identity.sha256,
    "Darwin9.7/Node22 profile prerequisite: selected authenticated GNU9.7 binary required");
  return { uid: process.getuid(), groups: process.getgroups() };
}

async function nativeProfile(context: TestContext): Promise<string> {
  const caller = await requireDarwinProfile();
  const root = await host.mkdtemp(join(await host.realpath("/tmp"), "virtual-bash-permission-profile-"));
  context.after(async () => {
    try {
      await host.chmod(join(root, "work/directory"), 0o700);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    } finally {
      await host.rm(root, { recursive: true, force: true });
    }
    await assert.rejects(host.stat(root), { code: "ENOENT" });
    context.diagnostic(`removed owned Darwin profile root ${root}`);
  });
  await host.mkdir(join(root, "work"));
  await host.mkdir(join(root, "work/directory"));
  await host.writeFile(join(root, "work/sentinel"), sentinel);
  const entry = await host.stat(join(root, "work/directory"));
  assert.equal(entry.uid, caller.uid, "Darwin9.7/Node22 profile prerequisite: target must be caller-owned");
  assert.equal(entry.gid, 0, "Darwin9.7/Node22 profile prerequisite: inherited nonmember group0 required; never manufacture it");
  context.diagnostic(`Darwin9.7/Node22 strict GNU gap remains; uid=${entry.uid} gid=${entry.gid}; caller groups=${caller.groups.join(",")}`);
  return root;
}

function profileOracle(args: readonly string[], cwd: string, umask: number) {
  const identity = oracleIdentity("chmod");
  const result = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", 'umask "$1"; shift; exec "$@"', "metadata-oracle", umask.toString(8), identity.path, ...args], {
    cwd, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC", TMPDIR: cwd }, timeout: 3000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}

async function metadata(path: string) {
  const entry = await host.stat(path, { bigint: true });
  return { mode: entry.mode & 0o7777n, uid: entry.uid, gid: entry.gid, ino: entry.ino,
    dev: entry.dev, ctimeNs: entry.ctimeNs, mtimeNs: entry.mtimeNs, size: entry.size };
}

for (const input of [
  { name: "requested06755 actual04755 +2000", initial: 0o6755, measured: 0o4755, mode: "+2000", requested: 0o6755, umask: 0o022 },
  { name: "directory0051 ug+s", initial: 0o051, measured: 0o051, mode: "ug+s", requested: 0o6051, umask: 0 },
]) test(`Darwin9.7/Node22 divergence characterization, strict GNU gap remains: ${input.name}`, async context => {
  const root = await nativeProfile(context);
  const directory = join(root, "work/directory");
  await host.chmod(directory, input.initial);
  const established = await metadata(directory);
  assert.equal(established.mode, BigInt(input.measured));
  const args = ["--", input.mode, "directory"];
  const native = profileOracle(args, join(root, "work"), input.umask);
  assert.equal(native.status, 1);
  assert.deepEqual(native.stdout, Buffer.alloc(0));
  assert.equal(native.stderr.toString(), "chmod: changing permissions of 'directory': Operation not permitted\n");
  assert.deepEqual(await metadata(directory), established);
  const real = await createRealFileSystem({ root });
  for (const layer of ["node", "realfs", "command-realfs"]) {
    await host.chmod(directory, input.measured);
    const before = await metadata(directory);
    await setTimeout(4);
    if (layer === "node") await host.chmod(directory, input.requested);
    else if (layer === "realfs") await real.chmod("/work/directory", input.requested, { signal: new AbortController().signal });
    else {
      const result = await run("chmod", args, real, { umask: input.umask });
      assert.equal(result.exitCode, 0);
      assert.deepEqual(result.stdout, Buffer.alloc(0));
      assert.equal(result.stderr, "");
    }
    const after = await metadata(directory);
    assert.equal(after.mode, BigInt(input.requested & ~0o2000), layer);
    assert.equal(after.uid, before.uid);
    assert.equal(after.gid, before.gid);
    assert.equal(after.ino, before.ino);
    assert.notEqual(after.ctimeNs, before.ctimeNs, layer);
  }
  const memory = new MemoryFileSystem();
  await memory.mkdir("/work/directory", { recursive: true });
  await memory.chmod("/work/directory", input.measured);
  const result = await run("chmod", args, memory, { umask: input.umask });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stdout, Buffer.alloc(0));
  assert.equal(result.stderr, "");
  assert.equal((await memory.stat("/work/directory")).mode & 0o7777, input.requested);
  assert.deepEqual(await host.readFile(join(root, "work/sentinel")), Buffer.from(sentinel));
  assert.deepEqual((await host.readdir(join(root, "work"))).sort(), ["directory", "sentinel"]);
});

test("real search-permission denial preserves typed EACCES, diagnostics and child metadata/bytes", async context => {
  assert.ok(process.getuid, "metadata permission prerequisite: POSIX caller identity unavailable");
  assert.notEqual(process.getuid(), 0, "metadata permission prerequisite: normal denial requires a nonprivileged caller");
  const root = await namespace(context);
  const blocked = join(root, "work/blocked");
  await host.mkdir(blocked, { recursive: true });
  const file = join(blocked, "file");
  await host.writeFile(file, sentinel, { mode: 0o600 });
  const before = await metadata(file);
  const real = await createRealFileSystem({ root });
  try {
    await host.chmod(blocked, 0);
    const native = oracle("chmod", ["--", "644", "blocked/file"], join(root, "work"));
    assert.equal(native.exitCode, 1);
    assert.deepEqual(native.stdout, Buffer.alloc(0));
    assert.equal(native.stderr, "chmod: cannot access 'blocked/file': Permission denied\n");
    await assert.rejects(host.chmod(file, 0o644), { code: "EACCES" });
    await assert.rejects(real.chmod("/work/blocked/file", 0o644, { signal: new AbortController().signal }), error => {
      assert.ok(error instanceof FsError);
      assert.equal(error.code, "EACCES");
      assert.equal(error.path, "/work/blocked/file");
      return true;
    });
    const actual = await run("chmod", ["--", "644", "blocked/file"], real);
    assert.equal(actual.exitCode, 1);
    assert.deepEqual(actual.stdout, Buffer.alloc(0));
    assert.equal(actual.stderr, "chmod: EACCES: permission denied, lstat '/work/blocked/file'\n");
  } finally {
    await host.chmod(blocked, 0o700);
  }
  assert.deepEqual(await metadata(file), before);
  assert.deepEqual(await host.readFile(file), Buffer.from(sentinel));
});
