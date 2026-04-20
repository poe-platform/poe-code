import { createMockFs } from "@poe-code/config-mutations/testing";
import { describe, expect, it } from "vitest";
import {
  cacheEnabled,
  configuredMemoryRoot,
  configuredTimeout,
  defaultQueryBudget,
  mcpWritesAllowed,
  resolveAgent
} from "./memory.js";

const homeDir = "/home/test";
const configPath = `${homeDir}/.poe-code/config.json`;
const projectConfigPath = `${homeDir}/workspace/.poe-code/config.json`;

describe("memory config readers", () => {
  it("reads nested memory settings from merged global and project config", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            memory: {
              ingestTimeoutMs: 120_000,
              cache: {
                enabled: true
              },
              query: {
                defaultBudgetTokens: 2_048
              }
            }
          },
          null,
          2
        )}\n`,
        "~/workspace/.poe-code/config.json": `${JSON.stringify(
          {
            memory: {
              ingestAgent: "codex",
              cache: {
                enabled: false
              },
              mcp: {
                allowWrites: true
              }
            }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );

    const options = {
      fs,
      filePath: configPath,
      projectFilePath: projectConfigPath
    };

    await expect(resolveAgent(options, "claude-code")).resolves.toBe("codex");
    await expect(configuredTimeout(options)).resolves.toBe(120_000);
    await expect(cacheEnabled(options)).resolves.toBe(false);
    await expect(mcpWritesAllowed(options)).resolves.toBe(true);
    await expect(defaultQueryBudget(options)).resolves.toBe(2_048);
  });

  it("reads memory.root from merged config", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            memory: {
              root: "/srv/poe-mem"
            }
          },
          null,
          2
        )}\n`,
        "~/workspace/.poe-code/config.json": `${JSON.stringify(
          {
            memory: {
              root: "custom/memory"
            }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );

    const options = {
      fs,
      filePath: configPath,
      projectFilePath: projectConfigPath
    };

    await expect(configuredMemoryRoot(options)).resolves.toBe("custom/memory");
  });

  it("returns undefined memory.root when unset", async () => {
    const fs = createMockFs(undefined, homeDir);
    const options = {
      fs,
      filePath: configPath,
      projectFilePath: projectConfigPath
    };

    await expect(configuredMemoryRoot(options)).resolves.toBeUndefined();
  });

  it("falls back to defaults when memory settings are missing", async () => {
    const fs = createMockFs(undefined, homeDir);
    const options = {
      fs,
      filePath: configPath,
      projectFilePath: projectConfigPath
    };

    await expect(resolveAgent(options, "claude-code")).resolves.toBe("claude-code");
    await expect(configuredTimeout(options)).resolves.toBe(300_000);
    await expect(cacheEnabled(options)).resolves.toBe(true);
    await expect(mcpWritesAllowed(options)).resolves.toBe(false);
    await expect(defaultQueryBudget(options)).resolves.toBe(4_096);
  });

  it("ignores invalid nested memory values", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            memory: {
              ingestAgent: 123,
              ingestTimeoutMs: "fast",
              cache: {
                enabled: "sometimes"
              },
              mcp: {
                allowWrites: "yes"
              },
              query: {
                defaultBudgetTokens: "plenty"
              }
            }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );
    const options = {
      fs,
      filePath: configPath
    };

    await expect(resolveAgent(options, "claude-code")).resolves.toBe("claude-code");
    await expect(configuredTimeout(options)).resolves.toBe(300_000);
    await expect(cacheEnabled(options)).resolves.toBe(true);
    await expect(mcpWritesAllowed(options)).resolves.toBe(false);
    await expect(defaultQueryBudget(options)).resolves.toBe(4_096);
  });
});
