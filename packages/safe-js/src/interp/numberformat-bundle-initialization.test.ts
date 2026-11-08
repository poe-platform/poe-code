import { fileURLToPath } from "node:url";
import { build, transform } from "esbuild";
import { expect, it } from "vitest";

it("emits valid JavaScript when the runtime is bundled behind a dynamic import", async () => {
  const result = await build({
    stdin: {
      contents: 'export async function load(){return import("./packages/safe-js/src/run.ts")}',
      resolveDir: fileURLToPath(new URL("../../../../", import.meta.url)),
      sourcefile: "runtime-loader.ts",
      loader: "ts"
    },
    bundle: true,
    platform: "node",
    target: "node18",
    format: "esm",
    packages: "external",
    write: false,
    logLevel: "silent"
  });
  expect(result.outputFiles).toHaveLength(1);
  await expect(transform(result.outputFiles[0].text, {
    loader: "js", target: "node18", format: "esm", logLevel: "silent"
  })).resolves.toMatchObject({ warnings: [] });
});
