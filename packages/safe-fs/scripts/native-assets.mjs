import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import * as filesystem from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const headerNames = ["node_api.h", "node_api_types.h", "js_native_api.h", "js_native_api_types.h"];

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function relativePath(value) {
  assert.equal(typeof value, "string", "native asset path must be text");
  assert.ok(value.length > 0 && value.length <= 256 && !value.includes("\\") && !value.includes(":"));
  assert.ok(value.split("/").every(part => part && part !== "." && part !== ".." && !part.includes("\0")), "invalid native asset path");
  return value;
}

function targetName(target) {
  for (const key of ["platform", "arch", "libc"]) {
    const value = target[key];
    assert.ok(typeof value === "string" && value.length > 0 && value.length <= 32
      && [...value].every(character => "abcdefghijklmnopqrstuvwxyz0123456789".includes(character)), "invalid native target");
  }
  return `${target.platform}-${target.arch}-${target.libc}`;
}

function versionParts(value) {
  assert.ok(typeof value === "string" && value.length > 0 && value.length <= 32, "invalid libc version");
  const parts = value.split(".");
  assert.ok(parts.length >= 2 && parts.length <= 4 && parts.every(part => part.length > 0
    && [...part].every(character => "0123456789".includes(character))), "invalid libc version");
  return parts.map(Number);
}

function supported(target, host) {
  if (target.platform !== host.platform || target.arch !== host.arch || target.libc !== host.libc) return false;
  if (typeof host.libcVersion !== "string") return false;
  const actual = versionParts(host.libcVersion);
  const minimum = versionParts(target.minimumLibc);
  for (let index = 0; index < Math.max(actual.length, minimum.length); index++) {
    if ((actual[index] ?? 0) !== (minimum[index] ?? 0)) return (actual[index] ?? 0) > (minimum[index] ?? 0);
  }
  return true;
}

async function inspectPath(files, filename, create = false) {
  const absolute = path.resolve(filename);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat;
    try { stat = await files.lstat(current); }
    catch (error) {
      if (!create || error?.code !== "ENOENT") throw error;
      await files.mkdir(current);
      stat = await files.lstat(current);
    }
    assert.ok(!stat.isSymbolicLink(), `native asset path must not contain a symlink: ${current}`);
    if (current !== absolute || create) assert.ok(stat.isDirectory(), `native asset parent is not a directory: ${current}`);
  }
}

async function readBounded(files, filename, maximum) {
  await inspectPath(files, filename);
  const handle = await files.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let failed = false;
  let failure;
  let contents;
  try {
    const before = await handle.stat();
    assert.ok(before.isFile() && Number.isSafeInteger(before.size) && before.size >= 0 && before.size <= maximum, `invalid native input size: ${filename}`);
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, length);
      assert.ok(Number.isSafeInteger(result.bytesRead) && result.bytesRead >= 0 && result.bytesRead <= bytes.length - length);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    const after = await handle.stat();
    assert.ok(length === before.size && before.size === after.size && before.ino === after.ino
      && before.dev === after.dev && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
    `native input changed during read: ${filename}`);
    contents = bytes.subarray(0, length);
  } catch (error) {
    failed = true;
    failure = error;
  }
  try { await handle.close(); } catch (error) { if (!failed) throw error; }
  if (failed) throw failure;
  return contents;
}

export async function readNativeRegistry({ rootDir, files = filesystem }) {
  const packageDir = path.join(rootDir, "packages/safe-fs");
  const registry = JSON.parse((await readBounded(files, path.join(packageDir, "native/assets.json"), 16384)).toString("utf8"));
  assert.equal(registry.version, 1);
  assert.equal(registry.specifier, "#safe-fs-native-seek");
  for (const key of ["directory", "source", "loader", "declaration"]) relativePath(registry[key]);
  assert.ok(registry.source.endsWith(".c") && registry.loader.endsWith(".mjs") && registry.declaration.endsWith(".d.ts"));
  assert.equal(registry.napi, 6);
  assert.equal(registry.maxBinaryBytes, 1048576);
  assert.ok(Array.isArray(registry.targets) && registry.targets.length > 0 && registry.targets.length <= 8);
  const names = new Set();
  for (const target of registry.targets) {
    const name = targetName(target);
    assert.ok(!names.has(name), "duplicate native target");
    names.add(name);
    versionParts(target.minimumLibc);
  }
  return registry;
}

export function nativeImportMapping(registry, prefix = "") {
  const directory = path.posix.join(prefix, registry.directory);
  return { types: `./${directory}/loader.d.ts`, workerd: null, browser: null, default: `./${directory}/loader.mjs` };
}

async function sourceInputs(rootDir, registry, files) {
  const packageDir = path.join(rootDir, "packages/safe-fs");
  const values = {};
  for (const key of ["source", "loader", "declaration"]) {
    values[key] = await readBounded(files, path.join(packageDir, registry[key]), 262144);
  }
  return values;
}

function runCompiler(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
    const chunks = { stdout: [], stderr: [] };
    let size = 0;
    let failure;
    const fail = error => { failure ??= error; child.kill("SIGKILL"); };
    const timer = setTimeout(() => fail(new Error("native compiler timed out")), 30000);
    timer.unref();
    for (const channel of ["stdout", "stderr"]) child[channel].on("data", chunk => {
      size += chunk.length;
      if (size > 65536) fail(new Error("native compiler output exceeded its limit"));
      else chunks[channel].push(chunk);
    });
    child.once("error", error => { failure = error; });
    child.once("close", code => {
      clearTimeout(timer);
      const result = Object.fromEntries(Object.entries(chunks).map(([key, value]) => [key, Buffer.concat(value).toString("utf8")]));
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`native compiler failed (${code}): ${result.stderr}`));
      else resolve(result);
    });
  });
}

async function publishFiles(files, directory, entries, registry) {
  await inspectPath(files, directory, true);
  const expected = new Set(entries.map(entry => entry.name));
  const registered = new Set(registry.targets.map(target => `${targetName(target)}.node`));
  const existing = await files.readdir(directory);
  for (const name of existing) assert.ok(expected.has(name) || registered.has(name), `unexpected native output: ${name}`);
  for (const name of new Set([...existing, ...expected])) {
    const filename = path.join(directory, name);
    try {
      const stat = await files.lstat(filename);
      assert.ok(stat.isFile() && !stat.isSymbolicLink(), "native output is not a regular file");
    } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  for (const name of existing) if (!expected.has(name)) await files.unlink(path.join(directory, name));
  for (const entry of entries) await files.writeFile(path.join(directory, entry.name), entry.contents);
}

export async function buildNativeAssets({ rootDir, files = filesystem, host, headers, compile = runCompiler }) {
  const registry = await readNativeRegistry({ rootDir, files });
  const inputs = await sourceInputs(rootDir, registry, files);
  const packageDir = path.join(rootDir, "packages/safe-fs");
  const dist = path.join(packageDir, "dist");
  await inspectPath(files, dist, true);
  if (host === undefined) {
    const libcVersion = process.platform === "linux" ? process.report?.getReport().header?.glibcVersionRuntime : undefined;
    host = { platform: process.platform, arch: process.arch, libc: libcVersion ? "glibc" : undefined, libcVersion };
  }
  const targets = registry.targets.filter(target => supported(target, host));
  assert.ok(targets.length <= 1, "ambiguous native target");
  const manifest = { version: 1, napi: registry.napi, maxBinaryBytes: registry.maxBinaryBytes, targets: [], build: {
    sourceSha256: digest(inputs.source), loaderSha256: digest(inputs.loader), declarationSha256: digest(inputs.declaration), headers: null, compiler: null,
  } };
  const entries = [{ name: "loader.mjs", contents: inputs.loader }, { name: "loader.d.ts", contents: inputs.declaration }];
  if (targets.length > 0) {
    headers ??= { directory: require("node-api-headers").include_dir, version: require("node-api-headers/package.json").version };
    assert.ok(typeof headers.version === "string" && headers.version.length <= 32);
    const headerFiles = {};
    for (const name of headerNames) {
      const bytes = await readBounded(files, path.join(headers.directory, name), 262144);
      headerFiles[name] = { size: bytes.length, sha256: digest(bytes) };
    }
    manifest.build.headers = { version: headers.version, files: headerFiles };
    const compilerPath = await files.realpath("/usr/bin/cc");
    const compilerBytes = await readBounded(files, compilerPath, 16777216);
    const staging = await files.mkdtemp(path.join(dist, ".native-build-"));
    let failed = false;
    let failure;
    try {
      const options = { cwd: packageDir, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TMPDIR: staging } };
      const version = await compile(compilerPath, ["--version"], options);
      assert.ok(typeof version.stdout === "string" && version.stdout.length <= 4096);
      manifest.build.compiler = { path: "/usr/bin/cc", sha256: digest(compilerBytes), version: version.stdout };
      const target = targets[0];
      const name = `${targetName(target)}.node`;
      const output = path.join(staging, name);
      await compile(compilerPath, ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-fPIC", "-shared", "-B/usr/bin/",
        "-D_FILE_OFFSET_BITS=64", `-DNAPI_VERSION=${registry.napi}`, `-I${headers.directory}`, path.join(packageDir, registry.source), "-o", output], options);
      const contents = await readBounded(files, output, registry.maxBinaryBytes);
      assert.ok(contents.length > 0, "empty native compiler output");
      manifest.targets.push({ ...target, size: contents.length, sha256: digest(contents) });
      entries.push({ name, contents });
      for (const name of headerNames) assert.equal(digest(await readBounded(files, path.join(headers.directory, name), 262144)), headerFiles[name].sha256, "native header changed during compilation");
      const current = await sourceInputs(rootDir, registry, files);
      for (const key of ["source", "loader", "declaration"]) assert.ok(current[key].equals(inputs[key]), "native source changed during compilation");
      assert.equal(digest(await readBounded(files, compilerPath, 16777216)), manifest.build.compiler.sha256, "native compiler changed during compilation");
    } catch (error) {
      failed = true;
      failure = error;
    }
    try { await files.rm(staging, { recursive: true }); } catch (error) { if (!failed) throw error; }
    if (failed) throw failure;
  }
  entries.push({ name: "manifest.json", contents: Buffer.from(JSON.stringify(manifest, null, 2) + "\n") });
  const directory = path.join(dist, registry.directory);
  await publishFiles(files, directory, entries, registry);
  const packageFile = path.join(dist, "package.json");
  const packageJson = JSON.parse((await readBounded(files, packageFile, 65536)).toString("utf8"));
  packageJson.imports = { ...packageJson.imports, [registry.specifier]: nativeImportMapping(registry) };
  await files.writeFile(packageFile, JSON.stringify(packageJson, null, 2) + "\n");
  return { registry, directory, manifest };
}

export async function readBuiltNativeAssets({ rootDir, files = filesystem }) {
  const registry = await readNativeRegistry({ rootDir, files });
  const inputs = await sourceInputs(rootDir, registry, files);
  const directory = path.join(rootDir, "packages/safe-fs/dist", registry.directory);
  const manifestBytes = await readBounded(files, path.join(directory, "manifest.json"), 16384);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  assert.equal(manifest.version, 1);
  assert.equal(manifest.napi, registry.napi);
  assert.equal(manifest.maxBinaryBytes, registry.maxBinaryBytes);
  assert.ok(Array.isArray(manifest.targets) && manifest.targets.length <= registry.targets.length);
  for (const key of ["source", "loader", "declaration"]) assert.equal(manifest.build?.[`${key}Sha256`], digest(inputs[key]), "native source binding differs");
  const entries = [{ name: "manifest.json", contents: manifestBytes }];
  for (const [name, key] of [["loader.mjs", "loader"], ["loader.d.ts", "declaration"]]) {
    const contents = await readBounded(files, path.join(directory, name), 262144);
    assert.ok(contents.equals(inputs[key]), "native loader or declaration differs");
    entries.push({ name, contents });
  }
  const names = new Set(entries.map(entry => entry.name));
  for (const target of manifest.targets) {
    const name = `${targetName(target)}.node`;
    const declared = registry.targets.find(value => targetName(value) === targetName(target));
    assert.ok(declared && declared.minimumLibc === target.minimumLibc && !names.has(name), "undeclared native target");
    names.add(name);
    assert.ok(Number.isSafeInteger(target.size) && target.size > 0 && target.size <= registry.maxBinaryBytes);
    const contents = await readBounded(files, path.join(directory, name), registry.maxBinaryBytes);
    assert.equal(contents.length, target.size, "native binary size differs");
    assert.equal(digest(contents), target.sha256, "native binary digest differs");
    entries.push({ name, contents });
  }
  for (const name of await files.readdir(directory)) assert.ok(names.has(name), "unexpected native asset");
  return { registry, directory, manifest, entries };
}

export async function copyNativeAssets({ rootDir, outDir, files = filesystem }) {
  const artifact = await readBuiltNativeAssets({ rootDir, files });
  const directory = path.join(outDir, artifact.registry.directory);
  await publishFiles(files, directory, artifact.entries, artifact.registry);
  return { registry: artifact.registry, directory, manifest: artifact.manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootDir = fileURLToPath(new URL("../../../", import.meta.url));
  const result = await buildNativeAssets({ rootDir });
  console.log(JSON.stringify({ nativeAssets: result.directory, targets: result.manifest.targets.map(targetName) }));
}
