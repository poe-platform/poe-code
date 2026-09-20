import assert from "node:assert/strict";
import { lstat, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@poe-platform/safe-bash";
import { createMemoryFileSystem, FsError } from "@poe-platform/safe-fs";
import * as optional from "./safe-packages-opt-in.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
assert.equal(await realpath(root), root);
const entry = fileURLToPath(import.meta.resolve("@poe-platform/safe-bash/yes"));
assert.ok(entry.startsWith(join(root, "node_modules", "@poe-platform/safe-bash") + sep));
const optionalRequire = createRequire(entry);
for (const name of ["@poe-platform/safe-bash", "@poe-platform/safe-fs"]) {
  const resolved = fileURLToPath(import.meta.resolve(name));
  assert.ok(resolved.startsWith(join(root, "node_modules", name) + sep));
  let current = root;
  for (const component of relative(root, resolved).split(sep)) {
    current = join(current, component);
    const stat = await lstat(current);
    assert.equal(stat.isSymbolicLink(), false, current);
    assert.equal(current === resolved ? stat.isFile() : stat.isDirectory(), true, current);
  }
}
assert.throws(() => optionalRequire.resolve("yaml"), { code: "MODULE_NOT_FOUND" });
assert.throws(() => require.resolve("yaml"), { code: "MODULE_NOT_FOUND" });
const manifestPath = join(root, "node_modules/@poe-platform/safe-bash/package.json");
const manifestStat = await lstat(manifestPath);
assert.equal(manifestStat.isSymbolicLink(), false);
assert.equal(manifestStat.isFile(), true);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
for (const name of Object.keys(manifest.peerDependencies)) {
  assert.equal(manifest.peerDependenciesMeta[name]?.optional, true, name);
  assert.throws(() => optionalRequire.resolve(name), { code: "MODULE_NOT_FOUND" });
  assert.throws(() => require.resolve(name), { code: "MODULE_NOT_FOUND" });
}
assert.equal(manifest.peerDependencies["@poe-platform/safe-bash"], undefined);
assert.equal(manifest.peerDependencies.yaml, "2.9.0");
assert.equal(manifest.peerDependenciesMeta.yaml.optional, true);
assert.equal(optional.Shell, core.Shell);
assert.equal(core.FsError, FsError);
for (const name of ["createYesCommand", "createCmpCommand", "createDdCommand", "createShufCommand", "createTruncateCommand", "createInstallCommand", "createYqCommand"]) {
  const definition = optional[name]();
  assert.equal(definition.runtimeIdentity, core.commandRuntimeIdentity);
  assert.equal(new core.CommandRegistry([definition]).has(definition.name), true);
}
for (const name of ["arraysExtension", "jobsExtension", "mapfileExtension", "readExtension", "trapExtension"]) {
  assert.equal(optional[name]().runtimeIdentity, core.commandRuntimeIdentity);
}
const owner = {};
try {
  const fs = createMemoryFileSystem();
  const original = Buffer.from("a: 1\n");
  await fs.writeFile("/settings.yaml", original);
  owner.shell = new core.Shell({ fs, limits: { maxWallClockMs: 2000 } }).use(core.agentCommands()).use(optional.yesCommands()).use(optional.yqCommands());
  const unrelated = await owner.shell.exec(String.raw`yes $'\377' | head -c 3`);
  assert.equal(unrelated.exitCode, 0, unrelated.stderr);
  assert.equal(unrelated.stderr, "");
  assert.deepEqual(unrelated.stdoutBytes, Uint8Array.of(255, 10, 255));
  for (const [source, stdin] of [["yq '.a'", "a: 1\n"], ["yq -i '.a = 2' /settings.yaml", ""]]) {
    const result = await owner.shell.exec(source, { stdin });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "Error: the optional yaml@2.9.0 peer is required for this yq profile\n");
    assert.deepEqual(await fs.readFile("/settings.yaml"), new Uint8Array(original));
    assert.deepEqual(await fs.readdir("/"), [{ name: "settings.yaml", type: "file" }]);
  }
  assert.throws(() => optionalRequire.resolve("yaml"), { code: "MODULE_NOT_FOUND" });
} finally { await owner.shell?.dispose(); }
console.log("Installed optional without YAML: lazy import, canonical peers, unrelated tools and exact missing-peer refusal passed");
