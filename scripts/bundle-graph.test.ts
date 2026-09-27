import { build } from "esbuild";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import * as commandContracts from "../packages/safe-bash-contracts/src/command.js";
import * as filesystem from "../packages/safe-fs/src/core.js";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { canonicalFs } from "../packages/package-lint/src/bundle-policy.js";

import {
  findUnreachableBundleOutputs,
  resolveBundleGraph,
  resolveConsumerGraph
} from "./bundle-graph.mjs";

it.each([undefined, "/repo/dist/shared/safe-bash-contracts"])("shares owned arguments between independently bundled entries (runtime output=%s)", async outdir => {
  const contractRoot = { directory: "/repo/packages/safe-bash-contracts", ...(outdir ? { outdir } : {}), pkg: {
    name: "safe-bash-contracts", exports: { "./command": { import: "./dist/command.js" } }
  } };
  const graph = resolveConsumerGraph({ alias: {
    "safe-bash-contracts/command": new URL("../packages/safe-bash-contracts/src/command.ts", import.meta.url).pathname,
    "@poe-code/safe-fs/core": new URL("../packages/safe-fs/src/core.ts", import.meta.url).pathname,
  }, external: [] }, canonicalFs, [contractRoot]);
  const modules = [];
  for (const name of ["createCommandArguments", "getCommandArguments"]) {
    const output = await build({ ...graph, stdin: { contents: `export { ${name} } from "safe-bash-contracts/command";`, resolveDir: process.cwd() },
      outfile: "/repo/dist/sdk.js", bundle: true, write: false, platform: "node", format: "cjs", target: "node22" });
    const module = { exports: {} as typeof commandContracts };
    const context = createContext({ module, exports: module.exports, TextEncoder, TextDecoder, Uint8Array, Buffer,
      require(specifier: string) {
        if (specifier === (outdir ? "./shared/safe-bash-contracts/command.js" : "../packages/safe-bash-contracts/dist/command.js")) return commandContracts;
        if (specifier === "poe-code/safe-fs/core") return filesystem;
        throw new Error(`Unexpected dependency: ${specifier}`);
      } });
    runInContext(output.outputFiles[0]!.text, context);
    modules.push(module.exports);
  }
  const carrier = modules[0]!.createCommandArguments(["value"]);
  expect(modules[1]!.getCommandArguments({ args: carrier.args, argumentValues: carrier })).toBe(carrier);
});

function createFileSystem(rootPackageJson: object) {
  const volume = Volume.fromJSON({
    "/repo/package.json": JSON.stringify(rootPackageJson)
  });
  return createFsFromVolume(volume).promises;
}

it("uses prepared workspace entrypoints when source cannot represent the built runtime", async () => {
  const graph = await resolveBundleGraph("/repo", [{ dir: "engine", pkg: {
    name: "private-engine", private: true,
    exports: {
      ".": { import: "./dist/index.js" },
      "./filter": { import: "./dist/filter.js" },
    },
    poeCode: { bundle: { prebuilt: true } },
  } }], createFileSystem({}));
  expect(graph.alias["private-engine"]).toBe("/repo/packages/engine/dist/index.js");
  expect(graph.alias["private-engine/filter"]).toBe("/repo/packages/engine/dist/filter.js");
});

it("routes embedded spreadsheet XML imports to the published core entry", () => {
  const consumer = resolveConsumerGraph({
    alias: { "@poe-code/safe-fs/xml": "/repo/packages/safe-fs/src/xml.ts" },
    external: ["node:*"],
  }, canonicalFs);
  expect(consumer.alias["@poe-code/safe-fs/xml"]).toBe("poe-code/safe-fs/core");
  expect(consumer.external).toContain("poe-code/safe-fs/core");
});

it('resolves explicit Node server conditions without admitting schema assets as source', async () => {
  const graph = await resolveBundleGraph('/repo', [{ dir: 'remote', pkg: {
    name: '@example/remote', exports: {
      './server': { browser: null, workerd: null, node: { types: './dist/server.d.ts', default: './dist/server.js' }, default: null },
      './schemas/*': './schemas/*',
    },
  } }], createFileSystem({}));
  expect(graph.alias['@example/remote/server']).toBe('/repo/packages/remote/src/server.ts');
  expect(graph.alias['@example/remote/schemas/*']).toBeUndefined();
});

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


it("leaves explicitly external workspaces to their published runtime dependency", async () => {
  const graph = await resolveBundleGraph("/repo", [{dir: "tokenfill", pkg: {name: "tokenfill", exports: {"./tokenizer": "./dist/tokenizer.js"}}}], createFileSystem({dependencies: {tokenfill: "^0.0.14"}, poeCode: {bundle: {external: ["tokenfill"]}}}));
  expect(graph.alias).not.toHaveProperty("tokenfill");
  expect(graph.alias).not.toHaveProperty("tokenfill/tokenizer");
  expect(graph.external).toContain("tokenfill");
});


it("rejects external workspaces without a declared runtime dependency", async () => {
  await expect(resolveBundleGraph("/repo", [], createFileSystem({devDependencies: {tokenfill: "*"}, poeCode: {bundle: {external: ["tokenfill"]}}}))).rejects.toThrow("must be declared as a runtime dependency");
});

it.each([undefined, "/repo/dist/shared/contracts"])("links shared entries relative to nested outputs (runtime output=%s)", async outdir => {
  const graph = resolveConsumerGraph({ alias: {}, external: [] }, canonicalFs, [{ directory: "/repo/packages/contracts", ...(outdir ? { outdir } : {}), pkg: { name: "contracts", exports: { "./command": { import: "./dist/command.js" }, "./errors": { import: "./dist/errors.js" } } } }]);
  const result = await build({ ...graph, entryPoints: { index: "entry-root", "nested/index": "entry-nested" }, outdir: "/repo/dist", bundle: true, splitting: true, write: false, metafile: true, format: "esm", plugins: [...graph.plugins, { name: "entry", setup(builder) {
    builder.onResolve({ filter: /^entry-/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: `export { value } from "contracts/${args.path === 'entry-root' ? 'command' : 'errors'}";` }));
  } }] });
  for (const output of result.outputFiles.filter(file => file.path.endsWith(".js"))) {
    const expected = outdir
      ? output.path.includes("/nested/") ? "../shared/contracts/errors.js" : "./shared/contracts/command.js"
      : output.path.includes("/nested/") ? "../../packages/contracts/dist/errors.js" : "../packages/contracts/dist/command.js";
    expect(output.text).toContain(JSON.stringify(expected));
    const metadata = Object.entries(result.metafile.outputs).find(([filename]) => output.path === path.resolve(filename))?.[1];
    expect(metadata?.imports.some(edge => edge.external && edge.path === expected)).toBe(true);
  }
});
