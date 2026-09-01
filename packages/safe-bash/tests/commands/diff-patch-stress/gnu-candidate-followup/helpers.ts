import assert from "node:assert/strict";
import { link, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toByteSource } from "../../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { createDiffPatchCommands, diffPatchCommands } from "../../../../src/commands/diff-patch/index.js";
import { Shell } from "../../../../src/shell/index.js";
import { sentinel, type Fixture, type Mode } from "./fixtures.js";

const directory = fileURLToPath(new URL(".", import.meta.url));
type Entry = { type: string; mode: number; ino: number; dev: number; nlink: number; hex?: string; target?: string };
type Namespace = Record<string, Entry>;

async function nativeSnapshot(root: string): Promise<Namespace> {
  const result: Namespace = {};
  const visit = async (relative: string): Promise<void> => {
    const path = join(root, relative);
    const stat = await lstat(path);
    const type = stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : "file";
    const entry: Entry = { type, mode: stat.mode & 0o7777, ino: stat.ino, dev: stat.dev, nlink: stat.nlink };
    result[relative] = entry;
    if (type === "directory") for (const name of (await readdir(path)).sort()) await visit(relative === "." ? name : `${relative}/${name}`);
    else if (type === "symlink") entry.target = await readlink(path);
    else entry.hex = (await readFile(path)).toString("hex");
  };
  await visit(".");
  return result;
}

async function virtualSnapshot(fs: MemoryFileSystem): Promise<Namespace> {
  const result: Namespace = {};
  const visit = async (relative: string): Promise<void> => {
    const path = relative === "." ? "/" : `/${relative}`;
    const stat = await fs.lstat(path);
    assert.notEqual(stat.ino, undefined);
    assert.notEqual(stat.nlink, undefined);
    const entry: Entry = { type: stat.type, mode: stat.mode & 0o7777, ino: stat.ino!, dev: stat.dev ?? 0, nlink: stat.nlink! };
    result[relative] = entry;
    if (stat.type === "directory") for (const name of (await fs.readdir(path)).map(item => item.name).sort()) await visit(relative === "." ? name : `${relative}/${name}`);
    else if (stat.type === "symlink") entry.target = await fs.readlink(path);
    else entry.hex = Buffer.from(await fs.readFile(path)).toString("hex");
  };
  await visit(".");
  return result;
}

export function comparable(namespace: Namespace) {
  return Object.fromEntries(Object.entries(namespace).map(([path, entry]) => [path, {
    type: entry.type,
    ...(entry.hex === undefined ? {} : { hex: entry.hex }),
    ...(entry.target === undefined ? {} : { target: entry.target }),
    ...(entry.type !== "file" ? {} : {
      nlink: entry.nlink,
      aliases: Object.entries(namespace).filter(([, other]) => other.type === "file" && other.dev === entry.dev && other.ino === entry.ino).map(([name]) => name).sort(),
    }),
  }]));
}

export async function probe(fixture: Fixture, mode: Mode) {
  const root = await mkdtemp(join(directory, ".native-"));
  const fs = new MemoryFileSystem();
  const dry = mode.includes("dry-run");
  const atomic = mode.startsWith("atomic");
  const commonArgs = ["--batch", "-p0", ...(dry ? ["--dry-run"] : []), ...(fixture.args ?? [])];
  const virtualArgs = [...(atomic ? ["--atomic"] : []), ...commonArgs.map(arg => arg.replaceAll("{root}", ""))];
  try {
    await mkdir(join(root, "work"));
    await fs.mkdir("/work");
    for (const [path, text] of Object.entries(fixture.files)) {
      assert(!path.startsWith("/") && !path.split("/").includes(".."));
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
      await fs.mkdir(dirname(`/${path}`), { recursive: true });
      await fs.writeFile(`/${path}`, Buffer.from(text));
    }
    for (const [path, target] of Object.entries(fixture.symlinks ?? {})) {
      await symlink(target, join(root, path));
      await fs.symlink(target, `/${path}`);
    }
    for (const [path, target] of Object.entries(fixture.hardlinks ?? {})) {
      await link(join(root, target), join(root, path));
      await fs.link(`/${target}`, `/${path}`);
    }
    const nativeBefore = await nativeSnapshot(root);
    const virtualBefore = await virtualSnapshot(fs);
    assert.deepEqual(comparable(virtualBefore), comparable(nativeBefore), "identical initial namespaces and hardlink equivalence classes");
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const shellInput = `patch ${virtualArgs.map(arg => `'${arg.replaceAll("'", "'\\''")}'`).join(" ")} <<'CANDIDATE_PATCH'\n${fixture.input}CANDIDATE_PATCH\n`;
    const virtual = fixture.shell
      ? await new Shell({ fs, cwd: "/work", limits: { maxOutputBytes: 65_536 } }).use(diffPatchCommands()).exec(shellInput, { signal: AbortSignal.timeout(3000) })
      : await createDiffPatchCommands().find(command => command.name === "patch")!.execute({
        command: "patch", args: virtualArgs, fs, cwd: "/work", env: {}, signal: AbortSignal.timeout(3000),
        stdin: toByteSource(fixture.input), stdinIsDefault: false,
        stdout: { async write(chunk) { stdout.push(chunk.slice()); } },
        stderr: { async write(chunk) { stderr.push(chunk.slice()); } },
      });
    const virtualAfter = await virtualSnapshot(fs);
    assert.deepEqual(await nativeSnapshot(root), nativeBefore, "product never executes against or mutates the host oracle fixture");
    return {
      name: fixture.name, mode, policy: fixture.policy ?? null,
      initial: nativeBefore,
      virtual: { args: virtualArgs, cwd: "/work", input: fixture.input, shellInput: fixture.shell ? shellInput : null, exitCode: virtual.exitCode,
        stdout: "stdout" in virtual ? virtual.stdout : Buffer.concat(stdout).toString(),
        stderr: "stderr" in virtual ? virtual.stderr : Buffer.concat(stderr).toString(), before: virtualBefore, after: virtualAfter },
    };
  } finally {
    try {
      assert.equal(await readFile(join(root, "sentinel"), "utf8"), sentinel);
    } finally {
      await rm(root, { recursive: true });
    }
  }
}

export function verify(fixture: Fixture, mode: Mode, observation: Awaited<ReturnType<typeof probe>>) {
  const { virtual, initial } = observation;
  const dry = mode.includes("dry-run");
  assert.doesNotMatch(String(virtual.stderr), /unsupported option.*atomic|unknown option.*atomic/u);
  if (fixture.policy) {
    if (fixture.policy === "output-alias") {
      assert.match(String(virtual.stderr), mode === "normal" ? /output aliases.*\/work\/a/u : /hunk.*does not match/u);
    } else if (fixture.policy === "backup-alias") {
      assert.match(String(virtual.stderr), /hard.link.*\/work\/a\.orig/u);
    } else {
      assert.match(String(virtual.stderr), /symlink.*\/work\/unused-long-name/u);
    }
    assert.notEqual(virtual.exitCode, 0, "required " + fixture.policy + " safety refusal");
    assert.deepEqual(virtual.after, virtual.before, "project safety refusal preserves complete namespace, bytes, modes, identities and links");
    return;
  }
  const target = fixture.shell ? "authorized/a" : "work/a";
  const expected = comparable(initial);
  expected[target] = { type: "file", hex: Buffer.from(dry ? "old\n" : "new\n").toString("hex"), nlink: 1, aliases: [target] };
  assert.equal(virtual.exitCode, 0, String(virtual.stderr));
  assert.deepEqual(comparable(virtual.after), expected, "complete namespace matches fixture input plus the selected target change");
  if (dry) assert.deepEqual(virtual.after, virtual.before, "VFS dry-run leaves all identities unchanged");
  for (const [path, entry] of Object.entries(virtual.before)) {
    if (path !== target) assert.deepEqual(virtual.after[path], entry, "unused " + path + " identity must survive");
  }
}
