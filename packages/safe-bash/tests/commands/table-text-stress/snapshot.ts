import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { resolve } from "node:path";
import { directory, hash, hashes, oracle, save } from "./support.js";

const before = await hashes();
const snapshot = await mkdtemp(`${directory}/.snapshot-acceptance-`);
for (const [path, expected] of Object.entries(before.files)) {
  if (path.startsWith("node_modules/")) continue;
  const content = await readFile(path, "utf8");
  assert.equal(hash(content), expected, `snapshot input drift: ${path}`);
  const patch = `*** Begin Patch\n*** Add File: ${snapshot}/${path}\n${content.replace(/\n$/u, "").split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`;
  const result = spawnSync("apply_patch", [], { input: patch, encoding: "utf8", maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(hash(await readFile(`${snapshot}/${path}`)), expected, `copy bytes differ: ${path}`);
}
await symlink(resolve("node_modules"), `${snapshot}/node_modules`);
await mkdir(`${snapshot}/tests/commands/metadata-stress`, { recursive: true });
await symlink(resolve(oracle, ".."), `${snapshot}/tests/commands/metadata-stress/.oracle`);
const afterCopy = await hashes();
assert.deepEqual(afterCopy.files, before.files, "source changed while copying; reject incoherent snapshot");
const result = spawnSync(process.execPath, ["--import", "tsx", "tests/commands/table-text-stress/acceptance.ts", "acceptance-isolated.json"], { cwd: snapshot, encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
const report = JSON.parse(await readFile(`${snapshot}/tests/commands/table-text-stress/acceptance-isolated.json`, "utf8"));
save("isolated-acceptance.json", { before, afterCopy, snapshot, exitCode: result.status, stdout: result.stdout, stderr: result.stderr, report });
assert.equal(result.status, 0, result.stdout + result.stderr);
const fixtureDirectory = `${snapshot}/tests/commands/table-text-stress`;
let cleaned = 0;
for (const entry of await readdir(fixtureDirectory, { withFileTypes: true })) if (entry.isDirectory() && entry.name.startsWith(".native-")) {
  const path = `${fixtureDirectory}/${entry.name}`;
  assert.equal(await readFile(`${path}/sentinel`, "utf8"), "independent-table-text-owned");
  assert.ok((await readdir(path)).every(name => ["sentinel", "left", "right"].includes(name)));
  await rm(path, { recursive: true }); cleaned++;
}
console.log({ snapshot, cleaned, summary: result.stdout });
