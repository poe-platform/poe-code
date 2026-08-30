import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../../../..");
assert.equal(process.cwd(), root);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const baselineBytes = await readFile(join(directory, "baseline.json"));
const baseline = JSON.parse(baselineBytes);
const raw = baseline.observations.find(record => record.kind === "raw-archive");
const original = Buffer.from(raw.archiveBase64, "base64");
assert.equal(hash(original), raw.archiveSha256);
const changed = Buffer.from(original);
const headerOffset = raw.linkHeaderOffset;
assert.equal(headerOffset, 1024);
assert.equal(original[headerOffset + 156], 0x32);
assert.ok(original.subarray(headerOffset + 157, headerOffset + 257).every(byte => byte === 0));
changed.write("PaxLink", headerOffset + 157, "ascii");
changed.fill(32, headerOffset + 148, headerOffset + 156);
const checksum = changed.subarray(headerOffset, headerOffset + 512).reduce((sum, byte) => sum + byte, 0);
changed.write(`${checksum.toString(8).padStart(6, "0")}\0 `, headerOffset + 148, "ascii");
const changedOffsets = [];
for (let offset = 0; offset < original.length; offset++) {
  if (original[offset] !== changed[offset]) changedOffsets.push(offset);
}
assert.ok(changedOffsets.every(offset => (offset >= headerOffset + 148 && offset < headerOffset + 156) || (offset >= headerOffset + 157 && offset < headerOffset + 257)));
assert.deepEqual(changed.subarray(0, headerOffset), original.subarray(0, headerOffset));
const target = `cross-${"x".repeat(116)}.bin`;
const payload = Buffer.from("independent long-link target\n");
const temporary = await mkdtemp(join(directory, ".native-control-"));
const observations = [];
try {
  for (const consumer of baseline.observations.filter(record => record.kind === "native")) {
    assert.equal(hash(await readFile(consumer.binary)), consumer.sha256);
    for (const [variant, plain] of [["original-empty", original], ["header-only-PaxLink", changed]]) {
      for (const gzip of [false, true]) {
        const output = join(temporary, String(observations.length));
        await mkdir(output);
        await writeFile(join(output, target), payload);
        const bytes = gzip ? gzipSync(plain) : plain;
        const archive = join(temporary, `${observations.length}.tar${gzip ? ".gz" : ""}`);
        await writeFile(archive, bytes);
        const run = args => {
          const result = spawnSync(consumer.binary, args, { encoding: "utf8", env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" }, timeout: 10_000, maxBuffer: 1024 * 1024 });
          assert.ifError(result.error);
          return { args, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr };
        };
        const listing = run([gzip ? "-tzf" : "-tf", archive]);
        const extraction = run([gzip ? "-xzf" : "-xf", archive, "-C", output]);
        const stat = await lstat(join(output, "symbol"));
        const observation = {
          consumer: consumer.consumer, binary: consumer.binary, binarySha256: consumer.sha256,
          variant, format: gzip ? "gzip" : "plain", archiveSha256: hash(bytes), listing, extraction,
          type: stat.isSymbolicLink() ? "symlink" : stat.isFile() ? "regular" : "other", size: stat.size,
          target: stat.isSymbolicLink() ? await readlink(join(output, "symbol")) : null,
          throughLinkBase64: (await readFile(join(output, "symbol"))).toString("base64"),
          seededTargetBase64: (await readFile(join(output, target))).toString("base64"),
        };
        observations.push(observation);
        assert.equal(listing.status, 0);
        assert.equal(listing.stdout, "symbol\n");
        assert.equal(extraction.status, 0);
        const originalBsd = consumer.consumer === "BSD 3.5.3" && variant === "original-empty";
        assert.equal(observation.type, originalBsd ? "regular" : "symlink");
        assert.equal(observation.target, originalBsd ? null : target);
        assert.equal(observation.throughLinkBase64, originalBsd ? "" : payload.toString("base64"));
        assert.equal(observation.seededTargetBase64, payload.toString("base64"));
      }
    }
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
const report = {
  classification: "Causal raw-header intervention, not eight successful product cases: two original BSD failures are intentionally preserved as observations.",
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  baselineReportSha256: hash(baselineBytes), originalSha256: hash(original), changedSha256: hash(changed),
  changedArchiveBase64: changed.toString("base64"), changedHeaderBase64: changed.subarray(headerOffset, headerOffset + 512).toString("base64"),
  changedOffsets, observations,
};
console.log(JSON.stringify(report, null, 2));
