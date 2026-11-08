import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const owned = "tests/commands/filesystem-authority-stress";
const baseline = "745eaa62eebbe07b7fd30dccad4a73a1669f7124";
const authorTests = ["tests/commands/copy-identity.test.ts", "tests/commands/move-cross-device.test.ts", "tests/commands/entry-comparison.test.ts",
  "tests/contracts/filesystem-comparison.test.ts", "tests/contracts/filesystem-identity.test.ts"];
const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const temporary = mkdtempSync(join(tmpdir(), "safe-core-review-"));
const archive = execFileSync("git", ["archive", "--format=tar", baseline, "src", "package.json", "tests/commands/helpers.ts", ...authorTests], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
const archivePath = join(temporary, "source.tar");
writeFileSync(archivePath, archive);
const snapshot = join(temporary, "snapshot");
mkdirSync(snapshot);
execFileSync("tar", ["-xf", archivePath, "-C", snapshot]);
symlinkSync(resolve(root, "node_modules"), join(snapshot, "node_modules"), "dir");
cpSync(join(root, owned), join(snapshot, owned), { recursive: true, filter: path => !path.includes(`${owned}/evidence`) });
const tests = readdirSync(join(snapshot, owned)).filter(name => name.endsWith(".test.ts")).sort().map(name => `${owned}/${name}`);
const consumerPaths = ["src/commands/filesystem.ts", "src/commands/copy-identity.ts", "src/commands/move.ts", "src/contracts/filesystem.ts", "src/contracts/filesystem.md", "src/fs/mount/comparison.ts"];
const hashes = () => Object.fromEntries(consumerPaths.map(path => [path, sha256(readFileSync(join(snapshot, path)))]));
const baselineHashes = hashes();
function run(files: readonly string[]) {
  const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--test", ...files], {
    cwd: snapshot, env: { ...process.env, LC_ALL: "C", TZ: "UTC" }, encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.signal || result.status === null) throw result.error ?? new Error("review child did not exit");
  const count = (field: string) => Number(result.stdout.match(new RegExp(`^# ${field} (\\d+)$`, "m"))?.[1] ?? NaN);
  const summary = { exitCode: result.status, tests: count("tests"), pass: count("pass"), fail: count("fail"), skipped: count("skipped"), todo: count("todo"),
    failures: [...result.stdout.matchAll(/^not ok \d+ - (.*)$/gm)].map(match => match[1]), stderr: result.stderr };
  assert.ok(Number.isSafeInteger(summary.tests), "test output must have a TAP summary");
  return { summary, tap: result.stdout };
}
const original = run(tests), originalAuthor = run(authorTests);
const fixedPath = "src/commands/filesystem.ts";
writeFileSync(join(snapshot, fixedPath), readFileSync(join(root, fixedPath)));
const fixedHashes = hashes();
for (const path of consumerPaths.filter(path => path !== fixedPath)) assert.equal(fixedHashes[path], baselineHashes[path], `${path} must remain frozen`);
const fixed = run(tests), fixedAuthor = run(authorTests);
const mutations = [
  { name: "accept-malformed-authority", file: "src/commands/copy-identity.ts",
    from: 'if (answer !== "same" && answer !== "distinct" && answer !== "unknown") {', to: "if (false) {" },
  { name: "ignore-post-authority-abort", file: "src/commands/copy-identity.ts",
    from: '    options.signal?.throwIfAborted();\n    if (answer !== "same"', to: '    if (answer !== "same"' },
  { name: "allow-unknown-move-noop-cleanup", file: "src/commands/move.ts",
    from: 'if (identity === "unknown") throw new FsError("ENOTSUP", { path: origin, dest: destination, message: "existing move destination lacks authoritative distinctness" });', to: "" },
  { name: "allow-unknown-force-unlink", file: fixedPath,
    from: 'if (identities.includes("unknown")) throw new FsError("ENOTSUP", { path: source, dest: target, message: "forced copy unlink lacks authoritative distinctness" });', to: "" },
  { name: "ignore-force-alias-recheck", file: fixedPath,
    from: 'if (identities.includes("same")) throw new FsError("EINVAL", { path: source, dest: target, message: "source and destination are the same file" });', to: "" },
  { name: "ignore-copy-publication-failure", file: "src/commands/move.ts",
    from: 'if (noClobber && entry === plan[0] && !entry.targetStat && codeOf(error) === "EEXIST") return false;\n      throw error;',
    to: 'if (noClobber && entry === plan[0] && !entry.targetStat && codeOf(error) === "EEXIST") return false;\n      continue;' },
  { name: "remove-before-publication", file: "src/commands/move.ts",
    from: "  for (const entry of plan) {\n    await recheck(context, entry);", to: "  await context.fs.rm(source, { signal: context.signal });\n  for (const entry of plan) {\n    await recheck(context, entry);" },
  { name: "nonexclusive-missing-move-target", file: "src/commands/move.ts",
    from: 'exclusive: !entry.targetStat || entry.targetStat.type === "symlink"', to: "exclusive: false" },
  { name: "allow-unknown-symlink-unlink", file: fixedPath,
    from: 'if (identity === "unknown") throw new FsError("ENOTSUP", { path: source, dest: target, message: "symbolic link copy unlink lacks authoritative distinctness" });', to: "" },
  { name: "successful-alias-move-status", file: fixedPath,
    from: 'if (!parsed.flags.has("n")) throw new FsError("EINVAL", { path: source, dest: target, message: "source and destination are the same file" });', to: "" },
  { name: "remove-move-depth-budget", file: "src/commands/move.ts",
    from: 'if (depth > 128) throw new FsError("EFBIG", { message: "cross-device move depth limit exceeded" });', to: "" },
] as const;
const mutants = [];
for (const mutation of mutations) {
  const path = join(snapshot, mutation.file), originalSource = readFileSync(path, "utf8");
  assert.equal(originalSource.split(mutation.from).length, 2, `${mutation.name}: exact mutation anchor`);
  const changed = originalSource.replace(mutation.from, mutation.to);
  writeFileSync(path, changed);
  try {
    const result = run(tests);
    mutants.push({ name: mutation.name, file: mutation.file, sourceSha256: sha256(changed), detected: result.summary.exitCode !== 0 && result.summary.fail > 0, ...result.summary });
  } finally { writeFileSync(path, originalSource); }
}
const ownerRevision = execFileSync("git", ["rev-parse", "e8d308a"], { cwd: root, encoding: "utf8" }).trim();
const ownerPath = "src/fs/mount/comparison.ts";
writeFileSync(join(snapshot, ownerPath), execFileSync("git", ["show", `${ownerRevision}:${ownerPath}`], { cwd: root }));
const integrated = run(tests), integratedAuthor = run(authorTests);
const report = {
  generatedAt: new Date().toISOString(), node: process.version, platform: process.platform,
  scope: "Distinct-leaf core consumer review; not remote-backend closure or malicious trusted-provider authentication",
  baseline, archiveSha256: sha256(archive), retainedTemporaryArchive: archivePath,
  baselineHashes, fixedHashes,
  fixtureHashes: Object.fromEntries(readdirSync(join(root, owned)).filter(name => /\.(?:ts|json)$/u.test(name)).sort()
    .map(name => [`${owned}/${name}`, sha256(readFileSync(join(root, owned, name)))])),
  baselineIndependent: original.summary, fixedIndependent: fixed.summary,
  baselineUnmodifiedAuthor: originalAuthor.summary, fixedUnmodifiedAuthor: fixedAuthor.summary,
  ownerIntegration: { description: "Same archive plus reviewed filesystem.ts and only the committed owner's mount/comparison.ts; not a moving worktree snapshot",
    revision: ownerRevision, path: ownerPath, hashes: hashes(), independent: integrated.summary, unmodifiedAuthor: integratedAuthor.summary },
  mutants,
};
const outputFiles = {
  [`${owned}/evidence/review.json`]: JSON.stringify(report, null, 2) + "\n",
  [`${owned}/evidence/baseline-independent.tap.json`]: JSON.stringify({ stdout: original.tap }, null, 2) + "\n",
  [`${owned}/evidence/fixed-independent.tap.json`]: JSON.stringify({ stdout: fixed.tap }, null, 2) + "\n",
  [`${owned}/evidence/baseline-author.tap.json`]: JSON.stringify({ stdout: originalAuthor.tap }, null, 2) + "\n",
  [`${owned}/evidence/fixed-author.tap.json`]: JSON.stringify({ stdout: fixedAuthor.tap }, null, 2) + "\n",
  [`${owned}/evidence/owner-integration-independent.tap.json`]: JSON.stringify({ stdout: integrated.tap }, null, 2) + "\n",
  [`${owned}/evidence/owner-integration-author.tap.json`]: JSON.stringify({ stdout: integratedAuthor.tap }, null, 2) + "\n",
};
if (process.argv.includes("--capture")) {
  const patch = "*** Begin Patch\n" + Object.entries(outputFiles).map(([path, contents]) => `*** Add File: ${path}\n${contents.trimEnd().split("\n").map(line => `+${line}`).join("\n")}\n`).join("") + "*** End Patch\n";
  execFileSync("apply_patch", [], { cwd: root, input: patch, stdio: ["pipe", "inherit", "inherit"] });
}
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
if (fixed.summary.exitCode !== 0 || integrated.summary.exitCode !== 0 || mutants.some(result => !result.detected)) process.exitCode = 1;
