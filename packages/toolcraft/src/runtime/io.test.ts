import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { HandlerFs } from "../index.js";
import { RESERVED_SERVICE_NAMES, createEnv, createFs, validateServices } from "./io.js";

describe("createFs", () => {
  it("returns an injected filesystem", () => {
    const injectedFs = {} as HandlerFs;

    expect(createFs(injectedFs)).toBe(injectedFs);
  });

  it("defaults to the real Node filesystem", async () => {
    const fs = createFs();
    const packageJsonPath = fileURLToPath(new URL("../../package.json", import.meta.url));

    await expect(fs.readFile(packageJsonPath)).resolves.toContain('"name": "toolcraft"');
    await expect(fs.exists(packageJsonPath)).resolves.toBe(true);
    await expect(fs.exists(`${packageJsonPath}.missing`)).resolves.toBe(false);
  });
});

describe("createEnv", () => {
  it("reads injected environment values", () => {
    const env = createEnv({ TOKEN: "secret", MISSING: undefined });

    expect(env.get("TOKEN")).toBe("secret");
    expect(env.get("MISSING")).toBeUndefined();
  });

  it("does not fall back to process.env for missing injected values", () => {
    const key = "TOOLCRAFT_RUNTIME_IO_INJECTED_TEST";
    const originalValue = process.env[key];
    process.env[key] = "process-value";

    try {
      expect(createEnv({}).get(key)).toBeUndefined();
    } finally {
      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    }
  });

  it("defaults to process.env", () => {
    const key = "TOOLCRAFT_RUNTIME_IO_TEST";
    const originalValue = process.env[key];
    process.env[key] = "available";

    try {
      expect(createEnv().get(key)).toBe("available");
    } finally {
      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    }
  });
});

describe("validateServices", () => {
  it("rejects every reserved service name", () => {
    for (const name of RESERVED_SERVICE_NAMES) {
      expect(() => validateServices({ [name]: true })).toThrow(
        `Service name "${name}" is reserved. Choose a different name. Available reserved names: params, secrets, fetch, fs, env, diagnostics, progress, runtimeOptions, root.`
      );
    }
  });

  it("accepts non-reserved service names", () => {
    expect(() => validateServices({ database: {} })).not.toThrow();
  });
});
