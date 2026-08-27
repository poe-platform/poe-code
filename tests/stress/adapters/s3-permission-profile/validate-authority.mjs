import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const root = "tests/stress/adapters/s3-permission-profile";
const label = process.argv[2];
assert.match(label ?? "", /^[a-z0-9-]+$/);
const destination = `${root}/${label}.json`;
assert.equal(existsSync(destination), false, "immutable evidence cannot be overwritten");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const digest = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const testFiles = directory => readdirSync(directory).filter(name => name.endsWith(".test.ts")).sort().map(name => `${directory}/${name}`);
const owned = [...readdirSync("src/fs/s3").map(name => `src/fs/s3/${name}`), ...testFiles("tests/fs/s3")];
const fixtures = ["tests/fs/mount/identity-compatibility-review/compatibility.test.ts", "tests/fs/conformance/shared.test.ts", "tests/fs/conformance/fixtures.ts", "tests/stress/adapters/core.test.ts", `${root}/revised-policy.test.ts`];
const sources = [...new Set([...git("ls-files", "src").split("\n").filter(path => path.endsWith(".ts")), ...owned, ...fixtures, "src/fs/mount/comparison.ts", "src/contracts/filesystem.md", `${root}/validate-authority.mjs`])].sort();
const manifest = () => Object.fromEntries(sources.map(path => [path, digest(path)]));
const before = manifest();
const base = git("rev-parse", "HEAD");
const tests = ["--unhandled-rejections=strict", "--import", "tsx", "--test"];
const commands = [
  ["comparison", [...tests, "tests/fs/s3/comparison.test.ts"]],
  ["s3-backend", [...tests, ...testFiles("tests/fs/s3")]],
  ["s3-conformance", [...tests, "--test-name-pattern=^s3:|^independent conformance source provenance$|^conformance source state remained stable during suite$", "tests/fs/conformance/shared.test.ts"]],
  ["policy86-read-only", [...tests, ...testFiles("tests/stress/s3-policy")]],
  ["approved-permission", [...tests, `${root}/revised-policy.test.ts`]],
  ["targeted-stress", [...tests, "--test-name-pattern=^[Ss]3", "tests/stress/adapters/core.test.ts", "tests/stress/adapters/s3.test.ts", "tests/stress/adapters/s3-rename-profile.test.ts", "tests/stress/adapters/s3-truncate-profile.test.ts"]],
  ["original-s3-compatibility", [...tests, "--test-name-pattern=s3|S3", fixtures[0]]],
  ["scoped-types", ["node_modules/typescript/bin/tsc", "--noEmit", "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--forceConsistentCasingInFileNames", "--skipLibCheck", "--types", "node", ...owned.filter(path => path.endsWith(".ts")), "tests/stress/adapters/core.test.ts", `${root}/revised-policy.test.ts`]],
];
const checks = commands.map(([name, args]) => {
  const started = new Date().toISOString();
  const result = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 180000, maxBuffer: 32 * 1024 * 1024 });
  console.log(name, result.status, (result.stdout ?? "").split("\n").filter(line => /^# (tests|pass|fail)/.test(line)).join("; "));
  return { name, args, started, ended: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
});
const after = manifest();
const record = {
  classification: "Full-operation-bound S3 checkpoint; original unqualified input gate remains separately counted, no fixture relaxation",
  base, finalHead: git("rev-parse", "HEAD"), node: process.version,
  typescript: JSON.parse(readFileSync("node_modules/typescript/package.json", "utf8")).version,
  tsx: JSON.parse(readFileSync("node_modules/tsx/package.json", "utf8")).version,
  before, after, changedInputs: sources.filter(path => before[path] !== after[path]),
  status: git("status", "--short"), sourcePatch: git("diff", "--", "src/fs/s3"),
  addedSources: { "src/fs/s3/authority.ts": readFileSync("src/fs/s3/authority.ts", "utf8"), "tests/fs/s3/comparison.test.ts": readFileSync("tests/fs/s3/comparison.test.ts", "utf8") },
  providerHandoff: readFileSync("/tmp/safe-bash-s3-authority-handoff.txt", "utf8"),
  wrapperHandoff: readFileSync("/tmp/safe-bash-comparison-internal-handoff.txt", "utf8"), checks,
};
const text = JSON.stringify(record, null, 2);
execFileSync("apply_patch", [], { input: `*** Begin Patch\n*** Add File: ${destination}\n${text.split("\n").map(line => "+" + line).join("\n")}\n*** End Patch\n`, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
assert.deepEqual(after, before, "moving inputs invalidate a frozen-source claim");
process.exitCode = checks.some(check => check.status !== 0) ? 1 : 0;
