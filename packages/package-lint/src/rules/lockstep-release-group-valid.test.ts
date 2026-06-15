import { describe, expect, it } from "vitest";
import { makeWorkspace, pkgJson } from "../fixtures.js";
import { lockstepReleaseGroupValid } from "./lockstep-release-group-valid.js";

describe("lockstep-release-group-valid", () => {
  it("passes for an existing public group published after preparation", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({ name: "a" }),
      "/repo/packages/b/package.json": pkgJson({ name: "b" }),
      "/repo/.github/workflows/release-a.yml": `
name: Release a + b
jobs:
  publish:
    steps:
      - uses: ./.github/actions/prepare-lockstep-release
        with:
          version: 1.2.3
          packages: '["packages/a", "packages/b"]'
      - working-directory: packages/a
        run: npm publish
      - working-directory: packages/b
        run: npm publish
`
    });

    expect(lockstepReleaseGroupValid.run(model)).toHaveLength(0);
  });

  it("flags missing, private, duplicate, and unpublished members", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({ name: "a" }),
      "/repo/packages/b/package.json": pkgJson({ name: "b" }),
      "/repo/packages/private/package.json": pkgJson({ name: "private", private: true }),
      "/repo/.github/workflows/release-a.yml": `
name: Release a
jobs:
  publish:
    steps:
      - uses: ./.github/actions/prepare-lockstep-release
        with:
          version: 1.2.3
          packages: '["packages/a", "packages/a", "packages/b", "packages/missing", "packages/private"]'
      - working-directory: packages/a
        run: npm publish
`
    });

    expect(lockstepReleaseGroupValid.run(model)).toHaveLength(4);
  });

  it("flags a malformed package group", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({ name: "a" }),
      "/repo/.github/workflows/release-a.yml": `
name: Release a
jobs:
  publish:
    steps:
      - uses: ./.github/actions/prepare-lockstep-release
        with:
          version: 1.2.3
          packages: packages/a
      - working-directory: packages/a
        run: npm publish
`
    });

    expect(lockstepReleaseGroupValid.run(model)).toHaveLength(1);
  });

  it("flags a package group containing a non-string member", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({ name: "a" }),
      "/repo/packages/b/package.json": pkgJson({ name: "b" }),
      "/repo/.github/workflows/release-a.yml": `
name: Release a + b
jobs:
  publish:
    steps:
      - uses: ./.github/actions/prepare-lockstep-release
        with:
          version: 1.2.3
          packages: '["packages/a", "packages/b", 3]'
      - working-directory: packages/a
        run: npm publish
      - working-directory: packages/b
        run: npm publish
`
    });

    expect(lockstepReleaseGroupValid.run(model)).toHaveLength(1);
  });

  it("flags a lockstep action without a version", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({ name: "a" }),
      "/repo/packages/b/package.json": pkgJson({ name: "b" }),
      "/repo/.github/workflows/release-a.yml": `
name: Release a + b
jobs:
  publish:
    steps:
      - uses: ./.github/actions/prepare-lockstep-release
        with:
          packages: '["packages/a", "packages/b"]'
      - working-directory: packages/a
        run: npm publish
      - working-directory: packages/b
        run: npm publish
`
    });

    expect(lockstepReleaseGroupValid.run(model)).toHaveLength(1);
  });

  it("flags a lockstep action with a blank version", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({ name: "a" }),
      "/repo/packages/b/package.json": pkgJson({ name: "b" }),
      "/repo/.github/workflows/release-a.yml": `
name: Release a + b
jobs:
  publish:
    steps:
      - uses: ./.github/actions/prepare-lockstep-release
        with:
          version: "   "
          packages: '["packages/a", "packages/b"]'
      - working-directory: packages/a
        run: npm publish
      - working-directory: packages/b
        run: npm publish
`
    });

    expect(lockstepReleaseGroupValid.run(model)).toHaveLength(1);
  });
});
