import { describe, expect, it } from "vitest";
import { makeWorkspace, pkgJson } from "../fixtures.js";
import { publishedDepNeedsVersionRange } from "./published-dep-needs-version-range.js";

describe("published-dep-needs-version-range", () => {
  it("flags a published -> published workspace dep with a `*` range", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({ name: "a", dependencies: { b: "*" } }),
      "/repo/packages/b/package.json": pkgJson({ name: "b" })
    });

    const violations = publishedDepNeedsVersionRange.run(model);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      package: "a",
      severity: "error",
      detail: { dependency: "b", range: "*" },
      fix: expect.stringContaining("prepare-lockstep-release")
    });
  });

  it("passes with a concrete range and ignores edges to private packages", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({
        name: "a",
        dependencies: { b: "^0.0.1", c: "*" }
      }),
      "/repo/packages/b/package.json": pkgJson({ name: "b", version: "0.0.1" }),
      "/repo/packages/c/package.json": pkgJson({ name: "c", private: true })
    });

    expect(publishedDepNeedsVersionRange.run(model)).toHaveLength(0);
  });

  it("flags a concrete workspace dependency range that excludes the workspace version", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({
        name: "a",
        dependencies: { b: "^0.0.4" }
      }),
      "/repo/packages/b/package.json": pkgJson({ name: "b", version: "0.0.51" })
    });

    const violations = publishedDepNeedsVersionRange.run(model);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      package: "a",
      severity: "error",
      detail: { dependency: "b", range: "^0.0.4", version: "0.0.51" }
    });
  });

  it("flags a concrete workspace dependency range that excludes the workspace version even within a lockstep release group", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({
        name: "a",
        dependencies: { b: "^0.0.4" }
      }),
      "/repo/packages/b/package.json": pkgJson({ name: "b", version: "0.0.51" }),
      "/repo/.github/workflows/release-a.yml": `
name: Release a + b
jobs:
  publish:
    steps:
      - uses: ./.github/actions/prepare-lockstep-release
        with:
          version: 1.2.3
          packages: '["packages/a", "packages/b"]'
      - working-directory: packages/b
        run: npm publish
      - working-directory: packages/a
        run: npm publish
`
    });

    const violations = publishedDepNeedsVersionRange.run(model);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      package: "a",
      severity: "error",
      detail: { dependency: "b", range: "^0.0.4", version: "0.0.51" }
    });
  });

  it("allows a loose range for a bundled workspace dependency", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({
        name: "a",
        optionalDependencies: { b: "*" },
        bundledDependencies: ["b"]
      }),
      "/repo/packages/b/package.json": pkgJson({ name: "b" })
    });

    expect(publishedDepNeedsVersionRange.run(model)).toHaveLength(0);
  });

  it("still requires a concrete peer dependency range when the name is bundled", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({
        name: "a",
        peerDependencies: { b: "*" },
        bundledDependencies: ["b"]
      }),
      "/repo/packages/b/package.json": pkgJson({ name: "b" })
    });

    expect(publishedDepNeedsVersionRange.run(model)).toHaveLength(1);
  });

  it("allows loose ranges within a declared lockstep release group", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({ name: "a", dependencies: { b: "*", c: "*" } }),
      "/repo/packages/b/package.json": pkgJson({ name: "b" }),
      "/repo/packages/c/package.json": pkgJson({ name: "c" }),
      "/repo/.github/workflows/release-a.yml": `
name: Release a + b
jobs:
  publish:
    steps:
      - uses: ./.github/actions/prepare-lockstep-release
        with:
          version: 1.2.3
          packages: '["packages/a", "packages/b"]'
      - working-directory: packages/b
        run: npm publish
      - working-directory: packages/a
        run: npm publish
`
    });

    expect(publishedDepNeedsVersionRange.run(model)).toMatchObject([
      { package: "a", detail: { dependency: "c", range: "*" } }
    ]);
  });

  it("flags a loose range when a lockstep group does not publish the dependency", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({ name: "a", dependencies: { b: "*" } }),
      "/repo/packages/b/package.json": pkgJson({ name: "b" }),
      "/repo/.github/workflows/release-a.yml": `
name: Release a
jobs:
  publish:
    steps:
      - uses: ./.github/actions/prepare-lockstep-release
        with:
          version: 1.2.3
          packages: '["packages/a", "packages/b"]'
      - working-directory: packages/a
        run: npm publish
`
    });

    expect(publishedDepNeedsVersionRange.run(model)).toHaveLength(1);
  });

  it("flags a loose range when the group does not include the dependency", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({ name: "a", dependencies: { b: "*" } }),
      "/repo/packages/b/package.json": pkgJson({ name: "b" }),
      "/repo/.github/workflows/release-a.yml": `
name: Release a
jobs:
  publish:
    steps:
      - uses: ./.github/actions/prepare-lockstep-release
        with:
          version: 1.2.3
          packages: '["packages/a"]'
      - working-directory: packages/a
        run: npm publish
`
    });

    expect(publishedDepNeedsVersionRange.run(model)).toHaveLength(1);
  });

  it("flags a loose range when the group is prepared after the consumer is published", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({ name: "a", dependencies: { b: "*" } }),
      "/repo/packages/b/package.json": pkgJson({ name: "b" }),
      "/repo/.github/workflows/release-a.yml": `
name: Release a
jobs:
  publish:
    steps:
      - working-directory: packages/a
        run: npm publish
      - uses: ./.github/actions/prepare-lockstep-release
        with:
          version: 1.2.3
          packages: '["packages/a", "packages/b"]'
      - working-directory: packages/b
        run: npm publish
`
    });

    expect(publishedDepNeedsVersionRange.run(model)).toHaveLength(1);
  });
});
