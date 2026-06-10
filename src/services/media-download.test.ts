import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { downloadToFile, MediaDownloadError } from "./media-download.js";
import type { FileSystem } from "../utils/file-system.js";

async function withObjectPrototypeCode<T>(code: string, callback: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "code");
  Object.defineProperty(Object.prototype, "code", {
    configurable: true,
    value: code,
    writable: true
  });

  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(Object.prototype, "code", descriptor);
    } else {
      delete (Object.prototype as { code?: unknown }).code;
    }
  }
}

describe("downloadToFile", () => {
  it("classifies transport failures as media fetch errors", async () => {
    const error = await downloadToFile({
      url: "https://cdn.example.test/generated.png",
      outputPath: "/output/image.png",
      fs: {} as FileSystem,
      fetcher: async () => {
        throw new TypeError("network unreachable");
      }
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(MediaDownloadError);
    expect(error).toMatchObject({ kind: "fetch" });
  });

  it("preserves an existing asset when replacement persistence fails", async () => {
    const outputPath = "/repo/generated/image.png";
    const volume = Volume.fromJSON({ [outputPath]: Buffer.from("old-image") });
    const base = createFsFromVolume(volume).promises;
    let temporaryPath: string | undefined;
    const fs = {
      async writeFile(
        filePath: string,
        data: string | NodeJS.ArrayBufferView,
        options?: { flag?: string }
      ): Promise<void> {
        if (filePath.startsWith(`${outputPath}.`) && filePath.endsWith(".tmp")) {
          temporaryPath = filePath;
        }

        await base.writeFile(
          filePath,
          filePath === outputPath ? Buffer.from("new") : data,
          options
        );
        throw new Error("media disk full");
      },
      rename: (oldPath: string, newPath: string) => base.rename(oldPath, newPath),
      unlink: (filePath: string) => base.unlink(filePath)
    } as unknown as FileSystem;

    await withObjectPrototypeCode("EEXIST", async () => {
      await expect(downloadToFile({
        url: "https://cdn.example.test/generated.png",
        outputPath,
        fs,
        fetcher: async () => ({
          ok: true,
          arrayBuffer: async () => Buffer.from("new-image").buffer
        } as Response)
      })).rejects.toBeInstanceOf(MediaDownloadError);
    });

    expect(await base.readFile(outputPath, "utf8")).toBe("old-image");
    expect(temporaryPath).toBeDefined();
    await expect(base.readFile(temporaryPath as string, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("does not remove a colliding media temp symlink", async () => {
    const outputPath = "/repo/generated/image.png";
    const outsidePath = "/outside.tmp";
    const volume = Volume.fromJSON({
      [outputPath]: Buffer.from("old-image"),
      [outsidePath]: "outside-state\n"
    });
    const base = createFsFromVolume(volume).promises;
    let temporaryPath: string | undefined;
    const fs = {
      ...base,
      async writeFile(
        filePath: string,
        data: string | NodeJS.ArrayBufferView,
        options?: { flag?: string }
      ): Promise<void> {
        if (
          temporaryPath === undefined &&
          filePath.startsWith(`${outputPath}.`) &&
          filePath.endsWith(".tmp")
        ) {
          temporaryPath = filePath;
          volume.symlinkSync(outsidePath, filePath);
          expect(options).toEqual({ flag: "wx" });
        }

        await base.writeFile(filePath, data, options);
      }
    } as unknown as FileSystem;

    await expect(downloadToFile({
      url: "https://cdn.example.test/generated.png",
      outputPath,
      fs,
      fetcher: async () => ({
        ok: true,
        arrayBuffer: async () => Buffer.from("new-image").buffer
      } as Response)
    })).rejects.toBeInstanceOf(MediaDownloadError);

    expect(temporaryPath).toBeDefined();
    expect(volume.readFileSync(outsidePath, "utf8")).toBe("outside-state\n");
    expect(volume.lstatSync(temporaryPath as string).isSymbolicLink()).toBe(true);
    expect(await base.readFile(outputPath, "utf8")).toBe("old-image");
  });
});
