import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { environment, finish as finishOriginal, json, manifest, requireSuccess, run, selectedPaths } from "../stream-five-public/harness.mjs";
import { sha256 } from "../stream-five-public/current-profile.mjs";
import { archiveInputs, currentConsumerPaths, negativeGroups, ownerPath } from "./consumers.mjs";
import { verifyInventory } from "./inventory-check.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
export function snapshot(sourceRef = "HEAD") {
  const sourceCommit = requireSuccess(run("git", ["--no-replace-objects", "rev-parse", "--verify", `${sourceRef}^{commit}`], repository)).stdout.trim();
  const tracked = requireSuccess(run("git", ["--no-replace-objects", "ls-tree", "-r", "--name-only", sourceCommit], repository)).stdout.trim().split("\n");
  const inventory = JSON.parse(readFileSync(join(repository, ownerPath, "inventory.json")));
  const currentPaths = currentConsumerPaths();
  verifyInventory(inventory, tracked, currentPaths, negativeGroups.map(group => group.path), path => requireSuccess(run("git", ["--no-replace-objects", "show", `${sourceCommit}:${path}`], repository, { encoding: "buffer" })).stdout);
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "qualified-current-consumers-")));
  const root = join(directory, "snapshot");
  mkdirSync(root);
  const harness = [...tracked.filter(path => path.startsWith(`${ownerPath}/`) && !path.includes("/evidence/")), "scripts/verify-qualified-release.mjs", "scripts/verify-current-consumers.mjs", ...tracked.filter(path => path.startsWith("tests/plugins/stream-five-public/") && !path.includes("/evidence/") && /\.(?:mjs|fixture)$/u.test(path))];
  const paths = [...new Set([...selectedPaths, "README.md", ownerPath, "scripts/verify-current-consumers.mjs", ...archiveInputs, ...currentPaths, ...negativeGroups.flatMap(group => [group.path, group.expected])])];
  requireSuccess(run("git", ["--no-replace-objects", "archive", "--format=tar", `--output=${join(directory, "source.tar")}`, sourceCommit, ...paths], repository));
  requireSuccess(run("/usr/bin/tar", ["-xf", join(directory, "source.tar"), "-C", root], repository));
  for (const path of harness) assert.equal(sha256(readFileSync(join(root, path))), sha256(readFileSync(join(repository, path))), `runner differs from committed candidate: ${path}`);
  cpSync(join(repository, "node_modules"), join(root, "node_modules"), { recursive: true, dereference: true });
  const sources = [...manifest(root), ...["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"].map(path => ({ path, sha256: sha256(readFileSync(join(root, path))) }))];
  const tests = manifest(root, "tests").filter(entry => !entry.path.startsWith(`${ownerPath}/evidence/`));
  const report = { sourceCommit, directory, root, startedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch, environment, sources, tests, sourceTreeSha256: sha256(JSON.stringify(sources)), testTreeSha256: sha256(JSON.stringify(tests)), archiveSha256: sha256(readFileSync(join(directory, "source.tar"))), harness: harness.map(path => ({ path, sha256: sha256(readFileSync(join(root, path))) })), tooling: [process.execPath, "node_modules/typescript/lib/_tsc.js", "node_modules/typescript/package.json", "node_modules/tsx/package.json", "node_modules/@types/node/package.json"].map(path => ({ path, sha256: sha256(readFileSync(resolve(repository, path))) })), indexBefore: requireSuccess(run("git", ["diff", "--cached", "--name-only"], repository)).stdout, steps: [], inventory };
  report.harnessSha256 = sha256(JSON.stringify(report.harness));
  report.rootDistBefore = existsSync(join(repository, "dist")) ? manifest(repository, "dist") : null;
  json(join(directory, "snapshot.json"), report);
  console.log(JSON.stringify({ directory, sourceCommit, sourceTreeSha256: report.sourceTreeSha256, testTreeSha256: report.testTreeSha256, harnessSha256: report.harnessSha256 }));
  return report;
}

export function unchangedTests(report) {
  return report.tests.every(entry => sha256(readFileSync(join(report.root, entry.path))) === entry.sha256);
}

export function finish(report, exitCode, error) {
  report.testsUnchanged = unchangedTests(report);
  report.rootDistAfter = existsSync(join(repository, "dist")) ? manifest(repository, "dist") : null;
  report.rootDistUnchanged = JSON.stringify(report.rootDistBefore) === JSON.stringify(report.rootDistAfter);
  finishOriginal(report, report.testsUnchanged && report.rootDistUnchanged ? exitCode : 1, error);
}
