import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function inside(root, path) {
  const suffix = relative(resolve(root), resolve(path));
  return suffix === "" || (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(".." + sep));
}
export function safeRelative(path) {
  assert.equal(typeof path, "string");
  assert(path && !isAbsolute(path) && !path.includes("\\") && !path.includes("\0"));
  assert(path.split("/").every((part) => part && part !== "." && part !== ".."));
  return path;
}
export function snapshot(root) {
  assert(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink(), "regular root required");
  const files = {};
  const directories = [];
  function walk(prefix) {
    for (const name of readdirSync(resolve(root, prefix)).sort()) {
      const path = prefix ? prefix + "/" + name : name;
      safeRelative(path);
      const absolute = resolve(root, path);
      const info = lstatSync(absolute);
      assert(!info.isSymbolicLink(), `symlink refused: ${path}`);
      if (info.isDirectory()) { directories.push(path); walk(path); }
      else {
        assert(info.isFile(), `nonregular input: ${path}`);
        files[path] = { bytes: info.size, mode: info.mode & 0o777, sha256: sha256(readFileSync(absolute)) };
      }
    }
  }
  walk("");
  return { directories: directories.sort(), files };
}
export function assertSnapshot(root, expected) {
  assert.deepEqual(snapshot(root), expected, `membership/hash/mode changed: ${root}`);
}
export function copyRegular(source, destination, expected) {
  assertSnapshot(source, expected);
  mkdirSync(destination, { recursive: false });
  for (const directory of expected.directories) mkdirSync(resolve(destination, safeRelative(directory)), { recursive: true });
  for (const [path, metadata] of Object.entries(expected.files)) {
    const target = resolve(destination, safeRelative(path));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(resolve(source, path)), { flag: "wx", mode: metadata.mode });
  }
  assertSnapshot(source, expected);
  assertSnapshot(destination, expected);
}
export function checkBytes(path, expected) {
  const info = lstatSync(path);
  assert(info.isFile() && !info.isSymbolicLink(), "regular admitted file required");
  assert.equal(info.mode & 0o777, expected.mode);
  assert.equal(info.size, expected.bytes);
  assert.equal(sha256(readFileSync(path)), expected.sha256);
}
export function requireAuthority(authority) {
  assert(authority && authority.kind === "root-authorized-directory-stack-execution-v1", "ROOT execution authorization absent");
  for (const key of ["rootApprovalCommit", "acceptedLetCommit", "acceptedLetEvidenceCommit", "acceptedCdLetBaseCommit", "acceptedCdLetBaseTree", "stackCandidateCommit", "stackCandidateTree", "authorEvidenceCommit", "preparationCommit"]) assert.match(authority[key] ?? "", /^[a-f0-9]{40}$/, `exact ${key} required; HEAD forbidden`);
  assert.equal(authority.rootStackGo, true, "fresh stack GO required");
  assert.equal(authority.stackWindowReleased, true, "LET-only release is insufficient");
  assert.equal(authority.acceptedCdCommit, "4641075df5355a91c83bf5b2cc3a88dfaf1f5153");
  assert.notEqual(authority.stackCandidateCommit, authority.acceptedCdCommit, "accepted CD is not a stack candidate");
  assert.notEqual(authority.stackCandidateCommit, authority.acceptedCdLetBaseCommit);
  assert.deepEqual([...authority.productDelta].sort(), ["src/shell/runtime.ts", "src/shell/shell.ts"]);
  assert.match(authority.rootApprovalPath ?? "", /^tests\//);
  assert.match(authority.rootApprovalSha256 ?? "", /^[a-f0-9]{64}$/);
  assert.equal(authority.preparedDriverScope, "explicit-selected-rows-not-138-pass");
  assert.equal(authority.noLiveOverlay, true);
  assert.equal(authority.toolchainRegularAndPinned, true);
  assert.equal(authority.moduleClosureQualification, "main-thread-ESM-no-unadmitted-worker-or-CJS-path");
  assert.match(authority.expectedPackageSha256 ?? "", /^[a-f0-9]{64}$/);
  assert(authority.expectedPackageInventory?.files && authority.expectedPackageInventory?.directories);
  for (const path of ["package.json", "tsconfig.build.json", "src/index.ts"]) assert(authority.sourceInputs?.[path], `required build/public input missing: ${path}`);
  for (const key of ["root", "inventory", "node", "tsc", "npmCli", "tsxPreload"]) assert(authority.tools?.[key], `pinned tool field missing: ${key}`);
  for (const key of ["sourceInputs", "tools", "authorProductHashes", "baseProductHashes", "publicConsumerInventory", "canonicalTypeScriptInventory", "caseIds"]) assert(authority[key] && Object.keys(authority[key]).length > 0, `${key} missing`);
  return authority;
}
