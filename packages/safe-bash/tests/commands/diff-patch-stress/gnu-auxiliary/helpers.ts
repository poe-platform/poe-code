import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, link, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { toByteSource } from "../../../../src/contracts/index.js";
import { createDiffPatchCommands } from "../../../../src/commands/diff-patch/index.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { oracleIdentity, withNativeScratch } from "../gnu-target/oracle.js";
import { replacement, type Fixture } from "./fixtures.js";
import { collectSourceInputs } from "../../../source-census.js";
import { nativeGnuBinding } from "../../../native-profile.js";

export const directory = fileURLToPath(new URL("./", import.meta.url));
const virtualRoot = "/laboratory";
const sentinel = "gnu-auxiliary: do not remove fixture ancestors\n";
interface Entry {
  readonly path: string;
  readonly type: string;
  readonly data?: string;
  readonly link?: string;
  readonly nlink?: number;
}

export async function sourceHashes(): Promise<Record<string, string>> {
  const captured = collectSourceInputs(process.cwd());
  const result: Record<string, string> = {};
  for (const [path, bytes] of [...captured.files, ...captured.admissionInputs]) {
    result[path] = createHash("sha256").update(bytes).digest("hex");
  }
  const oracle = fileURLToPath(new URL("../gnu-target/oracle.ts", import.meta.url));
  result[relative(process.cwd(), oracle)] = createHash("sha256").update(await readFile(oracle)).digest("hex");
  return result;
}

async function nativeSnapshot(root: string): Promise<Entry[]> {
  const result: Entry[] = [];
  async function visit(path: string): Promise<void> {
    const stat = await lstat(path);
    const name = relative(root, path) || ".";
    if (stat.isDirectory()) {
      result.push({ path: name, type: "directory" });
      for (const child of (await readdir(path)).sort()) await visit(join(path, child));
    } else if (stat.isSymbolicLink()) result.push({ path: name, type: "symlink", link: await readlink(path) });
    else result.push({ path: name, type: "file", data: (await readFile(path)).toString("hex"), nlink: stat.nlink });
  }
  await visit(root);
  return result;
}

async function virtualSnapshot(fs: MemoryFileSystem, identity = false): Promise<Entry[]> {
  const result: Entry[] = [];
  async function visit(path: string): Promise<void> {
    const stat = await fs.lstat(path);
    const name = path === virtualRoot ? "." : path.startsWith(`${virtualRoot}/`) ? path.slice(virtualRoot.length + 1) : `VFS:${path}`;
    const entry = { path: name, type: stat.type, ...(identity ? { ino: stat.ino, dev: stat.dev, mode: stat.mode, nlink: stat.nlink } : {}) };
    if (stat.type === "directory") {
      if (path !== "/" || identity) result.push(entry);
      for (const child of (await fs.readdir(path)).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) await visit(`${path === "/" ? "" : path}/${child.name}`);
    } else if (stat.type === "symlink") result.push({ ...entry, link: await fs.readlink(path) });
    else result.push({ ...entry, data: Buffer.from(await fs.readFile(path)).toString("hex"), nlink: stat.nlink ?? 1 });
  }
  await visit("/");
  return result;
}

export async function probe(fixture: Fixture, atomic = false) {
  const identity = oracleIdentity("patch");
  assert.equal(identity.sha256, nativeGnuBinding("patch")?.sha256 ?? "c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00");
  const root = await mkdtemp(join(directory, ".native-"));
  const fs = new MemoryFileSystem();
  const expand = (value: string, destination: string) => value.replaceAll("{root}", destination);
  try {
    await mkdir(join(root, "work"));
    await fs.mkdir(`${virtualRoot}/work`, { recursive: true });
    const files = { "../sentinel": sentinel, "../outside": "old\n", target: "old\n", spare: "spare\n", ...fixture.files };
    for (const [name, content] of Object.entries(files)) {
      const nativePath = join(root, "work", name);
      const virtualPath = join(virtualRoot, "work", name);
      await mkdir(dirname(nativePath), { recursive: true });
      await fs.mkdir(dirname(virtualPath), { recursive: true });
      await writeFile(nativePath, expand(content, root));
      await fs.writeFile(virtualPath, Buffer.from(expand(content, virtualRoot)));
    }
    for (const [name, target] of Object.entries(fixture.symlinks ?? {})) {
      await symlink(target, join(root, "work", name));
      await fs.symlink(target, join(virtualRoot, "work", name));
    }
    for (const [name, target] of Object.entries(fixture.hardlinks ?? {})) {
      await link(join(root, "work", target), join(root, "work", name));
      await fs.link(join(virtualRoot, "work", target), join(virtualRoot, "work", name));
    }
    const nativeBefore = await nativeSnapshot(root);
    const virtualBefore = await virtualSnapshot(fs);
    const virtualIdentityBefore = await virtualSnapshot(fs, true);
    const input = fixture.input ?? replacement();
    const nativeArgs = ["--batch", ...(fixture.args ?? []).map(arg => expand(arg, root))];
    const result = withNativeScratch(temporary => spawnSync(identity.realpath, nativeArgs, {
      cwd: join(root, "work"), input: expand(input, root), encoding: "utf8", shell: false,
      timeout: 3000, killSignal: "SIGKILL", maxBuffer: 262_144,
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC", PATCH_GET: "0", TMPDIR: temporary },
    }));
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    const nativeAfter = await nativeSnapshot(root);
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const command = createDiffPatchCommands().find(item => item.name === "patch");
    assert(command);
    const virtualArgs = [...(atomic ? ["--atomic"] : []), ...(fixture.args ?? []).map(arg => expand(arg, fixture.hostOnly ? root : virtualRoot))];
    const virtualResult = await command.execute({
      command: "patch", args: virtualArgs, cwd: `${virtualRoot}/work`, env: {}, fs,
      signal: AbortSignal.timeout(3000), stdin: toByteSource(expand(input, virtualRoot)),
      stdout: { async write(chunk) { stdout.push(chunk.slice()); } },
      stderr: { async write(chunk) { stderr.push(chunk.slice()); } },
    });
    assert.deepEqual(await nativeSnapshot(root), nativeAfter, "VFS invocation must not mutate the host fixture");
    assert.equal(await readFile(join(root, "sentinel"), "utf8"), sentinel, "ancestor sentinel must survive");
    return {
      name: fixture.name, policy: fixture.policy ?? false, atomic, input,
      native: { args: nativeArgs.map(arg => arg.replaceAll(root, "{root}")), exitCode: result.status, stdout: result.stdout.replaceAll(root, "{root}"), stderr: result.stderr.replaceAll(root, "{root}"), before: nativeBefore, after: nativeAfter },
      virtual: { args: virtualArgs.map(arg => arg.replaceAll(root, "{host-root}")), exitCode: virtualResult.exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), before: virtualBefore, after: await virtualSnapshot(fs), identityBefore: virtualIdentityBefore, identityAfter: await virtualSnapshot(fs, true) },
    };
  } finally {
    assert.equal(dirname(root), directory.replace(/\/$/u, ""));
    assert.equal(await readFile(join(root, "sentinel"), "utf8"), sentinel);
    await rm(root, { recursive: true });
  }
}

export type Observation = Awaited<ReturnType<typeof probe>>;

export function verify(fixture: Fixture, observation: Observation): void {
  const { native, virtual } = observation;
  if (fixture.policy) {
    assert.notEqual(virtual.exitCode, 0, "required safety rejection");
    assert.deepEqual(virtual.identityAfter, virtual.identityBefore, "safety refusal preserves complete VFS namespace, bytes, and identity");
  } else {
    assert.equal(native.exitCode, fixture.nativeStatus ?? 0, `unexpected pinned native result: ${native.stderr}`);
    if ((fixture.args ?? []).includes("--dry-run")) assert.deepEqual(native.after, native.before, "GNU dry-run changes no namespace entries");
    assert.equal(virtual.exitCode, native.exitCode, `GNU=${native.exitCode}, VFS=${virtual.exitCode}: ${virtual.stderr}`);
    assert.deepEqual(virtual.after, native.after, "complete resulting namespace must match pinned GNU");
    if ((fixture.args ?? []).includes("--dry-run")) assert.deepEqual(virtual.identityAfter, virtual.identityBefore);
  }
}
