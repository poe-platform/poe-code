import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("credentials package entrypoint", () => {
  it("publishes a focused credentials subpath", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      exports: Record<string, unknown>;
    };

    expect(packageJson.exports["./credentials"]).toEqual({
      types: "./dist/credentials.d.ts",
      import: "./dist/credentials.js"
    });
  });

  it("exposes the credential helpers without the application entrypoint", async () => {
    const credentials = await import("./credentials.js");

    expect(credentials).toMatchObject({
      ensurePoeApiKeyEnv: expect.any(Function),
      fetchPoeAuthIdentity: expect.any(Function),
      getPoeApiKey: expect.any(Function),
      getPoeAuthIdentity: expect.any(Function)
    });
  });
});
