import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("bundles contracts paths without a node:path dependency under default conditions", async () => {
  const output = await build({
    entryPoints: [fileURLToPath(new URL("../src/contracts/path.ts", import.meta.url))],
    bundle: true, platform: "node", format: "esm", write: false,
    metafile: true, logLevel: "silent"
  });
  expect(Object.values(output.metafile!.inputs).flatMap(input => input.imports)
    .filter(input => input.path === "node:path")).toEqual([]);
});
