import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { readFileSync } from "node:fs";
import path from "node:path";
vi.mock(
  "../packages/package-lint/dist/bundle-policy.js",
  () => import("../packages/package-lint/src/bundle-policy.js")
);

describe("profile-specific emitted workspace declarations", () => {
  it("does not rewrite separately published outputs after their root exclusions are removed", async () => {
    const source = 'export type Value = import("@poe-platform/safe-bash/optional-host").Value;';
    const optional = "/repo/packages/safe-bash/dist/opt-in/optional.d.ts";
    const published = "/repo/packages/memory/dist/included.d.ts";
    const volume = Volume.fromJSON({ [optional]: source, [published]: source });
    const files = createFsFromVolume(volume).promises;
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const { collectPackageFiles } = await import("../packages/package-lint/src/bundle-policy.js");
    const packed = await collectPackageFiles("/repo", manifest.files.filter((entry: string) => !entry.startsWith("!")), {
      readdir: directory => files.readdir(directory, { withFileTypes: true }),
      stat: filename => files.stat(filename),
    });
    const { rewriteWorkspaceDts } = await import("./rewrite-workspace-dts.mjs");
    await rewriteWorkspaceDts("/repo/packages", [{ dir: "safe-bash", pkg: { name: "@poe-platform/safe-bash" } }], {
      rootDir: "/repo", files,
      includedFiles: new Set([...packed].map(filename => path.resolve("/repo", filename))),
    });
    expect(volume.readFileSync(optional, "utf8")).toBe(source);
    expect(volume.readFileSync(published, "utf8")).toContain('import("../../safe-bash/dist/optional-host.js")');
  });

  it("preserves excluded distribution declarations while rewriting included ones", async () => {
    const source = 'export type Value = import("@poe-platform/safe-bash/optional-host").Value;';
    const volume = Volume.fromJSON({
      "/repo/packages/safe-bash/dist/opt-in/optional.d.ts": source,
      "/repo/packages/safe-bash/dist/included.d.ts": source
    });
    const { rewriteWorkspaceDts } = await import("./rewrite-workspace-dts.mjs");
    await rewriteWorkspaceDts("/repo/packages/safe-bash/dist", [{ dir: "safe-bash", pkg: { name: "@poe-platform/safe-bash" } }], {
      rootDir: "/repo", files: createFsFromVolume(volume).promises,
      excludedPaths: ["/repo/packages/safe-bash/dist/opt-in"]
    });
    expect(volume.readFileSync("/repo/packages/safe-bash/dist/opt-in/optional.d.ts", "utf8")).toBe(source);
    expect(volume.readFileSync("/repo/packages/safe-bash/dist/included.d.ts", "utf8")).toContain('import("./optional-host.js")');
  });

  it.each(["node", "browser"])(
    "routes actual declaration edges for %s without changing literal data",
    async (profile) => {
      const filename = "/repo/packages/safe-js/dist/modules/fs.d.ts";
      const volume = Volume.fromJSON({
        [filename]: [
          'import type { FsError } from "@poe-code/safe-fs";',
          'export { MemoryFileSystem } from "@poe-code/safe-fs/core";',
          'export type Host = import("@poe-code/safe-fs/node").RealFileSystem;',
          'export type Policy = import("#safe-fs-platform").PlatformErrno;',
          'export type Literal = "@poe-code/safe-fs";'
        ].join("\n")
      });
      const { rewriteWorkspaceDts } = await import("./rewrite-workspace-dts.mjs");
      await rewriteWorkspaceDts(
        "/repo/packages/safe-js/dist",
        [{ dir: "safe-fs", pkg: { name: "@poe-code/safe-fs" } }],
        { rootDir: "/repo", profile, files: createFsFromVolume(volume).promises }
      );
      const text = volume.readFileSync(filename, "utf8");
      expect(text).toContain(
        `from "../../../safe-fs/dist/${profile === "browser" ? "core" : "index"}.js"`
      );
      expect(text).toContain('from "../../../safe-fs/dist/core.js"');
      expect(text).toContain(
        `import("../../../safe-fs/dist/${profile === "browser" ? "node-unavailable" : "node-host"}.js")`
      );
      expect(text).toContain('import("#safe-fs-platform")');
      expect(text).toContain('Literal = "@poe-code/safe-fs"');
    }
  );
});
