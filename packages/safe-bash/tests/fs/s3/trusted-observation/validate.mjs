import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const directory = "tests/fs/s3/trusted-observation";
const label = process.argv[2];
assert.match(label ?? "", /^[a-z0-9-]+$/);
const destination = `${directory}/${label}.json`;
assert.equal(existsSync(destination), false);
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const original = "tests/fs/mount/identity-compatibility-review/compatibility.test.ts";
const ownedTests = readdirSync("tests/fs/s3").filter(name => name.endsWith(".test.ts")).sort().map(name => `tests/fs/s3/${name}`);
const sources = git("ls-files", "src").split("\n").filter(path => path.endsWith(".ts"));
const selected = [...sources, ...ownedTests, original, "src/contracts/filesystem.md", `${directory}/validate.mjs`].sort();
const manifest = () => Object.fromEntries(selected.map(path => [path, hash(path)]));
const before = manifest();
const snapshots = Object.fromEntries([...sources.filter(path => path.startsWith("src/fs/") || path.startsWith("src/contracts/")),
  "src/commands/filesystem.ts", "src/commands/copy-identity.ts", "src/commands/move.ts", ...ownedTests, original,
  "src/contracts/filesystem.md"].map(path => [path, readFileSync(path, "utf8")]));
const base = git("rev-parse", "HEAD");
execFileSync("git", ["merge-base", "--is-ancestor", "0bee8e7", "HEAD"]);
const args = ["--unhandled-rejections=strict", "--import", "tsx", "--test"];
const commands = [
  ["authority", [...args, "tests/fs/s3/comparison.test.ts", "tests/fs/s3/adapter-overrides.test.ts", "tests/fs/s3/late-authority.test.ts",
    ...(existsSync("tests/fs/s3/trusted-forwarding.test.ts") ? ["tests/fs/s3/trusted-forwarding.test.ts"] : [])]],
  ["unchanged-original-s3", [...args, "--test-name-pattern=s3|S3", original]],
];
if (label === "final" || label.startsWith("replay")) commands.push(
  ["backend", [...args, ...ownedTests]],
  ["policy86-read-only", [...args, ...readdirSync("tests/stress/s3-policy").filter(name => name.endsWith(".test.ts")).sort().map(name => `tests/stress/s3-policy/${name}`)]],
  ["conformance", [...args, "--test-name-pattern=^s3:|^independent conformance source provenance$|^conformance source state remained stable during suite$", "tests/fs/conformance/shared.test.ts"]],
  ["scoped-types", ["node_modules/typescript/bin/tsc", "--noEmit", "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext",
    "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax",
    "--forceConsistentCasingInFileNames", "--skipLibCheck", "--types", "node", ...sources.filter(path => path.startsWith("src/fs/s3/")), ...ownedTests]],
);
const checks = commands.map(([name, parameters]) => {
  const started = new Date().toISOString();
  const result = spawnSync(process.execPath, parameters, { encoding: "utf8", timeout: 180000, maxBuffer: 24 * 1024 * 1024 });
  console.log(name, result.status, (result.stdout ?? "").split("\n").filter(line => /^(not ok|# tests|# pass|# fail)/.test(line)).join("; "));
  return { name, args: parameters, started, ended: new Date().toISOString(), status: result.status, signal: result.signal,
    error: result.error?.message ?? null, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
});
const after = manifest();
const changedInputs = selected.filter(path => before[path] !== after[path]);
const record = { base, finalHead: git("rev-parse", "HEAD"), core0bee8e7Included: true, node: process.version,
  before, after, changedInputs, snapshots, status: git("status", "--short"), sourcePatch: git("diff", "--", "src/fs/s3"), checks };
const text = JSON.stringify(record, null, 2);
execFileSync("apply_patch", [], { input: `*** Begin Patch\n*** Add File: ${destination}\n${text.split("\n").map(line => "+" + line).join("\n")}\n*** End Patch\n`, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
assert.deepEqual(changedInputs.filter(path => path.startsWith("src/fs/") || path.startsWith("tests/fs/s3/") || path === original), [], "relevant inputs moved during validation");
process.exitCode = checks.some(check => check.status !== 0) ? 1 : 0;
