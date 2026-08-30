import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const repository = resolve(owned, "../../../../..");
const accepted = join(owned, "evidence-bDQayH");
const provenance = JSON.parse(readFileSync(join(accepted, "provenance.json")));
const packageRecord = JSON.parse(readFileSync(join(accepted, "package.json")));
const resolution = JSON.parse(readFileSync(join(accepted, "public-resolution.json")));
const scratch = mkdtempSync(join(owned, ".package-audit-"));
const archive = join(scratch, "source");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const record = { authorOnly: true, purpose: "offline byte-identical tarball reproduction and inside-consumer module hashes", head: provenance.head,
  serviceRuns: 0, binaryDownloads: 0, node: process.version, commands: [], originalRuntimeResolution: resolution };
const execute = (name, command, args, cwd = archive) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 180000, maxBuffer: 24 * 1024 * 1024,
    env: { ...process.env, TMPDIR: scratch, npm_config_cache: join(scratch, "npm-cache"), TSX_DISABLE_CACHE: "1" } });
  record.commands.push({ name, command, args, status: result.status, stdout: result.stdout, stderr: result.stderr });
  assert.equal(result.status, 0, result.stderr);
  return result;
};
try {
  mkdirSync(archive);
  for (const input of provenance.inputs.filter(input => input.path.startsWith("src/") || ["package.json", "tsconfig.json", "tsconfig.build.json"].includes(input.path))) {
    const content = execFileSync("git", ["show", `${provenance.head}:${input.path}`], { cwd: repository, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(hash(content), input.sha256);
    const destination = join(archive, input.path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
  symlinkSync(join(repository, "node_modules"), join(archive, "node_modules"));
  execute("build", process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"]);
  const packed = execute("pack", "npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", scratch]);
  const tarball = join(scratch, JSON.parse(packed.stdout)[0].filename);
  record.reproducedTarballSha256 = hash(readFileSync(tarball));
  assert.equal(record.reproducedTarballSha256, packageRecord.tarballSha256);
  const consumer = join(scratch, "consumer"), packageRoot = join(consumer, "node_modules/virtual-bash");
  mkdirSync(packageRoot, { recursive: true });
  execute("unpack", "tar", ["-xzf", tarball, "--strip-components=1", "-C", packageRoot]);
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "safe-bash-offline-packed-consumer", private: true, type: "module" }) + "\n");
  const probe = `import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createS3HttpTransport as rootFactory } from "virtual-bash";
import { S3FileSystem, MockS3Client } from "virtual-bash/fs/s3";
import { createS3HttpTransport } from "virtual-bash/fs/s3/http";
assert.equal(rootFactory, createS3HttpTransport);
const urls = { root: import.meta.resolve("virtual-bash"), s3: import.meta.resolve("virtual-bash/fs/s3"), http: import.meta.resolve("virtual-bash/fs/s3/http") };
urls.implementation = new URL("./filesystem.js", urls.s3).href;
const filesystem = new S3FileSystem({ transport: new MockS3Client({ buckets: ["offline"] }), bucket: "offline" });
assert.equal(filesystem.capabilities.snapshotRmdir, true);
console.log(JSON.stringify({ modules: Object.entries(urls).map(([name, url]) => ({ name, url, sha256: createHash("sha256").update(readFileSync(new URL(url))).digest("hex") })), capability: filesystem.capabilities.snapshotRmdir, providerRequests: 0 }));
`;
  writeFileSync(join(consumer, "probe.mjs"), probe);
  record.insideConsumerProbe = probe;
  const checked = execute("inside-consumer-module-hashes", process.execPath, [join(consumer, "probe.mjs")], consumer);
  record.insideConsumer = JSON.parse(checked.stdout);
  const relativeFiles = { root: "dist/index.js", s3: "dist/fs/s3/index.js", http: "dist/fs/s3/http/index.js", implementation: "dist/fs/s3/filesystem.js" };
  for (const module of record.insideConsumer.modules) {
    const relative = relativeFiles[module.name];
    assert.equal(module.url, pathToFileURL(join(packageRoot, relative)).href);
    assert.equal(module.sha256, hash(readFileSync(join(archive, relative))));
    if (module.name === "implementation") assert.equal(module.sha256, resolution.packedS3Sha256);
  }
  record.success = true;
} finally {
  rmSync(scratch, { recursive: true, force: true });
  record.ownedScratchRemoved = !existsSync(scratch);
  const text = JSON.stringify(record, null, 2);
  execFileSync("apply_patch", [], { cwd: repository,
    input: `*** Begin Patch\n*** Add File: tests/fs/s3/rmdir-real-service/snapshot-profile/package-proof.json\n${text.split("\n").map(line => "+" + line).join("\n")}\n*** End Patch\n`, maxBuffer: 1024 * 1024 });
}
console.log(record.reproducedTarballSha256, record.success);
