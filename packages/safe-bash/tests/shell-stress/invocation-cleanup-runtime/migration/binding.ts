import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, posix, relative } from "node:path";
import { collectSourceInputs } from "../../../source-census.js";

export const fixturePath = "tests/shell/invocation-cleanup-public.test.ts";
export const probePath = "tests/shell-stress/invocation-cleanup-runtime/public-worker.mjs";
export const helperPath = "tests/shell-stress/invocation-cleanup-runtime/migration/binding.ts";
export const digest = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
export type Hashes = Record<string, string>;
export interface CommittedInputs { format: "public-cleanup-committed-v1"; revision: string; tree: string; files: Hashes }
export interface CapturedInputs { files: Hashes; bytes: Map<string, Buffer> }

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
    for (const tool of compilerToolPaths(repository)) {
      const destination = join(snapshot, "node_modules", tool.name);
      await mkdir(dirname(destination), { recursive: true });
      await copyRegularTools(tool.source, destination);
    }
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
      emittedHashes: emitted, probeHash: captured.files[probePath], packageHash: captured.files["package.json"],
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
    };
    await verify();
    return { snapshot, manifestPath, probe: join(snapshot, probePath), manifest, verify, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
