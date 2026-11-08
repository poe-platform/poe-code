import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repository = process.cwd();
const revision = "0d29f4d5e90cebc6976a51ddbeba883288126aa0";
const directory = mkdtempSync(join(tmpdir(), "safe-s3-http-independent-"));
const source = join(directory, "source"), consumer = join(directory, "consumer");
mkdirSync(source); mkdirSync(join(consumer, "node_modules/virtual-bash"), { recursive: true });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const archive = join(directory, "source.tar");
execFileSync("git", ["archive", "-o", archive, revision, "src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "tests/fs/s3/http"], { cwd: repository });
execFileSync("tar", ["-xf", archive, "-C", source]);
symlinkSync(join(repository, "node_modules"), join(source, "node_modules"), "dir");
const overlay = process.argv[2] ? execFileSync("git", ["rev-parse", process.argv[2]], { cwd: repository, encoding: "utf8" }).trim() : undefined;
if (overlay) {
  const patch = join(directory, "http-overlay.tar");
  execFileSync("git", ["archive", "-o", patch, overlay, "src/fs/s3/http"], { cwd: repository });
  execFileSync("tar", ["-xf", patch, "-C", source]);
}
cpSync(join(repository, "tests/fs/s3/http-independent"), join(source, "tests/fs/s3/http-independent"), { recursive: true, filter: path => !path.split("/").includes("evidence") });
function manifest(prefix) {
  const entries = {};
  for (const entry of readdirSync(join(source, prefix), { withFileTypes: true })) {
    const path = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(entries, manifest(path));
    else entries[path] = hash(readFileSync(join(source, path)));
  }
  return entries;
}
const sourceHashes = manifest("src"), authorHashes = manifest("tests/fs/s3/http/unit");
const phases = [];
function run(label, executable, args, cwd = source) {
  const result = spawnSync(executable, args, { cwd, encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  const phase = { label, executable, args, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr };
  phases.push(phase);
  writeFileSync(join(directory, "prepare.json"), JSON.stringify({ revision, overlay, directory, source, consumer, sourceHashes, authorHashes, phases }, null, 2));
  assert.equal(result.status, 0, `${label}: ${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
run("unchanged-author-unit", process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--test", ...Object.keys(authorHashes).filter(path => path.endsWith(".test.ts"))]);
run("isolated-production-build", process.execPath, [join(repository, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json"]);
const packed = JSON.parse(run("pack-actual-manifest", "npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", directory]));
const tarball = join(directory, packed[0].filename);
execFileSync("tar", ["-xf", tarball, "-C", join(consumer, "node_modules/virtual-bash"), "--strip-components=1"]);
writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "independent-s3-consumer", type: "module", private: true }));
cpSync(join(source, "tests/fs/s3/http/author/public-consumer.mts"), join(consumer, "public-consumer.mts"));
run("unchanged-public-consumer-types", process.execPath, [join(repository, "node_modules/typescript/bin/tsc"), "--target", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--skipLibCheck", "--types", "node", "--typeRoots", join(repository, "node_modules/@types"), "public-consumer.mts"], consumer);
run("packed-root-and-subpath-smoke", process.execPath, ["--input-type=module", "-e", "import assert from 'node:assert/strict';import{createS3HttpTransport as root}from'virtual-bash';import{createS3HttpTransport as sub}from'virtual-bash/fs/s3/http';assert.equal(root,sub);console.log('same factory, actual package root and HTTP subpath');"], consumer);
assert.deepEqual(manifest("src"), sourceHashes);
const result = { revision, overlay, directory, source, consumer, sourceHashes, authorHashes, phases, archiveSha256: hash(readFileSync(archive)), packageSha256: hash(readFileSync(tarball)), node: process.version, nodeSha256: hash(readFileSync(process.execPath)), lockSha256: hash(readFileSync(join(source, "package-lock.json"))), httpSha256: sourceHashes["src/fs/s3/http/transport.ts"], serviceLock: JSON.parse(readFileSync(join(source, "tests/fs/s3/http/interop/service.lock.json"), "utf8")) };
writeFileSync(join(directory, "prepare.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ directory, source, consumer, phases: phases.map(({ label, status }) => ({ label, status })) }, null, 2));
