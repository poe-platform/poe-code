import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { link, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toByteSource } from "../../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { createDiffPatchCommands, diffPatchCommands } from "../../../../src/commands/diff-patch/index.js";
import { Shell } from "../../../../src/shell/index.js";
import { oracleIdentity } from "../gnu-target/oracle.js";
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
  const oracle = oracleIdentity("patch");
  const root = await mkdtemp(join(directory, ".native-"));
  const fs = new MemoryFileSystem();
  const dry = mode.includes("dry-run");
  const atomic = mode.startsWith("atomic");
  const commonArgs = ["--batch", "-p0", ...(dry ? ["--dry-run"] : []), ...(fixture.args ?? [])];
  const nativeArgs = commonArgs.map(arg => arg.replaceAll("{root}", root));
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
    const env = { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC", HOME: root, TMPDIR: root };
    const native = spawnSync(oracle.path, nativeArgs, {
      cwd: join(root, "work"), env, input: fixture.input, encoding: "utf8", shell: false,
      timeout: 3000, killSignal: "SIGKILL", maxBuffer: 1_048_576,
    });
    assert.ifError(native.error);
    assert.equal(native.signal, null);
    const nativeAfter = await nativeSnapshot(root);
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
    assert.deepEqual(await nativeSnapshot(root), nativeAfter, "product never executes against or mutates the host oracle fixture");
    return {
      name: fixture.name, mode, policy: fixture.policy ?? null, oracle,
      native: { args: nativeArgs, cwd: join(root, "work"), env, input: fixture.input, exitCode: native.status, signal: native.signal, stdout: native.stdout, stderr: native.stderr, before: nativeBefore, after: nativeAfter },
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
  const { native, virtual } = observation;
  const dry = mode.includes("dry-run");
  assert.doesNotMatch(String(virtual.stderr), /unsupported option.*atomic|unknown option.*atomic/u);
  if (fixture.policy) {
    const expected = comparable(native.before);
    const fileEntry = (path: string, text: string) => ({ type: "file", hex: Buffer.from(text).toString("hex"), nlink: 1, aliases: [path] });
    assert.equal(native.stderr, "");
    if (fixture.policy === "output-alias") {
      assert.equal(native.exitCode, 1, "GNU allows reject output alias; project intentionally refuses it");
      assert.equal(native.stdout, "patching file a\nHunk #1 FAILED at 1.\n1 out of 1 hunk FAILED -- saving rejects to file a\n");
      expected["work/a"] = fileEntry("work/a", fixture.input);
      expected["work/a.orig"] = fileEntry("work/a.orig", "old\n");
      assert.match(String(virtual.stderr), mode === "normal" ? /output aliases.*\/work\/a/u : /hunk.*does not match/u);
    } else if (fixture.policy === "backup-alias") {
      assert.equal(native.exitCode, 0);
      assert.equal(native.stdout, "patching file a\nHunk #1 succeeded at 2 (offset 1 line).\n");
      expected["work/a"] = fileEntry("work/a", "padding\nnew\n");
      expected["work/a.orig"] = fileEntry("work/a.orig", "padding\nold\n");
      expected.sentinel = fileEntry("sentinel", sentinel);
      assert.match(String(virtual.stderr), /hard.link.*\/work\/a\.orig/u);
    } else {
      assert.equal(native.exitCode, 1, "GNU refuses selected loop or creation dry-run link");
      const suffix = dry ? "\n" : " -- saving rejects to file unused-long-name.rej\n";
      assert.equal(native.stdout, `${fixture.policy === "creation-dry-run" ? "checking file a\n" : ""}File unused-long-name is not a regular file -- refusing to patch\n1 out of 1 hunk ignored${suffix}`);
      if (!dry) expected["work/unused-long-name.rej"] = fileEntry("work/unused-long-name.rej", fixture.input);
      assert.match(String(virtual.stderr), /symlink.*\/work\/unused-long-name/u);
    }
    assert.deepEqual(comparable(native.after), expected, "pinned GNU complete safety-control namespace, including any actual reject/backup outputs");
    if (dry) assert.deepEqual(native.after, native.before, "native dry-run preserves every namespace entry and identity");
    assert.notEqual(virtual.exitCode, 0, `required ${fixture.policy} safety refusal`);
    assert.deepEqual(virtual.after, virtual.before, "project safety refusal preserves complete namespace, bytes, modes, identities and links");
    return;
  }
  assert.equal(native.exitCode, 0, native.stderr);
  assert.equal(native.stderr, "");
  const target = fixture.shell ? "authorized/a" : "work/a";
  const expected = comparable(native.before);
  expected[target] = { type: "file", hex: Buffer.from(dry ? "old\n" : "new\n").toString("hex"), nlink: 1, aliases: [target] };
  assert.deepEqual(comparable(native.after), expected, "GNU changes only the selected target; no unexpected backups/rejects/alias effects");
  for (const [path, entry] of Object.entries(native.before)) {
    if (path !== target && entry.type !== "directory") assert.deepEqual(native.after[path], entry, `GNU unused ${path} identity must survive`);
  }
  if (dry) assert.deepEqual(native.after, native.before, "GNU dry-run leaves all identities unchanged");
  const expectedStdout = fixture.shell ? `patching file ${native.args.at(-1)}\n` : fixture.name.startsWith("create-") ? "patching file a\npatching file a\n" : `${dry ? "checking" : "patching"} file a\n`;
  assert.equal(native.stdout, expectedStdout);
  assert.equal(virtual.exitCode, 0, String(virtual.stderr));
  assert.deepEqual(comparable(virtual.after), expected, "actual MemoryFS product result must match full GNU namespace");
  if (dry) assert.deepEqual(virtual.after, virtual.before, "VFS dry-run leaves all identities unchanged");
  for (const [path, entry] of Object.entries(virtual.before)) {
    if (path !== target) assert.deepEqual(virtual.after[path], entry, `unused ${path} identity must survive`);
  }
}
