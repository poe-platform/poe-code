import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { assets, oracleDirectory } from "../../commands/metadata-stress/canonical-env/runner.mjs";
import { json, owned, repository, requireSuccess, run } from "./harness.mjs";

const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--source-commit");
const sourceCommit = requireSuccess(run("git", ["--no-replace-objects", "rev-parse", "--verify", `${args[1] ?? "HEAD"}^{commit}`], repository)).stdout.trim();
mkdirSync(join(owned, ".runs"), { recursive: true });
const directory = mkdtempSync(join(owned, ".runs/prerequisite-controls-"));
const observations = [];
for (const kind of ["missing", "wrong-hash"]) {
  const primary = join(directory, kind, "coreutils-9.7");
  for (const asset of assets().filter(entry => entry.path.startsWith(oracleDirectory))) {
    const suffix = relative(dirname(oracleDirectory), asset.path);
    const destination = join(dirname(primary), suffix);
    if (kind === "missing" && destination === join(primary, "src/chmod")) continue;
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(asset.path, destination);
  }
  if (kind === "wrong-hash") writeFileSync(join(primary, "src/chmod"), "not the pinned executable\n");
  const result = run(process.execPath, ["scripts/verify-qualified-release.mjs", "--source-commit", sourceCommit, "--native-assets-from", primary], repository);
  assert.equal(result.status, 78, JSON.stringify(result));
  assert.equal(result.signal, null);
  assert.equal(result.error, undefined);
  const header = JSON.parse(result.stdout.split("\n")[0]);
  const report = JSON.parse(readFileSync(join(header.directory, "result.json")));
  assert.equal(report.setup.status, "setup-unavailable");
  assert.equal(report.setup.executedTests, 0);
  assert.deepEqual(report.steps, []);
  assert.equal(existsSync(join(header.directory, "mandatory-metadata.json")), false);
  assert.equal(existsSync(join(report.root, "dist")), false);
  observations.push({ kind, result, report });
}
json(join(directory, "controls.json"), { sourceCommit, directory, observations });
console.log(JSON.stringify({ directory, sourceCommit, passed: observations.length, controls: observations.map(row => ({ kind: row.kind, status: row.result.status, executedTests: row.report.setup.executedTests })) }));
