import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const directory = "tests/fs/s3/late-authority";
const label = process.argv[2];
assert.match(label ?? "", /^[a-z0-9-]+$/);
const destination = `${directory}/${label}.json`;
assert.equal(existsSync(destination), false);
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
execFileSync("git", ["merge-base", "--is-ancestor", "0bee8e7", "HEAD"]);
const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const independent = "tests/fs/mount/identity-authority-review/implementation/adapter-binding.test.ts";
const original = "tests/fs/mount/identity-authority-review/implementation/remote-comparison.test.ts";
const focused = "tests/fs/s3/late-authority.test.ts";
const selected = [...new Set([...git("ls-files", "src").split("\n").filter(path => path.endsWith(".ts")),
  focused, independent, original, "src/contracts/filesystem.md", `${directory}/validate.mjs`,
  "tests/fs/s3/adapter-overrides.test.ts", "tests/fs/s3/comparison.test.ts",
  "tests/fs/mount/identity-authority-review/implementation/support.ts",
  "tests/fs/mount/identity-authority-review/implementation/evidence/explicit-late-confirmed/observations.json",
])].sort();
const manifest = () => Object.fromEntries(selected.map(path => [path, hash(path)]));
const before = manifest();
const snapshots = Object.fromEntries(["src/fs/s3/authority.ts", "src/fs/s3/filesystem.ts", "src/fs/mount/comparison.ts",
  "src/fs/memory/index.ts", "src/fs/webdav/resource-id.ts", "src/commands/filesystem.ts", focused, independent, original]
  .map(path => [path, readFileSync(path, "utf8")]));
const base = git("rev-parse", "HEAD");
const testArgs = ["--unhandled-rejections=strict", "--import", "tsx", "--test"];
const commands = [
  ["late-authority", [...testArgs, focused]],
  ["independent-s3-late-denial", [...testArgs, "--test-name-pattern=^s3 post-construction explicit", independent]],
];
if (label !== "before") commands.push(
  ["existing-s3-authority", [...testArgs, "tests/fs/s3/adapter-overrides.test.ts", "tests/fs/s3/comparison.test.ts"]],
  ["independent-s3-binding", [...testArgs, "--test-name-pattern=^s3 ", independent]],
  ["unchanged-original-source-loss", [...testArgs, "--test-name-pattern=^S3 two custom clients", original]],
  ["scoped-types", ["node_modules/typescript/bin/tsc", "--noEmit", "--target", "ES2023", "--lib", "ES2023",
    "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess",
    "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--forceConsistentCasingInFileNames", "--skipLibCheck", "--types", "node",
    ...readdirSync("src/fs/s3").filter(name => name.endsWith(".ts")).sort().map(name => `src/fs/s3/${name}`),
    ...readdirSync("tests/fs/s3").filter(name => name.endsWith(".test.ts")).sort().map(name => `tests/fs/s3/${name}`)]],
);
const checks = commands.map(([name, args]) => {
  const started = new Date().toISOString();
  const result = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
  console.log(name, result.status, (result.stdout ?? "").split("\n").filter(line => /^(not ok|# tests|# pass|# fail)/.test(line)).join("; "));
  return { name, args, started, ended: new Date().toISOString(), status: result.status, signal: result.signal,
    error: result.error?.message ?? null, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
});
const after = manifest();
const record = { base, finalHead: git("rev-parse", "HEAD"), core0bee8e7Included: true, node: process.version,
  before, after, changedInputs: selected.filter(path => before[path] !== after[path]), snapshots,
  status: git("status", "--short"), patch: git("diff", "--", "src/fs/s3"), checks };
const text = JSON.stringify(record, null, 2);
execFileSync("apply_patch", [], { input: `*** Begin Patch\n*** Add File: ${destination}\n${text.split("\n").map(line => "+" + line).join("\n")}\n*** End Patch\n`, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
assert.deepEqual(after, before, "source inputs moved during validation");
process.exitCode = checks.some(check => check.status !== 0) ? 1 : 0;
