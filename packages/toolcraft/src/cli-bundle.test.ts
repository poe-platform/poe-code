import path from "node:path";
import { describe, expect, it } from "vitest";
import { build } from "esbuild";

describe("Toolcraft CLI bundling", () => {
  it("bundles a basic Node 18 CLI without optional integrations", async () => {
    const result = await build({
      stdin: {
        contents: [
          'import { defineCommand, defineGroup, S } from "./index.ts";',
          'import { runCLI } from "./cli.ts";',
          'const command = defineCommand({ name: "hello", scope: ["cli"], params: S.Object({}), handler: async () => ({ ok: true }) });',
          'await runCLI(defineGroup({ name: "fixture", children: [command] }), { argv: ["node", "fixture", "hello"], controls: { output: false } });'
        ].join("\n"),
        loader: "ts",
        resolveDir: path.resolve("packages/toolcraft/src"),
        sourcefile: "toolcraft-basic-cli.ts"
      },
      bundle: true,
      format: "esm",
      logLevel: "silent",
      metafile: true,
      platform: "node",
      target: "node18",
      write: false
    });

    const bundledInputs = Object.keys(result.metafile.inputs);
    for (const optionalPackage of [
      "process-runner",
      "tiny-mcp-client",
      "agent-human-in-loop",
      "mcp-oauth"
    ]) {
      expect(bundledInputs.some((input) => input.includes(optionalPackage))).toBe(false);
    }

    const output = result.outputFiles[0];
    expect(output).toBeDefined();
    await expect(
      import(`data:text/javascript;base64,${Buffer.from(output?.contents ?? []).toString("base64")}`)
    ).resolves.toBeDefined();
  });
});
