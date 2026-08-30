import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";

import {
  findUnreachableBundleOutputs,
  resolveBundleGraph,
  resolveConsumerGraph
} from "./bundle-graph.mjs";

function createFileSystem(rootPackageJson: object) {
  const volume = Volume.fromJSON({
    "/repo/package.json": JSON.stringify(rootPackageJson)
  });
  return createFsFromVolume(volume).promises;
}

describe("findUnreachableBundleOutputs", () => {
  it("keeps declared entries, shared dependencies, dynamic imports, and their source maps", () => {
    const metafile = {
      outputs: {
        "dist/index.js": { entryPoint: "src/index.ts", imports: [{ path: "dist/shared.js" }] },
        "dist/core.js": { entryPoint: "src/core.ts", imports: [{ path: "dist/shared.js" }] },
        "dist/cli.js": {
          entryPoint: "src/cli.ts",
          imports: [{ path: "dist/lazy.js", kind: "dynamic-import" }]
        },
        "dist/shared.js": { imports: [] },
        "dist/lazy.js": { entryPoint: "src/lazy.ts", imports: [{ path: "dist/shared.js" }] },
        "dist/unused.js": { entryPoint: "src/unused.ts", imports: [{ path: "dist/shared.js" }] },
        "dist/index.js.map": { imports: [] },
        "dist/lazy.js.map": { imports: [] },
        "dist/unused.js.map": { imports: [] }
      }
    };

    expect(
      findUnreachableBundleOutputs(metafile, ["src/index.ts", "src/core.ts", "src/cli.ts"], "/repo")
    ).toEqual(["dist/unused.js", "dist/unused.js.map"]);
  });

  it("retains reachable cycles without keeping disconnected cycles", () => {
    const metafile = {
      outputs: {
        "dist/index.js": { entryPoint: "src/index.ts", imports: [{ path: "dist/shared.js" }] },
        "dist/shared.js": { imports: [{ path: "dist/index.js" }] },
        "dist/unused.js": { imports: [{ path: "dist/other.js" }] },
        "dist/other.js": { imports: [{ path: "dist/unused.js" }] }
      }
    };

    expect(findUnreachableBundleOutputs(metafile, ["src/index.ts"], "/repo")).toEqual([
      "dist/unused.js",
      "dist/other.js"
    ]);
  });

  it("does not traverse external imports even when their paths match an output", () => {
    const metafile = {
      outputs: {
        "dist/index.js": {
          entryPoint: "src/index.ts",
          imports: [
            { path: "dist/external.js", external: true },
            { path: "node:fs", external: true }
          ]
        },
        "dist/external.js": { imports: [] }
      }
    };

    expect(findUnreachableBundleOutputs(metafile, ["src/index.ts"], "/repo")).toEqual([
      "dist/external.js"
    ]);
  });

  it("keeps associated CSS bundles and imported assets", () => {
    const metafile = {
      outputs: {
        "dist/index.js": { entryPoint: "src/index.ts", cssBundle: "dist/index.css", imports: [] },
        "dist/index.css": { imports: [{ path: "dist/font.woff", kind: "url-token" }] },
        "dist/index.css.map": { imports: [] },
        "dist/font.woff": { imports: [] },
        "dist/unused.css": { imports: [] }
      }
    };

    expect(findUnreachableBundleOutputs(metafile, ["src/index.ts"], "/repo")).toEqual([
      "dist/unused.css"
    ]);
  });

  it("normalizes absolute and relative metadata against the explicit working directory", () => {
    const metafile = {
      outputs: {
        "dist/index.js": {
          entryPoint: "/repo/src/index.ts",
          imports: [{ path: "/repo/dist/shared.js" }]
        },
        "/repo/dist/shared.js": { imports: [] }
      }
    };

    expect(findUnreachableBundleOutputs(metafile, ["src/index.ts"], "/repo")).toEqual([]);
  });

  it.each(["dist/./index.js", "dist/nested/../index.js", "/repo/dist/index.js"])(
    "refuses ambiguous output aliases instead of pruning live dependencies: %s",
    (alias) => {
      const metafile = {
        outputs: {
          "dist/index.js": {
            entryPoint: "src/index.ts",
            imports: [{ path: "dist/shared.js" }]
          },
          [alias]: { entryPoint: "src/index.ts", imports: [] },
          "dist/shared.js": { imports: [] }
        }
      };
      const before = structuredClone(metafile);

      expect(() => findUnreachableBundleOutputs(metafile, ["src/index.ts"], "/repo")).toThrow(
        "Duplicate bundle output"
      );
      expect(metafile).toEqual(before);
    }
  );

  it("rejects aliases of disconnected outputs even when their metadata agrees", () => {
    const metafile = {
      outputs: {
        "dist/index.js": { entryPoint: "src/index.ts", imports: [] },
        "dist/unused.js": { imports: [] },
        "/repo/dist/unused.js": { imports: [] }
      }
    };

    expect(() => findUnreachableBundleOutputs(metafile, ["src/index.ts"], "/repo")).toThrow(
      "Duplicate bundle output"
    );
  });

  it.each([[], ["src/missing.ts"], ["src/index.ts", "src/missing.ts"]])(
    "refuses cleanup when declared entries are missing: %j",
    (...entryPoints) => {
      const metafile = {
        outputs: { "dist/index.js": { entryPoint: "src/index.ts", imports: [] } }
      };

      expect(() => findUnreachableBundleOutputs(metafile, entryPoints, "/repo")).toThrow(
        "entry point"
      );
    }
  );

  it("refuses cleanup when the output graph has a missing internal dependency", () => {
    const metafile = {
      outputs: {
        "dist/index.js": { entryPoint: "src/index.ts", imports: [{ path: "dist/missing.js" }] }
      }
    };

    expect(() => findUnreachableBundleOutputs(metafile, ["src/index.ts"], "/repo")).toThrow(
      "Missing bundle output"
    );
  });
});

describe("resolveBundleGraph", () => {
  it("discovers the canonical SafeJS workspace and subpaths without a private legacy alias", async () => {
    const { alias, external } = await resolveBundleGraph(
      "/repo",
      [
        {
          dir: "safe-js",
          pkg: {
            name: "@poe-code/safe-js",
            exports: {
              ".": "./dist/index.js",
              "./core": "./dist/core.js",
              "./cli": "./dist/cli.js"
            }
          }
        }
      ],
      createFileSystem({ dependencies: {} })
    );
    expect(alias["@poe-code/safe-js"]).toBe("/repo/packages/safe-js/src/index.ts");
    expect(alias["@poe-code/safe-js/core"]).toBe("/repo/packages/safe-js/src/core.ts");
    expect(alias["@poe-code/safe-js/cli"]).toBe("/repo/packages/safe-js/src/cli.ts");
    expect(alias).not.toHaveProperty("@poe-code/safejs");
    expect(external).not.toContain("@poe-code/safe-js");
  });

  it("routes every private FS subpath to the one public entry only in consumer graphs", () => {
    const graph = {
      alias: {
        "@poe-code/safe-fs": "/repo/packages/safe-fs/src/index.ts",
        "@poe-code/safe-fs/node": "/repo/packages/safe-fs/src/node/index.ts",
        "@poe-code/safe-fs/fs/memory": "/repo/packages/safe-fs/src/fs/memory/index.ts",
        "@poe-code/safe-fs-extra": "/repo/packages/other/src/index.ts"
      },
      external: ["node:*"]
    };
    const consumer = resolveConsumerGraph(graph, {
      workspace: "@poe-code/safe-fs",
      specifier: "poe-code/safe-fs"
    });
    expect(consumer.alias["@poe-code/safe-fs/node"]).toBe("poe-code/safe-fs");
    expect(consumer.alias["@poe-code/safe-fs/fs/memory"]).toBe("poe-code/safe-fs");
    expect(consumer.alias["@poe-code/safe-fs-extra"]).toBe(graph.alias["@poe-code/safe-fs-extra"]);
    expect(consumer.external).toEqual(["node:*", "poe-code/safe-fs"]);
    expect(graph.alias["@poe-code/safe-fs"]).toBe("/repo/packages/safe-fs/src/index.ts");
  });
  it("aliases sub-path exports to the source behind the import target", async () => {
    const { alias } = await resolveBundleGraph(
      "/repo",
      [
        {
          dir: "agent-spawn",
          pkg: {
            name: "@poe-code/agent-spawn",
            exports: {
              ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
              "./configs": {
                types: "./dist/configs/index.d.ts",
                import: "./dist/configs/index.js"
              },
              "./parallel": { types: "./dist/parallel.d.ts", import: "./dist/parallel.js" }
            }
          }
        }
      ],
      createFileSystem({ dependencies: {} })
    );

    expect(alias["@poe-code/agent-spawn/configs"]).toBe(
      "/repo/packages/agent-spawn/src/configs/index.ts"
    );
    expect(alias["@poe-code/agent-spawn/parallel"]).toBe(
      "/repo/packages/agent-spawn/src/parallel.ts"
    );
  });

  it("supports string export targets", async () => {
    const { alias } = await resolveBundleGraph(
      "/repo",
      [
        {
          dir: "toolcraft",
          pkg: { name: "toolcraft", exports: { "./cli": "./dist/cli.js" } }
        }
      ],
      createFileSystem({ dependencies: {} })
    );

    expect(alias["toolcraft/cli"]).toBe("/repo/packages/toolcraft/src/cli.ts");
  });

  it("rejects export targets outside dist", async () => {
    await expect(
      resolveBundleGraph(
        "/repo",
        [
          {
            dir: "toolcraft",
            pkg: { name: "toolcraft", exports: { "./cli": "./lib/cli.js" } }
          }
        ],
        createFileSystem({ dependencies: {} })
      )
    ).rejects.toThrow('toolcraft export "./cli"');
  });

  it("keeps workspace packages out of externals and root deps in", async () => {
    const { alias, external } = await resolveBundleGraph(
      "/repo",
      [
        {
          dir: "agent-spawn",
          pkg: { name: "@poe-code/agent-spawn", dependencies: { execa: "^9.0.0" } }
        }
      ],
      createFileSystem({ dependencies: { "@poe-code/agent-spawn": "*", commander: "^12.0.0" } })
    );

    expect(alias["@poe-code/agent-spawn"]).toBe("/repo/packages/agent-spawn/src/index.ts");
    expect(external).toContain("commander");
    expect(external).toContain("execa");
    expect(external).not.toContain("@poe-code/agent-spawn");
  });
});
