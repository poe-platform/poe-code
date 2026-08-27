import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const repository = resolve(owned, "../../../../..");
const revision = process.argv[2];
const label = process.argv[3];
const selected = process.argv.slice(4);
assert.ok(revision && label && /^[a-z0-9-]+$/.test(label), "capture.mjs REVISION|worktree new-label");
assert.ok(selected.every(name => /^[a-z0-9-]+\.test\.ts$/.test(name)), "selected tests must be owned basenames");
const git = (...args) => execFileSync("git", args, { cwd: repository, maxBuffer: 16 * 1024 * 1024 });
const hash = input => createHash("sha256").update(input).digest("hex");
const files = async directory => (await readdir(directory, { withFileTypes: true, recursive: true })).filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name)).sort();
const output = join(owned, "evidence", label);
await mkdir(join(owned, "evidence"), { recursive: true });
await mkdir(output);
await mkdir(join(owned, ".runs"), { recursive: true });
const scratch = await mkdtemp(join(owned, ".runs", "capture-"));
const inputs = ["src", "package.json", "package-lock.json", "tsconfig.json", "tests/fs/webdav/mock.ts"];
const manifest = {
  revision: revision === "worktree" ? revision : git("rev-parse", revision).toString().trim(),
  headAtCapture: git("rev-parse", "HEAD").toString().trim(), capturedAt: new Date().toISOString(),
  node: process.version, sourceHashes: {}, testHashes: {}, historicalHashes: {}, handoffs: {},
};
manifest.tooling = Object.fromEntries(await Promise.all(["tsx", "typescript"].map(async name => [name, JSON.parse(await readFile(join(repository, "node_modules", name, "package.json"), "utf8")).version])));
if (revision === "worktree") {
  for (const file of [...(await files(join(repository, "src"))).map(file => relative(repository, file)), ...inputs.slice(1)]) {
    await mkdir(dirname(join(scratch, file)), { recursive: true });
    await copyFile(join(repository, file), join(scratch, file));
  }
  execFileSync("tar", ["-czf", join(output, "source.tar.gz"), "-C", scratch, ...inputs]);
} else {
  await writeFile(join(output, "source.tar.gz"), git("archive", "--format=tar.gz", revision, ...inputs));
  execFileSync("tar", ["-xzf", join(output, "source.tar.gz"), "-C", scratch]);
}
for (const file of [...(await files(join(scratch, "src"))).map(file => relative(scratch, file)), ...inputs.slice(1)]) {
  manifest.sourceHashes[file] = hash(await readFile(join(scratch, file)));
}
const contract = git("show", "5076b32:src/contracts/filesystem.ts");
assert.equal(manifest.sourceHashes["src/contracts/filesystem.ts"], hash(contract));
manifest.coreCheckpoint = {
  commit: git("rev-parse", "0bee8e7").toString().trim(),
  expectedSourceHash: hash(git("show", "0bee8e7:src/commands/filesystem.ts")),
  actualSourceHash: manifest.sourceHashes["src/commands/filesystem.ts"],
};
await writeFile(join(output, "native-gnu-9.7.json"), git("show", "0bee8e7:tests/commands/filesystem-authority-stress/native-gnu-9.7.json"));
for (const entry of await readdir(owned, { withFileTypes: true })) {
  if (!entry.isFile() || (!entry.name.endsWith(".ts") && entry.name !== "capture.mjs")) continue;
  const file = relative(repository, join(owned, entry.name));
  await mkdir(dirname(join(scratch, file)), { recursive: true });
  await copyFile(join(owned, entry.name), join(scratch, file));
  await copyFile(join(owned, entry.name), join(output, `${entry.name}.txt`));
  manifest.testHashes[file] = hash(await readFile(join(owned, entry.name)));
}
for (const name of ["comparison-internal", "s3-authority", "webdav-authority"]) {
  try {
    const data = await readFile(`/tmp/safe-bash-${name}-handoff.txt`);
    await writeFile(join(output, `${name}-handoff.txt`), data);
    manifest.handoffs[name] = hash(data);
  } catch (error) { if (error.code !== "ENOENT") throw error; manifest.handoffs[name] = null; }
}
for (const file of git("ls-tree", "-rz", "--name-only", "29fe1bf", "--", "tests/fs/mount/identity-authority-review").toString().split("\0").filter(Boolean)) {
  const current = hash(await readFile(join(repository, file)));
  assert.equal(current, hash(git("show", `29fe1bf:${file}`)), `immutable proposal history changed: ${file}`);
  manifest.historicalHashes[file] = current;
}
const testPaths = Object.keys(manifest.testHashes).filter(file => file.endsWith(".test.ts") && (!selected.length || selected.some(name => file.endsWith(`/${name}`))));
assert.equal(testPaths.length, selected.length || testPaths.length);
manifest.command = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-reporter=tap", ...testPaths];
const run = spawnSync(process.execPath, manifest.command, { cwd: scratch, encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
await writeFile(join(output, "tests.stdout.tap"), run.stdout ?? "");
await writeFile(join(output, "tests.stderr.txt"), run.stderr ?? "");
const observations = (run.stdout ?? "").split("\n").filter(line => line.startsWith("# IMPLEMENTATION_OBSERVATION "))
  .map(line => JSON.parse(Buffer.from(line.slice("# IMPLEMENTATION_OBSERVATION ".length), "base64").toString()));
await writeFile(join(output, "observations.json"), `${JSON.stringify(observations, null, 2)}\n`);
manifest.testExit = run.status;
manifest.testError = run.error?.message ?? null;
manifest.counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(name => [name, Number(new RegExp(`^# ${name} (\\d+)$`, "m").exec(run.stdout ?? "")?.[1] ?? -1)]));
await writeFile(join(output, "tsconfig.json"), JSON.stringify({ extends: join(scratch, "tsconfig.json"), include: testPaths.map(file => join(scratch, file)), compilerOptions: { noEmit: true } }, null, 2));
const types = spawnSync(process.execPath, [join(repository, "node_modules/typescript/bin/tsc"), "--noEmit", "-p", join(output, "tsconfig.json")], { encoding: "utf8", timeout: 120000 });
await writeFile(join(output, "types.stdout.txt"), types.stdout ?? "");
await writeFile(join(output, "types.stderr.txt"), types.stderr ?? "");
manifest.typeExit = types.status;
manifest.archiveHash = hash(await readFile(join(output, "source.tar.gz")));
manifest.finishedAt = new Date().toISOString();
manifest.artifactHashes = {};
for (const file of await files(output)) manifest.artifactHashes[relative(output, file)] = hash(await readFile(file));
await writeFile(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await rm(scratch, { recursive: true });
console.log(JSON.stringify({ output, revision: manifest.revision, counts: manifest.counts, testExit: run.status, typeExit: types.status }, null, 2));
process.exitCode = run.status === 0 && types.status === 0 ? 0 : 1;
