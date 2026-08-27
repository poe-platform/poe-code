import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const repository = resolve(owned, "../../../..");
const authoritativeContract = "fa539de";
const mode = process.argv[2] ?? "pinned";
assert.ok(["pinned", "worktree", "revision"].includes(mode));
const requestedRevision = mode === "revision" ? process.argv[4] : "4fa4ba9502dac843bd13aa5031d128a3171f597d";
assert.match(requestedRevision ?? "", /^[a-f0-9]{7,40}$/);
const revision = mode === "revision"
  ? execFileSync("git", ["rev-parse", "--verify", `${requestedRevision}^{commit}`], { cwd: repository }).toString().trim()
  : requestedRevision;
const testName = mode === "revision" ? process.argv[5] ?? "compatibility.test.ts" : "compatibility.test.ts";
assert.ok(["compatibility.test.ts", "traversal-authority.test.ts"].includes(testName));
const label = process.argv[3] ?? `${mode}-${Date.now()}`;
assert.match(label, /^[a-z0-9-]+$/);
const output = join(owned, "evidence", label);
await mkdir(join(owned, "evidence"), { recursive: true });
await mkdir(output);
await mkdir(join(owned, ".runs"), { recursive: true });
const scratch = await mkdtemp(join(owned, ".runs", `${mode}-`));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: repository });
const manifest = {
  mode, revision, authoritativeContract: git("rev-parse", authoritativeContract).toString().trim(),
  startedAt: new Date().toISOString(), node: process.version,
  worktreeHead: git("rev-parse", "HEAD").toString().trim(),
  worktreeStatusBefore: git("status", "--short").toString(),
  sourceHashes: {},
};

try {
  if (mode === "pinned" || mode === "revision") {
    const archive = git("archive", "--format=tar.gz", revision, "src", "package.json", "tsconfig.json", "tests/fs/webdav/mock.ts",
      ...(testName === "traversal-authority.test.ts" ? ["tests/fs/webdav/property-fixture.ts"] : []));
    const archivePath = join(output, `source-${revision.slice(0, 7)}.tar.gz`);
    await writeFile(archivePath, archive);
    manifest.archiveSha256 = sha256(archive);
    execFileSync("tar", ["-xzf", archivePath, "-C", scratch]);
  } else {
    for (const path of ["src", "tests/fs/webdav/mock.ts", "package.json", "tsconfig.json"]) {
      const files = path === "src" ? (await readdir(join(repository, path), { recursive: true, withFileTypes: true }))
        .filter(entry => entry.isFile()).map(entry => relative(repository, join(entry.parentPath, entry.name))) : [path];
      for (const file of files) {
        await mkdir(dirname(join(scratch, file)), { recursive: true });
        await copyFile(join(repository, file), join(scratch, file));
      }
    }
  }
  const sourceFiles = (await readdir(join(scratch, "src"), { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile()).map(entry => relative(scratch, join(entry.parentPath, entry.name))).sort();
  for (const file of [...sourceFiles, "package.json", "tsconfig.json", "tests/fs/webdav/mock.ts",
    ...(testName === "traversal-authority.test.ts" ? ["tests/fs/webdav/property-fixture.ts"] : [])]) {
    manifest.sourceHashes[file] = sha256(await readFile(join(scratch, file)));
  }
  manifest.sourceSetSha256 = sha256(JSON.stringify(manifest.sourceHashes));
  const contract = git("show", `${authoritativeContract}:src/contracts/filesystem.md`);
  assert.equal(manifest.sourceHashes["src/contracts/filesystem.md"], sha256(contract));
  assert.equal(sha256(await readFile(join(owned, "compatibility.test.ts"))), "9d11741fd9b37757046c1278fdaa00c734633bfd9a1fc58ae479415c2f5a6734",
    "the original 38 positive plus 5 rejection controls must remain byte-identical");
  const testPath = relative(repository, join(owned, testName));
  await mkdir(dirname(join(scratch, testPath)), { recursive: true });
  await copyFile(join(repository, testPath), join(scratch, testPath));
  await copyFile(join(repository, testPath), join(output, `${testName}.txt`));
  manifest.testSha256 = sha256(await readFile(join(scratch, testPath)));
  const command = ["--import", "tsx", "--test", "--test-reporter=tap", testPath];
  manifest.command = ["node", ...command];
  const result = spawnSync(process.execPath, command, { cwd: scratch, encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
  await writeFile(join(output, "tests.stdout.tap"), result.stdout ?? "");
  await writeFile(join(output, "tests.stderr.txt"), result.stderr ?? "");
  manifest.exitCode = result.status;
  manifest.signal = result.signal;
  manifest.launchError = result.error?.message ?? null;
  manifest.counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(name => [name,
    Number(new RegExp(`^# ${name} (\\d+)$`, "m").exec(result.stdout ?? "")?.[1] ?? -1)]));
  const observations = (result.stdout ?? "").split("\n").filter(line => line.startsWith("# {\"case\":")).map(line => JSON.parse(line.slice(2)));
  await writeFile(join(output, "observations.json"), `${JSON.stringify(observations, null, 2)}\n`);
  await writeFile(join(output, "scoped-tsconfig.json"), `${JSON.stringify({
    extends: join(scratch, "tsconfig.json"), include: [join(scratch, testPath)], compilerOptions: { noEmit: true },
  }, null, 2)}\n`);
  const types = spawnSync(process.execPath, [join(repository, "node_modules/typescript/bin/tsc"), "--noEmit", "-p", join(output, "scoped-tsconfig.json")],
    { cwd: scratch, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  await writeFile(join(output, "types.stdout.txt"), types.stdout ?? "");
  await writeFile(join(output, "types.stderr.txt"), types.stderr ?? "");
  manifest.typecheckExitCode = types.status;
  manifest.finishedAt = new Date().toISOString();
  manifest.worktreeStatusAfter = git("status", "--short").toString();
  await writeFile(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ mode, revision, counts: manifest.counts, exitCode: manifest.exitCode, typecheckExitCode: types.status, output }, null, 2));
  process.exitCode = result.status === 0 && types.status === 0 ? 0 : 1;
} finally {
  await rm(scratch, { recursive: true, force: true });
}
