import { describe, expect, it } from "vitest";
import { makeWorkspace, pkgJson } from "../fixtures.js";
import { runtimeFileAssetsCollocated } from "./runtime-file-assets-collocated.js";

describe("runtime-file-assets-collocated", () => {
  it("errors when a package reads another package source asset", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({ name: "a", private: true }),
      "/repo/packages/a/src/index.ts": `
        import { readFileSync } from "node:fs";
        import { join } from "node:path";
        readFileSync(join(import.meta.dirname, "..", "..", "b", "src", "templates", "x.md"), "utf8");
      `,
      "/repo/packages/b/package.json": pkgJson({ name: "b", private: true })
    });

    expect(runtimeFileAssetsCollocated.run(model)).toMatchObject([
      {
        rule: "runtime-file-assets-collocated",
        package: "a",
        severity: "error",
        detail: { runtimePath: "packages/b/src/templates/x.md" }
      }
    ]);
  });

  it("errors when a package reads a repo-root asset", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({ name: "a", private: true }),
      "/repo/packages/a/src/index.ts": `
        import { readFileSync } from "node:fs";
        import { join } from "node:path";
        readFileSync(join(import.meta.dirname, "..", "..", "..", "docs", "foo.md"), "utf8");
      `
    });

    expect(runtimeFileAssetsCollocated.run(model)).toHaveLength(1);
  });

  it("passes when a package reads its own source asset", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({ name: "a", private: true }),
      "/repo/packages/a/src/index.ts": `
        import { readFileSync } from "node:fs";
        readFileSync(new URL("./templates/x.md", import.meta.url), "utf8");
      `
    });

    expect(runtimeFileAssetsCollocated.run(model)).toEqual([]);
  });

  it("ignores test files", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({ name: "a", private: true }),
      "/repo/packages/a/src/index.test.ts": `
        import { readFileSync } from "node:fs";
        readFileSync(new URL("../../../docs/foo.md", import.meta.url), "utf8");
      `
    });

    expect(runtimeFileAssetsCollocated.run(model)).toEqual([]);
  });
});
