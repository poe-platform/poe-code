import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { oracleIdentity } from "../gnu-target/oracle.js";
import { creation, cwd, instrument, invoke, replacement, snapshot } from "../safety/helpers.js";

export const fixtures = [
  {
    id: "author-ancestor",
    cwd: "/work",
    files: { target: "old\n", "dir/target": "old\n", input: replacement() },
    links: { alias: "target", linkdir: "dir", linkinput: "input" },
    input: replacement("linkdir/target"),
    selected: { target: "new\n" },
    retainedPath: "linkdir/target",
  },
  {
    id: "independent-ancestor",
    cwd,
    files: { first: "old\n", target: "old\n", "dir/target": "old\n", patch: replacement(), blocker: "old\n" },
    links: { alias: "dir" },
    input: replacement("first") + replacement("alias/target"),
    selected: { first: "new\n", target: "new\n" },
    retainedPath: "alias/target",
  },
  {
    id: "independent-file-parent",
    cwd,
    files: { first: "old\n", target: "old\n", "dir/target": "old\n", patch: replacement(), blocker: "old\n" },
    links: {},
    input: replacement("first") + creation("blocker/child"),
    selected: { first: "new\n", child: "created\n" },
    retainedPath: "blocker/child",
  },
] satisfies readonly Fixture[];

export interface Fixture {
  readonly id: string;
  readonly cwd: string;
  readonly files: Readonly<Record<string, string>>;
  readonly links: Readonly<Record<string, string>>;
  readonly input: string;
  readonly selected: Readonly<Record<string, string>>;
  readonly retainedPath: string;
}

export interface Entry {
  readonly path: string;
  readonly type: string;
  readonly mode: number;
  readonly ino: number | undefined;
  readonly dev: number | undefined;
  readonly nlink: number | undefined;
  readonly data?: string;
  readonly link?: string;
}

async function nativeSnapshot(root: string): Promise<Entry[]> {
  const entries: Entry[] = [];
  const visit = async (path: string): Promise<void> => {
    const absolute = join(root, path);
    const stat = await lstat(absolute);
    const type = stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : "file";
    const entry = { path, type, mode: stat.mode & 0o7777, ino: stat.ino, dev: stat.dev, nlink: stat.nlink };
    if (type === "symlink") entries.push({ ...entry, link: await readlink(absolute) });
    else if (type === "file") entries.push({ ...entry, data: (await readFile(absolute)).toString("hex") });
    else {
      entries.push(entry);
      for (const name of (await readdir(absolute)).sort()) await visit(`${path === "/" ? "" : path}/${name}`);
    }
  };
  await visit("/");
  return entries;
}

export async function capture(fixture: Fixture, args: readonly string[]) {
  const oracle = oracleIdentity("patch");
  const root = await mkdtemp(join(tmpdir(), "safe-bash-safety-strip-"));
  try {
    const backing = new MemoryFileSystem();
    await backing.mkdir(fixture.cwd, { recursive: true });
    await backing.writeFile("/sentinel", Buffer.from("boundary unchanged\n"));
    await mkdir(join(root, fixture.cwd), { recursive: true });
    await writeFile(join(root, "sentinel"), "boundary unchanged\n");
    for (const [path, data] of Object.entries(fixture.files)) {
      await backing.mkdir(dirname(`${fixture.cwd}/${path}`), { recursive: true });
      await backing.writeFile(`${fixture.cwd}/${path}`, Buffer.from(data));
      await mkdir(dirname(join(root, fixture.cwd, path)), { recursive: true });
      await writeFile(join(root, fixture.cwd, path), data);
    }
    for (const [path, target] of Object.entries(fixture.links)) {
      await backing.symlink(target, `${fixture.cwd}/${path}`);
      await symlink(target, join(root, fixture.cwd, path));
    }
    const nativeBefore = await nativeSnapshot(root);
    const native = spawnSync(oracle.path, [...args], {
      cwd: join(root, fixture.cwd), input: fixture.input, encoding: "utf8", shell: false,
      timeout: 3000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
      env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC", HOME: root, TMPDIR: root },
    });
    assert.ifError(native.error);
    assert.equal(native.signal, null);
    const productBefore = await snapshot(backing) as Entry[];
    const observed = instrument(backing);
    const result = await invoke(observed.fs, "patch", { args, input: fixture.input, cwd: fixture.cwd });
    return {
      id: fixture.id, cwd: fixture.cwd, args, input: fixture.input,
      selectedPaths: args.length === 0 ? Object.keys(fixture.selected) : [...("first" in fixture.files ? ["first"] : []), fixture.retainedPath],
      native: { exitCode: native.status, stdout: native.stdout, stderr: native.stderr, before: nativeBefore, after: await nativeSnapshot(root) },
      product: { ...result, before: productBefore, after: await snapshot(backing) as Entry[], mutations: observed.mutations().map(({ method, path }) => ({ method, path })) },
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export function semanticNamespace(entries: readonly Entry[]) {
  return entries.map(({ path, type, data, link }) => ({ path, type, ...(data === undefined ? {} : { data }), ...(link === undefined ? {} : { link }) }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function assertDefaultAcceptance(fixture: Fixture, result: Awaited<ReturnType<typeof capture>>) {
  const expected = semanticNamespace(result.native.before);
  for (const [path, data] of Object.entries(fixture.selected)) {
    const absolute = `${fixture.cwd}/${path}`;
    const entry = { path: absolute, type: "file", data: Buffer.from(data).toString("hex") };
    const index = expected.findIndex(candidate => candidate.path === absolute);
    if (index < 0) expected.push(entry);
    else expected[index] = entry;
  }
  expected.sort((left, right) => left.path.localeCompare(right.path));
  for (const execution of [result.native, result.product]) {
    assert.equal(execution.exitCode, 0, execution.stderr);
    assert.equal(execution.stdout, Object.keys(fixture.selected).map(path => `patching file ${path}\n`).join(""));
    assert.equal(execution.stderr, "");
    assert.deepEqual(semanticNamespace(execution.after), expected);
    const createdParents = Object.keys(fixture.selected).filter(path => !execution.before.some(entry => entry.path === `${fixture.cwd}/${path}`))
      .map(path => dirname(`${fixture.cwd}/${path}`));
    const ignored = (entries: readonly Entry[]) => entries.filter(entry => !Object.keys(fixture.selected).some(path => entry.path === `${fixture.cwd}/${path}`))
      .map(entry => createdParents.includes(entry.path) ? { ...entry, nlink: undefined } : entry)
      .sort((left, right) => left.path.localeCompare(right.path));
    assert.deepEqual(ignored(execution.after), ignored(execution.before), "All ignored prefixes, referents, aliases, directories and sentinels retain identities and bytes");
  }
  assert.deepEqual(result.product.mutations, Object.keys(fixture.selected).map(path => ({ method: "writeFile", path: `${fixture.cwd}/${path}` })));
}
