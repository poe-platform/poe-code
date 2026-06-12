import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";

import { resolveBundleGraph } from "./bundle-graph.mjs";

function createFileSystem(rootPackageJson: object) {
  const volume = Volume.fromJSON({
    "/repo/package.json": JSON.stringify(rootPackageJson)
  });
  return createFsFromVolume(volume).promises;
}

describe("resolveBundleGraph", () => {
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
