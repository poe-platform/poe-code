import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, link, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { toByteSource } from "../../../../src/contracts/index.js";
import { createDiffPatchCommands } from "../../../../src/commands/diff-patch/index.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { replacement, type Fixture } from "./fixtures.js";
import { collectSourceInputs } from "../../../source-census.js";

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
    assert.deepEqual(await nativeSnapshot(root), nativeBefore, "VFS invocation must not mutate the host fixture");
    assert.equal(await readFile(join(root, "sentinel"), "utf8"), sentinel, "ancestor sentinel must survive");
    return {
      name: fixture.name, policy: fixture.policy ?? false, atomic, input,
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
  const { virtual } = observation;
  if (fixture.policy) {
    assert.notEqual(virtual.exitCode, 0, "required safety rejection");
    assert.deepEqual(virtual.identityAfter, virtual.identityBefore, "safety refusal preserves complete VFS namespace, bytes, and identity");
  } else {
    assert.equal(virtual.exitCode, fixture.nativeStatus ?? 0, virtual.stderr);
    if ((fixture.args ?? []).includes("--dry-run")) assert.deepEqual(virtual.identityAfter, virtual.identityBefore);
  }
}
