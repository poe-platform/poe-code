import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const revision = "4fa4ba9502dac843bd13aa5031d128a3171f597d";
const owned = fileURLToPath(new URL(".", import.meta.url));
const repository = fileURLToPath(new URL("../../../", import.meta.url));
const label = process.argv[2] ?? "closure-4fa4ba9";
assert.match(label, /^[a-z0-9-]+$/);
const output = join(owned, `evidence/${label}/socket-path-recheck.json`);
assert.equal(existsSync(output), false);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: repository, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trim();
const baseline = JSON.parse(readFileSync(join(owned, `evidence/${label}/provenance.json`)));
const fixed = baseline.snapshots.find((snapshot) => snapshot.pin === revision);
const temporary = mkdtempSync(join(owned, ".socket-recheck-"));
const originalOwnedEntries = readdirSync(owned).sort();
let result;

function command(name, argv, environment = {}) {
  const started = new Date().toISOString();
  const child = spawnSync(process.execPath, argv, { cwd: temporary, env: { ...process.env, TMPDIR: owned, TMP: owned, TEMP: owned, ...environment }, encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
  return { name, argv, started, ended: new Date().toISOString(), exit: child.status, signal: child.signal, error: child.error?.message, stdout: child.stdout, stderr: child.stderr,
    summary: Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map((field) => { const match = child.stdout.match(new RegExp(`^# ${field} (\\d+)$`, "m")); return [field, match ? Number(match[1]) : null]; })) };
}

try {
  const tar = execFileSync("git", ["archive", "--format=tar", revision, ...fixed.selected], { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
  const tarPath = join(temporary, "inputs.tar");
  writeFileSync(tarPath, tar);
  execFileSync("tar", ["-xf", tarPath, "-C", temporary]);
  assert.equal(sha256(tar), fixed.archiveSha256);
  const independentNames = [...baseline.independent.map(({ path }) => path.split("/").at(-1)), "closure-seven-fs-tsconfig.json"];
  const testDirectory = join(temporary, "tests/fs/mount-identity-review");
  mkdirSync(testDirectory, { recursive: true });
  for (const name of independentNames) copyFileSync(join(owned, name), join(testDirectory, name));
  symlinkSync(join(repository, "node_modules"), join(temporary, "node_modules"), "dir");
  const files = fixed.selected.filter((path) => path.startsWith("tests/fs/real/") && path.endsWith(".test.ts"));
  const real = command("real94-short-owned-tmp", ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", ...files]);
  const types = command("seven-fs-noEmit", ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "tests/fs/mount-identity-review/closure-seven-fs-tsconfig.json"]);
  const before = fixed.manifest;
  const after = before.map(({ path }) => ({ path, sha256: sha256(readFileSync(join(temporary, path))) }));
  assert.deepEqual(after, before.map(({ path, sha256 }) => ({ path, sha256 })));
  const old = JSON.parse(readFileSync(join(owned, `evidence/${label}/fs-real.json`)));
  const failingSocket = old.stdout.match(/address already in use (.*\/root\/socket)/)?.[1];
  result = { revision, archiveSha256: sha256(tar), originalRun: "fs-real.json", originalCounts: old.summary, originalError: "EADDRINUSE before product assertions in server.listen", originalSocketPath: failingSocket, originalSocketPathBytes: failingSocket ? Buffer.byteLength(failingSocket) : null,
    correctedTmpdir: owned, resultingSocketPathBytes: Buffer.byteLength(join(owned, "virtual-bash-real-XXXXXX/root/socket")), onlyEnvironmentChanged: true, testFixturesUnchanged: true,
    real, types, sourceHashesStable: true, realFixtureHashes: fixed.manifest.filter(({ path }) => path.startsWith("tests/fs/real/")),
    newConfigSha256: sha256(readFileSync(join(owned, "closure-seven-fs-tsconfig.json"))), independentHashes: independentNames.map((name) => ({ name, sha256: sha256(readFileSync(join(owned, name))) })),
    newNativeFixtureEntriesAfterRun: readdirSync(owned).filter((name) => !originalOwnedEntries.includes(name) && name.startsWith("virtual-bash-real-")),
  };
  assert.deepEqual(result.newNativeFixtureEntriesAfterRun, []);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
const text = JSON.stringify(result, null, 2);
execFileSync("apply_patch", [], { cwd: repository, input: `*** Begin Patch\n*** Add File: ${relative(repository, output)}\n${text.split("\n").map((line) => `+${line}`).join("\n")}\n*** End Patch\n`, maxBuffer: 1024 * 1024 });
console.log(JSON.stringify({ real: result.real.summary, realExit: result.real.exit, typesExit: result.types.exit, types: result.types.stdout, originalSocketPathBytes: result.originalSocketPathBytes, correctedSocketPathBytes: result.resultingSocketPathBytes }, null, 2));
process.exitCode = result.real.exit || result.types.exit || 0;
