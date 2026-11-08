import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import {
  downloadWorkspace,
  uploadWorkspace,
  type WorkspaceTransferEnv,
  type WorkspaceTransferFileSystem
} from "./workspace-transfer.js";

function createFs(files: Record<string, string | Buffer>) {
  const volume = Volume.fromJSON(files, "/");
  return createFsFromVolume(volume).promises as unknown as WorkspaceTransferFileSystem;
}

function createEnv(files: Record<string, string | Buffer>): WorkspaceTransferEnv {
  return {
    cwd: "/repo",
    uploadDir: "/upload",
    workspaceDir: "/workspace",
    fs: createFs(files),
    remoteFs: createFs({})
  };
}

async function readRemote(env: WorkspaceTransferEnv, relativePath: string): Promise<string> {
  return env.remoteFs.readFile(`/workspace/${relativePath}`, "utf8") as Promise<string>;
}

async function expectNoRemote(env: WorkspaceTransferEnv, relativePath: string): Promise<void> {
  await expect(readRemote(env, relativePath)).rejects.toThrow();
}

describe("workspace transfer", () => {
  it("does not re-include files from gitignored directories unless the parent is unignored", async () => {
    const env = createEnv({
      "/repo/.gitignore": "build/\n!build/keep.txt\n",
      "/repo/build/drop.txt": "drop",
      "/repo/build/keep.txt": "keep",
      "/repo/src/app.ts": "app"
    });

    const result = await uploadWorkspace(env, {});

    expect(result.files).toBe(2);
    await expectNoRemote(env, "build/drop.txt");
    await expectNoRemote(env, "build/keep.txt");
    await expect(readRemote(env, "src/app.ts")).resolves.toBe("app");
  });

  it("re-includes files from gitignored directories when the parent is unignored", async () => {
    const env = createEnv({
      "/repo/.gitignore": "build/\n!build/\n!build/keep.txt\n",
      "/repo/build/drop.txt": "drop",
      "/repo/build/keep.txt": "keep",
      "/repo/src/app.ts": "app"
    });

    const result = await uploadWorkspace(env, {});

    expect(result.files).toBe(3);
    await expectNoRemote(env, "build/drop.txt");
    await expect(readRemote(env, "build/keep.txt")).resolves.toBe("keep");
  });

  it("keeps poe-code-ignore additive and never un-ignores gitignored files", async () => {
    const env = createEnv({
      "/repo/.gitignore": "secret.txt\n",
      "/repo/.poe-code-ignore": "!secret.txt\nnotes.txt\n",
      "/repo/secret.txt": "secret",
      "/repo/notes.txt": "notes",
      "/repo/src/app.ts": "app"
    });

    const result = await uploadWorkspace(env, {});

    expect(result.files).toBe(3);
    await expectNoRemote(env, "secret.txt");
    await expectNoRemote(env, "notes.txt");
    await expect(readRemote(env, "src/app.ts")).resolves.toBe("app");
  });

  it("keeps poe-code-ignore additive even when it tries to unignore a nested gitignore include", async () => {
    const env = createEnv({
      "/repo/.gitignore": "build/\n!build/keep.txt\n",
      "/repo/.poe-code-ignore": "build/\n!build/keep.txt\n",
      "/repo/build/keep.txt": "keep",
      "/repo/src/app.ts": "app"
    });

    const result = await uploadWorkspace(env, {});

    expect(result.files).toBe(3);
    await expectNoRemote(env, "build/keep.txt");
    await expect(readRemote(env, "src/app.ts")).resolves.toBe("app");
  });

  it("treats leading slash ignore patterns as cwd-anchored", async () => {
    const env = createEnv({
      "/repo/.gitignore": "/root-only.txt\n",
      "/repo/root-only.txt": "drop",
      "/repo/nested/root-only.txt": "keep"
    });

    await uploadWorkspace(env, {});

    await expectNoRemote(env, "root-only.txt");
    await expect(readRemote(env, "nested/root-only.txt")).resolves.toBe("keep");
  });

  it("honors escaped leading comment markers in gitignore patterns", async () => {
    const env = createEnv({
      "/repo/.gitignore": "\\#credentials\n",
      "/repo/#credentials": "secret",
      "/repo/app.ts": "app"
    });

    await uploadWorkspace(env, {});

    await expectNoRemote(env, "#credentials");
    await expect(readRemote(env, "app.ts")).resolves.toBe("app");
  });

  it("preserves meaningful leading spaces in gitignore patterns", async () => {
    const env = createEnv({
      "/repo/.gitignore": " secret.txt\n",
      "/repo/ secret.txt": "drop",
      "/repo/secret.txt": "keep"
    });

    await uploadWorkspace(env, {});

    await expectNoRemote(env, " secret.txt");
    await expect(readRemote(env, "secret.txt")).resolves.toBe("keep");
  });

  it("matches globstar gitignore rules across nested directories", async () => {
    const env = createEnv({
      "/repo/.gitignore": "**/.env\n",
      "/repo/packages/app/config/.env": "secret",
      "/repo/packages/app/config/app.ts": "app"
    });

    await uploadWorkspace(env, {});

    await expectNoRemote(env, "packages/app/config/.env");
    await expect(readRemote(env, "packages/app/config/app.ts")).resolves.toBe("app");
  });

  it("applies nested gitignore rules within their containing directory", async () => {
    const env = createEnv({
      "/repo/packages/app/.gitignore": ".env\n",
      "/repo/packages/app/.env": "secret",
      "/repo/packages/other/.env": "keep"
    });

    await uploadWorkspace(env, {});

    await expectNoRemote(env, "packages/app/.env");
    await expect(readRemote(env, "packages/other/.env")).resolves.toBe("keep");
  });

  it("skips oversize files and prints one warning per skip", async () => {
    const warn = vi.fn();
    const env = createEnv({
      "/repo/small.txt": "small",
      "/repo/large.bin": Buffer.alloc(20)
    });

    const result = await uploadWorkspace(env, {
      uploadMaxFileMb: 0.00001,
      warn
    });

    expect(result).toEqual({
      files: 1,
      bytes: 5,
      skipped: [{ path: "large.bin", bytes: 20, reason: "max_size" }]
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("Skipping large.bin: 20 bytes exceeds upload_max_file_mb.");
    await expectNoRemote(env, "large.bin");
  });

  it("checks the bytes read for upload against the size limit", async () => {
    const baseFs = createFs({ "/repo/growing.bin": "small" });
    const originalReadFile = baseFs.readFile.bind(baseFs);
    let didGrow = false;
    const env: WorkspaceTransferEnv = {
      cwd: "/repo",
      uploadDir: "/upload",
      workspaceDir: "/workspace",
      fs: {
        ...baseFs,
        async readFile(filePath: string, encoding?: BufferEncoding) {
          if (filePath === "/repo/growing.bin" && !didGrow) {
            didGrow = true;
            await baseFs.writeFile(filePath, Buffer.alloc(20));
          }

          return encoding === undefined
            ? originalReadFile(filePath)
            : originalReadFile(filePath, encoding);
        }
      } as WorkspaceTransferFileSystem,
      remoteFs: createFs({})
    };

    const result = await uploadWorkspace(env, { uploadMaxFileMb: 0.00001, warn: vi.fn() });

    expect(result.skipped).toEqual([{ path: "growing.bin", bytes: 20, reason: "max_size" }]);
    await expectNoRemote(env, "growing.bin");
  });

  it("does not read gitignored file content during upload", async () => {
    const baseFs = createFs({
      "/repo/.gitignore": "secret.txt\n",
      "/repo/secret.txt": "secret",
      "/repo/app.ts": "app"
    });
    const originalReadFile = baseFs.readFile.bind(baseFs);
    const env: WorkspaceTransferEnv = {
      cwd: "/repo",
      uploadDir: "/upload",
      workspaceDir: "/workspace",
      fs: {
        ...baseFs,
        async readFile(filePath: string, encoding?: BufferEncoding) {
          if (filePath === "/repo/secret.txt") {
            throw new Error("ignored content should not be read");
          }

          return encoding === undefined
            ? originalReadFile(filePath)
            : originalReadFile(filePath, encoding);
        }
      } as WorkspaceTransferFileSystem,
      remoteFs: createFs({})
    };

    await expect(uploadWorkspace(env, {})).resolves.toMatchObject({ files: 2 });
    await expect(readRemote(env, "app.ts")).resolves.toBe("app");
    await expectNoRemote(env, "secret.txt");
  });

  it("applies runner workspace excludes", async () => {
    const env = createEnv({
      "/repo/src/app.ts": "app",
      "/repo/dist/app.js": "built"
    });

    const result = await uploadWorkspace(env, {
      runner: {
        detach: false,
        upload_max_file_mb: 100,
        download_conflict: "refuse",
        workspace: { exclude: ["dist"] }
      }
    });

    expect(result.files).toBe(1);
    await expect(readRemote(env, "src/app.ts")).resolves.toBe("app");
    await expectNoRemote(env, "dist/app.js");
  });

  it("writes a tar archive under uploadDir", async () => {
    const env = createEnv({
      "/repo/src/app.ts": "app"
    });

    await uploadWorkspace(env, {});

    const tar = await env.remoteFs.readFile("/upload/workspace.tar");
    expect(tar.subarray(0, "src/app.ts".length).toString("utf8")).toBe("src/app.ts");
    expect(tar.subarray(512, 515).toString("utf8")).toBe("app");
  });

  it("stores long tar paths using the USTAR prefix field", async () => {
    const longPath = `${"segment/".repeat(13)}file.txt`;
    const env = createEnv({ [`/repo/${longPath}`]: "content" });

    await uploadWorkspace(env, {});

    const tar = await env.remoteFs.readFile("/upload/workspace.tar");
    const name = tar.subarray(0, 100).toString("utf8").replaceAll("\0", "");
    const prefix = tar.subarray(345, 500).toString("utf8").replaceAll("\0", "");
    expect(`${prefix}/${name}`).toBe(longPath);
  });

  it("downloads remote changes over unchanged local files", async () => {
    const env = createEnv({
      "/repo/app.ts": "base"
    });
    await uploadWorkspace(env, {});
    await env.remoteFs.writeFile("/workspace/app.ts", "remote");

    const result = await downloadWorkspace(env, { conflictPolicy: "refuse" });

    expect(result).toEqual({
      files: 1,
      bytes: 6,
      conflicts: []
    });
    await expect(env.fs.readFile("/repo/app.ts", "utf8")).resolves.toBe("remote");
  });

  it("downloads new remote files when no local file exists", async () => {
    const env = createEnv({
      "/repo/app.ts": "base"
    });
    await uploadWorkspace(env, {});
    await env.remoteFs.writeFile("/workspace/new.ts", "new");

    const result = await downloadWorkspace(env, { conflictPolicy: "refuse" });

    expect(result.conflicts).toEqual([]);
    await expect(env.fs.readFile("/repo/new.ts", "utf8")).resolves.toBe("new");
  });

  it("does not write downloads through a preexisting temp symlink", async () => {
    const env = createEnv({
      "/repo/app.ts": "base",
      "/outside/target.txt": "keep"
    });
    await uploadWorkspace(env, {});
    await (env.fs as WorkspaceTransferFileSystem & { symlink(target: string, path: string): Promise<void> }).symlink(
      "/outside/target.txt",
      "/repo/out.txt.download-tmp"
    );
    await env.remoteFs.writeFile("/workspace/out.txt", "remote");

    const result = await downloadWorkspace(env, { conflictPolicy: "refuse" });

    expect(result.conflicts).toEqual([]);
    await expect(env.fs.readFile("/repo/out.txt", "utf8")).resolves.toBe("remote");
    await expect(env.fs.readFile("/outside/target.txt", "utf8")).resolves.toBe("keep");
  });

  it("rejects remote workspace symlinks during download", async () => {
    const env = createEnv({
      "/repo/app.ts": "base"
    });
    await uploadWorkspace(env, {});
    await env.remoteFs.mkdir("/outside", { recursive: true });
    await env.remoteFs.writeFile("/outside/secret.txt", "secret");
    await (env.remoteFs as WorkspaceTransferFileSystem & { symlink(target: string, path: string): Promise<void> }).symlink(
      "/outside",
      "/workspace/leak"
    );

    await expect(downloadWorkspace(env, { conflictPolicy: "overwrite" })).rejects.toThrow(
      "Workspace download must not follow symbolic links."
    );
    await expect(env.fs.readFile("/repo/leak/secret.txt", "utf8")).rejects.toThrow();
  });

  it("conflicts when remote adds a path that local also created after upload", async () => {
    const env = createEnv({
      "/repo/app.ts": "base"
    });
    await uploadWorkspace(env, {});
    await env.fs.writeFile("/repo/new.ts", "local-new");
    await env.remoteFs.writeFile("/workspace/new.ts", "remote-new");

    const result = await downloadWorkspace(env, { conflictPolicy: "refuse" });

    expect(result.conflicts).toEqual([{ path: "new.ts", reason: "local_modified" }]);
    await expect(env.fs.readFile("/repo/new.ts", "utf8")).resolves.toBe("local-new");
  });

  it("does not conflict when remote adds a path with the same content local also created", async () => {
    const env = createEnv({
      "/repo/app.ts": "base"
    });
    await uploadWorkspace(env, {});
    await env.fs.writeFile("/repo/new.ts", "same");
    await env.remoteFs.writeFile("/workspace/new.ts", "same");

    const result = await downloadWorkspace(env, { conflictPolicy: "refuse" });

    expect(result.conflicts).toEqual([]);
    await expect(env.fs.readFile("/repo/new.ts", "utf8")).resolves.toBe("same");
  });

  it("refuses conflicting downloads and lists affected files", async () => {
    const env = createEnv({
      "/repo/app.ts": "base",
      "/repo/clean.ts": "base"
    });
    await uploadWorkspace(env, {});
    await env.fs.writeFile("/repo/app.ts", "local");
    await env.remoteFs.writeFile("/workspace/app.ts", "remote");
    await env.remoteFs.writeFile("/workspace/clean.ts", "remote-clean");

    const result = await downloadWorkspace(env, { conflictPolicy: "refuse" });

    expect(result).toEqual({
      files: 1,
      bytes: 12,
      conflicts: [{ path: "app.ts", reason: "local_modified" }]
    });
    await expect(env.fs.readFile("/repo/app.ts", "utf8")).resolves.toBe("local");
    await expect(env.fs.readFile("/repo/clean.ts", "utf8")).resolves.toBe("remote-clean");
  });

  it("refuses downloads over local files excluded from upload", async () => {
    const env = createEnv({
      "/repo/.gitignore": ".env\n",
      "/repo/.env": "LOCAL_SECRET=keep\n"
    });
    await uploadWorkspace(env, {});
    await env.remoteFs.writeFile("/workspace/.env", "LOCAL_SECRET=remote\n");

    const result = await downloadWorkspace(env, { conflictPolicy: "refuse" });

    expect(result.conflicts).toEqual([{ path: ".env", reason: "local_modified" }]);
    await expect(env.fs.readFile("/repo/.env", "utf8")).resolves.toBe("LOCAL_SECRET=keep\n");
  });

  it("preserves an existing local file when a replacement download write fails", async () => {
    const backingLocal = createFs({ "/repo/app.ts": "base content" });
    const remoteFs = createFs({ "/workspace/app.ts": "remote content" });
    const env: WorkspaceTransferEnv = {
      cwd: "/repo",
      uploadDir: "/upload",
      workspaceDir: "/workspace",
      fs: {
        ...backingLocal,
        async writeFile(filePath: string, data: string | Buffer) {
          if (filePath.endsWith(".download-tmp")) {
            await backingLocal.writeFile(filePath, Buffer.from(data).subarray(0, 3));
            throw new Error("disk full");
          }

          await backingLocal.writeFile(filePath, data);
        }
      } as WorkspaceTransferFileSystem,
      remoteFs
    };

    await expect(downloadWorkspace(env, { conflictPolicy: "overwrite" })).rejects.toThrow(
      "disk full"
    );
    await expect(backingLocal.readFile("/repo/app.ts", "utf8")).resolves.toBe("base content");
  });

  it("preserves the prior remote workspace when replacement upload fails", async () => {
    const backingRemote = createFs({
      "/workspace/app.ts": "stable remote",
      "/workspace/keep.ts": "keep"
    });
    const env: WorkspaceTransferEnv = {
      cwd: "/repo",
      uploadDir: "/upload",
      workspaceDir: "/workspace",
      fs: createFs({ "/repo/app.ts": "fresh remote" }),
      remoteFs: {
        ...backingRemote,
        async writeFile(filePath: string, data: string | Buffer) {
          if (filePath.includes(".upload-tmp") && filePath.endsWith("/app.ts")) {
            await backingRemote.writeFile(filePath, Buffer.from(data).subarray(0, 5));
            throw new Error("remote disk full");
          }

          await backingRemote.writeFile(filePath, data);
        }
      } as WorkspaceTransferFileSystem
    };

    await expect(uploadWorkspace(env, {})).rejects.toThrow("remote disk full");
    await expect(backingRemote.readFile("/workspace/app.ts", "utf8")).resolves.toBe(
      "stable remote"
    );
    await expect(backingRemote.readFile("/workspace/keep.ts", "utf8")).resolves.toBe("keep");
  });

  it("refuses to delete locally modified files removed remotely", async () => {
    const env = createEnv({
      "/repo/app.ts": "base"
    });
    await uploadWorkspace(env, {});
    await env.fs.writeFile("/repo/app.ts", "local");
    await env.remoteFs.rm?.("/workspace/app.ts", { force: true });

    const result = await downloadWorkspace(env, { conflictPolicy: "refuse" });

    expect(result).toEqual({
      files: 0,
      bytes: 0,
      conflicts: [{ path: "app.ts", reason: "local_modified" }]
    });
    await expect(env.fs.readFile("/repo/app.ts", "utf8")).resolves.toBe("local");
  });

  it("removes unchanged local files deleted remotely", async () => {
    const env = createEnv({
      "/repo/app.ts": "base"
    });
    await uploadWorkspace(env, {});
    await env.remoteFs.rm?.("/workspace/app.ts", { force: true });

    const result = await downloadWorkspace(env, { conflictPolicy: "refuse" });

    expect(result).toEqual({
      files: 0,
      bytes: 0,
      conflicts: []
    });
    await expect(env.fs.readFile("/repo/app.ts", "utf8")).rejects.toThrow();
  });

  it("uses upload-time hashes for files skipped during upload", async () => {
    const env = createEnv({
      "/repo/large.bin": Buffer.alloc(20, "a")
    });
    await uploadWorkspace(env, {
      uploadMaxFileMb: 0.00001,
      warn: vi.fn()
    });
    await env.fs.writeFile("/repo/large.bin", Buffer.alloc(20, "b"));
    await env.remoteFs.writeFile("/workspace/large.bin", Buffer.alloc(20, "c"));

    const result = await downloadWorkspace(env, { conflictPolicy: "refuse" });

    expect(result.conflicts).toEqual([{ path: "large.bin", reason: "local_modified" }]);
    await expect(env.fs.readFile("/repo/large.bin")).resolves.toEqual(Buffer.alloc(20, "b"));
  });

  it("overwrites conflicting downloads when requested", async () => {
    const env = createEnv({
      "/repo/app.ts": "base"
    });
    await uploadWorkspace(env, {});
    await env.fs.writeFile("/repo/app.ts", "local");
    await env.remoteFs.writeFile("/workspace/app.ts", "remote");

    const result = await downloadWorkspace(env, { conflictPolicy: "overwrite" });

    expect(result).toEqual({
      files: 1,
      bytes: 6,
      conflicts: []
    });
    await expect(env.fs.readFile("/repo/app.ts", "utf8")).resolves.toBe("remote");
  });

  it("rejects downloads through a symlinked local parent before writing externally", async () => {
    const env = createEnv({
      "/repo/linked/old.txt": "base",
      "/outside/keep.txt": "keep"
    });
    await uploadWorkspace(env, {});
    await env.fs.rm?.("/repo/linked", { recursive: true, force: true });
    await (env.fs as WorkspaceTransferFileSystem & { symlink(target: string, path: string): Promise<void> }).symlink(
      "/outside",
      "/repo/linked"
    );
    await env.remoteFs.writeFile("/workspace/linked/new.txt", "remote");

    await expect(downloadWorkspace(env, { conflictPolicy: "overwrite" })).rejects.toThrow(
      "Workspace download must remain inside the local workspace."
    );
    await expect(env.fs.readFile("/outside/new.txt", "utf8")).rejects.toThrow();
    await expect(env.fs.readFile("/outside/keep.txt", "utf8")).resolves.toBe("keep");
  });

  it("rejects downloads through a symlinked local parent before deleting externally", async () => {
    const env = createEnv({
      "/repo/linked/old.txt": "base",
      "/outside/old.txt": "external"
    });
    await uploadWorkspace(env, {});
    await env.remoteFs.rm?.("/workspace/linked/old.txt", { force: true });
    await env.fs.rm?.("/repo/linked", { recursive: true, force: true });
    await (env.fs as WorkspaceTransferFileSystem & { symlink(target: string, path: string): Promise<void> }).symlink(
      "/outside",
      "/repo/linked"
    );

    await expect(downloadWorkspace(env, { conflictPolicy: "overwrite" })).rejects.toThrow(
      "Workspace download must remain inside the local workspace."
    );
    await expect(env.fs.readFile("/outside/old.txt", "utf8")).resolves.toBe("external");
  });
});
