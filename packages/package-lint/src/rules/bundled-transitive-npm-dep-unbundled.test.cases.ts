import { describe, expect, it } from "vitest";
import { makeWorkspace, pkgJson } from "../fixtures.js";
import { bundledTransitiveNpmDepUnbundled } from "./bundled-transitive-npm-dep-unbundled.js";

describe("bundled-transitive-npm-dep-unbundled", () => {
  it("flags an external npm dep required by a bundled workspace package", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/pub/package.json": pkgJson({
        name: "pub",
        dependencies: { bundled: "*" },
        bundledDependencies: ["bundled"]
      }),
      "/repo/packages/bundled/package.json": pkgJson({
        name: "bundled",
        dependencies: { ajv: "^8.20.0" }
      })
    });

    const violations = bundledTransitiveNpmDepUnbundled.run(model);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      package: "pub",
      severity: "error",
      detail: { missing: [{ dependency: "ajv", requiredBy: ["bundled"] }] }
    });
  });

  it("still flags it when the consumer also declares it in its own dependencies", async () => {
    // Regression for poe-platform/poe-code#512: declaring the dep in the
    // consumer's own "dependencies" is not enough — npm can dedupe the
    // unsanitized nested manifest requirement to an incompatible sibling
    // version in a mixed workspace unless it is bundled too.
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/pub/package.json": pkgJson({
        name: "pub",
        dependencies: { bundled: "*", ajv: "^8.20.0" },
        bundledDependencies: ["bundled"]
      }),
      "/repo/packages/bundled/package.json": pkgJson({
        name: "bundled",
        dependencies: { ajv: "^8.20.0" }
      })
    });

    const violations = bundledTransitiveNpmDepUnbundled.run(model);
    expect(violations).toHaveLength(1);
    expect(violations[0].detail).toMatchObject({ missing: [{ dependency: "ajv" }] });
  });

  it("passes when the external dependency is also bundled", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/pub/package.json": pkgJson({
        name: "pub",
        dependencies: { bundled: "*", ajv: "^8.20.0" },
        bundledDependencies: ["bundled", "ajv"]
      }),
      "/repo/packages/bundled/package.json": pkgJson({
        name: "bundled",
        dependencies: { ajv: "^8.20.0" }
      })
    });

    expect(bundledTransitiveNpmDepUnbundled.run(model)).toHaveLength(0);
  });

  it("traverses through nested bundled workspace dependencies", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/pub/package.json": pkgJson({
        name: "pub",
        dependencies: { bundled: "*" },
        bundledDependencies: ["bundled"]
      }),
      "/repo/packages/bundled/package.json": pkgJson({
        name: "bundled",
        dependencies: { nested: "*" }
      }),
      "/repo/packages/nested/package.json": pkgJson({
        name: "nested",
        dependencies: { yaml: "^2.0.0" }
      })
    });

    const violations = bundledTransitiveNpmDepUnbundled.run(model);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      package: "pub",
      detail: { missing: [{ dependency: "yaml", requiredBy: ["nested"] }] }
    });
  });

  it("ignores peerDependencies of a bundled workspace package", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/pub/package.json": pkgJson({
        name: "pub",
        dependencies: { bundled: "*" },
        bundledDependencies: ["bundled"]
      }),
      "/repo/packages/bundled/package.json": pkgJson({
        name: "bundled",
        peerDependencies: { react: "^18.0.0" }
      })
    });

    expect(bundledTransitiveNpmDepUnbundled.run(model)).toHaveLength(0);
  });

  it("ignores packages without bundledDependencies", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/pub/package.json": pkgJson({
        name: "pub",
        dependencies: { ajv: "^8.20.0" }
      })
    });

    expect(bundledTransitiveNpmDepUnbundled.run(model)).toHaveLength(0);
  });

  it("ignores private consumers", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/pub/package.json": pkgJson({
        name: "pub",
        private: true,
        dependencies: { bundled: "*" },
        bundledDependencies: ["bundled"]
      }),
      "/repo/packages/bundled/package.json": pkgJson({
        name: "bundled",
        dependencies: { ajv: "^8.20.0" }
      })
    });

    expect(bundledTransitiveNpmDepUnbundled.run(model)).toHaveLength(0);
  });
});
