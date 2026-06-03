import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { downloadToFile, MediaDownloadError } from "./media-download.js";
import type { FileSystem } from "../utils/file-system.js";

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
    const fs = {
      async writeFile(filePath: string, data: string | NodeJS.ArrayBufferView): Promise<void> {
        await base.writeFile(filePath, filePath === outputPath ? Buffer.from("new") : data);
        throw new Error("media disk full");
      },
      rename: (oldPath: string, newPath: string) => base.rename(oldPath, newPath),
      unlink: (filePath: string) => base.unlink(filePath)
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

    expect(await base.readFile(outputPath, "utf8")).toBe("old-image");
  });
});
