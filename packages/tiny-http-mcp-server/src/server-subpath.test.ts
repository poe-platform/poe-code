import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("tiny-http-mcp-server server subpath", () => {
  it("exports the HTTP server without loading Express middleware", async () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve(import.meta.dirname, "..", "package.json"), "utf8")
    ) as {
      exports?: Record<string, { import?: string; types?: string }>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.exports?.["./server"]).toEqual({
      types: "./dist/server.d.ts",
      import: "./dist/server.js"
    });

    const server = await import("./server.js");
    expect(server.createHttpServer).toBeTypeOf("function");
    expect("createExpressMiddleware" in server).toBe(false);
    expect(packageJson.dependencies?.express).toBeUndefined();
    expect(packageJson.devDependencies?.express).toBe("^5.1.0");
  });
});
