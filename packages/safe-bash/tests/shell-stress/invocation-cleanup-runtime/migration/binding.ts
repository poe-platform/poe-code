import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isBuiltin } from "node:module";
import { dirname, join, posix, relative, resolve } from "node:path";
import { collectSourceInputs } from "../../../source-census.js";
import ts from "typescript";

export const fixturePath = "tests/shell/invocation-cleanup-public.test.ts";
export const probePath = "tests/shell-stress/invocation-cleanup-runtime/public-worker.mjs";
export const helperPath = "tests/shell-stress/invocation-cleanup-runtime/migration/binding.ts";
export const digest = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
export type Hashes = Record<string, string>;
export interface CommittedInputs { format: "public-cleanup-committed-v1"; revision: string; tree: string; files: Hashes }
export interface CapturedInputs { files: Hashes; bytes: Map<string, Buffer> }
export interface RequiredPeer {
  name: "poe-code"; version: string; integrity: string | null; profile: string; metadataPath: string; metadataSha256: string;
  entries: Record<string, string>; files: Hashes; edges: Record<string, Record<string, string>>;
}
interface CapturedDependency {
  name: string;
  version: string;
  integrity: string;
  entries: Record<string, string>;
  files: { path: string; sha256: string }[];
}

export async function captureRequiredPeer(snapshot: string, emittedHashes: Hashes, tools: Hashes, peerBinding?: { profile: string; metadataSha256: string; entries: Record<string, string>; files: readonly { path: string; sha256: string }[] }, verifyEmittedTree = false): Promise<RequiredPeer> {
  const { capturePeerRuntimeFacts } = await import(new URL("../../../plugins/qualified-current-release/peer.mjs", import.meta.url).href);
  const facts: {
    edges: Readonly<Record<string, Readonly<Record<string, string>>>>;
    nativeEdges: readonly { importer: string; specifier: string; target: string }[];
    nativeAssets: readonly { path: string; sha256: string; maxBytes: number }[];
  } | undefined = peerBinding === undefined ? undefined : capturePeerRuntimeFacts(peerBinding, snapshot);
  const checkoutBinding = peerBinding?.profile === "checkout-root" ? peerBinding : undefined;
  if (peerBinding) assert.ok(checkoutBinding || peerBinding.profile === "registry-release", "Unreviewed required-peer binding profile");
  const root = JSON.parse(await readFile(join(snapshot, "package.json"), "utf8"));
  assert.equal(typeof root.peerDependencies?.["poe-code"], "string", "Canonical runtime must be a declared peer");
  assert.notEqual(root.peerDependenciesMeta?.["poe-code"]?.optional, true, "Canonical runtime peer must be required");
  const locked = JSON.parse(await readFile(join(snapshot, "package-lock.json"), "utf8")).packages["node_modules/poe-code"];
  const metadataPath = "node_modules/poe-code/package.json";
  let size = 0;
  const readPeer = async (path: string, maxBytes = 8 * 1024 * 1024): Promise<Buffer> => {
    assert.ok(path.startsWith("node_modules/poe-code/") && !path.split("/").includes(".."), `Peer path escaped: ${path}`);
    const absolute = join(snapshot, path), stat = await lstat(absolute);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= Math.min(maxBytes, 8 * 1024 * 1024), `Peer input must be a bounded regular file: ${path}`);
    assert.equal(await realpath(absolute), absolute, `Peer input must not traverse symlinks: ${path}`);
    const bytes = await readFile(absolute);
    assert.equal(bytes.length, stat.size, `Peer input changed while reading: ${path}`);
    size += bytes.length;
    assert.ok(size <= 16 * 1024 * 1024, "Peer runtime closure exceeds byte bound");
    assert.equal(digest(bytes), tools[path.slice("node_modules/".length)], `Peer differs from captured tools: ${path}`);
    if (peerBinding) assert.equal(digest(bytes), peerBinding.files.find(file => file.path === path.slice("node_modules/poe-code/".length))?.sha256, `Peer differs from authenticated binding: ${path}`);
    return bytes;
  };
  const metadata = await readPeer(metadataPath);
  const peer = JSON.parse(metadata.toString()) as { name: string; version: string; exports: Record<string, { import?: string }> };
  assert.equal(peer.name, "poe-code");
  if (peerBinding) assert.equal(digest(metadata), peerBinding.metadataSha256, "Runtime peer differs from authenticated metadata");
  if (checkoutBinding) {
    assert.equal(checkoutBinding.profile, "checkout-root");
    assert.equal(root.devDependencies?.["poe-code"], "file:../..");
    assert.equal(digest(metadata), checkoutBinding.metadataSha256, "Runtime peer differs from captured checkout identity");
  } else {
    assert.equal(peer.version, root.devDependencies?.["poe-code"], "Runtime peer differs from exact development pin");
    assert.equal(peer.version, locked?.version, "Runtime peer differs from locked version");
    assert.match(locked.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/u, "Runtime peer must have registry integrity");
  }
  const entries: Record<string, string> = {};
  const publicEntries = checkoutBinding ? ["poe-code/safe-fs", "poe-code/safe-fs/core"] : ["poe-code/safe-fs"];
  const collectEntries = (path: string, bytes: Uint8Array, hash: string): void => {
    if (!path.endsWith(".js")) return;
    assert.equal(hash, emittedHashes[path], `Emitted bytes changed before peer capture: ${path}`);
    const source = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString();
    for (const { fileName } of ts.preProcessFile(source, true).importedFiles) {
      if (fileName !== "poe-code" && !fileName.startsWith("poe-code/")) continue;
      assert.ok(publicEntries.includes(fileName), `Unreviewed canonical runtime entry: ${fileName}`);
      const target = peer.exports[`.${fileName.slice("poe-code".length)}`]?.import;
      assert.equal(typeof target, "string", "Canonical runtime requires an explicit public import target");
      assert.ok(target!.startsWith("./packages/") && target!.includes("/dist/") && !target!.split("/").includes(".."), "Canonical public target is not a built package entry");
      if (peerBinding) assert.equal(target, `./${peerBinding.entries[fileName]}`, `Canonical runtime differs from authenticated public binding: ${fileName}`);
      entries[fileName] = posix.join("node_modules/poe-code", target!);
    }
  };
  if (verifyEmittedTree) {
    assert.deepEqual(await census(join(snapshot, "dist"), snapshot, { readdir, readFile }, collectEntries), emittedHashes, "Built public artifacts changed after compilation");
  } else {
    for (const path of Object.keys(emittedHashes).filter(path => path.endsWith(".js"))) {
      const bytes = await readFile(join(snapshot, path));
      collectEntries(path, bytes, digest(bytes));
    }
  }
  assert.deepEqual(Object.keys(entries).sort(), publicEntries, "Canonical public runtime entry is missing");
  const files: Hashes = {}, edges: Record<string, Record<string, string>> = {};
  const pending = Object.values(entries);
  while (pending.length) {
    const path = pending.pop()!;
    if (Object.hasOwn(files, path)) continue;
    assert.ok(Object.keys(files).length < 128, "Peer runtime closure exceeds file bound");
    assert.ok(path.startsWith("node_modules/poe-code/packages/") && path.includes("/dist/") && (path.endsWith(".js") || path.endsWith(".mjs")), `Peer closure requires built ESM: ${path}`);
    const local = path.slice("node_modules/poe-code/".length);
    const bytes = await readPeer(path, facts?.nativeAssets.find(asset => asset.path === local)?.maxBytes);
    files[path] = digest(bytes);
    const imports: Record<string, string> = {};
    const admitted = facts?.edges[local];
    if (facts) assert.ok(admitted, `Runtime importer is outside authenticated binding: ${path}`);
    const specifiers = admitted ? Object.keys(admitted) : ts.preProcessFile(bytes.toString(), true).importedFiles.map(entry => entry.fileName);
    for (const fileName of specifiers) {
      if (isBuiltin(fileName)) continue;
      const nativeEdge = facts?.nativeEdges.find(edge => edge.importer === local && edge.specifier === fileName);
      assert.ok(nativeEdge || fileName.startsWith("./") || fileName.startsWith("../"), `Unreviewed peer runtime dependency: ${fileName}`);
      const target = nativeEdge ? `node_modules/poe-code/${nativeEdge.target}` : posix.normalize(posix.join(posix.dirname(path), fileName));
      assert.ok(target.startsWith("node_modules/poe-code/packages/") && target.includes("/dist/"), `Peer runtime edge escapes built package: ${fileName}`);
      if (admitted) assert.equal(target, `node_modules/poe-code/${admitted[fileName]}`, `Peer runtime edge differs from authenticated binding: ${fileName}`);
      imports[fileName] = target;
      pending.push(target);
    }
    edges[path] = imports;
  }
  for (const asset of facts?.nativeAssets ?? []) {
    const path = `node_modules/poe-code/${asset.path}`;
    if (Object.hasOwn(files, path)) continue;
    assert.ok(Object.keys(files).length < 128, "Peer runtime closure exceeds file bound");
    const bytes = await readPeer(path, asset.maxBytes);
    assert.equal(digest(bytes), asset.sha256, `Native asset differs from authenticated binding: ${path}`);
    files[path] = digest(bytes);
  }
  if (peerBinding) capturePeerRuntimeFacts(peerBinding, snapshot);
  return { name: "poe-code", version: peer.version, integrity: checkoutBinding ? null : locked.integrity, profile: checkoutBinding ? "checkout-root" : "registry-release", metadataPath, metadataSha256: digest(metadata), entries, files, edges };
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
  const captured = collectSourceInputs(repository);
  const bytes = new Map<string, Buffer>([...captured.files, ...captured.admissionInputs]);
  async function add(path: string): Promise<void> {
    const absolute = join(repository, path);
    const stat = await lstat(absolute);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), `Candidate input must be a regular file: ${path}`);
    bytes.set(path, await readFile(absolute));
  }
  const configs = await configurationPaths(async path => (await readFile(join(repository, path))).toString());
  for (const path of ["package.json", "package-lock.json", "scripts/build.mjs", "scripts/typecheck-consumers.mjs", "tests/plugins/qualified-current-release/peer.mjs", "tests/plugins/qualified-current-release/consumers.mjs", "tests/plugins/qualified-current-release/runtime-coverage.mjs", "tests/integration/s3-http-exports/committed-archive.mjs", ...configs, fixturePath, probePath, helperPath]) await add(path);
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

export function compilerToolPaths(repository: string, resolve = (from: string, specifier: string): string => createRequire(from).resolve(specifier)) {
  const manifest = join(repository, "package.json");
  const compiler = resolve(manifest, "typescript/package.json");
  const nodeTypes = resolve(manifest, "@types/node/package.json");
  const undiciTypes = resolve(nodeTypes, "undici-types/package.json");
  return [
    { name: "typescript", source: dirname(compiler) },
    { name: "@types/node", source: dirname(nodeTypes) },
    { name: "undici-types", source: dirname(undiciTypes) },
  ];
}

interface CensusReader {
  readdir(path: string, options: { withFileTypes: true }): Promise<readonly { name: string; isSymbolicLink(): boolean; isDirectory(): boolean }[]>;
  readFile(path: string): Promise<Uint8Array>;
}

export async function census(directory: string, base = directory, io: CensusReader = { readdir, readFile }, inspect?: (path: string, bytes: Uint8Array, hash: string) => void): Promise<Hashes> {
  const paths: string[] = [];
  async function visit(current: string): Promise<void> {
    for (const entry of await io.readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      assert.ok(!entry.isSymbolicLink(), `Unexpected snapshot symlink: ${path}`);
      if (entry.isDirectory()) await visit(path);
      else paths.push(path);
    }
  }
  await visit(directory);
  const result: Hashes = {};
  for (let offset = 0; offset < paths.length; offset += 16) {
    const batch = paths.slice(offset, offset + 16);
    const reads = await Promise.allSettled(batch.map(async path => {
      const bytes = await io.readFile(path);
      const hash = digest(bytes);
      inspect?.(relative(base, path), bytes, hash);
      return hash;
    }));
    for (const [index, read] of reads.entries()) {
      if (read.status === "rejected") throw read.reason;
      result[relative(base, batch[index]!)] = read.value;
    }
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

export async function preparePublicSnapshot(repository: string, expected?: CommittedInputs) {
  const captured = await captureInputs(repository);
  if (expected) assertCommittedInputs(captured, expected);
  const outer = await realpath(await mkdtemp(join(tmpdir(), "safe-bash-public-cleanup-current-")));
  const snapshot = join(outer, "packages/safe-bash");
  let closed = false;
  const dispose = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await rm(outer, { recursive: true, force: true });
    await assert.rejects(lstat(outer), { code: "ENOENT" });
  };
  try {
    const { createPeerBinding } = await import(new URL("../../../../scripts/typecheck-consumers.mjs", import.meta.url).href);
    const { bindPeerArtifact, stagePeerArtifact, assertPeerArtifact, resolvePeerProfile } = await import(new URL("../../../plugins/qualified-current-release/peer.mjs", import.meta.url).href);
    const { prepareArchiveDependencies, stageArchiveDependencies, assertArchiveDependencies, resolveTools } = await import(new URL("../../../integration/s3-http-exports/committed-archive.mjs", import.meta.url).href);
    const manifest = JSON.parse(captured.bytes.get("package.json")!.toString());
    const profile = resolvePeerProfile(repository);
    const sourceInputs = new Map(Object.entries(captured.files).filter(([path]) => path.startsWith("src/")));
    const peerBinding = bindPeerArtifact({ root: repository, declarations: { peer: createPeerBinding(repository, manifest, sourceInputs) }, checkout: profile.profile === "checkout-root", ...(profile.profile === "checkout-root" ? {} : { artifact: process.env.SAFE_BASH_PEER_ARTIFACT }) });
    const rootInputs = new Map<string, Buffer>();
    const integrationRoot = resolve(repository, "../..");
    for (const path of ["package.json", "package-lock.json", "scripts/guard-package-dist.mjs"]) {
      const filename = join(integrationRoot, path), stat = await lstat(filename);
      assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 1024 * 1024);
      assert.equal(await realpath(filename), filename);
      rootInputs.set(path, await readFile(filename));
    }
    const dependencies: CapturedDependency[] = await prepareArchiveDependencies({ manifest, lock: JSON.parse(rootInputs.get("package-lock.json")!.toString()) }, resolveTools(), outer);
    for (const [path, bytes] of rootInputs) {
      await mkdir(dirname(join(outer, path)), { recursive: true });
      await writeFile(join(outer, path), bytes, { flag: "wx" });
    }
    for (const [path, bytes] of captured.bytes) {
      await mkdir(dirname(join(snapshot, path)), { recursive: true });
      await writeFile(join(snapshot, path), bytes, { flag: "wx" });
    }
    assert.deepEqual((await captureInputs(snapshot)).files, captured.files, "Copied candidate differs from captured input bytes");
    await assertInputsUnchanged(repository, captured.files);
    stagePeerArtifact(peerBinding, snapshot);
    stageArchiveDependencies(dependencies, snapshot);
    if (profile.profile === "checkout-root") stageArchiveDependencies(dependencies, outer);
    for (const { path, sha256 } of peerBinding.files) {
      const bytes = await readFile(join(snapshot, "node_modules/poe-code", path));
      assert.equal(digest(bytes), sha256);
      if (rootInputs.has(path)) assert.deepEqual(bytes, rootInputs.get(path));
      else {
        await mkdir(dirname(join(outer, path)), { recursive: true });
        await writeFile(join(outer, path), bytes, { flag: "wx" });
      }
    }
    for (const tool of compilerToolPaths(repository)) {
      const destination = join(snapshot, "node_modules", tool.name);
      await mkdir(dirname(destination), { recursive: true });
      await copyRegularTools(tool.source, destination);
    }
    const tools = await census(join(snapshot, "node_modules"));
    const build = spawnSync(process.execPath, [join(snapshot, "scripts/build.mjs"), "--pretty", "false"], {
      cwd: snapshot, encoding: "utf8", timeout: 45000, killSignal: "SIGKILL", maxBuffer: 2 * 1024 * 1024,
    });
    assert.equal(build.error, undefined, build.error?.message);
    assert.equal(build.status, 0, build.stdout + build.stderr);
    await assertInputsUnchanged(repository, captured.files);
    assert.deepEqual((await captureInputs(snapshot)).files, captured.files, "Build changed captured inputs");
    assert.deepEqual(await census(join(snapshot, "node_modules")), tools, "Build changed compiler dependencies");
    const emitted = await census(join(snapshot, "dist"), snapshot);
    const requiredPeer = await captureRequiredPeer(snapshot, emitted, tools, peerBinding);
    const report = {
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
      snapshot, node: process.version, peerQualification: peerBinding, rootInputs: Object.fromEntries([...rootInputs].map(([path, bytes]) => [path, digest(bytes)])),
      sourceHashes: Object.fromEntries(Object.entries(captured.files).filter(([path]) => path.startsWith("src/"))),
      emittedHashes: emitted, requiredPeer, runtimeDependencies: dependencies.map(dependency => ({
        name: dependency.name, version: dependency.version, integrity: dependency.integrity,
        entries: Object.fromEntries(Object.entries(dependency.entries).map(([specifier, path]) => [specifier, `node_modules/${dependency.name}/${path}`])),
        files: Object.fromEntries(dependency.files.map(({ path, sha256 }) => [`node_modules/${dependency.name}/${path}`, sha256])),
      })), probeHash: captured.files[probePath], packageHash: captured.files["package.json"],
      compilerVersion: (JSON.parse(await readFile(join(snapshot, "node_modules/typescript/package.json"), "utf8")) as { version: string }).version,
      compilerInputs: tools,
      build: { status: build.status, stdout: build.stdout, stderr: build.stderr },
    };
    const manifestPath = join(snapshot, "public-manifest.json");
    const manifestBytes = JSON.stringify(report);
    await writeFile(manifestPath, manifestBytes, { flag: "wx" });
    const verify = async (): Promise<void> => {
      await assertInputsUnchanged(repository, captured.files);
      assert.deepEqual((await captureInputs(snapshot)).files, captured.files, "Captured source was changed after build");
      assert.equal(await readFile(manifestPath, "utf8"), manifestBytes, "Public source manifest changed after capture");
      assertPeerArtifact(peerBinding, snapshot);
      assertArchiveDependencies(dependencies, snapshot);
      if (profile.profile === "checkout-root") assertArchiveDependencies(dependencies, outer);
      for (const [path, bytes] of rootInputs) {
        assert.deepEqual(await readFile(join(integrationRoot, path)), bytes, "Integrated root input changed after capture");
        assert.deepEqual(await readFile(join(outer, path)), bytes, "Copied integrated root input changed after capture");
      }
      for (const { path, sha256 } of peerBinding.files) assert.equal(digest(await readFile(join(outer, path))), sha256, "Copied public peer input changed after capture");
      assert.deepEqual(await captureRequiredPeer(snapshot, emitted, tools, peerBinding, true), requiredPeer, "Required runtime peer changed after capture");
    };
    await verify();
    return { snapshot, manifestPath, probe: join(snapshot, probePath), manifest: report, verify, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
