import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const candidate = process.argv[2];
assert.match(candidate ?? "", /^[a-f0-9]{40}$/u);
const native = "/tmp/safe-bash-gnu-strings-20260827-YJqPHf/build-system-zlib/binutils/strings";
const nativeHash = "90b9c9257095110594ae58a4bb1531d9670bd6aed297b8dbf0dc01914c5de09f";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(hash(readFileSync(native)), nativeHash);
const output = realpathSync(mkdtempSync("/tmp/strings-binding-author-"));
const tree = join(output, "tree");
const staged = join(output, "strings");
const receipt = {
  candidate, output, started: new Date().toISOString(),
  profile: "Author-only scoped GNU Binutils 2.44 on Darwin; not independent review or a full gate",
  node: { executable: process.execPath, version: process.version, sha256: hash(readFileSync(process.execPath)), platform: process.platform, arch: process.arch },
  native: { original: native, staged, sha256: nativeHash, stagedMode: "0700", argv0: native },
  runnerSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
  commands: [],
};

function run(label, executable, args, cwd = repository, env = process.env) {
  const result = spawnSync(executable, args, { cwd, env, timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(join(output, `${label}.stdout.log`), result.stdout ?? Buffer.alloc(0));
  writeFileSync(join(output, `${label}.stderr.log`), result.stderr ?? Buffer.alloc(0));
  let reaped = false;
  if (result.pid) {
    try { process.kill(result.pid, 0); } catch (error) { if (error.code === "ESRCH") reaped = true; else throw error; }
  }
  receipt.commands.push({ label, executable, args, cwd, status: result.status, signal: result.signal, pid: result.pid, reaped, stdoutSha256: hash(result.stdout ?? ""), stderrSha256: hash(result.stderr ?? "") });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${label}: ${result.stderr?.toString()}`);
  assert.equal(result.signal, null);
  assert.equal(reaped, true);
  return result.stdout;
}

function snapshot(directory, prefix = "") {
  return readdirSync(directory).sort().flatMap(name => {
    const relative = prefix ? `${prefix}/${name}` : name;
    const absolute = join(directory, name);
    const stat = lstatSync(absolute);
    const entry = { path: relative, mode: stat.mode & 0o7777 };
    if (stat.isSymbolicLink()) return [{ ...entry, symlink: readlinkSync(absolute) }];
    if (stat.isDirectory()) return [{ ...entry, directory: true }, ...snapshot(absolute, relative)];
    assert.ok(stat.isFile());
    return [{ ...entry, bytes: stat.size, sha256: hash(readFileSync(absolute)) }];
  });
}

try {
  mkdirSync(tree);
  const archive = run("archive", "git", ["archive", candidate, "src", "tests/commands/stream-inspection", "tests/commands/stream-inspection-stress/argv0-binding-author/binding.test.ts", "package.json"]);
  receipt.archiveSha256 = hash(archive);
  run("extract", "/usr/bin/tar", ["-xf", join(output, "archive.stdout.log"), "-C", tree]);
  symlinkSync(join(repository, "node_modules"), join(tree, "node_modules"));
  copyFileSync(native, staged);
  chmodSync(staged, 0o700);
  assert.equal(hash(readFileSync(staged)), nativeHash);
  receipt.native.version = run("native-version", staged, ["--version"], tree, { LC_ALL: "C", PATH: "/usr/bin:/bin" }).toString();
  assert.ok(receipt.native.version.startsWith("GNU strings (GNU Binutils) 2.44"));
  receipt.host = run("host", "/usr/bin/sw_vers", []).toString();
  receipt.dependencies = Object.fromEntries(["tsx", "typescript", "@types/node"].map(name => {
    const bytes = readFileSync(join(repository, "node_modules", name, "package.json"));
    return [name, { version: JSON.parse(bytes).version, packageJsonSha256: hash(bytes) }];
  }));
  const before = snapshot(tree);
  writeFileSync(join(output, "inputs.before.json"), JSON.stringify(before, null, 2) + "\n");
  const env = { ...process.env, TSX_DISABLE_CACHE: "1", STREAM_NATIVE_LIVE: "1", STREAM_GNU_STRINGS: staged };
  receipt.testEnvironment = { TSX_DISABLE_CACHE: "1", STREAM_NATIVE_LIVE: "1", STREAM_GNU_STRINGS: staged };
  run("canonical-and-regressions", process.execPath, ["--import", "tsx", "--test", "tests/commands/stream-inspection/gnu-strings.test.ts", "tests/commands/stream-inspection-stress/argv0-binding-author/binding.test.ts"], tree, env);
  run("scoped-typecheck", process.execPath, [join(repository, "node_modules/typescript/bin/tsc"), "--noEmit", "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--forceConsistentCasingInFileNames", "--skipLibCheck", "--types", "node", "tests/commands/stream-inspection/oracle.ts", "tests/commands/stream-inspection/gnu-strings-oracle.ts", "tests/commands/stream-inspection-stress/argv0-binding-author/binding.test.ts"], tree, env);
  const after = snapshot(tree);
  writeFileSync(join(output, "inputs.after.json"), JSON.stringify(after, null, 2) + "\n");
  assert.deepEqual(after, before);
  receipt.integrity = { entries: before.length, detectsNewEntries: true, beforeSha256: hash(JSON.stringify(before)), afterSha256: hash(JSON.stringify(after)), dependencySymlinkTraversed: false };
  assert.equal(hash(readFileSync(native)), nativeHash);
  assert.equal(hash(readFileSync(staged)), nativeHash);
  assert.equal(hash(readFileSync(join(output, "archive.stdout.log"))), receipt.archiveSha256);
  receipt.success = true;
} finally {
  rmSync(tree, { recursive: true, force: true });
  rmSync(staged, { force: true });
  receipt.finished = new Date().toISOString();
  receipt.cleanup = { removedIsolatedTree: true, removedStagedBinary: true, synchronousCommandsOnly: true };
  writeFileSync(join(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  process.stdout.write(`${output}\n`);
}
