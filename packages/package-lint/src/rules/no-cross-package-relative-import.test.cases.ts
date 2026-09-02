import { describe, expect, it } from "vitest";
import { makeWorkspace, pkgJson } from "../fixtures.js";
import { noCrossPackageRelativeImport } from "./no-cross-package-relative-import.js";

describe("no-cross-package-relative-import", () => {
  it("errors on a shipped relative import escaping into a sibling package", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({ name: "a" }),
      "/repo/packages/a/src/index.ts": 'export { x } from "../../b/dist/index.js";\n',
      "/repo/packages/b/package.json": pkgJson({ name: "b" }),
      "/repo/packages/b/src/index.ts": "export const x = 1;\n"
    });

    const violations = noCrossPackageRelativeImport.run(model);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      package: "a",
      severity: "error",
      via: "packages/a/src/index.ts",
      detail: { target: "packages/b", targetPackage: "b", specifiers: ["../../b/dist/index.js"] }
    });
  });

  it("warns (not errors) when the escape is in a test file", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({ name: "a" }),
      "/repo/packages/a/src/a.test.ts": 'import "../../b/src/index.js";\n',
      "/repo/packages/b/package.json": pkgJson({ name: "b" }),
      "/repo/packages/b/src/index.ts": "export const x = 1;\n"
    });

    const violations = noCrossPackageRelativeImport.run(model);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ package: "a", severity: "warning" });
  });

  it("allows relative imports within the same package", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({ name: "a" }),
      "/repo/packages/a/src/index.ts": 'export { y } from "./util.js";\n',
      "/repo/packages/a/src/util.ts": "export const y = 2;\n"
    });

    expect(noCrossPackageRelativeImport.run(model)).toHaveLength(0);
  });
});
