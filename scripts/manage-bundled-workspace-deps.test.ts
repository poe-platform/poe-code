import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";

import {
  anonymizeBundledWorkspaceManifest,
  assertSafeBundledPath,
  collectInstalledDependencyTree,
  createBundledCompositionManifest,
  restoreGeneratedFiles,
  sanitizeBundledWorkspaceManifest
} from "./manage-bundled-workspace-deps.mjs";

describe("anonymizeBundledWorkspaceManifest", () => {
  it("removes registry identity from private manifests while preserving runtime metadata", () => {
    expect(
      anonymizeBundledWorkspaceManifest({
        name: "tiny-mcp-client",
        version: "0.1.0",
        private: true,
        type: "module",
        exports: {
          ".": "./dist/index.js"
        }
      })
    ).toEqual({
      private: true,
      type: "module",
      exports: {
        ".": "./dist/index.js"
      }
    });
  });

  it("keeps registry identity for public manifests", () => {
    const manifest = {
      name: "toolcraft-schema",
      version: "0.0.1",
      type: "module",
      exports: {
        ".": "./dist/index.js"
      }
    };

    expect(anonymizeBundledWorkspaceManifest(manifest)).toEqual(manifest);
  });
});

describe("collectInstalledDependencyTree", () => {
  it("includes hoisted transitive runtime dependencies", () => {
    const volume = Volume.fromJSON({
      "/repo/node_modules/ajv/package.json": JSON.stringify({
        name: "ajv",
        version: "8.20.0",
        dependencies: { "fast-deep-equal": "^3.1.3" }
      }),
      "/repo/node_modules/fast-deep-equal/package.json": JSON.stringify({
        name: "fast-deep-equal",
        version: "3.1.3"
      })
    });
    const fs = createFsFromVolume(volume);

    expect(collectInstalledDependencyTree("/repo", "ajv", fs)).toEqual([
      { name: "ajv", sourceDir: "/repo/node_modules/ajv" },
      { name: "fast-deep-equal", sourceDir: "/repo/node_modules/fast-deep-equal" }
    ]);
  });
});

describe("createBundledCompositionManifest", () => {
  it("lists root, scoped, and nested bundled packages with exact licenses and versions", () => {
    const volume = Volume.fromJSON({
      "/repo/pkg/package.json": JSON.stringify({
        name: "toolcraft",
        version: "1.2.3",
        license: "MIT"
      }),
      "/repo/pkg/node_modules/@poe-code/frontmatter/package.json": JSON.stringify({
        name: "@poe-code/frontmatter",
        version: "2.0.0",
        license: "MIT"
      }),
      "/repo/pkg/node_modules/toolcraft-design/package.json": JSON.stringify({
        name: "toolcraft-design",
        version: "3.0.0",
        license: "Apache-2.0"
      }),
      "/repo/pkg/node_modules/toolcraft-design/node_modules/sisteransi/package.json":
        JSON.stringify({
          name: "sisteransi",
          version: "1.0.5",
          license: "MIT"
        })
    });
    const fs = createFsFromVolume(volume);

    expect(createBundledCompositionManifest("/repo/pkg", fs)).toEqual({
      schemaVersion: 1,
      packages: [
        { name: "@poe-code/frontmatter", version: "2.0.0", license: "MIT" },
        { name: "sisteransi", version: "1.0.5", license: "MIT" },
        { name: "toolcraft", version: "1.2.3", license: "MIT" },
        { name: "toolcraft-design", version: "3.0.0", license: "Apache-2.0" }
      ]
    });
  });

  it("recovers anonymized nested workspace identities for composition metadata", () => {
    const volume = Volume.fromJSON({
      "/repo/pkg/package.json": JSON.stringify({
        name: "toolcraft",
        version: "1.2.3",
        license: "MIT"
      }),
      "/repo/pkg/node_modules/tiny-http-mcp-server/package.json": JSON.stringify({
        name: "tiny-http-mcp-server",
        version: "0.1.0",
        license: "MIT"
      }),
      "/repo/pkg/node_modules/tiny-http-mcp-server/node_modules/auth-store/package.json":
        JSON.stringify({ private: true, license: "MIT" })
    });
    const fs = createFsFromVolume(volume);

    expect(
      createBundledCompositionManifest("/repo/pkg", fs, (name) =>
        name === "auth-store" ? { name, version: "0.1.0", license: "MIT" } : undefined
      )
    ).toEqual({
      schemaVersion: 1,
      packages: [
        { name: "auth-store", version: "0.1.0", license: "MIT" },
        { name: "tiny-http-mcp-server", version: "0.1.0", license: "MIT" },
        { name: "toolcraft", version: "1.2.3", license: "MIT" }
      ]
    });
  });
});

describe("assertSafeBundledPath", () => {
  it("rejects dependency output through a symlinked node_modules directory", () => {
    const volume = Volume.fromJSON({
      "/repo/pkg/package.json": "{}",
      "/outside/marker": "outside"
    });
    volume.symlinkSync("/outside", "/repo/pkg/node_modules");
    const fs = createFsFromVolume(volume);

    expect(() =>
      assertSafeBundledPath("/repo/pkg", "/repo/pkg/node_modules/auth-store", fs)
    ).toThrow("Bundled dependency output must remain inside the package directory.");
  });

  it("rejects a symlinked stamp file and crafted cleanup target", () => {
    const volume = Volume.fromJSON({
      "/repo/pkg/package.json": "{}",
      "/outside/stamp.json": "{}",
      "/outside/dependency/package.json": "{}"
    });
    volume.symlinkSync("/outside/stamp.json", "/repo/pkg/.bundled-workspace-deps.json");
    const fs = createFsFromVolume(volume);

    expect(() =>
      assertSafeBundledPath("/repo/pkg", "/repo/pkg/.bundled-workspace-deps.json", fs)
    ).toThrow("Bundled dependency output must remain inside the package directory.");
    expect(() => assertSafeBundledPath("/repo/pkg", "/outside/dependency", fs)).toThrow(
      "Bundled dependency output must remain inside the package directory."
    );
  });
});

describe("restoreGeneratedFiles", () => {
  it("restores existing generated files and removes newly created files", () => {
    const volume = Volume.fromJSON({
      "/repo/pkg/package.json": "{}",
      "/repo/pkg/composition.json": "generated root",
      "/repo/pkg/dist/composition.json": "generated dist"
    });
    const fs = createFsFromVolume(volume);

    restoreGeneratedFiles(
      "/repo/pkg",
      [
        { path: "/repo/pkg/composition.json", originalContent: "original root" },
        { path: "/repo/pkg/dist/composition.json", originalContent: null }
      ],
      fs
    );

    expect(fs.readFileSync("/repo/pkg/composition.json", "utf8")).toBe("original root");
    expect(fs.existsSync("/repo/pkg/dist/composition.json")).toBe(false);
  });
});

describe("sanitizeBundledWorkspaceManifest", () => {
  it("removes dependency metadata for workspace packages bundled in the same tarball", () => {
    const manifest = {
      name: "@poe-code/agent-skill-config",
      dependencies: {
        "@poe-code/agent-defs": "*",
        "@poe-code/config-mutations": "*",
        yaml: "^2.8.2"
      },
      optionalDependencies: {
        "toolcraft-design": "*",
        jose: "^6.1.2"
      },
      peerDependencies: {
        "@poe-code/frontmatter": "*",
        react: "^19.0.0"
      },
      bundleDependencies: ["@poe-code/agent-defs", "toolcraft-design", "left-pad"]
    };

    expect(
      sanitizeBundledWorkspaceManifest(
        manifest,
        new Set([
          "@poe-code/agent-defs",
          "@poe-code/config-mutations",
          "toolcraft-design",
          "@poe-code/frontmatter"
        ])
      )
    ).toEqual({
      name: "@poe-code/agent-skill-config",
      dependencies: {
        yaml: "^2.8.2"
      },
      optionalDependencies: {
        jose: "^6.1.2"
      },
      peerDependencies: {
        react: "^19.0.0"
      },
      bundleDependencies: ["left-pad"]
    });
  });

  it("removes empty dependency sections after sanitizing", () => {
    const manifest = {
      name: "tiny-mcp-client",
      dependencies: {
        "mcp-oauth": "*"
      }
    };

    expect(sanitizeBundledWorkspaceManifest(manifest, new Set(["mcp-oauth"]))).toEqual({
      name: "tiny-mcp-client"
    });
  });
});
