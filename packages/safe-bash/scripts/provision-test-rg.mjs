import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { release } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const fingerprint = stat => [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs ?? stat.mtimeMs, stat.ctimeNs ?? stat.ctimeMs].join(":");
const directoryIdentity = stat => [stat.dev, stat.ino, stat.mode, stat.uid].join(":");

function readBounded(fileSystem, path, expectedSize) {
  const before = fileSystem.lstatSync(path, { bigint: true });
  assert(before.isFile() && !before.isSymbolicLink());
  assert.equal(before.size, BigInt(expectedSize));
  assert.equal(fileSystem.realpathSync(path), path);
  const descriptor = fileSystem.openSync(path, fileSystem.constants.O_RDONLY | fileSystem.constants.O_NOFOLLOW);
  try {
    assert.equal(fingerprint(fileSystem.fstatSync(descriptor, { bigint: true })), fingerprint(before));
    const bytes = Buffer.alloc(expectedSize + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = fileSystem.readSync(descriptor, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    assert.equal(length, expectedSize);
    assert.equal(fingerprint(fileSystem.fstatSync(descriptor, { bigint: true })), fingerprint(before));
    assert.equal(fingerprint(fileSystem.lstatSync(path, { bigint: true })), fingerprint(before));
    return bytes.subarray(0, length);
  } finally { fileSystem.closeSync(descriptor); }
}

export function loadLinuxRgProfile() {
  const path = fileURLToPath(new URL("../tests/commands/search/native-tool-profile.json", import.meta.url));
  const bytes = readBounded(fs, path, 2423);
  assert.equal(sha256(bytes), "4d2066640d6215035e4be1cb52d2d400e51495e17c31a7799b6be106aee5f99b", "frozen Linux rg metadata changed");
  return JSON.parse(bytes.toString("utf8"));
}

function snapshotProfile(profile) {
  const snapshot = {
    id: profile.id, platform: profile.platform, arch: profile.arch, version: profile.version,
    archive: { url: profile.archive.url, prefix: profile.archive.prefix, size: profile.archive.size, sha256: profile.archive.sha256 },
    executable: { member: profile.executable.member, size: profile.executable.size, sha256: profile.executable.sha256, mode: profile.executable.mode },
    qualification: { status: profile.qualification.status },
  };
  assert.equal(snapshot.platform, "linux"); assert.equal(snapshot.arch, "x64"); assert.equal(snapshot.version, "15.2.0");
  assert(typeof snapshot.id === "string" && snapshot.id.length > 0 && snapshot.id.length <= 256);
  assert(Number.isSafeInteger(snapshot.archive.size) && snapshot.archive.size > 0 && snapshot.archive.size <= 4 * 1024 * 1024);
  assert(Number.isSafeInteger(snapshot.executable.size) && snapshot.executable.size > 0 && snapshot.executable.size <= 8 * 1024 * 1024);
  for (const hash of [snapshot.archive.sha256, snapshot.executable.sha256]) assert.match(hash, /^[a-f0-9]{64}$/u);
  assert.match(snapshot.archive.prefix, /^[a-zA-Z0-9._-]+$/u);
  assert(![".", ".."].includes(snapshot.archive.prefix));
  assert.equal(snapshot.executable.member, snapshot.archive.prefix + "/rg");
  assert.equal(snapshot.executable.mode, "0755");
  assert.equal(snapshot.qualification.status, "PENDING_LINUX_EXECUTION");
  return snapshot;
}

function admittedUrl(value, initial = false) {
  const url = new URL(value);
  assert.equal(url.protocol, "https:");
  assert.equal(url.username, ""); assert.equal(url.password, ""); assert.equal(url.port, ""); assert.equal(url.hash, "");
  const hosts = initial ? ["github.com"] : ["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"];
  assert(hosts.includes(url.hostname), "rg download redirect host not admitted");
  if (url.hostname === "github.com") assert(url.pathname.startsWith("/BurntSushi/ripgrep/releases/download/15.2.0/"));
  return url;
}

export async function fetchRgArchive(inputProfile, fetcher = fetch, timeoutMs = 30000) {
  const profile = snapshotProfile(inputProfile);
  assert(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30000);
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("rg download deadline exceeded")); }, timeoutMs);
  });
  let reader;
  try {
    let url = admittedUrl(profile.archive.url, true);
    for (let redirects = 0; redirects <= 3; redirects++) {
      const response = await Promise.race([fetcher(url.href, { redirect: "manual", signal: controller.signal }), deadline]);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        void response.body?.cancel().catch(() => {});
        assert(redirects < 3, "rg redirect limit exceeded");
        const location = response.headers.get("location");
        assert(location, "rg redirect lacks location");
        url = admittedUrl(new URL(location, url).href);
        continue;
      }
      assert.equal(response.status, 200, "rg archive fetch failed");
      const length = response.headers.get("content-length");
      if (length !== null) assert.equal(length, String(profile.archive.size), "rg archive content length mismatch");
      assert(response.body, "rg archive response lacks body");
      reader = response.body.getReader();
      const chunks = [];
      let total = 0; let reads = 0;
      for (;;) {
        assert(++reads <= 16384, "rg archive chunk-read limit exceeded");
        const chunk = await Promise.race([reader.read(), deadline]);
        if (chunk.done) break;
        total += chunk.value.byteLength;
        assert(total <= profile.archive.size, "rg archive response exceeds bound");
        chunks.push(Buffer.from(chunk.value));
      }
      assert.equal(total, profile.archive.size, "rg archive response size mismatch");
      const bytes = Buffer.concat(chunks, total);
      assert.equal(sha256(bytes), profile.archive.sha256, "rg archive SHA-256 mismatch");
      return bytes;
    }
    throw new Error("rg archive redirect limit exceeded");
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
  }
}

function tarText(bytes) {
  const end = bytes.indexOf(0);
  if (end >= 0) assert(bytes.subarray(end).every(byte => byte === 0), "invalid tar string padding");
  return new TextDecoder("utf-8", { fatal: true }).decode(end < 0 ? bytes : bytes.subarray(0, end));
}

function tarOctal(bytes) {
  const value = bytes.toString("ascii").replaceAll("\0", "").trim();
  assert.match(value, /^[0-7]+$/u, "unsupported tar numeric field");
  const number = Number.parseInt(value, 8);
  assert(Number.isSafeInteger(number));
  return number;
}

export function extractRgArchive(archive, inputProfile) {
  const profile = snapshotProfile(inputProfile);
  assert(Buffer.isBuffer(archive));
  assert.equal(archive.length, profile.archive.size, "rg archive size mismatch");
  assert.equal(sha256(archive), profile.archive.sha256, "rg archive SHA-256 mismatch before decompression");
  const tar = gunzipSync(archive, { maxOutputLength: 16 * 1024 * 1024 });
  assert.equal(tar.length % 512, 0, "truncated tar block");
  let offset = 0; let members = 0; let executable; let ended = false;
  const names = new Set();
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      assert(offset + 1024 <= tar.length && tar.subarray(offset).every(byte => byte === 0), "invalid tar terminator");
      ended = true;
      break;
    }
    assert(++members <= 256, "rg archive member limit exceeded");
    let checksum = 0;
    for (let index = 0; index < 512; index++) checksum += index >= 148 && index < 156 ? 32 : header[index];
    assert.equal(tarOctal(header.subarray(148, 156)), checksum, "tar header checksum mismatch");
    const magic = header.subarray(257, 263).toString("ascii");
    assert(magic === "ustar\0" || magic === "ustar ", "unsupported tar format");
    const prefix = tarText(header.subarray(345, 500));
    const rawName = (prefix ? prefix + "/" : "") + tarText(header.subarray(0, 100));
    const type = header[156];
    assert([0, 48, 53].includes(type), "tar links, extended metadata and special files are forbidden");
    const name = type === 53 && rawName.endsWith("/") ? rawName.slice(0, -1) : rawName;
    assert(!name.includes("\\") && !name.startsWith("/"));
    assert(name.split("/").every(part => part.length > 0 && part !== "." && part !== ".."), "tar path traversal");
    assert(name === profile.archive.prefix || name.startsWith(profile.archive.prefix + "/"), "tar path outside required prefix");
    assert(!names.has(name.toLowerCase()), "duplicate tar member"); names.add(name.toLowerCase());
    const size = tarOctal(header.subarray(124, 136));
    const mode = tarOctal(header.subarray(100, 108));
    assert(size <= 16 * 1024 * 1024 && offset + 512 + size <= tar.length, "tar member exceeds archive bound");
    if (type === 53) assert.equal(size, 0, "tar directory has payload");
    const end = offset + 512 + Math.ceil(size / 512) * 512;
    assert(end <= tar.length && tar.subarray(offset + 512 + size, end).every(byte => byte === 0), "invalid tar member padding");
    if (name === profile.executable.member) {
      assert(type === 0 || type === 48, "rg member must be a regular file");
      assert.equal(size, profile.executable.size); assert.equal(mode, 0o755);
      const bytes = tar.subarray(offset + 512, offset + 512 + size);
      assert.equal(sha256(bytes), profile.executable.sha256, "rg executable SHA-256 mismatch");
      executable = Buffer.from(bytes);
    }
    offset = end;
  }
  assert(ended && executable, "rg archive lacks terminator or required executable");
  return executable;
}

export async function provisionRg({ destination, profile: inputProfile = loadLinuxRgProfile(), fileSystem = fs, fetcher = fetch, host = { platform: process.platform, arch: process.arch, release: release() } }) {
  const profile = snapshotProfile(inputProfile);
  const actualHost = { platform: host.platform, arch: host.arch, release: host.release ?? null };
  assert.equal(actualHost.platform, profile.platform, "required Linux rg provisioning host mismatch");
  assert.equal(actualHost.arch, profile.arch, "required Linux rg provisioning architecture mismatch");
  assert(actualHost.release === null || (typeof actualHost.release === "string" && actualHost.release.length > 0 && !actualHost.release.includes("\0")));
  assert(typeof destination === "string" && isAbsolute(destination) && resolve(destination) === destination && !destination.includes("\0"), "destination must be canonical absolute path");
  const parent = dirname(destination);
  assert.equal(fileSystem.realpathSync(parent), parent, "destination parent must be canonical and nonsymlink");
  const parentStat = fileSystem.lstatSync(parent, { bigint: true });
  assert(parentStat.isDirectory() && !parentStat.isSymbolicLink());
  assert.equal(parentStat.mode & 0o022n, 0n, "destination parent must not be group/world writable");
  if (process.getuid) assert.equal(parentStat.uid, BigInt(process.getuid()), "destination parent must be job-owned");
  fileSystem.mkdirSync(destination, { mode: 0o700 });
  const owned = fileSystem.lstatSync(destination, { bigint: true });
  const assertOwned = () => {
    assert.equal(fileSystem.realpathSync(parent), parent);
    assert.equal(directoryIdentity(fileSystem.lstatSync(parent, { bigint: true })), directoryIdentity(parentStat), "destination parent replaced");
    const actual = fileSystem.lstatSync(destination, { bigint: true });
    assert(actual.isDirectory() && !actual.isSymbolicLink());
    assert.equal(directoryIdentity(actual), directoryIdentity(owned), "owned destination replaced");
    assert.equal(fileSystem.realpathSync(destination), destination);
  };
  try {
    assertOwned();
    const archive = await fetchRgArchive(profile, fetcher);
    const executable = extractRgArchive(archive, profile);
    assertOwned();
    const bin = join(destination, "bin");
    fileSystem.mkdirSync(bin, { mode: 0o700 });
    const binIdentity = directoryIdentity(fileSystem.lstatSync(bin, { bigint: true }));
    const writeExclusive = (path, bytes, mode) => {
      assertOwned();
      assert.equal(directoryIdentity(fileSystem.lstatSync(bin, { bigint: true })), binIdentity);
      assert.equal(fileSystem.realpathSync(bin), bin);
      const flags = fileSystem.constants;
      const descriptor = fileSystem.openSync(path, flags.O_WRONLY | flags.O_CREAT | flags.O_EXCL | flags.O_NOFOLLOW, 0o600);
      try {
        let offset = 0;
        while (offset < bytes.length) {
          const written = fileSystem.writeSync(descriptor, bytes, offset, bytes.length - offset);
          assert(written > 0); offset += written;
        }
        fileSystem.fchmodSync(descriptor, mode);
      } finally { fileSystem.closeSync(descriptor); }
    };
    const path = join(bin, "rg");
    writeExclusive(path, executable, 0o755);
    assertOwned();
    assert.equal(sha256(readBounded(fileSystem, path, profile.executable.size)), profile.executable.sha256);
    assert.equal(fileSystem.lstatSync(path, { bigint: true }).mode & 0o7777n, 0o755n);
    const receipt = {
      status: "PROVISIONED_NOT_BEHAVIORALLY_QUALIFIED", profileId: profile.id, path,
      archiveSha256: profile.archive.sha256, executableSha256: profile.executable.sha256,
      executableSize: profile.executable.size, mode: "0755", qualificationStatus: profile.qualification.status,
      observedVersion: null, host: actualHost, node: process.version,
    };
    writeExclusive(join(destination, "receipt.json"), Buffer.from(JSON.stringify(receipt, null, 2) + "\n"), 0o600);
    assertOwned();
    return receipt;
  } catch (error) {
    try { assertOwned(); fileSystem.rmSync(destination, { recursive: true }); }
    catch (cleanup) { throw new AggregateError([error, cleanup], "rg provisioning failed; unsafe cleanup refused"); }
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 4, "usage: node scripts/provision-test-rg.mjs --destination /absolute/absent/job-directory");
    assert.equal(process.argv[2], "--destination");
    const receipt = await provisionRg({ destination: process.argv[3] });
    process.stdout.write(JSON.stringify(receipt) + "\n");
  } catch (error) {
    process.stderr.write(`rg provisioning failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
