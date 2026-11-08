import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../..");
const git = (...args) => execFileSync("git", ["--no-replace-objects", ...args], { cwd: repository });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const revision = git("rev-parse", "HEAD").toString().trim();
const trackedWhich = git("ls-tree", "-r", "--name-only", revision, "src/commands/which").toString().trim().split("\n");
assert.equal(trackedWhich.some(filename => filename.endsWith(".ts")), false, "Freeze must precede tracked implementation");
const liveWhich = readdirSync(path.join(repository, "src/commands/which"), { recursive: true });
assert.equal(liveWhich.some(filename => /\.(?:[cm]?[jt]s|tsx)$/.test(filename)), false, "Freeze must precede live implementation");
const historical = ["README.md", "draft-cases.json", "observe-type-path.mjs", "type-path-observations.json", "verify-draft.mjs"];
const inputs = ["cases-v1.json", "cohort-v1.mjs", "types-v1.json", "FREEZE-v1.md", "seal-v1.mjs", "verify-v1.mjs"];
const draftCommit = "65d198cfd1f4df9f9687e05017986c6815b67eb6";
const historicalHashes = Object.fromEntries(historical.map(filename => {
  const relative = path.relative(repository, path.join(own, filename));
  const stored = readFileSync(path.join(own, filename));
  assert.deepEqual(stored, git("show", `${draftCommit}:${relative}`));
  return [filename, hash(stored)];
}));
const references = [
  "src/commands/which/DESIGN.md", "src/commands/which/ACCESS-POLICY-v2.md",
  ...trackedWhich.filter(filename => filename.includes("/design-evidence/")),
  "src/contracts/command.ts", "src/contracts/filesystem.ts", "src/contracts/filesystem.md",
  "src/contracts/errors.ts", "src/contracts/io.ts", "src/contracts/path.ts", "src/contracts/plugin.ts",
  "src/fs/memory/index.ts", "src/fs/readonly/index.ts", "src/shell/shell.ts", "src/shell/runtime.ts", "src/plugins/index.ts"
];
const sourceHashes = Object.fromEntries(references.map(relative => {
  const stored = readFileSync(path.join(repository, relative));
  assert.deepEqual(stored, git("show", `${revision}:${relative}`), `Dirty inspected input: ${relative}`);
  return [relative, hash(stored)];
}));
const fixtureHashes = Object.fromEntries(inputs.map(filename => [filename, hash(readFileSync(path.join(own, filename)))]));
const seal = {
  version: 1, classification: "independent normative preimplementation WHICH fixture; no execution acceptance",
  sealedAt: new Date().toISOString(), revision, rootApprovedBase: "5c34372be6aedd179123ceab2663c7d52f207ed1",
  rootApprovedAccessDelta: "c82a7fc9eac4aecd764ffb91d0b7f91f0e452dbd", draftCommit,
  upstreamRevision: "8268a31bcceb9ebe32d380cab792c89c5d897d15", timing: "after approved policy inspection; before tracked or live WHICH code",
  familyCount: 28, runtimeGroups: 26, typeFamilies: 4, overlappingTypeRuntimeFamilies: ["T02", "T03"],
  candidateExecutions: 0, typeCompilations: 0, nativeOracleExecutions: 0, mutationExecutions: 0,
  nativeQualification: "FreeBSD binary unprovisioned; Darwin not exercised; pinned primary manual/source only",
  fixtureHashes, historicalHashes, sourceHashes
};
const output = path.relative(repository, path.join(own, "FREEZE-v1.json"));
assert.equal(existsSync(path.join(repository, output)), false, "Seal is immutable");
const lines = JSON.stringify(seal, null, 2).split("\n").map(line => `+${line}`).join("\n");
execFileSync("apply_patch", [], { cwd: repository, input: `*** Begin Patch\n*** Add File: ${output}\n${lines}\n*** End Patch\n` });
console.log(JSON.stringify({ output, revision, normativeFamilies: 28, candidateExecutions: 0, nativeExecutions: 0 }, null, 2));
