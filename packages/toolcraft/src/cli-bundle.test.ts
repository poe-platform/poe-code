import path from "node:path";
import { describe, expect, it, vi } from "vitest";
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
      "tiny-http-mcp-server",
      "tiny-mcp-client",
      "agent-human-in-loop",
      "mcp-oauth",
      "express"
    ]) {
      expect(bundledInputs.some((input) => input.includes(optionalPackage))).toBe(false);
    }

    const output = result.outputFiles[0];
    expect(output).toBeDefined();
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      await expect(
        import(`data:text/javascript;base64,${Buffer.from(output?.contents ?? []).toString("base64")}`)
      ).resolves.toBeDefined();
    } finally {
      stdout.mockRestore();
    }
  });

  it("keeps Streamable HTTP code out of stdio MCP bundles", async () => {
    const result = await build({
      stdin: {
        contents: [
          'import { defineGroup } from "./index.ts";',
          'import { createMCPServer } from "./mcp.ts";',
          'createMCPServer(defineGroup({ name: "fixture", children: [] }), { name: "fixture", version: "1.0.0" });'
        ].join("\n"),
        loader: "ts",
        resolveDir: path.resolve("packages/toolcraft/src"),
        sourcefile: "toolcraft-stdio-mcp.ts"
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
    for (const httpPackage of ["tiny-http-mcp-server", "mcp-oauth", "express"]) {
      expect(bundledInputs.some((input) => input.includes(httpPackage))).toBe(false);
    }
  });
});
