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

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

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

  it("ignores inherited top-level memory scope values", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": "{}\n"
      },
      homeDir
    );
    const options = {
      fs,
      filePath: configPath
    };

    await withObjectPrototypeProperties(
      {
        memory: {
          root: "/polluted-memory",
          ingestAgent: "polluted-agent",
          ingestTimeoutMs: 1,
          cache: { enabled: false },
          mcp: { allowWrites: true },
          query: { defaultBudgetTokens: 1 }
        }
      },
      async () => {
        await expect(configuredMemoryRoot(options)).resolves.toBeUndefined();
        await expect(resolveAgent(options, "claude-code")).resolves.toBe("claude-code");
        await expect(configuredTimeout(options)).resolves.toBe(300_000);
        await expect(cacheEnabled(options)).resolves.toBe(true);
        await expect(mcpWritesAllowed(options)).resolves.toBe(false);
        await expect(defaultQueryBudget(options)).resolves.toBe(4_096);
      }
    );
  });

  it("ignores inherited nested memory values", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": '{"memory":{}}\n'
      },
      homeDir
    );
    const options = {
      fs,
      filePath: configPath
    };

    await withObjectPrototypeProperties(
      {
        root: "/polluted-memory",
        ingestAgent: "polluted-agent",
        ingestTimeoutMs: 1,
        cache: { enabled: false },
        mcp: { allowWrites: true },
        query: { defaultBudgetTokens: 1 }
      },
      async () => {
        await expect(configuredMemoryRoot(options)).resolves.toBeUndefined();
        await expect(resolveAgent(options, "claude-code")).resolves.toBe("claude-code");
        await expect(configuredTimeout(options)).resolves.toBe(300_000);
        await expect(cacheEnabled(options)).resolves.toBe(true);
        await expect(mcpWritesAllowed(options)).resolves.toBe(false);
        await expect(defaultQueryBudget(options)).resolves.toBe(4_096);
      }
    );
  });

  it("rejects invalid nested memory values", async () => {
    await expectMemoryConfigError(
      { memory: { root: 123 } },
      () => configuredMemoryRoot,
      "memory.root: expected a string."
    );
    await expectMemoryConfigError(
      { memory: { ingestAgent: 123 } },
      () => (options) => resolveAgent(options, "claude-code"),
      "memory.ingestAgent: expected a string."
    );
    await expectMemoryConfigError(
      { memory: { ingestTimeoutMs: "120000" } },
      () => configuredTimeout,
      "memory.ingestTimeoutMs: expected a finite number."
    );
    await expectMemoryConfigError(
      { memory: { ingestTimeoutMs: -1 } },
      () => configuredTimeout,
      "memory.ingestTimeoutMs: expected a non-negative finite number."
    );
    await expectMemoryConfigError(
      { memory: { cache: { enabled: "false" } } },
      () => cacheEnabled,
      "memory.cache.enabled: expected a boolean."
    );
    await expectMemoryConfigError(
      { memory: { mcp: { allowWrites: "true" } } },
      () => mcpWritesAllowed,
      "memory.mcp.allowWrites: expected a boolean."
    );
    await expectMemoryConfigError(
      { memory: { query: { defaultBudgetTokens: "2048" } } },
      () => defaultQueryBudget,
      "memory.query.defaultBudgetTokens: expected a finite number."
    );
    await expectMemoryConfigError(
      { memory: { query: { defaultBudgetTokens: -100 } } },
      () => defaultQueryBudget,
      "memory.query.defaultBudgetTokens: expected a positive integer."
    );
  });
});

async function expectMemoryConfigError(
  document: Record<string, unknown>,
  selectReader: () => (options: { fs: ReturnType<typeof createMockFs>; filePath: string }) => Promise<unknown>,
  message: string
): Promise<void> {
  const fs = createMockFs(
    {
      "~/.poe-code/config.json": `${JSON.stringify(document, null, 2)}\n`
    },
    homeDir
  );

  await expect(selectReader()({ fs, filePath: configPath })).rejects.toThrow(message);
}
