import path from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { publishSafeBashRuntime, resolveSafeBashRuntime } from "./safe-bash-runtime.mjs";

function fixture(root = "/repo") {
  const volume = Volume.fromJSON({
    [`${root}/package.json`]: JSON.stringify({ name: "poe-code", type: "module" }),
    [`${root}/dist/safe-bash.js`]: 'export * from "./chunks/old.js";',
    [`${root}/dist/chunks/old.js`]: "export const value = 1;",
    [`${root}/packages/command/dist/index.js`]: "command artifact"
  });
  return { root, volume, files: createFsFromVolume(volume).promises,
    artifacts: new Set(["dist/safe-bash.js", "dist/chunks/old.js", "packages/command/dist/index.js"]) };
}

describe("source-linked Safe Bash runtime", () => {
  it("keeps the complete selected graph during command replacement and later publication", async () => {
    const { root, volume, files, artifacts } = fixture();
    await publishSafeBashRuntime(root, artifacts, { files, validate: async () => {} });
    const oldEntry = await resolveSafeBashRuntime(root, files);
    volume.rmSync("/repo/dist/chunks", { recursive: true });
    volume.rmSync("/repo/packages/command/dist", { recursive: true });
    expect(await resolveSafeBashRuntime(root, files)).toBe(oldEntry);
    expect(await files.readFile(path.join(path.dirname(oldEntry), "chunks/old.js"), "utf8")).toContain("value = 1");
    volume.mkdirSync("/repo/dist/chunks");
    volume.writeFileSync("/repo/dist/chunks/old.js", "export const value = 2;");
    artifacts.delete("packages/command/dist/index.js");
    await publishSafeBashRuntime(root, artifacts, { files, validate: async () => {} });
    const newEntry = await resolveSafeBashRuntime(root, files);
    expect(newEntry).not.toBe(oldEntry);
    expect(await files.readFile(path.join(path.dirname(newEntry), "chunks/old.js"), "utf8")).toContain("value = 2");
    expect(await files.readFile(path.join(path.dirname(oldEntry), "chunks/old.js"), "utf8")).toContain("value = 1");
  });

  it("keeps the previous runtime visible while copying and after a failed build publication", async () => {
    const { root, volume, files, artifacts } = fixture();
    await publishSafeBashRuntime(root, artifacts, { files, validate: async () => {} });
    const entry = await resolveSafeBashRuntime(root, files);
    const before = volume.toJSON();
    let copies = 0;
    await expect(publishSafeBashRuntime(root, artifacts, { files: { ...files,
      copyFile: async (...args: Parameters<typeof files.copyFile>) => {
        expect(await resolveSafeBashRuntime(root, files)).toBe(entry);
        if (++copies === 2) throw new Error("injected copy failure");
        await files.copyFile(...args);
      }
    }, validate: async () => {} })).rejects.toThrow("injected copy failure");
    expect(volume.toJSON()).toEqual(before);
  });

  it("does not select a candidate whose startup import fails", async () => {
    const { root, volume, files, artifacts } = fixture();
    await publishSafeBashRuntime(root, artifacts, { files, validate: async () => {} });
    const before = volume.toJSON();
    await expect(publishSafeBashRuntime(root, artifacts, { files,
      validate: async () => { throw new Error("missing command chunk"); }
    })).rejects.toThrow("missing command chunk");
    expect(volume.toJSON()).toEqual(before);
  });

  it("keeps the current generation when the atomic pointer update fails", async () => {
    const { root, volume, files, artifacts } = fixture();
    await publishSafeBashRuntime(root, artifacts, { files, validate: async () => {} });
    const before = volume.toJSON();
    await expect(publishSafeBashRuntime(root, artifacts, { files: { ...files,
      rename: async () => { throw new Error("injected rename failure"); }
    }, validate: async () => {} })).rejects.toThrow("injected rename failure");
    expect(volume.toJSON()).toEqual(before);
  });

  it("requires a successful build instead of falling back to mutable source artifacts", async () => {
    const { root, files } = fixture();
    await expect(resolveSafeBashRuntime(root, files)).rejects.toThrow("npm run build");
  });

  it("rejects output symlinks outside this checkout", async () => {
    const { root, volume, files, artifacts } = fixture();
    volume.mkdirSync("/other");
    volume.symlinkSync("/other", "/repo/.cache");
    await expect(publishSafeBashRuntime(root, artifacts, { files, validate: async () => {} })).rejects.toThrow("inside the package");
    expect(volume.readdirSync("/other")).toEqual([]);
  });

  it("rejects artifact paths outside this checkout", async () => {
    const { root, files } = fixture();
    await expect(publishSafeBashRuntime(root, new Set(["dist/safe-bash.js", "../other.js"]), { files, validate: async () => {} })).rejects.toThrow("artifact");
  });

  it("keeps independent checkout runtimes separate", async () => {
    const { root, volume, files, artifacts } = fixture();
    volume.mkdirSync("/other/dist", { recursive: true });
    volume.writeFileSync("/other/package.json", '{"type":"module"}');
    volume.writeFileSync("/other/dist/safe-bash.js", "other checkout");
    await publishSafeBashRuntime(root, artifacts, { files, validate: async () => {} });
    await publishSafeBashRuntime("/other", new Set(["dist/safe-bash.js"]), { files, validate: async () => {} });
    const entry = await resolveSafeBashRuntime(root, files);
    const other = await resolveSafeBashRuntime("/other", files);
    expect(entry.startsWith("/repo/")).toBe(true);
    expect(other.startsWith("/other/")).toBe(true);
    expect(await files.readFile(other, "utf8")).toBe("other checkout");
  });
});
