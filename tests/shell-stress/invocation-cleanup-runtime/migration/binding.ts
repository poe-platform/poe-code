import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isBuiltin } from "node:module";
import { dirname, join, posix, relative } from "node:path";
import ts from "typescript";

export const fixturePath = "tests/shell/invocation-cleanup-public.test.ts";
export const probePath = "tests/shell-stress/invocation-cleanup-runtime/public-worker.mjs";
export const helperPath = "tests/shell-stress/invocation-cleanup-runtime/migration/binding.ts";
export const digest = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
export type Hashes = Record<string, string>;
export interface CommittedInputs { format: "public-cleanup-committed-v1"; revision: string; tree: string; files: Hashes }
export interface CapturedInputs { files: Hashes; bytes: Map<string, Buffer> }
export interface RequiredPeer {
  name: "poe-code"; version: string; integrity: string; metadataPath: string; metadataSha256: string;
  entries: Record<string, string>; files: Hashes; edges: Record<string, Record<string, string>>;
}

export async function captureRequiredPeer(snapshot: string, emittedHashes: Hashes, tools: Hashes): Promise<RequiredPeer> {
  const root = JSON.parse(await readFile(join(snapshot, "package.json"), "utf8"));
  assert.equal(typeof root.peerDependencies?.["poe-code"], "string", "Canonical runtime must be a declared peer");
  assert.notEqual(root.peerDependenciesMeta?.["poe-code"]?.optional, true, "Canonical runtime peer must be required");
  const locked = JSON.parse(await readFile(join(snapshot, "package-lock.json"), "utf8")).packages["node_modules/poe-code"];
  const metadataPath = "node_modules/poe-code/package.json";
  let size = 0;
  const readPeer = async (path: string): Promise<Buffer> => {
    assert.ok(path.startsWith("node_modules/poe-code/") && !path.split("/").includes(".."), `Peer path escaped: ${path}`);
    const absolute = join(snapshot, path), stat = await lstat(absolute);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 8 * 1024 * 1024, `Peer input must be a bounded regular file: ${path}`);
    assert.equal(await realpath(absolute), absolute, `Peer input must not traverse symlinks: ${path}`);
    const bytes = await readFile(absolute);
    size += bytes.length;
    assert.ok(size <= 16 * 1024 * 1024, "Peer runtime closure exceeds byte bound");
    assert.equal(digest(bytes), tools[path.slice("node_modules/".length)], `Peer differs from captured tools: ${path}`);
    return bytes;
  };
  const metadata = await readPeer(metadataPath);
  const peer = JSON.parse(metadata.toString()) as { name: string; version: string; exports: Record<string, { import?: string }> };
  assert.equal(peer.name, "poe-code");
  assert.equal(peer.version, root.devDependencies?.["poe-code"], "Runtime peer differs from exact development pin");
  assert.equal(peer.version, locked?.version, "Runtime peer differs from locked version");
  assert.match(locked.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/u, "Runtime peer must have registry integrity");
  const entries: Record<string, string> = {};
  for (const path of Object.keys(emittedHashes).filter(path => path.endsWith(".js"))) {
    const bytes = await readFile(join(snapshot, path));
    assert.equal(digest(bytes), emittedHashes[path], `Emitted bytes changed before peer capture: ${path}`);
    for (const { fileName } of ts.preProcessFile(bytes.toString(), true).importedFiles) {
      if (fileName !== "poe-code" && !fileName.startsWith("poe-code/")) continue;
      assert.equal(fileName, "poe-code/safe-fs", `Unreviewed canonical runtime entry: ${fileName}`);
      const target = peer.exports["./safe-fs"]?.import;
      assert.equal(typeof target, "string", "Canonical runtime requires an explicit public import target");
      assert.ok(target!.startsWith("./packages/") && target!.includes("/dist/") && !target!.split("/").includes(".."), "Canonical public target is not a built package entry");
      entries[fileName] = posix.join("node_modules/poe-code", target!);
    }
  }
  assert.deepEqual(Object.keys(entries), ["poe-code/safe-fs"], "Canonical public runtime entry is missing");
  const files: Hashes = {}, edges: Record<string, Record<string, string>> = {};
  const pending = Object.values(entries);
  while (pending.length) {
    const path = pending.pop()!;
    if (Object.hasOwn(files, path)) continue;
    assert.ok(Object.keys(files).length < 128, "Peer runtime closure exceeds file bound");
    assert.ok(path.startsWith("node_modules/poe-code/packages/") && path.includes("/dist/") && (path.endsWith(".js") || path.endsWith(".mjs")), `Peer closure requires built ESM: ${path}`);
    const bytes = await readPeer(path);
    files[path] = digest(bytes);
    const imports: Record<string, string> = {};
    for (const { fileName } of ts.preProcessFile(bytes.toString(), true).importedFiles) {
      if (isBuiltin(fileName)) continue;
      assert.ok(fileName.startsWith("./") || fileName.startsWith("../"), `Unreviewed peer runtime dependency: ${fileName}`);
      const target = posix.normalize(posix.join(posix.dirname(path), fileName));
      assert.ok(target.startsWith("node_modules/poe-code/packages/") && target.includes("/dist/"), `Peer runtime edge escapes built package: ${fileName}`);
      imports[fileName] = target;
      pending.push(target);
    }
    edges[path] = imports;
  }
  return { name: "poe-code", version: peer.version, integrity: locked.integrity, metadataPath, metadataSha256: digest(metadata), entries, files, edges };
}

export async function configurationPaths(read: (path: string) => Promise<string>): Promise<string[]> {
  const paths = new Set<string>();
  async function visit(path: string): Promise<void> {
    assert.ok(paths.size < 16, "Unbounded build configuration chain");
    assert.ok(!path.startsWith("/") && !path.split("/").includes(".."), "Configuration escapes candidate");
    if (paths.has(path)) return;
    paths.add(path);
    const config = JSON.parse(await read(path)) as { extends?: unknown };
    if (config.extends !== undefined) {
      assert.equal(typeof config.extends, "string", "Explicit relative build-config inheritance required");
      const parent = config.extends as string;
      assert.ok(parent.startsWith("."), "Package-based build configuration is not implicitly trusted");
      await visit(posix.normalize(posix.join(posix.dirname(path), parent.endsWith(".json") ? parent : `${parent}.json`)));
    }
  }
  await visit("tsconfig.build.json");
  return [...paths].sort();
}

export async function captureInputs(repository: string): Promise<CapturedInputs> {
  const bytes = new Map<string, Buffer>();
  async function add(path: string): Promise<void> {
    const absolute = join(repository, path);
    const stat = await lstat(absolute);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), `Candidate input must be a regular file: ${path}`);
    bytes.set(path, await readFile(absolute));
  }
  async function walk(path: string): Promise<void> {
    const stat = await lstat(join(repository, path));
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), `Candidate directory must be regular: ${path}`);
    for (const entry of await readdir(join(repository, path), { withFileTypes: true })) {
      const child = posix.join(path, entry.name);
      assert.ok(!entry.isSymbolicLink(), `Candidate symlink is not a source binding: ${child}`);
      if (entry.isDirectory()) await walk(child); else await add(child);
    }
  }
  await walk("src");
  const configs = await configurationPaths(async path => (await readFile(join(repository, path))).toString());
  for (const path of ["package.json", "package-lock.json", ...configs, fixturePath, probePath, helperPath]) await add(path);
  return { files: Object.fromEntries([...bytes].sort(([left], [right]) => left.localeCompare(right)).map(([path, value]) => [path, digest(value)])), bytes };
}

export function assertCommittedInputs(capture: CapturedInputs, expected: CommittedInputs): void {
  assert.equal(expected.format, "public-cleanup-committed-v1");
  assert.match(expected.revision, /^[a-f0-9]{40}$/u);
  assert.match(expected.tree, /^[a-f0-9]{40}$/u);
  assert.ok(expected.files && typeof expected.files === "object" && !Array.isArray(expected.files));
  for (const [path, hash] of Object.entries(expected.files)) {
    assert.ok(!path.startsWith("/") && !path.split("/").includes(".."));
    assert.match(hash, /^[a-f0-9]{64}$/u);
  }
  assert.deepEqual(capture.files, expected.files, "Executing inputs do not match the explicit committed expectation");
}

export async function assertInputsUnchanged(repository: string, expected: Hashes): Promise<void> {
  assert.deepEqual((await captureInputs(repository)).files, expected, "Executing source/config/probe changed during public cleanup test");
}

export async function copyRegularTools(source: string, destination: string): Promise<void> {
  const allowed = await realpath(source);
  async function copy(origin: string, target: string): Promise<void> {
    const actual = await realpath(origin);
    assert.ok(actual === allowed || actual.startsWith(`${allowed}/`), "Tool symlink escaped the explicit tool tree");
    const stat = await lstat(actual);
    if (stat.isDirectory()) {
      await mkdir(target);
      for (const name of await readdir(actual)) await copy(join(actual, name), join(target, name));
    } else {
      assert.ok(stat.isFile());
      await writeFile(target, await readFile(actual), { flag: "wx", mode: stat.mode & 0o777 });
    }
  }
  await copy(allowed, destination);
}

export async function census(directory: string, base = directory): Promise<Hashes> {
  const result: Hashes = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    assert.ok(!entry.isSymbolicLink(), `Unexpected snapshot symlink: ${path}`);
    if (entry.isDirectory()) Object.assign(result, await census(path, base));
    else result[relative(base, path)] = digest(await readFile(path));
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

export async function preparePublicSnapshot(repository: string, expected?: CommittedInputs) {
  const captured = await captureInputs(repository);
  if (expected) assertCommittedInputs(captured, expected);
  const snapshot = await realpath(await mkdtemp(join(tmpdir(), "safe-bash-public-cleanup-current-")));
  let closed = false;
  const dispose = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await rm(snapshot, { recursive: true, force: true });
    await assert.rejects(lstat(snapshot), { code: "ENOENT" });
  };
  try {
    for (const [path, bytes] of captured.bytes) {
      await mkdir(dirname(join(snapshot, path)), { recursive: true });
      await writeFile(join(snapshot, path), bytes, { flag: "wx" });
    }
    assert.deepEqual((await captureInputs(snapshot)).files, captured.files, "Copied candidate differs from captured input bytes");
    await assertInputsUnchanged(repository, captured.files);
    await copyRegularTools(join(repository, "node_modules"), join(snapshot, "node_modules"));
    const tools = await census(join(snapshot, "node_modules"));
    const build = spawnSync(process.execPath, [join(snapshot, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json", "--pretty", "false"], {
      cwd: snapshot, encoding: "utf8", timeout: 45000, killSignal: "SIGKILL", maxBuffer: 2 * 1024 * 1024,
    });
    assert.equal(build.error, undefined, build.error?.message);
    assert.equal(build.status, 0, build.stdout + build.stderr);
    await assertInputsUnchanged(repository, captured.files);
    assert.deepEqual((await captureInputs(snapshot)).files, captured.files, "Build changed captured inputs");
    assert.deepEqual(await census(join(snapshot, "node_modules")), tools, "Build changed compiler dependencies");
    const emitted = await census(join(snapshot, "dist"), snapshot);
    const requiredPeer = await captureRequiredPeer(snapshot, emitted, tools);
    const manifest = {
      runtimeCommit: expected?.revision ?? null,
      callbackCommit: null,
      binding: {
        profile: expected ? "explicit-committed-source" : "captured-working-tree-not-committed-qualification",
        capturedAt: new Date().toISOString(),
        revision: expected?.revision ?? null,
        tree: expected?.tree ?? null,
        expectedManifestSha256: expected ? digest(JSON.stringify(expected)) : null,
        inputManifestSha256: digest(JSON.stringify(captured.files)),
        inputs: captured.files,
      },
      snapshot, node: process.version,
      sourceHashes: Object.fromEntries(Object.entries(captured.files).filter(([path]) => path.startsWith("src/"))),
      emittedHashes: emitted, requiredPeer, probeHash: captured.files[probePath], packageHash: captured.files["package.json"],
      compilerVersion: (JSON.parse(await readFile(join(snapshot, "node_modules/typescript/package.json"), "utf8")) as { version: string }).version,
      compilerInputs: tools,
      build: { status: build.status, stdout: build.stdout, stderr: build.stderr },
    };
    const manifestPath = join(snapshot, "public-manifest.json");
    const manifestBytes = JSON.stringify(manifest);
    await writeFile(manifestPath, manifestBytes, { flag: "wx" });
    const verify = async (): Promise<void> => {
      await assertInputsUnchanged(repository, captured.files);
      assert.deepEqual((await captureInputs(snapshot)).files, captured.files, "Captured source was changed after build");
      assert.deepEqual(await census(join(snapshot, "dist"), snapshot), emitted, "Built public artifacts changed after compilation");
      assert.equal(await readFile(manifestPath, "utf8"), manifestBytes, "Public source manifest changed after capture");
      assert.deepEqual(await captureRequiredPeer(snapshot, emitted, tools), requiredPeer, "Required runtime peer changed after capture");
    };
    await verify();
    return { snapshot, manifestPath, probe: join(snapshot, probePath), manifest, verify, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
