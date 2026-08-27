import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd(), owned = "tests/commands/core-regression-stress";
const revision = "954f2302e4b2f42f90cb5ffd5670d1936f47390c";
const source = mkdtempSync(join(tmpdir(), "safe-core-independent-"));
const archive = join(source, "source.tar");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
execFileSync("git", ["archive", "--format=tar", "-o", archive, revision, "src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"], { cwd: root });
const snapshot = join(source, "snapshot"); mkdirSync(snapshot);
execFileSync("tar", ["-xf", archive, "-C", snapshot]);
symlinkSync(join(root, "node_modules"), join(snapshot, "node_modules"), "dir");
cpSync(join(root, owned), join(snapshot, owned), { recursive: true, filter: path => !path.includes(`${owned}/evidence`) });
const files = readdirSync(join(snapshot, owned)).filter(name => name.endsWith(".test.ts")).sort().map(name => `${owned}/${name}`);
const paths = ["src/commands/filesystem.ts", "src/commands/streams.ts", "src/commands/text.ts", "src/commands/execution.ts", "src/commands/bytes/checksums/index.ts", "src/contracts/command.ts", "src/shell/runtime.ts"];
const hashes = () => Object.fromEntries(paths.map(path => [path, sha(readFileSync(join(snapshot, path)))]));
const baselineHashes = hashes();
function run() {
  const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--test", ...files], {
    cwd: snapshot, encoding: "utf8", timeout: 20_000, maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.signal || result.status === null) throw result.error ?? new Error("test child failed to exit normally");
  const count = label => Number(result.stdout.match(new RegExp(`^# ${label} (\\d+)$`, "m"))?.[1]);
  const summary = { status: result.status, tests: count("tests"), pass: count("pass"), fail: count("fail"), skipped: count("skipped"), todo: count("todo"), failures: [...result.stdout.matchAll(/^not ok \d+ - (.*)$/gm)].map(match => match[1]) };
  assert.equal(summary.tests, 100);
  return { ...summary, stdout: result.stdout, stderr: result.stderr };
}
const original = run();
for (const path of paths.slice(0, 5)) writeFileSync(join(snapshot, path), readFileSync(join(root, path)));
const currentHashes = hashes(), current = run();
const mutants = [];
if (process.argv.includes("--mutants")) {
  for (const mutation of [
    { name: "wc-single-byte-character-loss", file: "src/commands/streams.ts", from: "counts.m! += chunk.length;", to: "counts.m! += 0;" },
    { name: "sort-partial-output-on-read-error", file: "src/commands/text.ts", from: 'catch (error) { await diagnostic(context, error); return { exitCode: 2 }; }', to: 'catch (error) { await diagnostic(context, error); }' },
    { name: "sort-reversed-plain-bytes", file: "src/commands/text.ts", from: "Buffer.compare(left, right)", to: "-Buffer.compare(left, right)" },
    { name: "env-merge-instead-of-replace", file: "src/commands/execution.ts", from: "replaceEnv: true", to: "replaceEnv: false" },
    { name: "env-old-new-name-order", file: "src/commands/execution.ts", from: "addedNames.reverse()", to: "addedNames" },
    { name: "cksum-discard-selected-algorithm", file: "src/commands/bytes/checksums/index.ts", from: "const selectedAlgorithm = selected.algorithm;", to: 'const selectedAlgorithm = "crc";' },
    { name: "realpath-ignore-relative-base", file: "src/commands/filesystem.ts", from: "base === undefined || isPathWithin(base, to) && isPathWithin(base, resolved)", to: "true" },
  ]) {
    const path = join(snapshot, mutation.file), original = readFileSync(path, "utf8");
    assert.equal(original.split(mutation.from).length, 2, `exact mutation anchor ${mutation.name}`);
    const changed = original.replace(mutation.from, mutation.to); writeFileSync(path, changed);
    try { const result = run(); mutants.push({ name: mutation.name, file: mutation.file, sha256: sha(changed), detected: result.fail > 0, ...result }); }
    finally { writeFileSync(path, original); }
  }
}
const report = { capturedAt: new Date().toISOString(), revision, archiveSha256: sha(readFileSync(archive)), retainedSnapshot: snapshot,
  node: process.version, baselineHashes, currentHashes, testHashes: Object.fromEntries(readdirSync(join(root, owned)).filter(name => /\.(?:ts|mjs|json)$/.test(name)).sort().map(name => [name, sha(readFileSync(join(root, owned, name)))])),
  original, current, mutants, scope: "Explicit committed source archive plus only listed owned command files; no dirty FS, shell or contract source. New independent tests copied in identically for both observations." };
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes("--mutants") && (current.status !== 0 || mutants.some(row => !row.detected))) process.exitCode = 1;
