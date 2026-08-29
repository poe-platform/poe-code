import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";

import { publishBundleOutputs } from "./publish-bundle.mjs";

function fixture() {
  const volume = Volume.fromJSON({
    "/repo/src/index.ts": "authoritative source",
    "/repo/dist/index.js": 'export * from "./chunks/chunk-OLD.js";',
    "/repo/dist/index.d.ts": "export declare const value: number;",
    "/repo/dist/chunks/chunk-OLD.js": "export const value = 1;",
    "/repo/dist/chunks/chunk-OLD.js.map": "old map",
    "/repo/dist/chunks/lazy-OLD.js": "export const lazy = true;",
    "/repo/dist/chunks/lazy-OLD.js.map": "old lazy map",
    "/repo/dist/chunks/notes.txt": "unrelated data"
  });
  const outputs = {
    "dist/index.js": {
      entryPoint: "src/index.ts",
      imports: [{ path: "dist/chunks/chunk-NEW.js" }]
    },
    "dist/chunks/chunk-NEW.js": { imports: [] },
    "dist/chunks/chunk-NEW.js.map": { imports: [] },
    "dist/chunks/chunk-DEAD.js": { imports: [] }
  };
  const result = {
    metafile: { outputs },
    outputFiles: Object.keys(outputs).map((filename) => ({
      path: `/repo/${filename}`,
      contents: new TextEncoder().encode(filename)
    }))
  };
  const options = {
    outdir: "/repo/dist",
    entryPoints: ["src/index.ts"],
    workingDirectory: "/repo"
  };
  return { volume, result, options, fileSystem: createFsFromVolume(volume).promises };
}

describe("publishBundleOutputs", () => {
  it("publishes reachable files before removing obsolete chunks and preserves other files", async () => {
    const { volume, result, options, fileSystem } = fixture();
    const renamed: string[] = [];
    const rename = vi.fn(async (source: string, target: string) => {
      expect(volume.existsSync("/repo/dist/chunks/chunk-OLD.js")).toBe(true);
      renamed.push(target);
      await fileSystem.rename(source, target);
    });

    await publishBundleOutputs(result, options, { ...fileSystem, rename });

    expect(renamed.at(-1)).toBe("/repo/dist/index.js");
    expect(volume.toJSON()).toEqual({
      "/repo/src/index.ts": "authoritative source",
      "/repo/dist/index.js": "dist/index.js",
      "/repo/dist/index.d.ts": "export declare const value: number;",
      "/repo/dist/chunks/chunk-NEW.js": "dist/chunks/chunk-NEW.js",
      "/repo/dist/chunks/chunk-NEW.js.map": "dist/chunks/chunk-NEW.js.map",
      "/repo/dist/chunks/notes.txt": "unrelated data"
    });
    const published = volume.toJSON();
    await publishBundleOutputs(result, options, fileSystem);
    expect(volume.toJSON()).toEqual(published);
  });

  it.each([1, 2, 3])(
    "preserves all previous outputs when staging write %i fails",
    async (failedWrite) => {
      const { volume, result, options, fileSystem } = fixture();
      const before = volume.toJSON();
      const failure = Object.assign(new Error("disk full"), { code: "ENOSPC" });
      let writes = 0;
      const writeFile = vi.fn(async (...args: Parameters<typeof fileSystem.writeFile>) => {
        if (++writes === failedWrite) throw failure;
        return fileSystem.writeFile(...args);
      });

      await expect(
        publishBundleOutputs(result, options, { ...fileSystem, writeFile })
      ).rejects.toBe(failure);
      expect(volume.toJSON()).toEqual(before);
      expect(volume.readdirSync("/repo/dist")).not.toContainEqual(
        expect.stringContaining(".bundle-")
      );
    }
  );

  it("does not delete old chunks when publication fails", async () => {
    const { volume, result, options, fileSystem } = fixture();
    const failure = new Error("rename failed");
    const rename = vi.fn(async (source: string, target: string) => {
      if (target === "/repo/dist/index.js") throw failure;
      await fileSystem.rename(source, target);
    });

    await expect(publishBundleOutputs(result, options, { ...fileSystem, rename })).rejects.toBe(
      failure
    );
    expect(volume.readFileSync("/repo/dist/index.js", "utf8")).toContain("chunk-OLD.js");
    expect(volume.readFileSync("/repo/dist/chunks/chunk-OLD.js", "utf8")).toBe(
      "export const value = 1;"
    );
    expect(volume.existsSync("/repo/dist/chunks/chunk-OLD.js.map")).toBe(true);
  });

  it.each(["missing-file", "extra-file", "duplicate-file", "missing-dependency", "outside-output"])(
    "rejects %s before changing files",
    async (kind) => {
      const { volume, result, options, fileSystem } = fixture();
      const before = volume.toJSON();
      if (kind === "missing-file") result.outputFiles.pop();
      if (kind === "extra-file")
        result.outputFiles.push({ path: "/repo/dist/extra.js", contents: new Uint8Array() });
      if (kind === "duplicate-file") result.outputFiles.push(result.outputFiles[0]);
      if (kind === "missing-dependency")
        result.metafile.outputs["dist/index.js"].imports.push({ path: "dist/missing.js" });
      if (kind === "outside-output") {
        result.outputFiles[0].path = "/repo/src/index.ts";
        Object.assign(result.metafile.outputs, {
          "src/index.ts": result.metafile.outputs["dist/index.js"]
        });
        Reflect.deleteProperty(result.metafile.outputs, "dist/index.js");
      }

      await expect(publishBundleOutputs(result, options, fileSystem)).rejects.toThrow();
      expect(volume.toJSON()).toEqual(before);
    }
  );

  it("rejects unsafe output symlinks before staging or deleting anything", async () => {
    const { volume, result, options, fileSystem } = fixture();
    volume.mkdirSync("/outside");
    volume.writeFileSync("/outside/value", "protected");
    volume.symlinkSync("/outside/value", "/repo/dist/chunks/chunk-NEW.js");
    const before = volume.toJSON();

    await expect(publishBundleOutputs(result, options, fileSystem)).rejects.toThrow(
      "inside the package"
    );
    expect(volume.toJSON()).toEqual(before);
    expect(volume.readlinkSync("/repo/dist/chunks/chunk-NEW.js")).toBe("/outside/value");
  });

  it("supports a fresh output directory", async () => {
    const { result, options } = fixture();
    const volume = Volume.fromJSON({ "/repo/src/index.ts": "source" });

    await publishBundleOutputs(result, options, createFsFromVolume(volume).promises);

    expect(volume.readFileSync("/repo/dist/index.js", "utf8")).toBe("dist/index.js");
    expect(volume.existsSync("/repo/dist/chunks/chunk-DEAD.js")).toBe(false);
  });
});
