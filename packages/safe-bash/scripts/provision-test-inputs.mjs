import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import { release } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const MAX_DOWNLOAD = 16 * 1024 * 1024;
const MAX_INFLATED = 128 * 1024 * 1024;
const MAX_MEMBER = 8 * 1024 * 1024;
const RG_PROFILE_SHA256 = "4d2066640d6215035e4be1cb52d2d400e51495e17c31a7799b6be106aee5f99b";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const shaPattern = /^[a-f0-9]{64}$/u;
const sourceMembers = [
  ["src/chmod.c", 18743, "9344f0799f8c50a10984d5cd708a6be41169b77bfd703f2640238618ccc51393"],
  ["src/stat.c", 57957, "32c77c3620837a73dc0ed72dc7ee874f8e52946c8c8c2c4b2255e4f41bea6bad"],
  ["src/mktemp.c", 10194, "176f2db23caa6cde6086d669d905d2c6ab0ba229e88f73aa853db76f2fa14113"],
  ["lib/modechange.c", 13085, "13bfe2cf140bc85b2630c3a2a6d1a9f6ae3e53f58c82e6976abd9a51aac723db"],
  ["src/comm.c", 14595, "3517b5f9e88bbb67ce93e3075811d0856647104ca83c40001f7fa2dcf07c7336"],
  ["doc/coreutils.texi", 667701, "39b126752866fff675e462bd44d76f3e034abafe462a069cebd53ef39fc53eca"],
];

export const COREUTILS_INPUT = Object.freeze({
  url: "https://ftp.gnu.org/gnu/coreutils/coreutils-9.7.tar.xz",
  size: 6158960,
  sha256: "e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf",
  archiveName: "coreutils-9.7.tar.xz",
  prefix: "coreutils-9.7",
  format: "xz",
  members: Object.freeze(sourceMembers.map(([name, size, sha256]) => Object.freeze({ path: `coreutils-9.7/${name}`, output: `coreutils-9.7/${name}`, size, sha256, mode: 0o644 }))),
});

export const COREUTILS_GZIP_INPUT = Object.freeze({
  ...COREUTILS_INPUT,
  url: "https://ftp.gnu.org/gnu/coreutils/coreutils-9.7.tar.gz",
  size: 15107617,
  sha256: "0898a90191c828e337d5e4e4feb71f8ebb75aacac32c434daf5424cda16acb42",
  archiveName: "coreutils-9.7.tar.gz",
  format: "gzip",
});

function pin(input, maximum = MAX_DOWNLOAD) {
  assert(Number.isSafeInteger(input.size) && input.size > 0 && input.size <= maximum, "invalid bounded size pin");
  assert(typeof input.sha256 === "string" && shaPattern.test(input.sha256), "invalid SHA-256 pin");
}

function relativePath(name) {
  assert(typeof name === "string" && name.length > 0 && !name.includes("\\") && !name.includes("\0"), "unsafe member path");
  assert(!name.startsWith("/") && !name.includes(":"), "absolute member path");
  assert(name.split("/").every(part => part !== "" && part !== "." && part !== ".."), "member path traversal");
  return name;
}

function allowedUrl(value) {
  const url = new URL(value);
  assert.equal(url.protocol, "https:", "HTTPS required");
  assert.equal(url.username + url.password + url.port + url.hash, "", "credentials, ports and fragments forbidden");
  assert(["ftp.gnu.org", "github.com", "release-assets.githubusercontent.com"].includes(url.hostname), "unapproved download origin");
  return url.href;
}

export async function fetchVerified(input, dependencies = {}) {
  pin(input);
  const fetcher = dependencies.fetch ?? fetch;
  const signal = dependencies.signal ? AbortSignal.any([dependencies.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
  let url = allowedUrl(input.url);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetcher(url, { redirect: "manual", signal, headers: { "Accept-Encoding": "identity" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      assert(redirects < 3, "redirect limit");
      assert(response.headers.has("location"), "missing redirect location");
      url = allowedUrl(new URL(response.headers.get("location"), url).href);
      continue;
    }
    try {
      assert.equal(response.status, 200, "download HTTP status");
      assert([null, "identity"].includes(response.headers.get("content-encoding")), "encoded response forbidden");
      if (response.headers.has("content-length")) assert.equal(response.headers.get("content-length"), String(input.size), "advertised download size mismatch");
    } catch (error) {
      await response.body?.cancel();
      throw error;
    }
    assert(response.body, "missing download body");
    const chunks = [];
    let size = 0;
    let reads = 0;
    for await (const chunk of response.body) {
      assert(++reads <= 16384, "download chunk-read limit");
      size += chunk.byteLength;
      assert(size <= input.size, "download exceeds size pin");
      chunks.push(Buffer.from(chunk));
    }
    assert.equal(size, input.size, "download truncated");
    const bytes = Buffer.concat(chunks, size);
    chunks.length = 0;
    assert.equal(digest(bytes), input.sha256, "download SHA-256 mismatch");
    return bytes;
  }
  throw new Error("redirect limit");
}

function tarText(bytes) {
  const end = bytes.indexOf(0);
  return new TextDecoder("utf-8", { fatal: true }).decode(end < 0 ? bytes : bytes.subarray(0, end));
}

function octal(bytes) {
  const text = tarText(bytes).trim();
  assert(/^[0-7]+$/u.test(text), "unsupported tar numeric encoding");
  const value = Number.parseInt(text, 8);
  assert(Number.isSafeInteger(value), "tar integer overflow");
  return value;
}

export function extractTarMembers(bytes, members, prefix) {
  assert(Buffer.isBuffer(bytes) && bytes.length <= MAX_INFLATED && bytes.length >= 1024 && bytes.length % 512 === 0, "tar size bound/alignment");
  relativePath(prefix);
  const wanted = new Map();
  const outputs = new Set();
  assert(Array.isArray(members) && members.length > 0 && members.length <= 6, "bounded member count required");
  for (const member of members) {
    pin(member, MAX_MEMBER);
    relativePath(member.path);
    relativePath(member.output);
    assert(member.path.startsWith(`${prefix}/`), "member outside archive prefix");
    assert([0o644, 0o755].includes(member.mode), "unapproved output mode");
    assert(!wanted.has(member.path) && !outputs.has(member.output), "duplicate member/output declaration");
    wanted.set(member.path, member);
    outputs.add(member.output);
  }
  const found = new Map();
  const seen = new Set();
  let offset = 0;
  let terminated = false;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(value => value === 0)) {
      assert(offset + 1024 <= bytes.length && bytes.subarray(offset).every(value => value === 0), "invalid tar terminator/trailing data");
      terminated = true;
      break;
    }
    const checksum = header.reduce((sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value), 0);
    assert.equal(octal(header.subarray(148, 156)), checksum, "tar header checksum");
    const magic = tarText(header.subarray(257, 263)).trim();
    const version = header.subarray(263, 265).toString("ascii");
    assert((magic === "ustar" && ["00", " \0"].includes(version)) || (magic === "" && header.subarray(257).every(value => value === 0)), "unsupported tar format");
    const type = header[156];
    assert([0, 48, 53].includes(type), "tar links/extensions/special files forbidden");
    const name = tarText(header.subarray(0, 100));
    const ancestor = magic === "ustar" && version === "00" ? tarText(header.subarray(345, 500)) : "";
    const raw = ancestor ? `${ancestor}/${name}` : name;
    const full = relativePath(type === 53 && raw.endsWith("/") ? raw.slice(0, -1) : raw);
    assert(full === prefix || full.startsWith(`${prefix}/`), "entry outside archive prefix");
    assert(!seen.has(full), "duplicate tar entry");
    seen.add(full);
    assert(seen.size <= 8192, "tar entry-count limit");
    const size = octal(header.subarray(124, 136));
    if (type === 53) assert.equal(size, 0, "directory with payload");
    const start = offset + 512;
    const next = start + Math.ceil(size / 512) * 512;
    assert(next <= bytes.length, "truncated tar entry");
    const member = wanted.get(full);
    if (member) {
      assert(type !== 53, "required member is not regular");
      assert.equal(size, member.size, "member size mismatch");
      const content = bytes.subarray(start, start + size);
      assert.equal(digest(content), member.sha256, "member SHA-256 mismatch");
      found.set(full, { ...member, bytes: Buffer.from(content) });
    }
    offset = next;
  }
  assert(terminated, "missing tar terminator");
  assert.equal(found.size, wanted.size, "missing required tar member");
  return members.map(member => found.get(member.path));
}

function sameIdentity(actual, expected, name) {
  assert(actual.dev === expected.dev && actual.ino === expected.ino, `changed filesystem identity: ${name}`);
}

async function directory(fileSystem, name, uid) {
  assert(isAbsolute(name) && resolve(name) === name, "canonical absolute directory required");
  const stat = await fileSystem.lstat(name);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), "real directory required");
  assert.equal(await fileSystem.realpath(name), name, "aliased directory forbidden");
  assert.equal(stat.uid, uid, "directory owner mismatch");
  assert.equal(stat.mode & 0o777, 0o700, "private 0700 directory required");
  return stat;
}

async function trustedAncestors(fileSystem, name, uid) {
  const identities = new Map();
  for (let current = dirname(name); ; current = dirname(current)) {
    const stat = await fileSystem.lstat(current);
    assert(stat.isDirectory() && !stat.isSymbolicLink(), `untrusted ancestor type: ${current}`);
    assert(stat.uid === 0 || stat.uid === uid, `untrusted ancestor owner: ${current}`);
    assert((stat.mode & 0o022) === 0 || (stat.uid === 0 && (stat.mode & 0o1000) !== 0), `untrusted ancestor permissions: ${current}`);
    identities.set(current, stat);
    if (current === dirname(current)) break;
  }
  return identities;
}

async function readVerified(fileSystem, name, expected) {
  pin(expected);
  const before = await fileSystem.lstat(name);
  assert(before.isFile() && !before.isSymbolicLink(), "regular input required");
  assert.equal(before.size, expected.size, "file size mismatch");
  if (expected.uid !== undefined) {
    assert.equal(before.uid, expected.uid, "input owner mismatch");
    assert.equal(before.nlink, 1, "multiply linked input forbidden");
    assert.equal(before.mode & 0o7777, expected.mode, "input mode mismatch");
    assert.equal(await fileSystem.realpath(name), name, "aliased input forbidden");
  }
  const handle = await fileSystem.open(name, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    sameIdentity(await handle.stat(), before, name);
    const bytes = Buffer.alloc(expected.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      assert(bytesRead > 0, "file truncated while reading");
      offset += bytesRead;
    }
    const after = await handle.stat();
    sameIdentity(after, before, name);
    sameIdentity(await fileSystem.lstat(name), before, name);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(after.ctimeMs, before.ctimeMs);
    assert.equal(after.mode, before.mode);
    assert.equal(after.uid, before.uid);
    assert.equal(after.nlink, before.nlink);
    assert.equal(digest(bytes), expected.sha256, "file SHA-256 mismatch");
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function inflateArchive(bytes, input, options) {
  const { timeoutMs = 30000, maxInflatedBytes = MAX_INFLATED } = options;
  assert(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30000, "invalid decompressor timeout");
  assert(Number.isSafeInteger(maxInflatedBytes) && maxInflatedBytes >= 512 && maxInflatedBytes <= MAX_INFLATED, "invalid inflated-size limit");
  if (input.format === "gzip") return gunzipSync(bytes, { maxOutputLength: maxInflatedBytes });
  assert.equal(input.format, "xz");
  const { xz, root, fileSystem = fs, spawn: launch = spawn } = options;
  assert(xz && isAbsolute(xz.path), "explicit authenticated existing xz binding required");
  assert.equal(await fileSystem.realpath(xz.path), xz.path, "xz path must be canonical");
  await readVerified(fileSystem, xz.path, xz);
  const tool = await fileSystem.lstat(xz.path);
  assert((tool.mode & 0o111) !== 0 && (tool.mode & 0o022) === 0, "unsafe xz mode");
  const child = launch(xz.path, ["--decompress", "--stdout", "--memlimit-decompress=128MiB"], {
    cwd: root,
    env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC", HOME: root, TMPDIR: root },
    stdio: ["pipe", "pipe", "pipe"],
  });
  return new Promise((accept, reject) => {
    const chunks = [];
    let outputBytes = 0;
    let errorBytes = 0;
    let failure;
    const fail = error => { failure ??= error; child.kill("SIGKILL"); };
    const timer = setTimeout(() => fail(new Error("xz timeout")), timeoutMs);
    child.on("error", fail);
    child.stdin.on("error", fail);
    child.stdout.on("error", fail);
    child.stderr.on("error", fail);
    child.stdout.on("data", chunk => {
      outputBytes += chunk.length;
      if (outputBytes > maxInflatedBytes) fail(new Error("xz inflated-size limit"));
      else if (!failure) chunks.push(Buffer.from(chunk));
    });
    child.stderr.on("data", chunk => { errorBytes += chunk.length; if (errorBytes > 65536) fail(new Error("xz stderr limit")); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0 || signal || errorBytes !== 0) reject(new Error(`xz failed: exit=${code} signal=${signal} stderrBytes=${errorBytes}`));
      else {
        const output = Buffer.concat(chunks, outputBytes);
        chunks.length = 0;
        accept(output);
      }
    });
    child.stdin.end(bytes);
  });
}

function snapshotArchive(input) {
  const snapshot = {
    url: input.url, size: input.size, sha256: input.sha256,
    archiveName: input.archiveName, prefix: input.prefix, format: input.format,
    members: input.members.map(member => Object.freeze({ path: member.path, output: member.output, size: member.size, sha256: member.sha256, mode: member.mode })),
  };
  pin(snapshot);
  allowedUrl(snapshot.url);
  relativePath(snapshot.archiveName);
  assert(!snapshot.archiveName.includes("/"), "archive output must be a basename");
  relativePath(snapshot.prefix);
  assert(["xz", "gzip"].includes(snapshot.format), "unsupported compression");
  assert(snapshot.members.length > 0 && snapshot.members.length <= 6, "bounded explicit member list required");
  for (const member of snapshot.members) {
    pin(member, MAX_MEMBER);
    relativePath(member.path);
    relativePath(member.output);
    assert([0o644, 0o755].includes(member.mode), "unapproved output mode");
  }
  Object.freeze(snapshot.members);
  return Object.freeze(snapshot);
}

export async function provisionInputs(options, dependencies = {}) {
  const fileSystem = dependencies.fileSystem ?? fs;
  const uid = dependencies.uid ?? process.getuid();
  const parent = options.parent;
  const suppliedMode = options.sourceMode;
  const sourceMode = suppliedMode === undefined ? "xz" : suppliedMode;
  assert(["xz", "gzip"].includes(sourceMode), "source mode must be xz or gzip");
  const suppliedInputs = options.inputs;
  assert(Array.isArray(suppliedInputs) && suppliedInputs.length > 0 && suppliedInputs.length <= 2, "one or two explicit archive inputs required");
  const inputs = suppliedInputs.map(snapshotArchive);
  const suppliedXz = options.xz;
  const xz = suppliedXz === undefined ? undefined : Object.freeze({ path: suppliedXz.path, size: suppliedXz.size, sha256: suppliedXz.sha256 });
  let gzipSource;
  if (sourceMode === "gzip") {
    assert.equal(xz, undefined, "gzip source mode forbids an xz binding");
    gzipSource = snapshotArchive(options.gzipSource ?? COREUTILS_GZIP_INPUT);
    assert.equal(inputs[0].format, "xz", "gzip source mode must retain an xz archive");
    assert.equal(gzipSource.format, "gzip");
    assert.equal(gzipSource.prefix, inputs[0].prefix, "source archive prefixes differ");
    assert.deepEqual(gzipSource.members, inputs[0].members, "source archive member pins differ");
  } else {
    assert.equal(options.gzipSource, undefined, "xz source mode forbids a gzip source override");
  }
  const parentIdentity = await directory(fileSystem, parent, uid);
  const ancestors = await trustedAncestors(fileSystem, parent, uid);
  const root = await fileSystem.mkdtemp(join(parent, "safe-bash-inputs-"));
  const directories = new Map();
  async function guard() {
    for (const [name, identity] of await trustedAncestors(fileSystem, parent, uid)) sameIdentity(identity, ancestors.get(name), name);
    sameIdentity(await directory(fileSystem, parent, uid), parentIdentity, parent);
    for (const [name, identity] of directories) sameIdentity(await directory(fileSystem, name, uid), identity, name);
  }
  async function writeOutput(name, bytes, mode) {
    relativePath(name);
    await guard();
    let current = root;
    for (const part of name.split("/").slice(0, -1)) {
      current = join(current, part);
      if (!directories.has(current)) {
        await fileSystem.mkdir(current, { mode: 0o700 });
        directories.set(current, await directory(fileSystem, current, uid));
      }
      await guard();
    }
    const target = join(root, name);
    const handle = await fileSystem.open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
    try {
      const opened = await handle.stat();
      assert(opened.isFile() && opened.nlink === 1 && opened.uid === uid, "unsafe output file");
      await handle.writeFile(bytes);
      await handle.chmod(mode);
      sameIdentity(await fileSystem.lstat(target), opened, target);
    } finally {
      await handle.close();
    }
    await guard();
    const identity = { path: name, size: bytes.length, sha256: digest(bytes), mode: mode.toString(8) };
    await readVerified(fileSystem, target, identity);
    assert.equal((await fileSystem.lstat(target)).mode & 0o777, mode);
    return identity;
  }
  try {
    await fileSystem.chmod(root, 0o700);
    directories.set(root, await directory(fileSystem, root, uid));
    await guard();
    const outputs = [];
    for (const [index, input] of inputs.entries()) {
      const compressed = await fetchVerified(input, dependencies);
      outputs.push(await writeOutput(input.archiveName, compressed, 0o644));
      const source = index === 0 && gzipSource ? gzipSource : input;
      const sourceBytes = source === input ? compressed : await fetchVerified(source, dependencies);
      const expanded = await (dependencies.inflate ?? inflateArchive)(sourceBytes, source, { xz, root, fileSystem, spawn: dependencies.spawn });
      const selected = extractTarMembers(expanded, input.members, input.prefix);
      await guard();
      for (const member of selected) outputs.push(await writeOutput(member.output, member.bytes, member.mode));
    }
    const downloadedInputs = gzipSource ? [inputs[0], gzipSource, ...inputs.slice(1)] : inputs;
    const report = { schema: 1, status: "INPUTS_VERIFIED_NOT_QUALIFIED", sourceMode, root, downloadedExecutableExecution: false, nativeOracleExecution: false, extractor: xz ?? null, host: { platform: process.platform, arch: process.arch, release: release(), node: process.version }, inputs: downloadedInputs.map(({ url, size, sha256 }) => ({ url, size, sha256 })), outputs };
    await writeOutput("provision-result.json", Buffer.from(`${JSON.stringify(report, null, 2)}\n`), 0o600);
    await guard();
    return report;
  } catch (error) {
    try {
      await guard();
      await fileSystem.rm(root, { recursive: true, force: false });
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], `provision failed; cleanup refused or failed for ${root}; inspect owned root without following replacements`);
    }
    throw error;
  }
}

export async function stageMetadataInputs(options, dependencies = {}) {
  const fileSystem = dependencies.fileSystem ?? fs;
  const uid = dependencies.uid ?? process.getuid();
  const sourceRoot = options.sourceRoot;
  const packageRoot = options.packageRoot;
  const input = snapshotArchive(dependencies.coreutilsInput ?? COREUTILS_INPUT);
  assert.equal(input.archiveName, COREUTILS_INPUT.archiveName, "staging archive path is fixed");
  assert.equal(input.prefix, COREUTILS_INPUT.prefix);
  assert.equal(input.format, "xz");
  assert.deepEqual(input.members.map(member => [member.path, member.output, member.mode]), COREUTILS_INPUT.members.map(member => [member.path, member.output, member.mode]), "staging is restricted to six fixed source members");
  assert(typeof packageRoot === "string" && isAbsolute(packageRoot) && resolve(packageRoot) === packageRoot && !packageRoot.includes("\0"), "canonical package root required");
  assert(typeof sourceRoot === "string" && !sourceRoot.includes("\0"), "source root required");
  const destination = join(packageRoot, "tests/commands/metadata-stress/.oracle");
  assert(!`${sourceRoot}/`.startsWith(`${packageRoot}/`), "staging source must be outside the package tree");
  const sourceDirectories = new Map([[sourceRoot, await directory(fileSystem, sourceRoot, uid)]]);
  const sourceAncestors = await trustedAncestors(fileSystem, sourceRoot, uid);
  assert.equal(await fileSystem.realpath(packageRoot), packageRoot, "aliased package root forbidden");
  const destinationParent = dirname(destination);
  const parent = await fileSystem.lstat(destinationParent);
  assert(parent.isDirectory() && !parent.isSymbolicLink());
  assert.equal(parent.uid, uid, "destination parent must be job-owned");
  assert.equal(await fileSystem.realpath(destinationParent), destinationParent, "aliased destination parent forbidden");
  const destinationAncestors = await trustedAncestors(fileSystem, destination, uid);
  const destinationDirectories = new Map();
  const createdFiles = new Map();
  async function guardSource() {
    for (const [name, identity] of await trustedAncestors(fileSystem, sourceRoot, uid)) sameIdentity(identity, sourceAncestors.get(name), name);
    for (const [name, identity] of sourceDirectories) sameIdentity(await directory(fileSystem, name, uid), identity, name);
  }
  async function guardDestination() {
    assert.equal(await fileSystem.realpath(destinationParent), destinationParent);
    assert.equal((await fileSystem.lstat(destinationParent)).uid, uid);
    for (const [name, identity] of await trustedAncestors(fileSystem, destination, uid)) sameIdentity(identity, destinationAncestors.get(name), name);
    for (const [name, identity] of destinationDirectories) sameIdentity(await directory(fileSystem, name, uid), identity, name);
  }
  const identities = [{ output: input.archiveName, size: input.size, sha256: input.sha256, mode: 0o644 }, ...input.members];
  const verified = [];
  for (const identity of identities) {
    let current = sourceRoot;
    for (const part of identity.output.split("/").slice(0, -1)) {
      current = join(current, part);
      if (!sourceDirectories.has(current)) sourceDirectories.set(current, await directory(fileSystem, current, uid));
    }
    await guardSource();
    const bytes = await readVerified(fileSystem, join(sourceRoot, identity.output), { ...identity, uid });
    await guardSource();
    verified.push({ identity, bytes });
  }
  await guardDestination();
  await fileSystem.mkdir(destination, { mode: 0o700 });
  destinationDirectories.set(destination, await directory(fileSystem, destination, uid));
  try {
    const outputs = [];
    for (const { identity, bytes } of verified) {
      await guardSource();
      await guardDestination();
      let current = destination;
      for (const part of identity.output.split("/").slice(0, -1)) {
        current = join(current, part);
        if (!destinationDirectories.has(current)) {
          await fileSystem.mkdir(current, { mode: 0o700 });
          destinationDirectories.set(current, await directory(fileSystem, current, uid));
        }
      }
      await guardDestination();
      const target = join(destination, identity.output);
      const handle = await fileSystem.open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      let primaryFailed = false;
      let primaryError;
      try {
        const opened = await handle.stat();
        assert(opened.isFile() && opened.uid === uid && opened.nlink === 1, "unsafe exclusive staging file");
        createdFiles.set(target, opened);
        await guardDestination();
        await handle.writeFile(bytes);
        await handle.chmod(0o644);
        sameIdentity(await fileSystem.lstat(target), opened, target);
      } catch (error) {
        primaryFailed = true;
        primaryError = error;
      }
      try { await handle.close(); }
      catch (closeError) {
        if (primaryFailed) throw new AggregateError([primaryError, closeError], "staging output and close failed");
        throw closeError;
      }
      if (primaryFailed) throw primaryError;
      await guardDestination();
      await readVerified(fileSystem, target, { ...identity, uid });
      outputs.push(Object.freeze({ path: identity.output, size: identity.size, sha256: identity.sha256, mode: "644" }));
    }
    await guardSource();
    await guardDestination();
    return Object.freeze({ status: "METADATA_INPUTS_STAGED_NOT_QUALIFIED", sourceRoot, destination, outputs: Object.freeze(outputs) });
  } catch (error) {
    try {
      await guardDestination();
      for (const [name, identity] of [...createdFiles].reverse()) {
        sameIdentity(await fileSystem.lstat(name), identity, name);
        await fileSystem.unlink(name);
      }
      for (const [name, identity] of [...destinationDirectories].reverse()) {
        sameIdentity(await directory(fileSystem, name, uid), identity, name);
        await fileSystem.rmdir(name);
      }
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "staging failed; unsafe or nonempty cleanup refused");
    }
    throw error;
  }
}

export function validateLinuxRgProfile(profile, host) {
  assert.equal(host.platform, "linux", "Linux rg extraction requires an explicitly matching host");
  assert.equal(host.arch, "x64", "Linux rg profile is x64 only");
  assert.equal(profile.version, "15.2.0");
  assert.equal(profile.platform, "linux");
  assert.equal(profile.arch, "x64");
  assert.equal(profile.target, "x86_64-unknown-linux-musl");
  assert.equal(profile.qualification.status, "PENDING_LINUX_EXECUTION");
  assert.equal(profile.qualification.executed, false);
  assert.equal(profile.qualification.observedVersion, null);
  assert.equal(profile.archive.sha256, "33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c");
  assert.equal(profile.executable.sha256, "e62198eb19b136b88c330af83647b5a962cb99b6b1f066758568f12de1974849");
  return { url: profile.archive.url, size: profile.archive.size, sha256: profile.archive.sha256, archiveName: profile.archive.name, prefix: profile.archive.prefix, format: "gzip", members: [{ path: profile.executable.member, output: "bin/rg", size: profile.executable.size, sha256: profile.executable.sha256, mode: 0o755 }] };
}

export function parseProvisionArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    assert(["--parent", "--xz", "--xz-sha256", "--xz-size", "--include-linux-rg", "--source-mode", "--stage-metadata"].includes(flag) && !values.has(flag), "unknown/duplicate argument");
    if (["--include-linux-rg", "--stage-metadata"].includes(flag)) values.set(flag, true);
    else { const value = args[++index]; assert(value && !value.startsWith("--"), "missing argument"); values.set(flag, value); }
  }
  const parent = values.get("--parent");
  assert(typeof parent === "string", "explicit --parent required");
  const packageRoot = fileURLToPath(new URL("../", import.meta.url));
  assert(!`${resolve(parent)}/`.startsWith(packageRoot), "output parent must be outside the package source tree");
  const sourceMode = values.get("--source-mode") ?? "xz";
  assert(["xz", "gzip"].includes(sourceMode), "source mode must be xz or gzip");
  let xz;
  if (sourceMode === "xz") {
    xz = { path: values.get("--xz"), sha256: values.get("--xz-sha256"), size: Number(values.get("--xz-size")) };
    assert(typeof xz.path === "string" && isAbsolute(xz.path), "explicit existing --xz path required");
    pin(xz);
  } else {
    assert(!["--xz", "--xz-sha256", "--xz-size"].some(flag => values.has(flag)), "gzip source mode forbids xz arguments");
  }
  return { parent, sourceMode, xz, includeLinuxRg: values.has("--include-linux-rg"), stageMetadata: values.has("--stage-metadata") };
}

export async function main(args) {
  const options = parseProvisionArguments(args);
  const inputs = [COREUTILS_INPUT];
  if (options.includeLinuxRg) {
    const profilePath = fileURLToPath(new URL("../tests/commands/search/native-tool-profile.json", import.meta.url));
    const bytes = await readVerified(fs, profilePath, { size: 2423, sha256: RG_PROFILE_SHA256 });
    inputs.push(validateLinuxRgProfile(JSON.parse(bytes.toString("utf8")), process));
  }
  const result = await provisionInputs({ parent: options.parent, inputs, sourceMode: options.sourceMode, xz: options.xz });
  if (options.stageMetadata) {
    const packageRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
    return { ...result, staging: await stageMetadataInputs({ sourceRoot: result.root, packageRoot }) };
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result)), error => { console.error(error); process.exitCode = 1; });
}
