import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createBackup, listBackups, removeBackup, restoreBackup } from "./backup-store.js";
import type { AgentStashContext, AgentStashFileSystem } from "./types.js";

function createContext(files: Record<string, string>, now = new Date("2026-01-02T03:04:05.000Z")): {
  ctx: AgentStashContext;
  volume: Volume;
} {
  const volume = Volume.fromJSON(files, "/");
  return {
    volume,
    ctx: {
      cwd: "/repo",
      homeDir: "/home/user",
      fs: createFsFromVolume(volume).promises as unknown as AgentStashFileSystem,
      now: () => now
    }
  };
}

describe("backup store", () => {
  it("restores files to their pre-write content", async () => {
    const { ctx, volume } = createContext({ "/repo/file.txt": "before" });
    const backup = await createBackup(ctx, { command: "test", args: { scope: "project" }, paths: ["/repo/file.txt"] });
    await ctx.fs.writeFile("/repo/file.txt", "after", { encoding: "utf8" });

    await restoreBackup(ctx, { backupId: backup.id, yes: true });

    expect(volume.readFileSync("/repo/file.txt", "utf8")).toBe("before");
  });

  it("records target metadata and affected paths", async () => {
    const { ctx } = createContext({ "/repo/file.txt": "before" });
    const backup = await createBackup(ctx, {
      command: "download",
      args: { scope: "project", agent: "claude-code" },
      paths: ["/repo/file.txt"]
    });

    expect(backup).toMatchObject({
      command: "download",
      cwd: "/repo",
      homeDir: "/home/user",
      targetScope: "project",
      targetAgent: "claude-code",
      affectedPaths: ["/repo/file.txt"]
    });
  });

  it("does not leave the final backup id when backup file writing fails", async () => {
    const { ctx } = createContext({ "/repo/file.txt": "before" });
    const originalWriteFile = ctx.fs.writeFile.bind(ctx.fs);
    ctx.fs.writeFile = async (filePath, content, options) => {
      if (filePath.includes(".tmp-") && filePath.endsWith("/repo/file.txt")) {
        throw new Error("backup interrupted");
      }
      await originalWriteFile(filePath, content, options);
    };

    await expect(
      createBackup(ctx, { command: "download", args: { scope: "project", agent: "claude-code" }, paths: ["/repo/file.txt"] })
    ).rejects.toThrow("backup interrupted");
    await expect(ctx.fs.stat("/home/user/.agent-stash/backups/backup-2026-01-02T03-04-05-000Z")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("preserves backup write failures when temp cleanup cannot remove directories", async () => {
    const { ctx } = createContext({ "/repo/file.txt": "before" });
    ctx.fs.rm = undefined;
    const originalWriteFile = ctx.fs.writeFile.bind(ctx.fs);
    ctx.fs.writeFile = async (filePath, content, options) => {
      if (filePath.includes(".tmp-") && filePath.endsWith("/repo/file.txt")) {
        throw new Error("backup interrupted");
      }
      await originalWriteFile(filePath, content, options);
    };

    await expect(
      createBackup(ctx, { command: "download", args: { scope: "project", agent: "claude-code" }, paths: ["/repo/file.txt"] })
    ).rejects.toThrow("backup interrupted");
    await expect(ctx.fs.stat("/home/user/.agent-stash/backups/backup-2026-01-02T03-04-05-000Z")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("refuses to back up symbolic links", async () => {
    const { ctx, volume } = createContext({ "/outside/secret.txt": "secret" });
    volume.mkdirSync("/repo", { recursive: true });
    volume.symlinkSync("/outside/secret.txt", "/repo/link.txt");

    await expect(
      createBackup(ctx, { command: "download", args: { scope: "project", agent: "claude-code" }, paths: ["/repo/link.txt"] })
    ).rejects.toThrow(/symbolic link/);
    await expect(ctx.fs.stat("/home/user/.agent-stash/backups/backup-2026-01-02T03-04-05-000Z")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("refuses to back up paths through symbolic link ancestors", async () => {
    const { ctx, volume } = createContext({ "/outside/secret.txt": "secret" });
    volume.mkdirSync("/repo", { recursive: true });
    volume.symlinkSync("/outside", "/repo/link");

    await expect(
      createBackup(ctx, { command: "download", args: { scope: "project", agent: "claude-code" }, paths: ["/repo/link/secret.txt"] })
    ).rejects.toThrow("Refusing to write through symbolic link: /repo/link");
    expect(volume.readFileSync("/outside/secret.txt", "utf8")).toBe("secret");
    await expect(ctx.fs.stat("/home/user/.agent-stash/backups/backup-2026-01-02T03-04-05-000Z")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("refuses to back up paths outside the project and home roots", async () => {
    const { ctx } = createContext({ "/outside/secret.txt": "secret" });

    await expect(
      createBackup(ctx, { command: "download", args: { scope: "project", agent: "claude-code" }, paths: ["/outside/secret.txt"] })
    ).rejects.toThrow("Backup path is outside backup roots: /outside/secret.txt");
    await expect(ctx.fs.stat("/home/user/.agent-stash/backups")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("refuses to create backups through a symlinked backup directory", async () => {
    const { ctx, volume } = createContext({
      "/repo/file.txt": "before",
      "/outside/backups/sentinel.txt": "keep\n"
    });
    volume.mkdirSync("/home/user/.agent-stash", { recursive: true });
    volume.mkdirSync("/outside/backups", { recursive: true });
    volume.symlinkSync("/outside/backups", "/home/user/.agent-stash/backups");

    await expect(
      createBackup(ctx, { command: "download", args: { scope: "project", agent: "claude-code" }, paths: ["/repo/file.txt"] })
    ).rejects.toThrow("Refusing to write through symbolic link: /home/user/.agent-stash/backups");
    expect(volume.readFileSync("/outside/backups/sentinel.txt", "utf8")).toBe("keep\n");
    expect(volume.readdirSync("/outside/backups")).toEqual(["sentinel.txt"]);
  });

  it("refuses to list backups through a symlinked backup directory", async () => {
    const { ctx, volume } = createContext({
      "/outside/backups/backup-2026-01-02T03-04-05-000Z/backup.json": JSON.stringify({
        id: "backup-2026-01-02T03-04-05-000Z",
        createdAt: "2026-01-02T03:04:05.000Z",
        command: "outside",
        args: {},
        cwd: "/repo",
        homeDir: "/home/user",
        affectedPaths: [],
        files: []
      })
    });
    volume.mkdirSync("/home/user/.agent-stash", { recursive: true });
    volume.mkdirSync("/outside/backups", { recursive: true });
    volume.symlinkSync("/outside/backups", "/home/user/.agent-stash/backups");

    await expect(listBackups(ctx)).rejects.toThrow(
      "Refusing to write through symbolic link: /home/user/.agent-stash/backups"
    );
  });

  it("refuses to list backups through a symlinked backup entry", async () => {
    const { ctx, volume } = createContext({
      "/outside/entry/backup.json": JSON.stringify({
        id: "backup-2026-01-02T03-04-05-000Z",
        createdAt: "2026-01-02T03:04:05.000Z",
        command: "outside",
        args: {},
        cwd: "/repo",
        homeDir: "/home/user",
        affectedPaths: [],
        files: []
      })
    });
    volume.mkdirSync("/home/user/.agent-stash/backups", { recursive: true });
    volume.symlinkSync("/outside/entry", "/home/user/.agent-stash/backups/backup-2026-01-02T03-04-05-000Z");

    await expect(listBackups(ctx)).rejects.toThrow(
      "Refusing to write through symbolic link: /home/user/.agent-stash/backups/backup-2026-01-02T03-04-05-000Z"
    );
  });

  it("rejects malformed backup metadata JSON when listing backups", async () => {
    const backupId = "backup-2026-01-02T03-04-05-000Z";
    const { ctx } = createContext({
      [`/home/user/.agent-stash/backups/${backupId}/backup.json`]: "{"
    });

    await expect(listBackups(ctx)).rejects.toThrow(`Malformed backup metadata for ${backupId}.`);
  });

  it("ignores non-directory files in the backup root when listing backups", async () => {
    const { ctx, volume } = createContext({
      "/home/user/.agent-stash/backups/README.txt": "operator note\n",
      "/repo/file.txt": "before"
    });
    const backup = await createBackup(ctx, { command: "test", args: { scope: "project" }, paths: ["/repo/file.txt"] });

    expect((await listBackups(ctx)).map((record) => record.id)).toEqual([backup.id]);
    expect(volume.readFileSync("/home/user/.agent-stash/backups/README.txt", "utf8")).toBe("operator note\n");
  });

  it("refuses to restore when cwd and homeDir do not match the backup record", async () => {
    const { ctx } = createContext({ "/repo/file.txt": "before" });
    const backup = await createBackup(ctx, { command: "test", args: { scope: "project" }, paths: ["/repo/file.txt"] });
    const mismatched = createContext({ [`/home/user/.agent-stash/backups/${backup.id}/backup.json`]: JSON.stringify(backup) });
    mismatched.ctx.cwd = "/other-repo";

    await expect(restoreBackup(mismatched.ctx, { backupId: backup.id, yes: true })).rejects.toThrow(/matching --cwd/);
  });

  it("allows restore when cwd and homeDir match the backup record", async () => {
    const { ctx, volume } = createContext({ "/repo/file.txt": "before" });
    const backup = await createBackup(ctx, { command: "test", args: { scope: "project" }, paths: ["/repo/file.txt"] });
    await ctx.fs.writeFile("/repo/file.txt", "after", { encoding: "utf8" });

    await restoreBackup(ctx, { backupId: backup.id, yes: true });

    expect(volume.readFileSync("/repo/file.txt", "utf8")).toBe("before");
  });

  it("rejects backup metadata that restores a file outside affected paths", async () => {
    const { ctx, volume } = createContext({ "/repo/file.txt": "before", "/outside/owned.txt": "safe" });
    const backup = await createBackup(ctx, { command: "test", args: { scope: "project" }, paths: ["/repo/file.txt"] });
    const metadataPath = `/home/user/.agent-stash/backups/${backup.id}/backup.json`;
    const tampered = {
      ...backup,
      files: [{
        ...backup.files[0]!,
        sourcePath: "/outside/owned.txt"
      }]
    };
    await ctx.fs.writeFile(metadataPath, `${JSON.stringify(tampered, null, 2)}\n`, { encoding: "utf8" });

    await expect(restoreBackup(ctx, { backupId: backup.id, yes: true })).rejects.toThrow(
      "Backup metadata source path is outside affected paths: /outside/owned.txt"
    );
    expect(volume.readFileSync("/outside/owned.txt", "utf8")).toBe("safe");
  });

  it("rejects backup metadata with directories outside affected paths before deleting current files", async () => {
    const { ctx, volume } = createContext({ "/repo/skill/SKILL.md": "# Before\n" });
    const backup = await createBackup(ctx, { command: "test", args: { scope: "project" }, paths: ["/repo/skill"] });
    await ctx.fs.writeFile("/repo/skill/NEW.md", "new\n", { encoding: "utf8" });
    const metadataPath = `/home/user/.agent-stash/backups/${backup.id}/backup.json`;
    const tampered = {
      ...backup,
      directories: ["/repo/other-skill"]
    };
    await ctx.fs.writeFile(metadataPath, `${JSON.stringify(tampered, null, 2)}\n`, { encoding: "utf8" });

    await expect(restoreBackup(ctx, { backupId: backup.id, yes: true })).rejects.toThrow(
      "Backup metadata directory path is outside affected paths: /repo/other-skill"
    );
    expect(volume.readFileSync("/repo/skill/NEW.md", "utf8")).toBe("new\n");
  });

  it("rejects backup metadata with directories that collide with restored files before deleting current files", async () => {
    const { ctx, volume } = createContext({ "/repo/file.txt": "before\n" });
    const backup = await createBackup(ctx, { command: "test", args: { scope: "project" }, paths: ["/repo/file.txt"] });
    await ctx.fs.writeFile("/repo/file.txt", "after\n", { encoding: "utf8" });
    const metadataPath = `/home/user/.agent-stash/backups/${backup.id}/backup.json`;
    const tampered = {
      ...backup,
      directories: ["/repo/file.txt"]
    };
    await ctx.fs.writeFile(metadataPath, `${JSON.stringify(tampered, null, 2)}\n`, { encoding: "utf8" });

    await expect(restoreBackup(ctx, { backupId: backup.id, yes: true })).rejects.toThrow(
      "Backup metadata directory path collides with restored file: /repo/file.txt"
    );
    expect(volume.readFileSync("/repo/file.txt", "utf8")).toBe("after\n");
  });

  it("rejects backup metadata with affected paths outside the original roots", async () => {
    const { ctx, volume } = createContext({ "/repo/file.txt": "before", "/outside/owned.txt": "safe" });
    const backup = await createBackup(ctx, { command: "test", args: { scope: "project" }, paths: ["/repo/file.txt"] });
    const metadataPath = `/home/user/.agent-stash/backups/${backup.id}/backup.json`;
    const tampered = {
      ...backup,
      affectedPaths: ["/outside/owned.txt"],
      files: [{
        ...backup.files[0]!,
        sourcePath: "/outside/owned.txt"
      }]
    };
    await ctx.fs.writeFile(metadataPath, `${JSON.stringify(tampered, null, 2)}\n`, { encoding: "utf8" });

    await expect(restoreBackup(ctx, { backupId: backup.id, yes: true })).rejects.toThrow(
      "Backup metadata affected path is outside backup roots: /outside/owned.txt"
    );
    expect(volume.readFileSync("/outside/owned.txt", "utf8")).toBe("safe");
  });

  it("rejects backup metadata that reads a file outside the backup root", async () => {
    const { ctx, volume } = createContext({ "/repo/file.txt": "before", "/outside/source.txt": "poison" });
    const backup = await createBackup(ctx, { command: "test", args: { scope: "project" }, paths: ["/repo/file.txt"] });
    await ctx.fs.writeFile("/repo/file.txt", "after", { encoding: "utf8" });
    const metadataPath = `/home/user/.agent-stash/backups/${backup.id}/backup.json`;
    const tampered = {
      ...backup,
      files: [{
        ...backup.files[0]!,
        backupPath: "/outside/source.txt"
      }]
    };
    await ctx.fs.writeFile(metadataPath, `${JSON.stringify(tampered, null, 2)}\n`, { encoding: "utf8" });

    await expect(restoreBackup(ctx, { backupId: backup.id, yes: true })).rejects.toThrow(
      "Backup metadata file path is outside backup root: /outside/source.txt"
    );
    expect(volume.readFileSync("/repo/file.txt", "utf8")).toBe("after");
  });

  it("rejects backup metadata that swaps source paths within the backup root", async () => {
    const { ctx, volume } = createContext({ "/repo/file.txt": "before", "/repo/other.txt": "other" });
    const backup = await createBackup(ctx, { command: "test", args: { scope: "project" }, paths: ["/repo/file.txt", "/repo/other.txt"] });
    await ctx.fs.writeFile("/repo/file.txt", "after", { encoding: "utf8" });
    const metadataPath = `/home/user/.agent-stash/backups/${backup.id}/backup.json`;
    const fileRecord = backup.files.find((file) => file.sourcePath === "/repo/file.txt")!;
    const otherRecord = backup.files.find((file) => file.sourcePath === "/repo/other.txt")!;
    const tampered = {
      ...backup,
      files: [{
        ...fileRecord,
        backupPath: otherRecord.backupPath
      }]
    };
    await ctx.fs.writeFile(metadataPath, `${JSON.stringify(tampered, null, 2)}\n`, { encoding: "utf8" });

    await expect(restoreBackup(ctx, { backupId: backup.id, yes: true })).rejects.toThrow(
      "Backup metadata file path mismatch for /repo/file.txt"
    );
    expect(volume.readFileSync("/repo/file.txt", "utf8")).toBe("after");
  });

  it("rejects backup file payloads through symbolic link ancestors before deleting current files", async () => {
    const backupId = "backup-2026-01-02T03-04-05-000Z";
    const { ctx, volume } = createContext({
      "/repo/file.txt": "after",
      "/outside/file.txt": "poison",
      [`/home/user/.agent-stash/backups/${backupId}/backup.json`]: JSON.stringify({
        id: backupId,
        createdAt: "2026-01-02T03:04:05.000Z",
        command: "tampered",
        args: {},
        cwd: "/repo",
        homeDir: "/home/user",
        affectedPaths: ["/repo/file.txt"],
        files: [{
          sourcePath: "/repo/file.txt",
          backupPath: `/home/user/.agent-stash/backups/${backupId}/files/repo/file.txt`,
          existed: true
        }]
      }, null, 2)
    });
    volume.mkdirSync(`/home/user/.agent-stash/backups/${backupId}/files`, { recursive: true });
    volume.symlinkSync("/outside", `/home/user/.agent-stash/backups/${backupId}/files/repo`);

    await expect(restoreBackup(ctx, { backupId, yes: true })).rejects.toThrow(
      `Refusing to write through symbolic link: /home/user/.agent-stash/backups/${backupId}/files/repo`
    );
    expect(volume.readFileSync("/repo/file.txt", "utf8")).toBe("after");
  });

  it("rejects restore paths through symbolic link ancestors before deleting current files", async () => {
    const backupId = "backup-2026-01-02T03-04-05-000Z";
    const { ctx, volume } = createContext({
      "/outside/secret.txt": "safe",
      [`/home/user/.agent-stash/backups/${backupId}/files/repo/link/secret.txt`]: "restored",
      [`/home/user/.agent-stash/backups/${backupId}/backup.json`]: JSON.stringify({
        id: backupId,
        createdAt: "2026-01-02T03:04:05.000Z",
        command: "tampered",
        args: {},
        cwd: "/repo",
        homeDir: "/home/user",
        affectedPaths: ["/repo/link/secret.txt"],
        files: [{
          sourcePath: "/repo/link/secret.txt",
          backupPath: `/home/user/.agent-stash/backups/${backupId}/files/repo/link/secret.txt`,
          existed: true
        }]
      }, null, 2)
    });
    volume.mkdirSync("/repo", { recursive: true });
    volume.symlinkSync("/outside", "/repo/link");

    await expect(restoreBackup(ctx, { backupId, yes: true })).rejects.toThrow(
      "Refusing to write through symbolic link: /repo/link"
    );
    expect(volume.readFileSync("/outside/secret.txt", "utf8")).toBe("safe");
  });

  it("rejects incomplete backups before deleting current files", async () => {
    const { ctx, volume } = createContext({ "/repo/file.txt": "before" });
    const backup = await createBackup(ctx, { command: "test", args: { scope: "project" }, paths: ["/repo/file.txt"] });
    await ctx.fs.writeFile("/repo/file.txt", "after", { encoding: "utf8" });
    await ctx.fs.unlink(`/home/user/.agent-stash/backups/${backup.id}/files/repo/file.txt`);

    await expect(restoreBackup(ctx, { backupId: backup.id, yes: true })).rejects.toMatchObject({
      code: "ENOENT"
    });
    expect(volume.readFileSync("/repo/file.txt", "utf8")).toBe("after");
  });

  it("rejects backup metadata id mismatches before deleting current files", async () => {
    const { ctx, volume } = createContext({ "/repo/file.txt": "before" });
    const backup = await createBackup(ctx, { command: "test", args: { scope: "project" }, paths: ["/repo/file.txt"] });
    await ctx.fs.writeFile("/repo/file.txt", "after", { encoding: "utf8" });
    const metadataPath = `/home/user/.agent-stash/backups/${backup.id}/backup.json`;
    await ctx.fs.writeFile(metadataPath, `${JSON.stringify({ ...backup, id: "backup-other" }, null, 2)}\n`, {
      encoding: "utf8"
    });

    await expect(restoreBackup(ctx, { backupId: backup.id, yes: true })).rejects.toThrow(
      `Backup metadata id mismatch for ${backup.id}`
    );
    expect(volume.readFileSync("/repo/file.txt", "utf8")).toBe("after");
  });

  it("rejects malformed backup metadata before deleting current files", async () => {
    const backupId = "backup-2026-01-02T03-04-05-000Z";
    const { ctx, volume } = createContext({
      "/repo/file.txt": "after",
      [`/home/user/.agent-stash/backups/${backupId}/backup.json`]: JSON.stringify({
        id: backupId,
        createdAt: "2026-01-02T03:04:05.000Z",
        command: "tampered",
        args: {},
        cwd: "/repo",
        homeDir: "/home/user",
        affectedPaths: "/repo/file.txt",
        files: {}
      }, null, 2)
    });

    await expect(restoreBackup(ctx, { backupId, yes: true })).rejects.toThrow(
      `Backup metadata affectedPaths must be an array for ${backupId}`
    );
    expect(volume.readFileSync("/repo/file.txt", "utf8")).toBe("after");
  });

  it("rejects malformed backup metadata JSON before deleting current files", async () => {
    const backupId = "backup-2026-01-02T03-04-05-000Z";
    const { ctx, volume } = createContext({
      "/repo/file.txt": "after",
      [`/home/user/.agent-stash/backups/${backupId}/backup.json`]: "{"
    });

    await expect(restoreBackup(ctx, { backupId, yes: true })).rejects.toThrow(
      `Malformed backup metadata for ${backupId}.`
    );
    expect(volume.readFileSync("/repo/file.txt", "utf8")).toBe("after");
  });

  it("removes files added under an affected directory after backup creation", async () => {
    const { ctx, volume } = createContext({ "/repo/skill/SKILL.md": "# Before\n" });
    const backup = await createBackup(ctx, { command: "import", args: { scope: "project" }, paths: ["/repo/skill"] });
    await ctx.fs.writeFile("/repo/skill/SKILL.md", "# After\n", { encoding: "utf8" });
    await ctx.fs.writeFile("/repo/skill/NEW.md", "new\n", { encoding: "utf8" });

    await restoreBackup(ctx, { backupId: backup.id, yes: true });

    expect(volume.readFileSync("/repo/skill/SKILL.md", "utf8")).toBe("# Before\n");
    expect(() => volume.statSync("/repo/skill/NEW.md")).toThrow();
  });

  it("restores originally empty directories", async () => {
    const { ctx, volume } = createContext({});
    await ctx.fs.mkdir("/repo/empty-skill", { recursive: true });
    const backup = await createBackup(ctx, { command: "import", args: { scope: "project" }, paths: ["/repo/empty-skill"] });
    await ctx.fs.writeFile("/repo/empty-skill/NEW.md", "new\n", { encoding: "utf8" });

    await restoreBackup(ctx, { backupId: backup.id, yes: true });

    expect(volume.statSync("/repo/empty-skill").isDirectory()).toBe(true);
    expect(volume.readdirSync("/repo/empty-skill")).toEqual([]);
  });

  it("removes originally missing files when rm is unavailable", async () => {
    const { ctx, volume } = createContext({});
    ctx.fs.rm = undefined;
    const backup = await createBackup(ctx, { command: "download", args: { scope: "project" }, paths: ["/repo/new-file.txt"] });
    await ctx.fs.mkdir("/repo", { recursive: true });
    await ctx.fs.writeFile("/repo/new-file.txt", "created\n", { encoding: "utf8" });

    await restoreBackup(ctx, { backupId: backup.id, yes: true });

    expect(() => volume.statSync("/repo/new-file.txt")).toThrow();
  });

  it("rejects directory restore without rm support before deleting earlier affected files", async () => {
    const { ctx, volume } = createContext({
      "/repo/a-file.txt": "before\n",
      "/repo/z-dir/old.txt": "old\n"
    });
    const backup = await createBackup(ctx, {
      command: "import",
      args: { scope: "project" },
      paths: ["/repo/a-file.txt", "/repo/z-dir"]
    });
    await ctx.fs.writeFile("/repo/a-file.txt", "after\n", { encoding: "utf8" });
    await ctx.fs.writeFile("/repo/z-dir/new.txt", "new\n", { encoding: "utf8" });
    ctx.fs.rm = undefined;

    await expect(restoreBackup(ctx, { backupId: backup.id, yes: true })).rejects.toThrow(
      "Filesystem rm support is required to restore directory: /repo/z-dir"
    );
    expect(volume.readFileSync("/repo/a-file.txt", "utf8")).toBe("after\n");
    expect(volume.readFileSync("/repo/z-dir/new.txt", "utf8")).toBe("new\n");
  });

  it("removes exactly the requested backup", async () => {
    const first = createContext({ "/repo/one.txt": "one" }, new Date("2026-01-02T03:04:05.000Z"));
    const backupOne = await createBackup(first.ctx, { command: "one", args: {}, paths: ["/repo/one.txt"] });
    first.ctx.now = () => new Date("2026-01-02T03:04:06.000Z");
    const backupTwo = await createBackup(first.ctx, { command: "two", args: {}, paths: ["/repo/one.txt"] });

    await removeBackup(first.ctx, backupOne.id);

    expect((await listBackups(first.ctx)).map((backup) => backup.id)).toEqual([backupTwo.id]);
    expect(() => first.volume.statSync(`/home/user/.agent-stash/backups/${backupOne.id}`)).toThrow();
  });

  it("refuses to remove non-directory files in the backup root", async () => {
    const { ctx, volume } = createContext({
      "/home/user/.agent-stash/backups/README.txt": "operator note\n"
    });

    await expect(removeBackup(ctx, "README.txt")).rejects.toThrow("Backup not found: README.txt");
    expect(volume.readFileSync("/home/user/.agent-stash/backups/README.txt", "utf8")).toBe("operator note\n");
  });

  it("rejects restore backup ids that would escape the backup directory", async () => {
    const { ctx, volume } = createContext({
      "/home/user/.agent-stash/config.json/backup.json": JSON.stringify({
        id: "../config.json",
        createdAt: "2026-01-02T03:04:05.000Z",
        command: "tampered",
        args: {},
        cwd: "/repo",
        homeDir: "/home/user",
        affectedPaths: ["/repo/file.txt"],
        files: []
      })
    });

    await expect(restoreBackup(ctx, { backupId: "../config.json", yes: true })).rejects.toThrow(
      "Invalid backup id: ../config.json"
    );
    expect(volume.existsSync("/home/user/.agent-stash/config.json/backup.json")).toBe(true);
  });

  it("rejects remove backup ids that would escape the backup directory", async () => {
    const { ctx, volume } = createContext({
      "/home/user/.agent-stash/config.json/sentinel.txt": "keep\n"
    });

    await expect(removeBackup(ctx, "../config.json")).rejects.toThrow("Invalid backup id: ../config.json");
    expect(volume.readFileSync("/home/user/.agent-stash/config.json/sentinel.txt", "utf8")).toBe("keep\n");
  });

  it("refuses to remove a symlinked backup entry", async () => {
    const backupId = "backup-2026-01-02T03-04-05-000Z";
    const { ctx, volume } = createContext({
      "/outside/entry/sentinel.txt": "keep\n"
    });
    volume.mkdirSync("/home/user/.agent-stash/backups", { recursive: true });
    volume.symlinkSync("/outside/entry", `/home/user/.agent-stash/backups/${backupId}`);

    await expect(removeBackup(ctx, backupId)).rejects.toThrow(
      `Refusing to write through symbolic link: /home/user/.agent-stash/backups/${backupId}`
    );
    expect(volume.readFileSync("/outside/entry/sentinel.txt", "utf8")).toBe("keep\n");
  });

  it("creates distinct backup ids for multiple backups in the same millisecond", async () => {
    const { ctx } = createContext({ "/repo/file.txt": "content" });

    const first = await createBackup(ctx, { command: "first", args: {}, paths: ["/repo/file.txt"] });
    const second = await createBackup(ctx, { command: "second", args: {}, paths: ["/repo/file.txt"] });

    expect(first.id).not.toBe(second.id);
    expect((await listBackups(ctx)).map((backup) => backup.command)).toEqual(["second", "first"]);
  });

  it("prunes backups to the 20 most recent after creation", async () => {
    const { ctx } = createContext({ "/repo/file.txt": "content" });
    for (let index = 0; index < 21; index += 1) {
      ctx.now = () => new Date(`2026-01-02T03:04:${String(index).padStart(2, "0")}.000Z`);
      await createBackup(ctx, { command: `backup-${index}`, args: {}, paths: ["/repo/file.txt"] });
    }

    const backups = await listBackups(ctx);

    expect(backups).toHaveLength(20);
    expect(backups.at(-1)?.command).toBe("backup-1");
    await expect(ctx.fs.stat("/home/user/.agent-stash/backups/backup-2026-01-02T03-04-00-000Z")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("does not let tampered backup metadata choose the prune deletion path", async () => {
    const { ctx, volume } = createContext({
      "/repo/file.txt": "content",
      "/home/user/.agent-stash/config.json": "keep\n",
      "/home/user/.agent-stash/backups/tampered/backup.json": JSON.stringify({
        id: "../config.json",
        createdAt: "2000-01-01T00:00:00.000Z",
        command: "tampered",
        args: {},
        cwd: "/repo",
        homeDir: "/home/user",
        affectedPaths: ["/repo/file.txt"],
        files: []
      })
    });

    for (let index = 0; index < 20; index += 1) {
      ctx.now = () => new Date(`2026-01-02T03:04:${String(index).padStart(2, "0")}.000Z`);
      await createBackup(ctx, { command: `backup-${index}`, args: {}, paths: ["/repo/file.txt"] });
    }
    ctx.now = () => new Date("2026-01-02T03:04:20.000Z");

    await createBackup(ctx, { command: "trigger-prune", args: {}, paths: ["/repo/file.txt"] });

    expect(volume.readFileSync("/home/user/.agent-stash/config.json", "utf8")).toBe("keep\n");
    expect(volume.existsSync("/home/user/.agent-stash/backups/tampered")).toBe(false);
  });
});
