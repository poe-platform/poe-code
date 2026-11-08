import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createBackup, listBackups, removeBackup, restoreBackup } from "./backup-store.js";
import type { AgentStashContext, AgentStashFileSystem, BackupRecord } from "./types.js";

const backupRoot = "/home/user/.agent-stash/backups";
const backupId = "backup-2026-01-02T03-04-05-000Z";
const finalRoot = `${backupRoot}/${backupId}`;
const stagingRoot = `${finalRoot}.tmp-${backupId}`;
const sourcePath = "/repo/file.txt";
const firstBytes = "snapshot A\r\nα\0\n";
const secondBytes = "snapshot B\nβ\0\r\n";

function createContext(): { ctx: AgentStashContext; volume: Volume } {
  const volume = Volume.fromJSON({ [sourcePath]: firstBytes }, "/");
  return {
    volume,
    ctx: {
      cwd: "/repo",
      homeDir: "/home/user",
      fs: createFsFromVolume(volume).promises as unknown as AgentStashFileSystem,
      now: () => new Date("2026-01-02T03:04:05.000Z")
    }
  };
}

function createGate() {
  let release!: () => void;
  let entered!: () => void;
  const reached = new Promise<void>((resolve) => { entered = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  return {
    reached,
    release,
    async wait() {
      entered();
      await released;
    }
  };
}

async function expectSnapshot(
  ctx: AgentStashContext,
  volume: Volume,
  record: BackupRecord,
  command: string,
  content: string
): Promise<void> {
  expect(record.command).toBe(command);
  const persisted = JSON.parse(await ctx.fs.readFile(`${backupRoot}/${record.id}/backup.json`, "utf8"));
  expect(persisted).toEqual(JSON.parse(JSON.stringify(record)));
  expect(await listBackups(ctx)).toContainEqual(persisted);
  await ctx.fs.writeFile(sourcePath, "changed after backup");
  await restoreBackup(ctx, { backupId: record.id, yes: true });
  expect(volume.readFileSync(sourcePath)).toEqual(Buffer.from(content));
}

describe.each(["shared", "independent"] as const)("backup staging with %s filesystem wrappers", (wrappers) => {
  it.each(["before", "after"] as const)("keeps records and payloads isolated when paused %s metadata writes", async (phase) => {
    const { ctx, volume } = createContext();
    const originalFs = ctx.fs;
    const firstRead = createGate();
    const secondRead = createGate();
    const firstMetadata = createGate();
    const secondMetadata = createGate();
    let reads = 0;
    ctx.fs = {
      ...originalFs,
      async readFile(filePath, encoding) {
        const content = await originalFs.readFile(filePath, encoding);
        if (filePath === sourcePath) {
          reads += 1;
          if (reads === 1) await firstRead.wait();
          else if (reads === 2) await secondRead.wait();
        }
        return content;
      },
      async writeFile(filePath, content, options) {
        const gate = filePath.endsWith("/backup.json")
          ? JSON.parse(content).command === "first" ? firstMetadata : secondMetadata
          : undefined;
        if (phase === "before") await gate?.wait();
        await originalFs.writeFile(filePath, content, options);
        if (phase === "after") await gate?.wait();
      }
    };
    const otherCtx = { ...ctx, fs: wrappers === "shared" ? ctx.fs : { ...ctx.fs } };
    const first = createBackup(ctx, { command: "first", args: { agent: "claude-code" }, paths: [sourcePath] });
    await firstRead.reached;
    await originalFs.writeFile(sourcePath, secondBytes);
    const second = createBackup(otherCtx, { command: "second", args: { scope: "global" }, paths: [sourcePath] });
    const outcomes = Promise.allSettled([first, second]);
    try {
      await secondRead.reached;
      firstRead.release();
      await firstMetadata.reached;
      secondRead.release();
      await secondMetadata.reached;
      firstMetadata.release();
      await first;
    } finally {
      firstRead.release();
      secondRead.release();
      firstMetadata.release();
      secondMetadata.release();
      await outcomes;
    }
    const firstRecord = await first;
    await expectSnapshot(ctx, volume, firstRecord, "first", firstBytes);
    const secondRecord = await second;
    expect(firstRecord.id).toBe(backupId);
    expect(secondRecord.id).toBe(`${backupId}-1`);
    await expectSnapshot(otherCtx, volume, secondRecord, "second", secondBytes);
    expect(volume.readdirSync(backupRoot).sort()).toEqual([backupId, `${backupId}-1`]);
  });

  it("does not let a symlink failure remove another caller's payload", async () => {
    const { ctx, volume } = createContext();
    volume.mkdirSync("/repo/bad", { recursive: true });
    volume.symlinkSync(sourcePath, "/repo/bad/link");
    const originalFs = ctx.fs;
    const firstRead = createGate();
    const badLink = createGate();
    const metadata = createGate();
    ctx.fs = {
      ...originalFs,
      async readFile(filePath, encoding) {
        const content = await originalFs.readFile(filePath, encoding);
        if (filePath === sourcePath) await firstRead.wait();
        return content;
      },
      async lstat(filePath) {
        if (filePath === "/repo/bad/link") await badLink.wait();
        return originalFs.lstat(filePath);
      },
      async mkdir(directory, options) {
        if (directory === stagingRoot && options?.recursive) await metadata.wait();
        await originalFs.mkdir(directory, options);
      }
    };
    const otherCtx = { ...ctx, fs: wrappers === "shared" ? ctx.fs : { ...ctx.fs } };
    const first = createBackup(ctx, { command: "first", args: {}, paths: [sourcePath] });
    await firstRead.reached;
    const second = createBackup(otherCtx, { command: "bad", args: {}, paths: ["/repo/bad"] });
    const outcomes = Promise.allSettled([first, second]);
    try {
      await badLink.reached;
      firstRead.release();
      await metadata.reached;
      badLink.release();
      await expect(second).rejects.toThrow("Refusing to write through symbolic link: /repo/bad/link");
    } finally {
      firstRead.release();
      badLink.release();
      metadata.release();
      await outcomes;
    }
    await expectSnapshot(ctx, volume, await first, "first", firstBytes);
    expect(volume.readdirSync(backupRoot)).toEqual([backupId]);
  });
});

describe("backup allocation and ownership", () => {
  it("rechecks the final directory after claiming staging against a stale absence check", async () => {
    const { ctx, volume } = createContext();
    const originalFs = ctx.fs;
    const absence = createGate();
    let paused = false;
    const delayedCtx = {
      ...ctx,
      fs: {
        ...originalFs,
        async stat(filePath: string) {
          try {
            return await originalFs.stat(filePath);
          } catch (error) {
            if (filePath === finalRoot && !paused) {
              paused = true;
              await absence.wait();
            }
            throw error;
          }
        }
      }
    };
    const delayed = createBackup(delayedCtx, { command: "delayed", args: {}, paths: [sourcePath] });
    const outcomes = Promise.allSettled([delayed]);
    await absence.reached;
    const published = await createBackup(ctx, { command: "published", args: {}, paths: [sourcePath] });
    await originalFs.writeFile(sourcePath, secondBytes);
    absence.release();
    await outcomes;
    await expectSnapshot(ctx, volume, published, "published", firstBytes);
    const delayedRecord = await delayed;
    expect(delayedRecord.id).toBe(`${backupId}-1`);
    await expectSnapshot(ctx, volume, delayedRecord, "delayed", secondBytes);
    expect(volume.readdirSync(backupRoot).sort()).toEqual([backupId, `${backupId}-1`]);
  });

  it.each(["directory", "file"])("retries an existing staging %s without modifying it", async (kind) => {
    const { ctx, volume } = createContext();
    volume.mkdirSync(backupRoot, { recursive: true });
    const sentinel = kind === "directory" ? `${stagingRoot}/sentinel` : stagingRoot;
    if (kind === "directory") volume.mkdirSync(stagingRoot);
    volume.writeFileSync(sentinel, "owned by another writer");
    const mkdir = vi.fn(ctx.fs.mkdir.bind(ctx.fs));
    ctx.fs = { ...ctx.fs, mkdir };

    const record = await createBackup(ctx, { command: "first", args: {}, paths: [sourcePath] });

    expect(record.id).toBe(`${backupId}-1`);
    expect(mkdir).toHaveBeenCalledWith(stagingRoot, { recursive: false });
    expect(volume.readFileSync(sentinel, "utf8")).toBe("owned by another writer");
    await expectSnapshot(ctx, volume, record, "first", firstBytes);
  });

  it("propagates a claim error without cleaning unowned staging", async () => {
    const { ctx, volume } = createContext();
    const originalFs = ctx.fs;
    const failure = Object.assign(new Error("claim denied"), { code: "EACCES" });
    const remove = vi.fn(originalFs.rm);
    ctx.fs = {
      ...originalFs,
      rm: remove,
      async mkdir(directory, options) {
        if (directory === stagingRoot) throw failure;
        await originalFs.mkdir(directory, options);
      }
    };

    await expect(createBackup(ctx, { command: "first", args: {}, paths: [sourcePath] })).rejects.toBe(failure);

    expect(remove).not.toHaveBeenCalled();
    expect(volume.readFileSync(sourcePath)).toEqual(Buffer.from(firstBytes));
  });

  it("cleans its claim when the final-directory recheck fails", async () => {
    const { ctx, volume } = createContext();
    const originalFs = ctx.fs;
    const failure = Object.assign(new Error("recheck denied"), { code: "EACCES" });
    let claimed = false;
    ctx.fs = {
      ...originalFs,
      async mkdir(directory, options) {
        await originalFs.mkdir(directory, options);
        if (directory === stagingRoot && !options?.recursive) claimed = true;
      },
      async stat(filePath) {
        if (filePath === finalRoot && claimed) throw failure;
        return originalFs.stat(filePath);
      }
    };

    await expect(createBackup(ctx, { command: "first", args: {}, paths: [sourcePath] })).rejects.toBe(failure);

    expect(volume.readdirSync(backupRoot)).toEqual([]);
  });

  it("relinquishes staging ownership after rename even when pruning fails", async () => {
    const { ctx, volume } = createContext();
    const originalFs = ctx.fs;
    const failure = Object.assign(new Error("prune denied"), { code: "EACCES" });
    ctx.fs = {
      ...originalFs,
      async readdir(directory) {
        if (directory === backupRoot) {
          await originalFs.mkdir(stagingRoot);
          await originalFs.writeFile(`${stagingRoot}/sentinel`, "new owner's data");
          throw failure;
        }
        return originalFs.readdir(directory);
      }
    };

    await expect(createBackup(ctx, { command: "first", args: {}, paths: [sourcePath] })).rejects.toBe(failure);

    expect(volume.readFileSync(`${stagingRoot}/sentinel`, "utf8")).toBe("new owner's data");
    ctx.fs = originalFs;
    const [published] = await listBackups(ctx);
    await expectSnapshot(ctx, volume, published, "first", firstBytes);
  });
});

describe("backup enumeration during concurrent writes and pruning", () => {
  it("lists and prunes only published entries while a different timestamp has complete staging metadata", async () => {
    const { ctx, volume } = createContext();
    for (let index = 0; index < 20; index += 1) {
      await createBackup({ ...ctx, now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, index)) }, {
        command: `seed-${index}`, args: {}, paths: []
      });
    }
    const originalFs = ctx.fs;
    const publish = createGate();
    const stagingCtx = {
      ...ctx,
      fs: {
        ...originalFs,
        async rename(from: string, to: string) {
          await publish.wait();
          await originalFs.rename!(from, to);
        }
      }
    };
    const staged = createBackup(stagingCtx, { command: "staged", args: {}, paths: [sourcePath] });
    const outcomes = Promise.allSettled([staged]);
    await publish.reached;
    const listing = await Promise.allSettled([listBackups(ctx)]);
    await originalFs.writeFile(sourcePath, secondBytes);
    let published: BackupRecord;
    let stageSurvived: boolean;
    try {
      published = await createBackup({ ...ctx, now: () => new Date("2026-01-02T03:04:06.000Z") }, {
        command: "published", args: {}, paths: [sourcePath]
      });
      stageSurvived = volume.existsSync(`${stagingRoot}/backup.json`);
      expect(await listBackups(ctx)).toHaveLength(20);
    } finally {
      publish.release();
      await outcomes;
    }
    expect(listing[0].status).toBe("fulfilled");
    if (listing[0].status === "fulfilled") expect(listing[0].value).toHaveLength(20);
    expect(stageSurvived).toBe(true);
    await expectSnapshot(ctx, volume, await staged, "staged", firstBytes);
    await expectSnapshot(ctx, volume, published, "published", secondBytes);
    const records = await listBackups(ctx);
    expect(records).toHaveLength(20);
    expect(records.at(-1)?.command).toBe("seed-2");
  });

  it.each(["lstat", "stat", "readFile"] as const)("tolerates a listed entry removed before %s", async (method) => {
    const { ctx } = createContext();
    const record = await createBackup(ctx, { command: "first", args: {}, paths: [sourcePath] });
    const gate = createGate();
    const originalFs = ctx.fs;
    const target = method === "readFile" ? `${finalRoot}/backup.json` : finalRoot;
    const observer: AgentStashContext = {
      ...ctx,
      fs: {
        ...originalFs,
        [method]: async (filePath: string, encoding: "utf8") => {
          if (filePath === target) await gate.wait();
          return originalFs[method](filePath, encoding);
        }
      }
    };
    const listing = listBackups(observer);
    const outcomes = Promise.allSettled([listing]);
    await gate.reached;
    await removeBackup(ctx, record.id);
    gate.release();
    await outcomes;

    await expect(listing).resolves.toEqual([]);
  });

  it("tolerates the backup root disappearing before readdir", async () => {
    const { ctx } = createContext();
    await createBackup(ctx, { command: "first", args: {}, paths: [sourcePath] });
    const originalFs = ctx.fs;
    ctx.fs = {
      ...originalFs,
      async readdir(directory) {
        await originalFs.rm!(directory, { recursive: true });
        return originalFs.readdir(directory);
      }
    };

    await expect(listBackups(ctx)).resolves.toEqual([]);
  });

  it.each([
    ["list", "lstat"], ["list", "stat"], ["list", "readFile"], ["list", "readdir"],
    ["prune", "lstat"], ["prune", "stat"], ["prune", "readFile"], ["prune", "readdir"]
  ] as const)("does not hide %s errors from %s or delete unreadable entries", async (operation, method) => {
    const { ctx, volume } = createContext();
    await createBackup(ctx, { command: "first", args: {}, paths: [sourcePath] });
    const originalFs = ctx.fs;
    const failure = Object.assign(new Error("entry denied"), { code: "EACCES" });
    const target = method === "readFile" ? `${finalRoot}/backup.json` : method === "readdir" ? backupRoot : finalRoot;
    ctx.fs = {
      ...originalFs,
      [method]: async (filePath: string, encoding: "utf8") => {
        if (filePath === target) throw failure;
        return originalFs[method](filePath, encoding);
      }
    };
    const action = operation === "list" ? listBackups(ctx) : createBackup({
      ...ctx, now: () => new Date("2026-01-02T03:04:06.000Z")
    }, { command: "second", args: {}, paths: [] });

    await expect(action).rejects.toBe(failure);

    expect(volume.existsSync(`${finalRoot}/backup.json`)).toBe(true);
  });

  it.each(["retention", "invalid metadata"])("tolerates another pruner removing the same %s entry", async (kind) => {
    const { ctx, volume } = createContext();
    for (let index = 0; index < 20; index += 1) {
      await createBackup({ ...ctx, now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, index)) }, {
        command: `seed-${index}`, args: {}, paths: []
      });
    }
    const target = kind === "retention" ? `${backupRoot}/backup-2026-01-01T00-00-00-000Z` : `${backupRoot}/invalid`;
    if (kind === "invalid metadata") {
      volume.mkdirSync(target);
      volume.writeFileSync(`${target}/backup.json`, "{");
    }
    const originalFs = ctx.fs;
    const removal = createGate();
    const firstCtx = {
      ...ctx,
      fs: {
        ...originalFs,
        async rm(filePath: string, options?: { recursive?: boolean; force?: boolean }) {
          if (filePath === target) {
            await removal.wait();
            if (!volume.existsSync(filePath)) throw Object.assign(new Error("already removed"), { code: "ENOENT" });
          }
          await originalFs.rm!(filePath, options);
        }
      }
    };
    const first = createBackup(firstCtx, { command: "first", args: {}, paths: [sourcePath] });
    const outcomes = Promise.allSettled([first]);
    await removal.reached;
    let second: BackupRecord;
    try {
      await originalFs.writeFile(sourcePath, secondBytes);
      second = await createBackup({ ...ctx, now: () => new Date("2026-01-02T03:04:06.000Z") }, {
        command: "second", args: {}, paths: [sourcePath]
      });
    } finally {
      removal.release();
      await outcomes;
    }

    await expectSnapshot(ctx, volume, await first, "first", firstBytes);
    await expectSnapshot(ctx, volume, second, "second", secondBytes);
    expect(await listBackups(ctx)).toHaveLength(20);
  });

  it("does not mistake arbitrary tmp-like names for staging", async () => {
    const { ctx, volume } = createContext();
    const directory = `${backupId}.tmp-other`;
    volume.mkdirSync(`${backupRoot}/${directory}`, { recursive: true });
    volume.writeFileSync(`${backupRoot}/${directory}/backup.json`, "{");

    await expect(listBackups(ctx)).rejects.toThrow(`Malformed backup metadata for ${directory}`);

    await createBackup(ctx, { command: "first", args: {}, paths: [sourcePath] });
    expect(volume.existsSync(`${backupRoot}/${directory}`)).toBe(false);
  });

  it.each(["list", "prune"] as const)("retains symlink refusal for recognized staging during %s", async (operation) => {
    const { ctx, volume } = createContext();
    volume.mkdirSync("/outside", { recursive: true });
    volume.writeFileSync("/outside/sentinel", "keep");
    volume.mkdirSync(backupRoot, { recursive: true });
    volume.symlinkSync("/outside", stagingRoot);
    const action = operation === "list" ? listBackups(ctx) : createBackup(ctx, { command: "first", args: {}, paths: [] });

    await expect(action).rejects.toThrow(`Refusing to write through symbolic link: ${stagingRoot}`);

    expect(volume.readFileSync("/outside/sentinel", "utf8")).toBe("keep");
    expect(volume.lstatSync(stagingRoot).isSymbolicLink()).toBe(true);
  });
});
