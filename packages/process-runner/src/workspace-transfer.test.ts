import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { downloadWorkspace, uploadWorkspace } from "./workspace-transfer.js";
import type { WorkspaceTransferFileSystem } from "./workspace-transfer.js";

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

function createMemFs(): {
  fs: WorkspaceTransferFileSystem;
  rawFs: ReturnType<typeof createFsFromVolume>["promises"];
} {
  const volume = new Volume();
  const rawFs = createFsFromVolume(volume).promises;
  return {
    fs: rawFs as unknown as WorkspaceTransferFileSystem,
    rawFs
  };
}

describe("uploadWorkspace", () => {
  it("rejects non-positive and non-finite upload size limits before reading workspace files", async () => {
    for (const uploadMaxFileMb of [-1, 0, Number.POSITIVE_INFINITY]) {
      const { fs } = createMemFs();
      const { fs: remoteFs } = createMemFs();
      await fs.mkdir("/repo", { recursive: true });
      await fs.writeFile("/repo/app.ts", "app");
      const warn = vi.fn();

      await expect(
        uploadWorkspace(
          { cwd: "/repo", uploadDir: "/upload", workspaceDir: "/workspace", fs, remoteFs },
          { uploadMaxFileMb, warn }
        )
      ).rejects.toThrow(/upload_max_file_mb/i);
      expect(warn).not.toHaveBeenCalled();
    }
  });

  it("excludes git metadata by default", async () => {
    const { fs } = createMemFs();
    const { fs: remoteFs } = createMemFs();
    await fs.mkdir("/repo/.git", { recursive: true });
    await fs.writeFile("/repo/.git/config", "[core]\nrepositoryformatversion = 0\n");
    await fs.writeFile("/repo/README.md", "hello\n");

    await expect(
      uploadWorkspace(
        { cwd: "/repo", uploadDir: "/upload", workspaceDir: "/workspace", fs, remoteFs },
        { warn: () => undefined }
      )
    ).resolves.toMatchObject({ files: 1, bytes: 6, skipped: [] });
    await expect(remoteFs.readFile("/workspace/README.md", "utf8")).resolves.toBe("hello\n");
    await expect(remoteFs.readFile("/workspace/.git/config", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("does not re-include files from gitignored directories unless the parent is unignored", async () => {
    const { fs } = createMemFs();
    const { fs: remoteFs } = createMemFs();
    await fs.mkdir("/repo/build", { recursive: true });
    await fs.writeFile("/repo/.gitignore", "build/\n!build/keep.txt\n");
    await fs.writeFile("/repo/build/keep.txt", "secret\n");

    await expect(
      uploadWorkspace(
        { cwd: "/repo", uploadDir: "/upload", workspaceDir: "/workspace", fs, remoteFs },
        { warn: () => undefined }
      )
    ).resolves.toMatchObject({ files: 1, bytes: 23, skipped: [] });
    await expect(remoteFs.readFile("/workspace/.gitignore", "utf8")).resolves.toBe(
      "build/\n!build/keep.txt\n"
    );
    await expect(remoteFs.readFile("/workspace/build/keep.txt", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("re-includes only explicitly unignored files when a gitignored parent is unignored", async () => {
    const { fs } = createMemFs();
    const { fs: remoteFs } = createMemFs();
    await fs.mkdir("/repo/build", { recursive: true });
    await fs.writeFile("/repo/.gitignore", "build/\n!build/\n!build/keep.txt\n");
    await fs.writeFile("/repo/build/drop.txt", "drop\n");
    await fs.writeFile("/repo/build/keep.txt", "keep\n");

    await expect(
      uploadWorkspace(
        { cwd: "/repo", uploadDir: "/upload", workspaceDir: "/workspace", fs, remoteFs },
        { warn: () => undefined }
      )
    ).resolves.toMatchObject({ files: 2, bytes: 36, skipped: [] });
    await expect(remoteFs.readFile("/workspace/.gitignore", "utf8")).resolves.toBe(
      "build/\n!build/\n!build/keep.txt\n"
    );
    await expect(remoteFs.readFile("/workspace/build/keep.txt", "utf8")).resolves.toBe("keep\n");
    await expect(remoteFs.readFile("/workspace/build/drop.txt", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});

describe("downloadWorkspace", () => {
  it("does not treat inherited not-found codes as missing remote workspace directories", async () => {
    const { fs: localFs } = createMemFs();
    const { fs: baseRemoteFs } = createMemFs();
    const remoteFs = {
      ...baseRemoteFs,
      readdir: async (directoryPath: string, options: { withFileTypes: true }) => {
        if (directoryPath === "/workspace") {
          throw new Error("remote workspace read denied");
        }

        return await baseRemoteFs.readdir(directoryPath, options);
      }
    } as WorkspaceTransferFileSystem;

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(
        downloadWorkspace(
          {
            cwd: "/repo",
            uploadDir: "/upload",
            workspaceDir: "/workspace",
            fs: localFs,
            remoteFs
          },
          { conflictPolicy: "overwrite" }
        )
      ).rejects.toThrow("remote workspace read denied");
    });
  });

  it("removes partial temporary files when download write errors only inherit existing-path codes", async () => {
    const { fs: baseLocalFs } = createMemFs();
    const { fs: remoteFs, rawFs: rawRemoteFs } = createMemFs();
    await rawRemoteFs.mkdir("/workspace", { recursive: true });
    await rawRemoteFs.writeFile("/workspace/page.txt", "remote\n");

    let temporaryPath: string | undefined;
    const localFs = {
      ...baseLocalFs,
      writeFile: async (
        filePath: string,
        data: string | Buffer,
        options?: { flag?: string; mode?: number }
      ) => {
        if (
          temporaryPath === undefined &&
          filePath.startsWith("/repo/page.txt.") &&
          filePath.endsWith(".download-tmp")
        ) {
          temporaryPath = filePath;
          await baseLocalFs.writeFile(filePath, "partial\n", options);
          throw new Error("download temp denied");
        }

        await baseLocalFs.writeFile(filePath, data, options);
      }
    } as WorkspaceTransferFileSystem;

    await withObjectPrototypeProperties({ code: "EEXIST" }, async () => {
      await expect(
        downloadWorkspace(
          {
            cwd: "/repo",
            uploadDir: "/upload",
            workspaceDir: "/workspace",
            fs: localFs,
            remoteFs
          },
          { conflictPolicy: "overwrite" }
        )
      ).rejects.toThrow("download temp denied");
    });

    expect(temporaryPath).toBeDefined();
    await expect(baseLocalFs.readFile(temporaryPath as string, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});
