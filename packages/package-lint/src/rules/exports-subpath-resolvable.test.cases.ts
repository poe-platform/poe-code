import { describe, expect, it } from "vitest";
import { makeWorkspace, pkgJson } from "../fixtures.js";
import { exportsSubpathResolvable } from "./exports-subpath-resolvable.js";

const B = pkgJson({
  name: "b",
  exports: {
    ".": "./dist/index.js",
    "./public": "./dist/public.js"
  }
});

describe("exports-subpath-resolvable", () => {
  it("errors on importing a subpath the target's exports map does not expose", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({ name: "a" }),
      "/repo/packages/a/src/index.ts": 'export { x } from "b/internal";\n',
      "/repo/packages/b/package.json": B,
      "/repo/packages/b/src/index.ts": "export const x = 1;\n"
    });

    const violations = exportsSubpathResolvable.run(model);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      package: "a",
      severity: "error",
      via: "packages/a/src/index.ts",
      detail: { target: "b", specifiers: ["b/internal"] }
    });
  });

  it("allows an exported subpath and the main entry", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({ name: "a" }),
      "/repo/packages/a/src/index.ts": 'export { x } from "b/public";\nimport "b";\n',
      "/repo/packages/b/package.json": B,
      "/repo/packages/b/src/index.ts": "export const x = 1;\n"
    });

    expect(exportsSubpathResolvable.run(model)).toHaveLength(0);
  });

  it("does not gate packages without an exports map", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({ name: "a" }),
      "/repo/packages/a/src/index.ts": 'export { x } from "b/anything";\n',
      "/repo/packages/b/package.json": pkgJson({ name: "b" }),
      "/repo/packages/b/src/index.ts": "export const x = 1;\n"
    });

    expect(exportsSubpathResolvable.run(model)).toHaveLength(0);
  });

  it("matches a wildcard exports pattern", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({ name: "a" }),
      "/repo/packages/a/src/index.ts": 'export { x } from "b/features/thing";\n',
      "/repo/packages/b/package.json": pkgJson({
        name: "b",
        exports: { ".": "./dist/index.js", "./features/*": "./dist/features/*.js" }
      }),
      "/repo/packages/b/src/index.ts": "export const x = 1;\n"
    });

    expect(exportsSubpathResolvable.run(model)).toHaveLength(0);
  });

  it("treats array exports as root-only gated exports", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({ name: "a" }),
      "/repo/packages/a/src/index.ts": 'export { x } from "b/internal";\n',
      "/repo/packages/b/package.json": pkgJson({
        name: "b",
        exports: ["./dist/index.js"]
      }),
      "/repo/packages/b/src/index.ts": "export const x = 1;\n"
    });

    expect(exportsSubpathResolvable.run(model)).toHaveLength(1);
  });
});
