import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RuntimeConfig } from "@poe-code/poe-code-config/core";
import { describe, expect, it, vi } from "vitest";
import type { ExecutionEnvFactory } from "./execution-env.js";

function runtime(type: RuntimeConfig["type"]): RuntimeConfig {
  return {
    type,
    build_args: {},
    mounts: []
  } as RuntimeConfig;
}

describe("execution env registry", () => {
  async function freshRegistry() {
    vi.resetModules();
    return import("./execution-env.js");
  }

  it.each(["host", "docker"] as const)(
    "selects a registered %s factory by runtime type",
    async (type) => {
      const { registerExecutionEnvFactory, selectExecutionEnv } = await freshRegistry();
      const factory = {
        type
      } as ExecutionEnvFactory;

      registerExecutionEnvFactory(factory);

      expect(selectExecutionEnv(runtime(type))).toBe(factory);
    }
  );

  it("uses the latest registered factory for a runtime type", async () => {
    const { registerExecutionEnvFactory, selectExecutionEnv } = await freshRegistry();
    const first = {
      type: "docker"
    } as ExecutionEnvFactory;
    const second = {
      type: "docker"
    } as ExecutionEnvFactory;

    registerExecutionEnvFactory(first);
    registerExecutionEnvFactory(second);

    expect(selectExecutionEnv(runtime("docker"))).toBe(second);
  });

  it("keeps runtime.type branching inside selectExecutionEnv", async () => {
    const sourceRoot = path.dirname(fileURLToPath(import.meta.url));
    const entries = await fs.readdir(sourceRoot, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => name.endsWith(".ts"))
      .filter((name) => !name.endsWith(".test.ts"));
    const branchSites: string[] = [];

    for (const file of files) {
      const text = await fs.readFile(path.join(sourceRoot, file), "utf8");
      const lines = text.split("\n");
      lines.forEach((line, index) => {
        if (line.includes("runtime.type")) {
          branchSites.push(`${file}:${index + 1}:${line.trim()}`);
        }
      });
    }

    expect(branchSites).toMatchInlineSnapshot(`
      [
        "execution-env.ts:102:return selectExecutionEnvFactory(runtime.type);",
      ]
    `);
  });
});
