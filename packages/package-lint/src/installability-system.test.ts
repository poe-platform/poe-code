import { describe, expect, it } from "vitest";
import { makeWorkspace, pkgJson } from "./fixtures.js";
import { runRules } from "./rules/index.js";

describe("package installability lint system", () => {
  it("flags published packages that depend on a stale workspace version range", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/consumer/package.json": pkgJson({
        name: "consumer",
        dependencies: { producer: "^0.0.4" }
      }),
      "/repo/packages/producer/package.json": pkgJson({ name: "producer", version: "0.0.51" })
    });

    const result = runRules(model, undefined, ["published-dep-needs-version-range"]);

    expect(result.summary.ok).toBe(false);
    expect(result.violations).toEqual([
      expect.objectContaining({
        rule: "published-dep-needs-version-range",
        package: "consumer",
        detail: expect.objectContaining({
          dependency: "producer",
          range: "^0.0.4",
          version: "0.0.51"
        })
      })
    ]);
  });

  it("flags bundled workspace packages that still require unbundled private packages", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/consumer/package.json": pkgJson({
        name: "consumer",
        dependencies: { bundled: "*" },
        bundledDependencies: ["bundled"]
      }),
      "/repo/packages/bundled/package.json": pkgJson({
        name: "bundled",
        private: true,
        dependencies: { missing: "*" }
      }),
      "/repo/packages/missing/package.json": pkgJson({ name: "missing", private: true })
    });

    const result = runRules(model, undefined, ["no-published-to-private-dep"]);

    expect(result.summary.ok).toBe(false);
    expect(result.violations).toEqual([
      expect.objectContaining({
        rule: "no-published-to-private-dep",
        package: "consumer",
        detail: expect.objectContaining({
          dependency: "missing",
          bundledVia: ["bundled"]
        })
      })
    ]);
  });

  it("flags bundled public workspace packages that still require unbundled private packages", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/consumer/package.json": pkgJson({
        name: "consumer",
        dependencies: { bundled: "^1.0.0" },
        bundledDependencies: ["bundled"]
      }),
      "/repo/packages/bundled/package.json": pkgJson({
        name: "bundled",
        dependencies: { missing: "*" }
      }),
      "/repo/packages/missing/package.json": pkgJson({ name: "missing", private: true })
    });

    const result = runRules(model, undefined, ["no-published-to-private-dep"]);

    expect(result.summary.ok).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: "no-published-to-private-dep",
          package: "consumer",
          detail: expect.objectContaining({
            dependency: "missing",
            bundledVia: ["bundled"]
          })
        })
      ])
    );
  });
});
