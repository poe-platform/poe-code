import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
vi.mock(
  "../packages/package-lint/dist/bundle-policy.js",
  () => import("../packages/package-lint/src/bundle-policy.js")
);

describe("profile-specific emitted workspace declarations", () => {
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
