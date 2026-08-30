import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { census, sha256, unpack } from "./evidence-data-v1.mjs";
const root = dirname(fileURLToPath(import.meta.url)), repository = resolve(root, "../../../.."), prefix = root.slice(repository.length + 1) + "/";
const commit = process.argv[2]; assert.match(commit ?? "", /^[a-f0-9]{40}$/);
const git = args => execFileSync("git", args, { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
for (const name of ["EVIDENCE-MANIFEST-v1.json", "EVIDENCE-MANIFEST-v2.json", "SCRATCH-CENSUS-v1.json.gz.base64"]) assert.deepEqual(readFileSync(resolve(root, name)), git(["show", commit + ":" + prefix + name]));
assert(!existsSync(resolve(root, "PRECLEAN-STATIC-v1.json")) && !existsSync(resolve(root, "CLEANUP-v1.json")));
const stdout = execFileSync(process.execPath, [resolve(root, "verify-final-v1.mjs"), "--preclean", commit], { cwd: repository, maxBuffer: 4 * 1024 * 1024, timeout: 180000 }).toString();
const verification = JSON.parse(stdout); assert.equal(verification.status, "static-only-pass");
const snapshot = unpack(resolve(root, "SCRATCH-CENSUS-v1.json.gz.base64"));
const manifest = JSON.parse(readFileSync(resolve(root, "EVIDENCE-MANIFEST-v1.json")));
assert.deepEqual(Object.keys(snapshot.inventories), manifest.scratchNames);
const removed = [];
for (const name of manifest.scratchNames) {
  assert(/^(raw-v[12]|work-v[12]|type-results-v2|mechanism-(results|work)-v1|import-(results|work)-v[12]|regression-(results|work)-v[1234])$/.test(name));
  const target = resolve(root, name); assert.equal(dirname(target), root); assert(lstatSync(target).isDirectory() && !lstatSync(target).isSymbolicLink());
  assert.deepEqual(census(target), snapshot.inventories[name]); rmSync(target, { recursive: true }); assert(!existsSync(target)); removed.push(name);
}
const receipt = { version: 1, at: new Date().toISOString(), archiveCommit: commit, censusSha256: sha256(readFileSync(resolve(root, "SCRATCH-CENSUS-v1.json.gz.base64"))), removed, archivedOriginalRawFiles: 1247, archivedNewRawAndConfigs: 1124, method: "Each explicit owned directory full files/bytes/modes/links/directory-modes/membership census matched immediately before recursive removal; symlink targets not followed", precleanGroups: { reported: 18, substantive: 17, deferred: "V18 final append-aware seal evaluated only in final mode" }, noProductExecution: true };
execFileSync("apply_patch", [], { cwd: repository, input: "*** Begin Patch\n*** Add File: " + resolve(root, "PRECLEAN-STATIC-v1.json") + "\n" + stdout.trimEnd().split("\n").map(line => "+" + line).join("\n") + "\n*** Add File: " + resolve(root, "CLEANUP-v1.json") + "\n" + JSON.stringify(receipt, null, 2).split("\n").map(line => "+" + line).join("\n") + "\n*** End Patch\n" });
process.stdout.write(JSON.stringify(receipt) + "\n");
