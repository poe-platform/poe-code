import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const assembly = JSON.parse(readFileSync(join(owned, "assembly.json")));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(readFileSync(join(assembly.task, "inputs/tests/shell-stress/first-read-contract-review/owned-output-streaming-prototype/tested-manifest.json")));
const compilerInputs = manifest.compilerInputs.map(entry => {
  const path = entry.normalizedPath.startsWith("CANDIDATE/")
    ? join(assembly.candidate, entry.normalizedPath.slice("CANDIDATE/".length))
    : join(assembly.task, "node_modules", entry.normalizedPath.split("/node_modules/")[1]);
  assert.equal(hash(readFileSync(path)), entry.sha256, path);
  return { normalizedPath: entry.normalizedPath, actualPath: path, sha256: entry.sha256 };
});
const readonlyRoots = ["inputs", "candidate", "baseline", "committed-base", "reconstructed", "engine", "node_modules", "consumer"];
let regularFiles = 0;
function checkReadonly(path) {
  const stat = lstatSync(path);
  assert.equal(stat.isSymbolicLink(), false, path);
  assert.equal(stat.mode & 0o222, 0, path);
  if (stat.isDirectory()) for (const name of readdirSync(path)) checkReadonly(join(path, name));
  else { assert.ok(stat.isFile(), path); regularFiles += 1; }
}
for (const name of readonlyRoots) checkReadonly(join(assembly.task, name));
const tools = ["/usr/bin/git", "/usr/bin/tar"].map(path => ({
  path, sha256: hash(readFileSync(path)),
  version: execFileSync(path, ["--version"], { env: { PATH: "/usr/bin:/bin", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" }, encoding: "utf8", timeout: 5000 }).trim(),
}));
const files = readdirSync(owned).filter(name => name !== "SEAL.json").sort().map(path => {
  const bytes = readFileSync(join(owned, path));
  return { path, bytes: bytes.length, sha256: hash(bytes) };
});
const seal = {
  at: new Date().toISOString(), status: "PREPARATION_ONLY_AUTHENTICATED_NO_SURFACE_VERDICT",
  candidateEvidenceCommit: assembly.evidenceCommit, baseCommit: assembly.baseCommit,
  privateHead: assembly.privateHead, task: assembly.task, source: assembly.sourceManifestSha256,
  files, compilerInputs, readonlyRoots, regularFiles, tools,
  productExecutionCount: 0, privateEngineExecutionCount: 0, publicBuildCount: 1,
  readonlyClaim: "Private before/after matched exactly; public foreign source additions disclosed; no live-source overlay",
};
writeFileSync(join(owned, "SEAL.json"), JSON.stringify(seal, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ sealedFiles: files.length, compilerInputsChecked: compilerInputs.length, regularReadonlyFiles: regularFiles, task: assembly.task }));
