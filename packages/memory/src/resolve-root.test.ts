import { createMockFs } from "@poe-code/config-mutations/testing";
import { describe, expect, it } from "vitest";
import { MEMORY_ROOT_ENV_VAR, resolveConfiguredMemoryRoot } from "./resolve-root.js";

const cwd = "/repo";
const homeDir = "/home/test";
const configPath = `${homeDir}/.poe-code/config.json`;
const projectConfigPath = `${cwd}/.poe-code/config.json`;

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

describe("resolveConfiguredMemoryRoot", () => {
  it("returns the default location when no env or config override exists", async () => {
    const fs = createMockFs(undefined, homeDir);
    const root = await resolveConfiguredMemoryRoot({
      cwd,
      env: {},
      fs,
      configPath
    });
    expect(root).toBe(`${cwd}/.poe-code/memory`);
  });

  it("prefers the env var over config when both are set", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          { memory: { root: "/from/config" } },
          null,
          2
        )}\n`
      },
      homeDir
    );
    const root = await resolveConfiguredMemoryRoot({
      cwd,
      env: { [MEMORY_ROOT_ENV_VAR]: "/from/env" },
      fs,
      configPath
    });
    expect(root).toBe("/from/env");
  });

  it("ignores inherited env root overrides", async () => {
    const fs = createMockFs(undefined, homeDir);

    await withObjectPrototypeProperties(
      {
        [MEMORY_ROOT_ENV_VAR]: "/from/prototype-env"
      },
      async () => {
        const root = await resolveConfiguredMemoryRoot({
          cwd,
          env: {},
          fs,
          configPath
        });
        expect(root).toBe(`${cwd}/.poe-code/memory`);
      }
    );
  });

  it("reads memory.root from config when env is unset", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          { memory: { root: "/from/config" } },
          null,
          2
        )}\n`
      },
      homeDir
    );
    const root = await resolveConfiguredMemoryRoot({
      cwd,
      env: {},
      fs,
      configPath
    });
    expect(root).toBe("/from/config");
  });

  it("ignores inherited config memory root values", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": '{"memory":{}}\n'
      },
      homeDir
    );

    await withObjectPrototypeProperties(
      {
        memory: { root: "/from/prototype-memory" },
        root: "/from/prototype-root"
      },
      async () => {
        const root = await resolveConfiguredMemoryRoot({
          cwd,
          env: {},
          fs,
          configPath
        });
        expect(root).toBe(`${cwd}/.poe-code/memory`);
      }
    );
  });

  it("resolves relative overrides against cwd", async () => {
    const fs = createMockFs(undefined, homeDir);
    const root = await resolveConfiguredMemoryRoot({
      cwd,
      env: { [MEMORY_ROOT_ENV_VAR]: "./custom/memory" },
      fs,
      configPath
    });
    expect(root).toBe(`${cwd}/custom/memory`);
  });

  it("ignores blank env overrides and falls through to config", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          { memory: { root: "/from/config" } },
          null,
          2
        )}\n`
      },
      homeDir
    );
    const root = await resolveConfiguredMemoryRoot({
      cwd,
      env: { [MEMORY_ROOT_ENV_VAR]: "  " },
      fs,
      configPath
    });
    expect(root).toBe("/from/config");
  });

  it("merges project config over global config", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          { memory: { root: "/global/mem" } },
          null,
          2
        )}\n`
      },
      homeDir
    );
    await fs.mkdir(`${cwd}/.poe-code`, { recursive: true });
    await fs.writeFile(
      projectConfigPath,
      `${JSON.stringify({ memory: { root: "/project/mem" } }, null, 2)}\n`,
      "utf8"
    );
    const root = await resolveConfiguredMemoryRoot({
      cwd,
      env: {},
      fs,
      configPath,
      projectConfigPath
    });
    expect(root).toBe("/project/mem");
  });

  it("rejects malformed project configuration without rewriting it", async () => {
    const fs = createMockFs(undefined, homeDir);
    await fs.mkdir(`${cwd}/.poe-code`, { recursive: true });
    await fs.writeFile(projectConfigPath, "{ malformed", "utf8");

    await expect(
      resolveConfiguredMemoryRoot({ cwd, env: {}, fs, configPath, projectConfigPath })
    ).rejects.toThrow();
    await expect(fs.readFile(projectConfigPath, "utf8")).resolves.toBe("{ malformed");
  });
});
