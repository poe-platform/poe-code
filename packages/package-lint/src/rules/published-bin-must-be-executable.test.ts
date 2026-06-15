import { describe, expect, it } from "vitest";
import { makeWorkspace, pkgJson } from "../fixtures.js";
import { publishedBinMustBeExecutable } from "./published-bin-must-be-executable.js";

function releaseWorkflow(dir: string): string {
  return [
    "name: Release",
    "on:",
    "  push:",
    `    paths: ['${dir}/**']`,
    "jobs:",
    "  publish:",
    "    steps:",
    `      - working-directory: ${dir}`,
    "        run: npm publish --provenance --access public",
    ""
  ].join("\n");
}

describe("published-bin-must-be-executable", () => {
  it("flags a published package whose prepack does not restore the bin's executable bit", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/cli/package.json": pkgJson({
        name: "cli",
        repository: { directory: "packages/cli" },
        bin: { "cli-generate": "dist/bin/generate.js" },
        scripts: { build: "tsc", prepack: "node ../../scripts/bundle-deps.mjs" }
      }),
      "/repo/.github/workflows/release-cli.yml": releaseWorkflow("packages/cli")
    });

    const violations = publishedBinMustBeExecutable.run(model);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      rule: "published-bin-must-be-executable",
      package: "cli",
      severity: "error",
      detail: { bins: ["dist/bin/generate.js"] }
    });
  });

  it("passes when prepack runs set-bin-executable", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/cli/package.json": pkgJson({
        name: "cli",
        repository: { directory: "packages/cli" },
        bin: { "cli-generate": "dist/bin/generate.js" },
        scripts: { prepack: "node ../../scripts/set-bin-executable.mjs" }
      }),
      "/repo/.github/workflows/release-cli.yml": releaseWorkflow("packages/cli")
    });

    expect(publishedBinMustBeExecutable.run(model)).toHaveLength(0);
  });

  it("models string-form bin declarations", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/cli/package.json": pkgJson({
        name: "cli",
        repository: { directory: "packages/cli" },
        bin: "dist/bin/generate.js"
      }),
      "/repo/.github/workflows/release-cli.yml": releaseWorkflow("packages/cli")
    });

    expect(model.byName.get("cli")?.bin).toEqual({ cli: "dist/bin/generate.js" });
    expect(publishedBinMustBeExecutable.run(model)).toHaveLength(1);
  });

  it("does not accept comments or similarly named scripts as set-bin-executable", async () => {
    for (const prepack of [
      "echo set-bin-executable",
      "node ../../scripts/not-set-bin-executable.mjs"
    ]) {
      const model = await makeWorkspace({
        "/repo/package.json": pkgJson({ name: "root" }),
        "/repo/packages/cli/package.json": pkgJson({
          name: "cli",
          repository: { directory: "packages/cli" },
          bin: { "cli-generate": "dist/bin/generate.js" },
          scripts: { prepack }
        }),
        "/repo/.github/workflows/release-cli.yml": releaseWorkflow("packages/cli")
      });

      expect(publishedBinMustBeExecutable.run(model)).toHaveLength(1);
    }
  });

  it("ignores private packages", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/secret/package.json": pkgJson({
        name: "secret",
        private: true,
        bin: { secret: "dist/cli.js" },
        scripts: { build: "tsc" }
      })
    });

    expect(publishedBinMustBeExecutable.run(model)).toHaveLength(0);
  });

  it("ignores published packages that declare no bin", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/lib/package.json": pkgJson({
        name: "lib",
        repository: { directory: "packages/lib" },
        scripts: { build: "tsc" }
      }),
      "/repo/.github/workflows/release-lib.yml": releaseWorkflow("packages/lib")
    });

    expect(publishedBinMustBeExecutable.run(model)).toHaveLength(0);
  });

  it("ignores a public bin package that no release workflow publishes", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/cli/package.json": pkgJson({
        name: "cli",
        repository: { directory: "packages/cli" },
        bin: { cli: "dist/cli.js" },
        scripts: { build: "tsc" }
      })
    });

    expect(publishedBinMustBeExecutable.run(model)).toHaveLength(0);
  });
});
