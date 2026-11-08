import type { FileStat, FileStaging, FileSystem, StagedFileContent } from "../contracts/filesystem.js";

export interface AtomicFileSystemConformanceFixture {
  readonly fs: FileSystem;
  readonly peer?: FileSystem;
  readonly root: string;
  dispose(): void | Promise<void>;
}

export interface AtomicFileSystemConformanceOptions {
  readonly createFixture: () => AtomicFileSystemConformanceFixture | Promise<AtomicFileSystemConformanceFixture>;
  readonly includeSymlinks?: boolean;
}

export interface AtomicFileSystemConformanceCase {
  readonly name: string;
  run(): Promise<void>;
}

type AtomicFileSystem = FileSystem & Required<Pick<FileSystem,
  "writeFileConditional" | "removeFileConditional" | "createStagedFile" |
  "publishStagedFile" | "removeStagedFile" | "prepareDirectory"
>>;

interface Context {
  fs: AtomicFileSystem;
  peer: AtomicFileSystem;
  root: string;
  path(name: string): string;
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function identity(stat: FileStat, label: string): void {
  check((typeof stat.identityScope === "object" && stat.identityScope !== null) || typeof stat.identityScope === "symbol", `${label}: unavailable identityScope`);
  check(Number.isSafeInteger(stat.ino) && stat.ino! >= 0 && Number.isSafeInteger(stat.dev) && stat.dev! >= 0, `${label}: unavailable scoped identity`);
}

function sameIdentity(actual: FileStat, expected: FileStat, label: string): void {
  identity(actual, label);
  identity(expected, label);
  for (const field of ["identityScope", "ino", "dev", "type"] as const) {
    check(actual[field] === expected[field], `${label}: changed ${field}`);
  }
}

function revision(stat: FileStat, label: string): void {
  identity(stat, label);
  check(Number.isSafeInteger(stat.revision) && stat.revision! >= 0, `${label}: unavailable revision`);
}

function sameSnapshot(actual: FileStat, expected: FileStat, label: string): void {
  sameIdentity(actual, expected, label);
  if (actual.type !== "directory" || actual.revision !== undefined) revision(actual, label);
  if (expected.type !== "directory" || expected.revision !== undefined) revision(expected, label);
  for (const field of ["revision", "size", "mode", "nlink", "mtimeMs", "ctimeMs"] as const) {
    check(actual[field] === expected[field], `${label}: changed ${field}`);
  }
}

async function bytes(fs: FileSystem, path: string, expected: Uint8Array): Promise<void> {
  const actual = await fs.readFile(path);
  check(actual.length === expected.length && actual.every((value, index) => value === expected[index]), `${path}: incorrect bytes`);
}

async function entries(fs: FileSystem, path: string, expected: readonly string[]): Promise<void> {
  const actual = (await fs.readdir(path)).map(entry => entry.name).sort();
  const names = [...expected].sort();
  check(actual.length === names.length && actual.every((name, index) => name === names[index]), `${path}: unexpected directory entries (${actual.join(", ")})`);
}

async function refuses(operation: () => Promise<unknown>, codes: readonly string[]): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const code: unknown = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    check(typeof code === "string" && codes.includes(code), `expected ${codes.join(" or ")}, received ${String(code)}`);
    return;
  }
  throw new Error(`expected rejection (${codes.join(" or ")})`);
}

async function validate(fs: FileSystem, root: string, symlinks: boolean): Promise<AtomicFileSystem> {
  const profiles = {
    atomicFileStaging: ["createStagedFile", "publishStagedFile", "removeStagedFile"],
    atomicFileMutation: ["writeFileConditional", "removeFileConditional"],
    atomicDirectoryMetadata: ["prepareDirectory"],
  } as const;
  const capabilities = fs.capabilitiesFor ? await fs.capabilitiesFor(root) : fs.capabilities;
  for (const [capability, methods] of Object.entries(profiles)) {
    check(fs.capabilities[capability] === true && capabilities[capability] === true, `required capability ${capability} is unavailable`);
    for (const method of methods) check(typeof fs[method] === "function", `required method ${method} is unavailable`);
  }
  if (symlinks) {
    for (const capability of ["symlinks", "readlink"] as const) {
      check(fs.capabilities[capability] === true && capabilities[capability] === true, `selected capability ${capability} is unavailable`);
    }
    for (const method of ["symlink", "readlink"] as const) check(typeof fs[method] === "function", `selected method ${method} is unavailable`);
  }
  const stat = await fs.lstat(root);
  check(stat.type === "directory", "fixture root must be an owned directory, not a symlink");
  identity(stat, "fixture root");
  check((await fs.readdir(root)).length === 0, "fixture root must be isolated and empty");
  return fs as AtomicFileSystem;
}

async function stage(context: Context, name = ".stage", content: StagedFileContent = { type: "file", data: Uint8Array.of(0, 255, 1, 128) }): Promise<FileStaging> {
  const { fs, root, path } = context;
  const parent = await fs.lstat(root);
  const receipt = await fs.createStagedFile(path(name), "file", content, { parent });
  check(receipt.parent.path === root && receipt.directory.path === path(name) && receipt.file.path === path(`${name}/file`), "staging receipt paths must remain in the owned root");
  sameIdentity(receipt.parent.stat, parent, "staging parent receipt");
  check(receipt.directory.stat.type === "directory", "staging directory receipt type");
  check(receipt.file.stat.type === content.type, "staging file receipt type");
  sameSnapshot(receipt.directory.stat, await fs.lstat(receipt.directory.path), "staging directory receipt");
  sameSnapshot(receipt.file.stat, await fs.lstat(receipt.file.path), "staging file receipt");
  return receipt;
}

async function winner(operations: readonly Promise<FileStat>[], clients: readonly FileSystem[], path: string, candidates: readonly Uint8Array[]): Promise<void> {
  const results = await Promise.allSettled(operations);
  check(results.filter(result => result.status === "fulfilled").length === 1, "conditional mutation must have exactly one winner");
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      const fs = clients[index]!;
      sameSnapshot(result.value, await fs.lstat(path), "winner receipt");
      await bytes(fs, path, candidates[index]!);
    } else {
      check(result.reason?.code === "EAGAIN", "conditional mutation loser must reject EAGAIN");
    }
  }
}

export function createAtomicFileSystemConformance(options: AtomicFileSystemConformanceOptions): readonly AtomicFileSystemConformanceCase[] {
  const cases: AtomicFileSystemConformanceCase[] = [];
  const add = (name: string, exercise: (context: Context) => Promise<void>): void => {
    cases.push(Object.freeze({ name, async run() {
      const fixture = await options.createFixture();
      try {
        const { root } = fixture;
        check(root.startsWith("/") && !root.includes("\0") && (root === "/" || root.slice(1).split("/").every(part => part !== "" && part !== "." && part !== "..")), "fixture root must be a normalized absolute path");
        const fs = await validate(fixture.fs, root, options.includeSymlinks === true);
        const peer = fixture.peer ? await validate(fixture.peer, root, options.includeSymlinks === true) : fs;
        await exercise({ fs, peer, root, path: name => `${root === "/" ? "" : root}/${name}` });
      } finally {
        await fixture.dispose();
      }
    } }));
  };

  add("conditional receipts preserve original identity and revision", async ({ fs, root, path }) => {
    const parent = await fs.lstat(root);
    const receipt = await fs.writeFileConditional(path("file"), Uint8Array.of(1, 2), { parent, expected: null, mode: 0o600 });
    check(receipt.type === "file", "conditional receipt must be a regular file");
    sameSnapshot(receipt, await fs.lstat(path("file")), "creation receipt");
    const original = { ...receipt };
    const updated = await fs.writeFileConditional(path("file"), Uint8Array.of(3, 4), { parent, expected: receipt });
    sameIdentity(updated, receipt, "updated file");
    check(updated.revision !== original.revision, "write must advance revision");
    sameSnapshot(receipt, original, "original receipt must not mutate");
    sameSnapshot(updated, await fs.lstat(path("file")), "update receipt");
    await bytes(fs, path("file"), Uint8Array.of(3, 4));
    await fs.removeFileConditional(path("file"), { parent, expected: updated });
    await entries(fs, root, []);
  });

  for (const existing of [false, true]) add(`conditional ${existing ? "update" : "create"} has one winner`, async ({ fs, peer, root, path }) => {
    const parent = await fs.lstat(root);
    if (existing) await fs.writeFileConditional(path("file"), Uint8Array.of(0), { parent, expected: null });
    const expected = existing ? await fs.lstat(path("file")) : null;
    const peerExpected = existing ? await peer.lstat(path("file")) : null;
    const peerParent = await peer.lstat(root);
    const candidates = [Uint8Array.of(1, 2), Uint8Array.of(3, 4, 5)];
    await winner([
      fs.writeFileConditional(path("file"), candidates[0]!, { parent, expected }),
      peer.writeFileConditional(path("file"), candidates[1]!, { parent: peerParent, expected: peerExpected }),
    ], [fs, peer], path("file"), candidates);
    await bytes(peer, path("file"), await fs.readFile(path("file")));
  });

  add("conditional append creates and preserves exact bytes", async ({ fs, root, path }) => {
    const parent = await fs.lstat(root);
    const created = await fs.writeFileConditional(path("file"), Uint8Array.of(0, 255), { parent, expected: null, append: true });
    const appended = await fs.writeFileConditional(path("file"), Uint8Array.of(128, 1), { parent, expected: created, append: true });
    await bytes(fs, path("file"), Uint8Array.of(0, 255, 128, 1));
    check(appended.revision !== created.revision, "append must advance revision");
    sameSnapshot(appended, await fs.lstat(path("file")), "append receipt");
  });

  add("same-length writes invalidate file revisions", async ({ fs, peer, root, path }) => {
    const parent = await fs.lstat(root);
    const expected = await fs.writeFileConditional(path("file"), Uint8Array.of(1, 2), { parent, expected: null });
    await peer.writeFile(path("file"), Uint8Array.of(3, 4));
    const current = await fs.lstat(path("file"));
    check(current.revision !== expected.revision, "same-length write must advance revision");
    const stale = { ...current, revision: expected.revision! };
    for (const append of [false, true]) await refuses(() => fs.writeFileConditional(path("file"), Uint8Array.of(5, 6), { parent, expected: stale, append }), ["EAGAIN"]);
    await refuses(() => fs.removeFileConditional(path("file"), { parent, expected: stale }), ["EAGAIN"]);
    sameSnapshot(await fs.lstat(path("file")), current, "stale mutation refusal");
    await bytes(fs, path("file"), Uint8Array.of(3, 4));
  });

  add("missing expected files are not recreated", async ({ fs, peer, root, path }) => {
    const parent = await fs.lstat(root);
    await fs.writeFile(path("file"), Uint8Array.of(1));
    const expected = await fs.lstat(path("file"));
    await peer.rm(path("file"));
    for (const append of [false, true]) await refuses(() => fs.writeFileConditional(path("file"), Uint8Array.of(2), { parent, expected, append }), ["EAGAIN"]);
    await refuses(() => fs.removeFileConditional(path("file"), { parent, expected }), ["EAGAIN"]);
    await entries(fs, root, []);
  });

  add("file snapshot metadata is checked", async context => {
    const { fs, root, path } = context;
    const parent = await fs.lstat(root);
    const expected = await fs.writeFileConditional(path("file"), Uint8Array.of(1), { parent, expected: null });
    const staged = await stage(context);
    for (const field of ["size", "mode", "nlink", "mtimeMs", "ctimeMs"] as const) {
      const changed = { ...expected, [field]: (expected[field] ?? 0) + 1 };
      const changedStage = { ...staged, file: { ...staged.file, stat: {
        ...staged.file.stat, [field]: (staged.file.stat[field] ?? 0) + 1,
      } } };
      await refuses(() => fs.writeFileConditional(path("file"), Uint8Array.of(2), { parent, expected: changed }), ["EAGAIN"]);
      await refuses(() => fs.removeFileConditional(path("file"), { parent, expected: changed }), ["EAGAIN"]);
      await refuses(() => fs.publishStagedFile(staged, path("file"), { parent, destination: changed }), ["EAGAIN"]);
      await refuses(() => fs.publishStagedFile(changedStage, path("output"), { parent, destination: null }), ["EAGAIN"]);
      await refuses(() => fs.removeStagedFile(changedStage), ["EAGAIN"]);
    }
    sameSnapshot(await fs.lstat(path("file")), expected, "file metadata refusal");
    sameSnapshot(await fs.lstat(staged.file.path), staged.file.stat, "staged metadata refusal");
    await bytes(fs, path("file"), Uint8Array.of(1));
    await bytes(fs, staged.file.path, Uint8Array.of(0, 255, 1, 128));
    await entries(fs, root, ["file", ".stage"]);
  });

  add("unknown identities and revisions refuse without mutation", async context => {
    const { fs, root, path } = context;
    const parent = await fs.lstat(root);
    const expected = await fs.writeFileConditional(path("file"), Uint8Array.of(1), { parent, expected: null });
    const unknownParent = { ...parent };
    delete unknownParent.identityScope;
    const unknownFile = { ...expected };
    delete unknownFile.revision;
    await refuses(() => fs.writeFileConditional(path("file"), Uint8Array.of(2), { parent, expected: unknownFile }), ["ENOTSUP"]);
    await refuses(() => fs.removeFileConditional(path("file"), { parent, expected: unknownFile }), ["ENOTSUP"]);
    await refuses(() => fs.writeFileConditional(path("new"), Uint8Array.of(2), { parent: unknownParent, expected: null }), ["ENOTSUP"]);
    await refuses(() => fs.removeFileConditional(path("file"), { parent: unknownParent, expected }), ["ENOTSUP"]);
    await refuses(() => fs.createStagedFile(path(".denied"), "file", { type: "file", data: Uint8Array.of(2) }, { parent: unknownParent }), ["ENOTSUP"]);
    await refuses(() => fs.prepareDirectory(path("denied"), { parent: unknownParent, expected: null }), ["ENOTSUP"]);
    const staged = await stage(context);
    const unknownStage = { ...staged, file: { ...staged.file, stat: { ...staged.file.stat } } };
    delete unknownStage.file.stat.revision;
    await refuses(() => fs.publishStagedFile(unknownStage, path("output"), { parent, destination: null }), ["ENOTSUP"]);
    await refuses(() => fs.removeStagedFile(unknownStage), ["ENOTSUP"]);
    await fs.removeStagedFile(staged);
    sameSnapshot(await fs.lstat(path("file")), expected, "unsupported conditions");
    await bytes(fs, path("file"), Uint8Array.of(1));
    await entries(fs, root, ["file"]);
  });

  add("parent replacement refuses mutations and staging", async context => {
    const { fs, peer, path } = context;
    await fs.mkdir(path("parent"));
    const parent = await fs.lstat(path("parent"));
    const expected = await fs.writeFileConditional(path("parent/file"), Uint8Array.of(1), { parent, expected: null });
    const staged = await stage({ ...context, root: path("parent"), path: name => path(`parent/${name}`) });
    await peer.rename(path("parent"), path("original"));
    await peer.mkdir(path("parent"));
    await peer.writeFile(path("parent/file"), Uint8Array.of(9));
    await refuses(() => fs.writeFileConditional(path("parent/file"), Uint8Array.of(2), { parent, expected }), ["EAGAIN"]);
    await refuses(() => fs.writeFileConditional(path("parent/new"), Uint8Array.of(2), { parent, expected: null }), ["EAGAIN"]);
    await refuses(() => fs.removeFileConditional(path("parent/file"), { parent, expected }), ["EAGAIN"]);
    await refuses(() => fs.createStagedFile(path("parent/.new"), "file", { type: "file", data: Uint8Array.of(2) }, { parent }), ["EAGAIN"]);
    await refuses(() => fs.prepareDirectory(path("parent/new"), { parent, expected: null }), ["EAGAIN"]);
    await refuses(() => fs.publishStagedFile(staged, path("parent/output"), { parent, destination: null }), ["EAGAIN"]);
    await refuses(() => fs.removeStagedFile(staged), ["EAGAIN"]);
    await bytes(fs, path("parent/file"), Uint8Array.of(9));
    await bytes(fs, path("original/file"), Uint8Array.of(1));
    await bytes(fs, path("original/.stage/file"), Uint8Array.of(0, 255, 1, 128));
    await entries(fs, path("parent"), ["file"]);
  });

  add("staging receipts preserve original identity and revision", async context => {
    const { fs, path } = context;
    const staged = await stage(context);
    const original = { ...staged.file.stat };
    await fs.writeFile(staged.file.path, Uint8Array.of(4, 3, 2, 1));
    sameSnapshot(staged.file.stat, original, "original staging receipt must not mutate");
    const current = await fs.lstat(staged.file.path);
    check(current.revision !== original.revision, "staged same-length write must advance revision");
    await refuses(() => fs.publishStagedFile(staged, path("output"), { parent: staged.parent.stat, destination: null }), ["EAGAIN"]);
    await refuses(() => fs.removeStagedFile(staged), ["EAGAIN"]);
    const stale = { ...staged, file: { ...staged.file, stat: { ...current, revision: original.revision! } } };
    await refuses(() => fs.publishStagedFile(stale, path("output"), { parent: staged.parent.stat, destination: null }), ["EAGAIN"]);
    await refuses(() => fs.removeStagedFile(stale), ["EAGAIN"]);
    await bytes(fs, staged.file.path, Uint8Array.of(4, 3, 2, 1));
    await refuses(() => fs.lstat(path("output")), ["ENOENT"]);
  });

  add("destination-parent replacement refuses publication", async context => {
    const { fs, peer, path } = context;
    const staged = await stage(context);
    await fs.mkdir(path("destination"));
    const parent = await fs.lstat(path("destination"));
    await peer.rename(path("destination"), path("original"));
    await peer.mkdir(path("destination"));
    await peer.writeFile(path("destination/unrelated"), Uint8Array.of(9));
    await refuses(() => fs.publishStagedFile(staged, path("destination/output"), { parent, destination: null }), ["EAGAIN"]);
    await bytes(fs, staged.file.path, Uint8Array.of(0, 255, 1, 128));
    await bytes(fs, path("destination/unrelated"), Uint8Array.of(9));
    await entries(fs, path("destination"), ["unrelated"]);
    await entries(fs, path("original"), []);
    await fs.removeStagedFile(staged);
  });

  add("staging is exclusive and private", async context => {
    const { fs } = context;
    const staged = await stage(context);
    check((staged.directory.stat.mode & 0o777) === 0o700, "staging receipt must declare private mode 0700");
    check(((await fs.lstat(staged.directory.path)).mode & 0o777) === 0o700, "staging must be private mode 0700");
    await refuses(() => fs.createStagedFile(staged.directory.path, "other", { type: "file", data: Uint8Array.of(9) }, { parent: staged.parent.stat }), ["EEXIST"]);
    sameSnapshot(await fs.lstat(staged.file.path), staged.file.stat, "exclusive staging refusal");
    await entries(fs, staged.directory.path, ["file"]);
    await bytes(fs, staged.file.path, Uint8Array.of(0, 255, 1, 128));
    await fs.removeStagedFile(staged);
    await entries(fs, context.root, []);
  });

  for (const directory of [false, true]) add(`stage-${directory ? "directory" : "file"} replacement survives rejection`, async context => {
    const { fs, peer, path } = context;
    const staged = await stage(context);
    const replaced = directory ? staged.directory.path : staged.file.path;
    const original = path("original");
    await peer.rename(replaced, original);
    if (directory) await peer.mkdir(replaced, { mode: 0o700 });
    await peer.writeFile(staged.file.path, Uint8Array.of(9));
    const replacement = await fs.lstat(staged.file.path);
    await refuses(() => fs.publishStagedFile(staged, path("output"), { parent: staged.parent.stat, destination: null }), ["EAGAIN"]);
    await refuses(() => fs.removeStagedFile(staged), ["EAGAIN"]);
    sameSnapshot(await fs.lstat(staged.file.path), replacement, "replacement must survive");
    await bytes(fs, staged.file.path, Uint8Array.of(9));
    await bytes(fs, directory ? `${original}/file` : original, Uint8Array.of(0, 255, 1, 128));
    await refuses(() => fs.lstat(path("output")), ["ENOENT"]);
  });

  for (const replaced of [false, true]) add(replaced ? "destination replacement survives publication rejection" : "destination revision changes refuse publication", async context => {
    const { fs, peer, root, path } = context;
    const parent = await fs.lstat(root);
    await fs.writeFile(path("output"), Uint8Array.of(1, 2));
    const destination = await fs.lstat(path("output"));
    const staged = await stage(context);
    if (replaced) await peer.rename(path("output"), path("original"));
    await peer.writeFile(path("output"), Uint8Array.of(3, 4));
    const replacement = await fs.lstat(path("output"));
    await refuses(() => fs.publishStagedFile(staged, path("output"), { parent, destination }), ["EAGAIN"]);
    await fs.removeStagedFile(staged);
    sameSnapshot(await fs.lstat(path("output")), replacement, "destination must survive");
    await bytes(fs, path("output"), Uint8Array.of(3, 4));
    if (replaced) await bytes(fs, path("original"), Uint8Array.of(1, 2));
  });

  add("missing and unexpectedly present destinations refuse publication", async context => {
    const { fs, peer, path } = context;
    await fs.writeFile(path("output"), Uint8Array.of(1));
    const destination = await fs.lstat(path("output"));
    const staged = await stage(context);
    await peer.rm(path("output"));
    await refuses(() => fs.publishStagedFile(staged, path("output"), { parent: staged.parent.stat, destination }), ["EAGAIN"]);
    await refuses(() => fs.lstat(path("output")), ["ENOENT"]);
    await peer.writeFile(path("output"), Uint8Array.of(9));
    await refuses(() => fs.publishStagedFile(staged, path("output"), { parent: staged.parent.stat, destination: null }), ["EAGAIN"]);
    await fs.removeStagedFile(staged);
    await bytes(fs, path("output"), Uint8Array.of(9));
  });

  add("unexpected staging children survive cleanup refusal", async context => {
    const { fs, peer } = context;
    const staged = await stage(context);
    await peer.writeFile(`${staged.directory.path}/unexpected`, Uint8Array.of(9));
    await refuses(() => fs.removeStagedFile(staged), ["EAGAIN", "ENOTEMPTY"]);
    await bytes(fs, staged.file.path, Uint8Array.of(0, 255, 1, 128));
    await bytes(fs, `${staged.directory.path}/unexpected`, Uint8Array.of(9));
    await entries(fs, staged.directory.path, ["file", "unexpected"]);
  });

  add("unexpected children survive post-publication cleanup refusal", async context => {
    const { fs, peer, path } = context;
    const staged = await stage(context);
    await fs.publishStagedFile(staged, path("output"), { parent: staged.parent.stat, destination: null });
    await peer.writeFile(`${staged.directory.path}/unexpected`, Uint8Array.of(9));
    await refuses(() => fs.removeStagedFile(staged), ["EAGAIN", "ENOTEMPTY"]);
    await bytes(fs, path("output"), Uint8Array.of(0, 255, 1, 128));
    await bytes(fs, `${staged.directory.path}/unexpected`, Uint8Array.of(9));
    await entries(fs, staged.directory.path, ["unexpected"]);
  });

  for (const existing of [false, true]) add(`publish ${existing ? "updates" : "creates"} exact bytes and cleans only the private directory`, async context => {
    const { fs, root, path } = context;
    const parent = await fs.lstat(root);
    await fs.writeFile(path("unrelated"), Uint8Array.of(9));
    if (existing) await fs.writeFile(path("output"), Uint8Array.of(8));
    const destination = existing ? await fs.lstat(path("output")) : null;
    const staged = await stage(context);
    await fs.publishStagedFile(staged, path("output"), { parent, destination });
    sameIdentity(await fs.lstat(path("output")), staged.file.stat, "published identity");
    await entries(fs, staged.directory.path, []);
    await bytes(fs, path("output"), Uint8Array.of(0, 255, 1, 128));
    await fs.removeStagedFile(staged);
    await bytes(fs, path("output"), Uint8Array.of(0, 255, 1, 128));
    await bytes(fs, path("unrelated"), Uint8Array.of(9));
    await entries(fs, root, ["output", "unrelated"]);
  });

  add("directories create exclusively and update despite child changes", async ({ fs, peer, root, path }) => {
    const parent = await fs.lstat(root);
    const receipt = await fs.prepareDirectory(path("directory"), { parent, expected: null, mode: 0o755 });
    check(receipt.type === "directory", "prepareDirectory must return a directory");
    sameSnapshot(receipt, await fs.lstat(path("directory")), "directory creation receipt");
    const original = { ...receipt };
    await refuses(() => fs.prepareDirectory(path("directory"), { parent, expected: null, mode: 0o700 }), ["EAGAIN"]);
    await peer.writeFile(path("directory/child"), Uint8Array.of(9));
    const updated = await fs.prepareDirectory(path("directory"), { parent, expected: receipt, mode: 0o700 });
    sameIdentity(updated, original, "directory update identity");
    sameSnapshot(updated, await fs.lstat(path("directory")), "directory update receipt");
    sameSnapshot(receipt, original, "original directory receipt must not mutate");
    check((updated.mode & 0o777) === 0o700, "directory metadata update must apply mode");
    await bytes(fs, path("directory/child"), Uint8Array.of(9));
  });

  add("directory creation has one winner", async ({ fs, peer, root, path }) => {
    const parent = await fs.lstat(root);
    const peerParent = await peer.lstat(root);
    const results = await Promise.allSettled([
      fs.prepareDirectory(path("directory"), { parent, expected: null, mode: 0o755 }),
      peer.prepareDirectory(path("directory"), { parent: peerParent, expected: null, mode: 0o700 }),
    ]);
    check(results.filter(result => result.status === "fulfilled").length === 1, "directory creation must have exactly one winner");
    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled") {
        check(result.value.type === "directory", "directory winner receipt type");
        check((result.value.mode & 0o777) === (index === 0 ? 0o755 : 0o700), "directory winner metadata");
        sameSnapshot(result.value, await [fs, peer][index]!.lstat(path("directory")), "directory winner receipt");
      } else check(result.reason?.code === "EAGAIN", "directory creation loser must reject EAGAIN");
    }
    check((await peer.lstat(path("directory"))).type === "directory", "peer directory visibility");
    await entries(peer, path("directory"), []);
    await entries(fs, path("directory"), []);
    await entries(fs, root, ["directory"]);
  });

  add("stale directories refuse metadata changes", async ({ fs, peer, root, path }) => {
    const parent = await fs.lstat(root);
    const expected = await fs.prepareDirectory(path("directory"), { parent, expected: null, mode: 0o755 });
    await peer.rename(path("directory"), path("original"));
    await peer.mkdir(path("directory"), { mode: 0o755 });
    await peer.writeFile(path("directory/child"), Uint8Array.of(9));
    const replacement = await fs.lstat(path("directory"));
    await refuses(() => fs.prepareDirectory(path("directory"), { parent, expected, mode: 0o700 }), ["EAGAIN"]);
    sameSnapshot(await fs.lstat(path("directory")), replacement, "replacement directory must survive");
    await bytes(fs, path("directory/child"), Uint8Array.of(9));
    await entries(fs, path("original"), []);
  });

  add("pre-aborted operations leave entries unchanged", async context => {
    const { fs, root, path } = context;
    const parent = await fs.lstat(root);
    const file = await fs.writeFileConditional(path("file"), Uint8Array.of(9), { parent, expected: null });
    const directory = await fs.prepareDirectory(path("directory"), { parent, expected: null, mode: 0o755 });
    const staged = await stage(context);
    const controller = new AbortController();
    const reason = new Error("conformance pre-abort");
    controller.abort(reason);
    const signal = controller.signal;
    const operations = [
      () => fs.writeFileConditional(path("new"), Uint8Array.of(1), { parent, expected: null, signal }),
      () => fs.writeFileConditional(path("file"), Uint8Array.of(1), { parent, expected: file, signal }),
      () => fs.removeFileConditional(path("file"), { parent, expected: file, signal }),
      () => fs.createStagedFile(path(".new"), "file", { type: "file" as const, data: Uint8Array.of(1) }, { parent, signal }),
      () => fs.publishStagedFile(staged, path("output"), { parent, destination: null, signal }),
      () => fs.removeStagedFile(staged, { signal }),
      () => fs.prepareDirectory(path("new-directory"), { parent, expected: null, signal }),
      () => fs.prepareDirectory(path("directory"), { parent, expected: directory, mode: 0o700, signal }),
    ];
    for (const operation of operations) {
      let rejected = false;
      try { await operation(); } catch (error) {
        rejected = true;
        check(error === reason, "pre-aborted operation must preserve the signal reason");
      }
      check(rejected, "pre-aborted operation must reject");
    }
    sameSnapshot(await fs.lstat(path("file")), file, "aborted file mutation");
    sameSnapshot(await fs.lstat(path("directory")), directory, "aborted directory mutation");
    sameSnapshot(await fs.lstat(staged.file.path), staged.file.stat, "aborted staging mutation");
    await bytes(fs, path("file"), Uint8Array.of(9));
    await bytes(fs, staged.file.path, Uint8Array.of(0, 255, 1, 128));
    await entries(fs, root, ["file", "directory", ".stage"]);
    await entries(fs, staged.directory.path, ["file"]);
  });

  if (options.includeSymlinks) {
    add("symlink staging publishes the exact target without following it", async context => {
      const { fs, root, path } = context;
      await fs.writeFile(path("target"), Uint8Array.of(9));
      const staged = await stage(context, ".stage", { type: "symlink", target: path("target") });
      check(await fs.readlink!(staged.file.path) === path("target"), "staged symlink target must be exact");
      await fs.publishStagedFile(staged, path("output"), { parent: staged.parent.stat, destination: null });
      check((await fs.lstat(path("output"))).type === "symlink", "publish must preserve symlink type");
      check(await fs.readlink!(path("output")) === path("target"), "published symlink target must be exact");
      await fs.removeStagedFile(staged);
      await bytes(fs, path("target"), Uint8Array.of(9));
      await entries(fs, root, ["target", "output"]);
    });

    for (const directory of [false, true]) add(`symlink replacement of staging ${directory ? "directory" : "file"} survives rejection`, async context => {
      const { fs, peer, path } = context;
      const staged = await stage(context);
      await fs.mkdir(path("target"));
      await fs.writeFile(path("target/file"), Uint8Array.of(9));
      const replaced = directory ? staged.directory.path : staged.file.path;
      const target = path(directory ? "target" : "target/file");
      await peer.rename(replaced, path("original"));
      await peer.symlink!(target, replaced);
      await refuses(() => fs.publishStagedFile(staged, path("output"), { parent: staged.parent.stat, destination: null }), ["EAGAIN"]);
      await refuses(() => fs.removeStagedFile(staged), ["EAGAIN"]);
      check((await fs.lstat(replaced)).type === "symlink", "replacement symlink must survive");
      check(await fs.readlink!(replaced) === target, "replacement symlink target must survive");
      await bytes(fs, path("target/file"), Uint8Array.of(9));
      await bytes(fs, path(directory ? "original/file" : "original"), Uint8Array.of(0, 255, 1, 128));
      await refuses(() => fs.lstat(path("output")), ["ENOENT"]);
    });
  }

  return Object.freeze(cases);
}
