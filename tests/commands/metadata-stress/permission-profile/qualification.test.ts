import assert from "node:assert/strict";
import test from "node:test";
import * as host from "node:fs/promises";
import { join } from "node:path";
import { namespace, oracle } from "../helpers.js";
import { qualifyModeFixtures } from "./fixtures.js";

test("member-group fixture qualification precedes exact setid modes and permits genuine SGID success", async context => {
  assert.ok(process.getuid && process.getgid, "metadata permission prerequisite: POSIX caller identity unavailable");
  const root = await namespace(context);
  await host.mkdir(join(root, "directory"));
  await host.writeFile(join(root, "file"), Uint8Array.of(0, 255, 10));
  const fixtures = await qualifyModeFixtures(root, ["directory", "file"]);
  assert.equal(fixtures.uid, process.getuid());
  assert.equal(fixtures.gid, process.getgid());
  for (const name of ["directory", "file"]) {
    assert.equal((await host.stat(join(root, name))).gid, process.getgid());
    assert.equal(await fixtures.setMode(name, 0o6755), 0o6755);
    const unchanged = oracle("chmod", ["--", "+2000", name], root);
    assert.equal(unchanged.exitCode, 0, unchanged.stderr);
    assert.equal((await host.stat(join(root, name))).mode & 0o7777, 0o6755);
    await fixtures.setMode(name, 0o755);
    const added = oracle("chmod", ["--", "ug+s", name], root);
    assert.equal(added.exitCode, 0, added.stderr);
    assert.equal((await host.stat(join(root, name))).mode & 0o7777, 0o6755);
  }
  assert.deepEqual(await host.readFile(join(root, "file")), Buffer.from([0, 255, 10]));
  context.diagnostic(`qualified caller uid=${fixtures.uid} primary gid=${fixtures.gid}; setid modes verified after chown`);
});

test("qualification rejects unsafe names, roots and symlinks before changing fixture metadata", async context => {
  const root = await namespace(context);
  const file = join(root, "file");
  await host.writeFile(file, Uint8Array.of(0, 255, 10), { mode: 0o640 });
  await host.symlink("file", join(root, "link"));
  const before = await host.stat(file, { bigint: true });
  for (const names of [["file", "link"], ["../file"], ["file", "file"], []]) {
    await assert.rejects(qualifyModeFixtures(root, names), /metadata permission prerequisite/u);
  }
  await host.mkdir(join(root, "nested"));
  await assert.rejects(qualifyModeFixtures(join(root, "nested"), ["file"]), /metadata permission prerequisite/u);
  const after = await host.stat(file, { bigint: true });
  assert.equal(after.uid, before.uid);
  assert.equal(after.gid, before.gid);
  assert.equal(after.mode, before.mode);
  assert.equal(after.ctimeNs, before.ctimeNs);
  assert.deepEqual(await host.readFile(file), Buffer.from([0, 255, 10]));
});

test("qualified initial-mode setup rejects invalid modes, unqualified names and replacement entries", async context => {
  const root = await namespace(context);
  await host.writeFile(join(root, "file"), Uint8Array.of(0, 255, 10));
  const fixtures = await qualifyModeFixtures(root, ["file"]);
  await assert.rejects(fixtures.setMode("file", 0o10000), /metadata permission prerequisite/u);
  await assert.rejects(fixtures.setMode("missing", 0o600), /metadata permission prerequisite/u);
  await host.rename(join(root, "file"), join(root, "original"));
  await host.writeFile(join(root, "file"), Uint8Array.of(7), { mode: 0o600 });
  const before = await host.stat(join(root, "file"), { bigint: true });
  await assert.rejects(fixtures.setMode("file", 0o777), /metadata permission prerequisite/u);
  const after = await host.stat(join(root, "file"), { bigint: true });
  assert.equal(after.mode, before.mode);
  assert.equal(after.ctimeNs, before.ctimeNs);
  assert.deepEqual(await host.readFile(join(root, "original")), Buffer.from([0, 255, 10]));
  assert.deepEqual(await host.readFile(join(root, "file")), Buffer.from([7]));
});

test("unavailable native search permission fails fixture prerequisites without changing the target", async context => {
  assert.ok(process.getuid, "metadata permission prerequisite: POSIX caller identity unavailable");
  assert.notEqual(process.getuid(), 0, "metadata permission prerequisite: denial control requires a nonprivileged caller");
  const root = await namespace(context);
  const file = join(root, "file");
  await host.writeFile(file, Uint8Array.of(0, 255, 10), { mode: 0o600 });
  const fixtures = await qualifyModeFixtures(root, ["file"]);
  const before = await host.stat(file, { bigint: true });
  try {
    await host.chmod(root, 0);
    await assert.rejects(qualifyModeFixtures(root, ["file"]), /metadata permission prerequisite/u);
    await assert.rejects(fixtures.setMode("file", 0o6755), /metadata permission prerequisite/u);
  } finally {
    await host.chmod(root, 0o700);
  }
  const after = await host.stat(file, { bigint: true });
  assert.equal(after.uid, before.uid);
  assert.equal(after.gid, before.gid);
  assert.equal(after.mode, before.mode);
  assert.equal(after.ctimeNs, before.ctimeNs);
  assert.deepEqual(await host.readFile(file), Buffer.from([0, 255, 10]));
});
