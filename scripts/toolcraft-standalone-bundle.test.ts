import { describe, expect, it } from "vitest";
import {
  canonicalizeToolcraftBundle,
  createToolcraftBundleOptions
} from "./toolcraft-standalone-bundle.mjs";

describe("Toolcraft standalone bundle recipe", () => {
  it("builds ESM for the minimum supported Node.js target with source maps", () => {
    expect(createToolcraftBundleOptions("src/cli.ts", "dist/cli.js")).toMatchObject({
      bundle: true,
      entryPoints: ["src/cli.ts"],
      format: "esm",
      outfile: "dist/cli.js",
      platform: "node",
      sourcemap: "external",
      sourcesContent: true,
      splitting: false,
      target: "node18"
    });
  });

  it("canonicalizes hoisted and standalone dependency paths identically", () => {
    const standalone = canonicalizeToolcraftBundle({
      bundle: ["// node_modules/toolcraft/dist/cli.js", "console.log('ok');"].join("\n"),
      sourceMap: JSON.stringify({
        version: 3,
        sources: ["../src/cli.ts", "../node_modules/toolcraft/dist/cli.js"]
      })
    });
    const hoisted = canonicalizeToolcraftBundle({
      bundle: ["// ../../node_modules/toolcraft/dist/cli.js", "console.log('ok');"].join("\n"),
      sourceMap: JSON.stringify({
        version: 3,
        sources: ["../src/cli.ts", "../../../node_modules/toolcraft/dist/cli.js"]
      })
    });

    expect(hoisted).toEqual(standalone);
    expect(JSON.parse(hoisted.sourceMap).sources).toEqual([
      "../src/cli.ts",
      "node_modules/toolcraft/dist/cli.js"
    ]);
  });
});
