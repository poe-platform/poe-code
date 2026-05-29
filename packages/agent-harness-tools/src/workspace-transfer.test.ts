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
  it("applies gitignore precedence before uploading", async () => {
    const env = createEnv({
      "/repo/.gitignore": "build/\n!build/keep.txt\n",
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
});
