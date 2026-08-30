import assert from "node:assert/strict";
import * as host from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout } from "node:timers/promises";

const frozen = process.argv[2];
assert.ok(frozen, "independent native profile prerequisite: frozen copy required");
assert.equal(process.platform, "darwin", "independent native profile prerequisite: Darwin, not portable equality");
assert.equal(process.arch, "arm64");
assert.equal(process.version, "v22.22.2");
assert.equal(process.versions.uv, "1.51.0");
assert.notEqual(process.getuid(), 0);
assert.equal(process.getuid(), process.geteuid());
assert.equal(process.getgid(), process.getegid());
assert.notEqual(process.getgid(), 0);
assert.equal(process.getgroups().includes(0), false);
const load = name => import(pathToFileURL(join(frozen, name)).href);
const { createRealFileSystem } = await load("src/fs/real/index.ts");
const { MemoryFileSystem } = await load("src/fs/memory/index.ts");
const { FsError } = await load("src/contracts/index.ts");
const { run } = await load("tests/commands/metadata-stress/helpers.ts");
const { qualifyModeFixtures } = await load("tests/commands/metadata-stress/permission-profile/fixtures.ts");
const suite = join(frozen, "tests/commands/metadata-stress");
const oracle = join(suite, ".oracle/coreutils-9.7/src/chmod");
assert.equal(createHash("sha256").update(await host.readFile(oracle)).digest("hex"), "3b7a9b5819dd93eff18b25dfbbac1c1d17e2ccd419368da90b366653b1b1cbd2");
const sentinel = Buffer.from([0, 255, 10, 13, 128]);
const observations = [];
async function metadata(target) {
  const stat = await host.lstat(target, { bigint: true });
  return { uid: String(stat.uid), gid: String(stat.gid), mode: Number(stat.mode & 0o7777n).toString(8), ino: String(stat.ino), dev: String(stat.dev),
    ctimeNs: String(stat.ctimeNs), mtimeNs: String(stat.mtimeNs), size: String(stat.size), nlink: String(stat.nlink) };
}
function native(args, cwd, umask = 0o022) {
  const result = spawnSync("/bin/bash", ["-c", 'umask "$1"; shift; exec "$@"', "independent-metadata", umask.toString(8), oracle, ...args], {
    cwd, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC", TMPDIR: cwd }, timeout: 3000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return { status: result.status, stdoutHex: result.stdout.toString("hex"), stderr: result.stderr.toString() };
}
const memberRoot = await host.mkdtemp(join(suite, ".native-independent-member-"));
try {
  const inherited = await host.mkdtemp(join(await host.realpath("/tmp"), "virtual-bash-independent-member-seed-"));
  try {
    assert.equal((await host.lstat(inherited)).gid, 0, "member-qualification stress prerequisite: inherited group0 seed");
    await host.mkdir(join(inherited, "directory"));
    await host.writeFile(join(inherited, "file"), sentinel);
    for (const name of ["directory", "file"]) {
      await host.rename(join(inherited, name), join(memberRoot, name));
      const before = await metadata(join(memberRoot, name));
      assert.equal(before.gid, "0");
      assert.equal(before.uid, String(process.getuid()));
      observations.push({ profile: "inherited nonmember fixture before authorized qualification", name, before });
    }
  } finally {
    await host.rm(inherited, { recursive: true, force: true });
  }
  const fixtures = await qualifyModeFixtures(memberRoot, ["directory", "file"]);
  for (const name of ["directory", "file"]) for (const operation of ["creation", "preservation"]) {
    const initial = operation === "creation" ? 0o755 : 0o6755;
    assert.equal(await fixtures.setMode(name, initial), initial);
    const before = await metadata(join(memberRoot, name));
    const result = native(["--", operation === "creation" ? "ug+s" : "+2000", name], memberRoot);
    assert.equal(result.status, 0);
    assert.equal(result.stdoutHex, "");
    assert.equal(result.stderr, "");
    const after = await metadata(join(memberRoot, name));
    assert.equal(after.mode, "6755");
    assert.equal(after.gid, String(process.getgid()));
    observations.push({ profile: "member-group", name, operation, before, result, after });
  }
  await host.chmod(join(memberRoot, "file"), 0o600);
  assert.deepEqual(await host.readFile(join(memberRoot, "file")), sentinel);
} finally {
  await host.rm(memberRoot, { recursive: true, force: true });
}
const history = JSON.parse(await host.readFile(join(suite, "permission-profile/classification-seal/results.json.data"), "utf8"));
const inputs = history.observations.filter(row => row.candidate === "frozen" && row.input && !row.input.id.startsWith("success"));
assert.equal(inputs.length, 17);
const root = await host.mkdtemp(join(await host.realpath("/tmp"), "virtual-bash-independent-permission-"));
try {
  const rootStat = await host.lstat(root);
  assert.equal(rootStat.uid, process.getuid(), "independent native profile prerequisite: owned native root");
  assert.equal(rootStat.gid, 0, "independent native profile prerequisite: naturally inherited nonmember group0, never chgrp0");
  await host.mkdir(join(root, "work"));
  const directory = join(root, "work/directory");
  await host.mkdir(directory);
  await host.writeFile(join(root, "work/sentinel"), sentinel);
  const real = await createRealFileSystem({ root });
  for (const historical of inputs) {
    const input = historical.input;
    const initial = Number.parseInt(input.initial, 8);
    const umask = Number.parseInt(input.umask, 8);
    const requested = Number.parseInt(historical.requestedMode, 8);
    const args = ["--", input.mode, "directory"];
    await host.chmod(directory, initial);
    const established = await metadata(directory);
    assert.equal(Number.parseInt(established.mode, 8), Number.parseInt(historical.initialMeasured.mode, 8));
    assert.equal(established.gid, "0");
    const gnu = native(args, join(root, "work"), umask);
    assert.equal(gnu.status, 1);
    assert.equal(gnu.stdoutHex, "");
    assert.equal(gnu.stderr, "chmod: changing permissions of 'directory': Operation not permitted\n");
    assert.deepEqual(await metadata(directory), established);
    const layers = {};
    for (const layer of ["node", "realfs", "command-realfs"]) {
      await host.chmod(directory, Number.parseInt(established.mode, 8));
      const before = await metadata(directory);
      await setTimeout(4);
      let result = { exitCode: 0 };
      if (layer === "node") await host.chmod(directory, requested);
      if (layer === "realfs") await real.chmod("/work/directory", requested, { signal: new AbortController().signal });
      if (layer === "command-realfs") {
        result = await run("chmod", args, real, { umask });
        assert.equal(result.exitCode, 0);
        assert.equal(result.stdout.length, 0);
        assert.equal(result.stderr, "");
      }
      const after = await metadata(directory);
      assert.equal(Number.parseInt(after.mode, 8), requested & ~0o2000);
      for (const field of ["uid", "gid", "ino", "dev", "mtimeNs", "nlink", "size"]) assert.equal(after[field], before[field]);
      assert.notEqual(after.ctimeNs, before.ctimeNs);
      layers[layer] = { status: result.exitCode, before, after };
    }
    const memory = new MemoryFileSystem();
    await memory.mkdir("/work/directory", { recursive: true });
    await memory.chmod("/work/directory", Number.parseInt(established.mode, 8));
    const result = await run("chmod", args, memory, { umask });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.length, 0);
    assert.equal(result.stderr, "");
    const memoryMode = (await memory.stat("/work/directory")).mode & 0o7777;
    assert.equal(memoryMode, requested);
    assert.deepEqual(await host.readFile(join(root, "work/sentinel")), sentinel);
    assert.deepEqual((await host.readdir(join(root, "work"))).sort(), ["directory", "sentinel"]);
    observations.push({ profile: "Darwin strict mismatch, NOT equality", input, established, gnu, layers, memory: { status: result.exitCode, mode: memoryMode.toString(8) } });
  }
  const blocked = join(root, "work/blocked");
  await host.mkdir(blocked);
  const file = join(blocked, "file");
  await host.writeFile(file, sentinel, { mode: 0o600 });
  const before = await metadata(file);
  let denial;
  try {
    await host.chmod(blocked, 0);
    const gnu = native(["--", "644", "blocked/file"], join(root, "work"));
    assert.deepEqual(gnu, { status: 1, stdoutHex: "", stderr: "chmod: cannot access 'blocked/file': Permission denied\n" });
    await assert.rejects(host.chmod(file, 0o644), { code: "EACCES" });
    await assert.rejects(real.chmod("/work/blocked/file", 0o644), error => {
      assert.ok(error instanceof FsError);
      assert.equal(error.code, "EACCES");
      assert.equal(error.path, "/work/blocked/file");
      return true;
    });
    const result = await run("chmod", ["--", "644", "blocked/file"], real);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.equal(result.stderr, "chmod: EACCES: permission denied, lstat '/work/blocked/file'\n");
    denial = { gnu, virtualExit: result.exitCode, virtualDiagnostic: result.stderr, typedCode: "EACCES", typedPath: "/work/blocked/file" };
  } finally {
    await host.chmod(blocked, 0o700);
  }
  assert.deepEqual(await metadata(file), before);
  assert.deepEqual(await host.readFile(file), sentinel);
  observations.push({ profile: "actual search denial, diagnostics NOT equality", before, after: await metadata(file), bytesHex: sentinel.toString("hex"), denial });
} finally {
  await host.rm(root, { recursive: true, force: true });
}
console.log(JSON.stringify({ memberTransitions: 4, historicalNonmemberCharacterizations: 17, denialControls: 1, observations, rootsRemoved: [memberRoot, root] }, null, 2));
