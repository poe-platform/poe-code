import { createMockFs } from "@poe-code/config-mutations/testing";
import type { FileSystem } from "@poe-code/config-mutations";
import { Volume, createFsFromVolume } from "memfs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConfigStore } from "./config.js";
import { collectEnvOverrides, initProjectConfig, resolveEditTarget } from "./inspect.js";
import { deepMergeDocuments } from "./merge.js";
import { integrationsConfigScope, planConfigScope } from "./index.js";
import { resolveScope } from "./resolve.js";
import { defineScope } from "./schema.js";
import { readDocument, readMergedDocument, resolveProjectConfigPath, writeScope } from "./store.js";

const homeDir = "/home/test";
const configPath = `${homeDir}/.poe-code/config.json`;

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

describe("createConfigStore", () => {
  const projectConfigPath = `${homeDir}/workspace/.poe-code/config.json`;

  const coreScope = defineScope("core", {
    apiKey: {
      type: "string" as const,
      default: "",
      env: "POE_API_KEY",
      doc: "Poe API key"
    },
    poeBaseUrl: {
      type: "string" as const,
      default: "https://api.poe.com/v1",
      env: "POE_BASE_URL",
      doc: "Poe API base URL"
    }
  });

  const uiScope = defineScope("ui", {
    darkMode: {
      type: "boolean" as const,
      default: false,
      env: "POE_DARK_MODE",
      doc: "Enable dark mode"
    }
  });

  it("supports get, set, and getAll for a typed scope", async () => {
    const fs = createMockFs(undefined, homeDir);
    const store = createConfigStore({ fs, filePath: configPath });
    const core = store.scope(coreScope);

    await core.set("apiKey", "stored-key");

    await expect(core.get("apiKey")).resolves.toBe("stored-key");
    await expect(core.getAll()).resolves.toEqual({
      apiKey: "stored-key",
      poeBaseUrl: "https://api.poe.com/v1"
    });
  });

  it("applies env overrides without mutating stored values", async () => {
    const fs = createMockFs(undefined, homeDir);
    const store = createConfigStore({
      fs,
      filePath: configPath,
      env: {
        POE_API_KEY: "env-key",
        POE_BASE_URL: "https://env.example.test"
      }
    });
    const core = store.scope(coreScope);

    await core.set("apiKey", "stored-key");

    await expect(core.get("apiKey")).resolves.toBe("env-key");
    await expect(core.getAll()).resolves.toEqual({
      apiKey: "env-key",
      poeBaseUrl: "https://env.example.test"
    });
    expect(JSON.parse(fs.getContent("~/.poe-code/config.json") as string)).toEqual({
      core: {
        apiKey: "stored-key"
      }
    });
  });

  it("keeps scopes isolated from each other", async () => {
    const fs = createMockFs(undefined, homeDir);
    const store = createConfigStore({ fs, filePath: configPath });
    const core = store.scope(coreScope);
    const ui = store.scope(uiScope);

    await core.set("apiKey", "stored-key");
    await ui.set("darkMode", true);

    await expect(core.getAll()).resolves.toEqual({
      apiKey: "stored-key",
      poeBaseUrl: "https://api.poe.com/v1"
    });
    await expect(ui.getAll()).resolves.toEqual({
      darkMode: true
    });
    expect(JSON.parse(fs.getContent("~/.poe-code/config.json") as string)).toEqual({
      core: {
        apiKey: "stored-key"
      },
      ui: {
        darkMode: true
      }
    });
  });

  it("does not resolve an inherited scope through a stored __proto__ key", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": '{"__proto__":{"feature":{"mode":"attacker"}}}\n'
      },
      homeDir
    );
    const featureScope = defineScope("feature", {
      mode: {
        type: "string" as const,
        default: "safe",
        doc: "Feature mode"
      }
    });

    await expect(createConfigStore({ fs, filePath: configPath }).scope(featureScope).getAll()).resolves.toEqual({
      mode: "safe"
    });
  });

  it("does not resolve or persist scope values inherited from Object.prototype", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": "{}\n"
      },
      homeDir
    );
    const featureScope = defineScope("feature", {
      mode: {
        type: "string" as const,
        default: "safe",
        doc: "Feature mode"
      },
      enabled: {
        type: "boolean" as const,
        default: false,
        doc: "Feature enabled"
      }
    });

    await withObjectPrototypeProperties({ feature: { mode: "attacker" } }, async () => {
      const feature = createConfigStore({ fs, filePath: configPath }).scope(featureScope);
      await expect(feature.getAll()).resolves.toEqual({
        mode: "safe",
        enabled: false
      });

      await feature.set("enabled", true);
    });

    expect(JSON.parse(fs.getContent("~/.poe-code/config.json") as string)).toEqual({
      feature: {
        enabled: true
      }
    });
  });

  it("does not resolve inherited field values through a nested __proto__ key", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": '{"feature":{"__proto__":{"mode":"attacker"}}}\n'
      },
      homeDir
    );
    const featureScope = defineScope("feature", {
      mode: {
        type: "string" as const,
        default: "safe",
        doc: "Feature mode"
      }
    });

    await expect(createConfigStore({ fs, filePath: configPath }).scope(featureScope).getAll()).resolves.toEqual({
      mode: "safe"
    });
  });

  it("prefers project config values on get", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            core: {
              apiKey: "global-key",
              poeBaseUrl: "https://global.example.test"
            }
          },
          null,
          2
        )}\n`,
        "~/workspace/.poe-code/config.json": `${JSON.stringify(
          {
            core: {
              apiKey: "project-key"
            }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );
    const store = createConfigStore({
      fs,
      filePath: configPath,
      projectFilePath: projectConfigPath
    });

    await expect(store.scope(coreScope).get("apiKey")).resolves.toBe("project-key");
  });

  it("merges project config with global for getAll", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            core: {
              apiKey: "global-key"
            }
          },
          null,
          2
        )}\n`,
        "~/workspace/.poe-code/config.json": `${JSON.stringify(
          {
            core: {
              poeBaseUrl: "https://project.example.test"
            }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );
    const store = createConfigStore({
      fs,
      filePath: configPath,
      projectFilePath: projectConfigPath
    });

    await expect(store.scope(coreScope).getAll()).resolves.toEqual({
      apiKey: "global-key",
      poeBaseUrl: "https://project.example.test"
    });
  });

  it("writes updates to the global config file only", async () => {
    const fs = createMockFs(
      {
        "~/workspace/.poe-code/config.json": `${JSON.stringify(
          {
            core: {
              apiKey: "project-key"
            }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );
    const store = createConfigStore({
      fs,
      filePath: configPath,
      projectFilePath: projectConfigPath
    });

    await store.scope(coreScope).set("apiKey", "global-key");

    expect(JSON.parse(fs.getContent("~/.poe-code/config.json") as string)).toEqual({
      core: {
        apiKey: "global-key"
      }
    });
    expect(JSON.parse(fs.getContent("~/workspace/.poe-code/config.json") as string)).toEqual({
      core: {
        apiKey: "project-key"
      }
    });
  });

  it("falls back to the global config when the project file is missing", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            core: {
              apiKey: "global-key"
            }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );
    const store = createConfigStore({
      fs,
      filePath: configPath,
      projectFilePath: projectConfigPath
    });

    await expect(store.scope(coreScope).getAll()).resolves.toEqual({
      apiKey: "global-key",
      poeBaseUrl: "https://api.poe.com/v1"
    });
  });

  it("uses the global scope when the project scope is absent", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            core: {
              apiKey: "global-key"
            }
          },
          null,
          2
        )}\n`,
        "~/workspace/.poe-code/config.json": `${JSON.stringify(
          {
            ui: {
              darkMode: true
            }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );
    const store = createConfigStore({
      fs,
      filePath: configPath,
      projectFilePath: projectConfigPath
    });

    await expect(store.scope(coreScope).getAll()).resolves.toEqual({
      apiKey: "global-key",
      poeBaseUrl: "https://api.poe.com/v1"
    });
  });

  it("supports json fields with schema validation", async () => {
    const fs = createMockFs(undefined, homeDir);
    const store = createConfigStore({ fs, filePath: configPath });
    const agentScope = defineScope("agent", {
      plugins: {
        type: "json" as const,
        default: null as Array<{ name: string; options?: unknown }> | null,
        parse: parseNullablePluginEntries,
        doc: "Configured poe-agent plugins"
      }
    });

    await store.scope(agentScope).set("plugins", [{ name: "web" }]);

    await expect(store.scope(agentScope).get("plugins")).resolves.toEqual([{ name: "web" }]);
  });
});
describe("planConfigScope", () => {
  it("uses docs/plans by default and POE_PLAN_DIRECTORY as the only env override", () => {
    expect(resolveScope(planConfigScope.schema, undefined, {}).plan_directory).toBe("docs/plans");
    expect(
      resolveScope(planConfigScope.schema, undefined, {
        POE_PLAN_DIRECTORY: "custom/plans"
      }).plan_directory
    ).toBe("custom/plans");
    expect(
      collectEnvOverrides([planConfigScope], {
        POE_PIPELINE_PLAN_DIRECTORY: "legacy/pipeline",
        POE_EXPERIMENT_PLAN_DIRECTORY: "legacy/experiment",
        POE_RALPH_PLAN_DIRECTORY: "legacy/ralph",
        POE_SUPERINTENDENT_PLAN_DIRECTORY: "legacy/superintendent"
      }).entries
    ).toEqual([]);
  });
});

describe("integrationsConfigScope", () => {
  it("parses a config with no integrations block", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify({
          models: {
            default: "anthropic/claude-sonnet-4.6"
          }
        })}\n`
      },
      homeDir
    );

    const document = await readDocument(fs, configPath);

    expect(resolveScope(integrationsConfigScope.schema, document.integrations)).toEqual({
      braintrust: {
        enabled: false
      }
    });
  });

  it("parses disabled Braintrust config without apiKey or project", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify({
          integrations: {
            braintrust: {
              enabled: false
            }
          }
        })}\n`
      },
      homeDir
    );

    const document = await readDocument(fs, configPath);

    expect(resolveScope(integrationsConfigScope.schema, document.integrations)).toEqual({
      braintrust: {
        enabled: false
      }
    });
  });

  it("parses enabled Braintrust config without cross-field validation", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify({
          integrations: {
            braintrust: {
              enabled: true
            }
          }
        })}\n`
      },
      homeDir
    );

    const document = await readDocument(fs, configPath);

    expect(resolveScope(integrationsConfigScope.schema, document.integrations)).toEqual({
      braintrust: {
        enabled: true
      }
    });
  });
});

function parseNullablePluginEntries(
  value: unknown
): Array<{ name: string; options?: unknown }> | null {
  if (value === null) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw new Error("expected an array or null");
  }
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`[${index}]: expected an object`);
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.name !== "string") {
      throw new Error(`[${index}].name: expected a string`);
    }
    const parsed: { name: string; options?: unknown } = { name: record.name };
    if ("options" in record) {
      parsed.options = record.options;
    }
    return parsed;
  });
}

describe("collectEnvOverrides", () => {
  const coreScope = defineScope("core", {
    apiKey: {
      type: "string",
      default: "",
      env: "POE_API_KEY",
      doc: "Poe API key"
    },
    poeBaseUrl: {
      type: "string",
      default: "https://api.poe.com/v1",
      env: "POE_BASE_URL",
      doc: "Poe API base URL"
    }
  });

  const extraScope = defineScope("extra", {
    timeout: {
      type: "number",
      default: 30,
      env: "POE_TIMEOUT",
      doc: "Timeout in seconds"
    },
    enabled: {
      type: "boolean",
      default: false,
      doc: "Whether feature is enabled"
    }
  });

  it("returns empty results when no env vars are set", () => {
    const result = collectEnvOverrides([coreScope], {});

    expect(result.document).toEqual({});
    expect(result.entries).toEqual([]);
  });

  it("collects env overrides for a single scope", () => {
    const result = collectEnvOverrides([coreScope], {
      POE_API_KEY: "sk-env"
    });

    expect(result.document).toEqual({
      core: { apiKey: "sk-env" }
    });
    expect(result.entries).toEqual(["  POE_API_KEY = sk-env"]);
  });

  it("collects env overrides across multiple scopes", () => {
    const result = collectEnvOverrides([coreScope, extraScope], {
      POE_API_KEY: "sk-env",
      POE_TIMEOUT: "60"
    });

    expect(result.document).toEqual({
      core: { apiKey: "sk-env" },
      extra: { timeout: 60 }
    });
    expect(result.entries).toEqual([
      "  POE_API_KEY = sk-env",
      "  POE_TIMEOUT = 60"
    ]);
  });

  it("ignores fields without env mapping", () => {
    const result = collectEnvOverrides([extraScope], {
      POE_TIMEOUT: "60"
    });

    expect(result.document).toEqual({
      extra: { timeout: 60 }
    });
    expect(result.entries).toHaveLength(1);
  });

  it("ignores env vars that fail coercion", () => {
    const result = collectEnvOverrides([extraScope], {
      POE_TIMEOUT: "not-a-number"
    });

    expect(result.document).toEqual({});
    expect(result.entries).toEqual([]);
  });

  it("coerces boolean env values", () => {
    const boolScope = defineScope("flags", {
      verbose: {
        type: "boolean",
        default: false,
        env: "VERBOSE",
        doc: "Verbose output"
      }
    });

    expect(collectEnvOverrides([boolScope], { VERBOSE: "true" }).document).toEqual({
      flags: { verbose: true }
    });
    expect(collectEnvOverrides([boolScope], { VERBOSE: "1" }).document).toEqual({
      flags: { verbose: true }
    });
    expect(collectEnvOverrides([boolScope], { VERBOSE: "false" }).document).toEqual({
      flags: { verbose: false }
    });
    expect(collectEnvOverrides([boolScope], { VERBOSE: "0" }).document).toEqual({
      flags: { verbose: false }
    });
    expect(collectEnvOverrides([boolScope], { VERBOSE: "maybe" }).document).toEqual({});
  });

  it("skips empty number strings", () => {
    const result = collectEnvOverrides([extraScope], {
      POE_TIMEOUT: ""
    });

    expect(result.document).toEqual({});
    expect(result.entries).toEqual([]);
  });

  it("skips non-finite number strings", () => {
    const result = collectEnvOverrides([extraScope], {
      POE_TIMEOUT: "Infinity"
    });

    expect(result.document).toEqual({});
    expect(result.entries).toEqual([]);
  });

  it("collects an environment override for a __proto__ schema field", () => {
    const schema = Object.fromEntries([
      ["__proto__", { type: "string", default: "", env: "PROTO_VALUE", doc: "Proto field" }]
    ]);
    const result = collectEnvOverrides([defineScope("custom", schema as never)], {
      PROTO_VALUE: "visible"
    });

    expect(Object.hasOwn(result.document.custom, "__proto__")).toBe(true);
    expect(result.document.custom.__proto__).toBe("visible");
    expect(result.entries).toEqual(["  PROTO_VALUE = visible"]);
  });
});

describe("resolveEditTarget", () => {
  const projectConfigPath = "/repo/.poe-code/config.json";

  it("returns global config path when --global is set", async () => {
    const fs = createMockFs(undefined, homeDir);

    const result = await resolveEditTarget(fs, configPath, projectConfigPath, {
      global: true
    });

    expect(result).toBe(configPath);
  });

  it("returns project config path when --project is set", async () => {
    const fs = createMockFs(undefined, homeDir);

    const result = await resolveEditTarget(fs, configPath, projectConfigPath, {
      project: true
    });

    expect(result).toBe(projectConfigPath);
  });

  it("returns project config when it exists and no flag is set", async () => {
    const fs = createMockFs(
      {
        "/repo/.poe-code/config.json": "{}\n"
      },
      homeDir
    );

    const result = await resolveEditTarget(fs, configPath, projectConfigPath, {});

    expect(result).toBe(projectConfigPath);
  });

  it("returns global config when project config is missing and no flag is set", async () => {
    const fs = createMockFs(undefined, homeDir);

    const result = await resolveEditTarget(fs, configPath, projectConfigPath, {});

    expect(result).toBe(configPath);
  });

  it("throws when both --global and --project are set", async () => {
    const fs = createMockFs(undefined, homeDir);

    await expect(
      resolveEditTarget(fs, configPath, projectConfigPath, {
        global: true,
        project: true
      })
    ).rejects.toThrow("Choose either --global or --project, not both.");
  });
});

describe("initProjectConfig", () => {
  const projectConfigPath = "/repo/.poe-code/config.json";

  it("creates an empty config file at the target path", async () => {
    const fs = createMockFs(undefined, homeDir);
    fs.directories.add("/repo");

    const result = await initProjectConfig(fs, projectConfigPath);

    expect(result).toBe("created");
    expect(fs.getContent(projectConfigPath)).toBe("{}\n");
  });

  it("returns already-exists when the file is already present", async () => {
    const fs = createMockFs(
      {
        "/repo/.poe-code/config.json": '{ "core": {} }\n'
      },
      homeDir
    );

    const result = await initProjectConfig(fs, projectConfigPath);

    expect(result).toBe("already-exists");
    expect(fs.getContent(projectConfigPath)).toBe('{ "core": {} }\n');
  });

  it("does not write through a symlinked project state directory", async () => {
    const volume = Volume.fromJSON({ "/outside/.keep": "" });
    volume.mkdirSync("/repo", { recursive: true });
    volume.symlinkSync("/outside", "/repo/.poe-code");
    const fs = createFsFromVolume(volume).promises as unknown as FileSystem;

    await expect(initProjectConfig(fs, projectConfigPath)).rejects.toThrow("symbolic link");
    await expect(fs.stat("/outside/config.json")).rejects.toBeTruthy();
  });

  it("does not overwrite a config created during initialization", async () => {
    const fs = createMockFs(undefined, homeDir);
    fs.directories.add("/repo");
    const originalStat = fs.stat.bind(fs);
    let created = false;

    fs.stat = async (filePath) => {
      try {
        return await originalStat(filePath);
      } catch (error) {
        if (!created && filePath === projectConfigPath) {
          created = true;
          fs.files[projectConfigPath] = '{"core":{"apiKey":"concurrent-value"}}\n';
        }
        throw error;
      }
    };

    await expect(initProjectConfig(fs, projectConfigPath)).resolves.toBe("already-exists");
    expect(fs.getContent(projectConfigPath)).toBe('{"core":{"apiKey":"concurrent-value"}}\n');
  });

  it("does not treat inherited write error codes as concurrent project config creation", async () => {
    const fs = createMockFs(undefined, homeDir);
    fs.directories.add("/repo");
    fs.writeFile = async (filePath) => {
      if (filePath === projectConfigPath) {
        throw new Error("project config create denied");
      }

      throw new Error(`Unexpected write: ${filePath}`);
    };

    await withObjectPrototypeProperties({ code: "EEXIST" }, async () => {
      await expect(initProjectConfig(fs, projectConfigPath)).rejects.toThrow(
        "project config create denied"
      );
    });
  });

  it("removes a partially written config when initialization fails", async () => {
    const fs = createMockFs(undefined, homeDir);
    fs.directories.add("/repo");
    const originalWriteFile = fs.writeFile.bind(fs);
    fs.writeFile = async (filePath, content, options) => {
      if (filePath === projectConfigPath) {
        fs.files[filePath] = "{\n";
        throw new Error("project config disk full");
      }

      await originalWriteFile(filePath, content, options);
    };

    await expect(initProjectConfig(fs, projectConfigPath)).rejects.toThrow(
      "project config disk full"
    );
    expect(fs.getContent(projectConfigPath)).toBeUndefined();
  });
});

describe("deepMergeDocuments", () => {
  it("returns the base document when override is empty", () => {
    const base = {
      core: { apiKey: "global-key" }
    };

    expect(deepMergeDocuments(base, {})).toEqual(base);
  });

  it("returns the override document when base is empty", () => {
    const override = {
      core: { apiKey: "project-key" }
    };

    expect(deepMergeDocuments({}, override)).toEqual(override);
  });

  it("unions disjoint scopes", () => {
    expect(
      deepMergeDocuments({ core: { apiKey: "global-key" } }, { ui: { darkMode: true } })
    ).toEqual({
      core: { apiKey: "global-key" },
      ui: { darkMode: true }
    });
  });

  it("merges disjoint keys within the same scope", () => {
    expect(
      deepMergeDocuments(
        {
          models: { default: "anthropic/claude-sonnet-4.6" }
        },
        {
          models: { codex: "openai/gpt-5.3-codex" }
        }
      )
    ).toEqual({
      models: {
        default: "anthropic/claude-sonnet-4.6",
        codex: "openai/gpt-5.3-codex"
      }
    });
  });

  it("prefers override values for overlapping keys", () => {
    expect(
      deepMergeDocuments(
        {
          models: { default: "anthropic/claude-sonnet-4.6" }
        },
        {
          models: { default: "anthropic/claude-opus-4.6" }
        }
      )
    ).toEqual({
      models: { default: "anthropic/claude-opus-4.6" }
    });
  });

  it("does not let undefined override clobber base values", () => {
    expect(
      deepMergeDocuments(
        {
          models: { default: "anthropic/claude-sonnet-4.6" }
        },
        {
          models: { default: undefined, codex: "openai/gpt-5.3-codex" }
        }
      )
    ).toEqual({
      models: {
        default: "anthropic/claude-sonnet-4.6",
        codex: "openai/gpt-5.3-codex"
      }
    });
  });

  it("preserves proto-named scopes and runtime keys as data", () => {
    const base = JSON.parse(
      '{"__proto__":{"base":true},"runtime":{"build_args":{"__proto__":"base-value"}}}'
    ) as ConfigDocument;
    const override = JSON.parse(
      '{"__proto__":{"override":true},"runtime":{"build_args":{"PACKAGE_MANAGER":"npm"}}}'
    ) as ConfigDocument;

    const result = deepMergeDocuments(base, override);
    const runtime = result.runtime as Record<string, Record<string, unknown>>;

    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(result.__proto__).toEqual({ base: true, override: true });
    expect(Object.hasOwn(runtime.build_args, "__proto__")).toBe(true);
    expect(runtime.build_args.__proto__).toBe("base-value");
  });

  it("returns the base document unchanged when override scope is empty", () => {
    const base = {
      core: { apiKey: "global-key" }
    };

    expect(deepMergeDocuments(base, { core: {} })).toEqual(base);
  });
});

describe("resolveScope", () => {
  const schema = {
    apiKey: {
      type: "string" as const,
      default: "",
      env: "POE_API_KEY",
      doc: "Poe API key"
    },
    timeout: {
      type: "number" as const,
      default: 30,
      env: "POE_TIMEOUT",
      doc: "Timeout in seconds"
    },
    enabled: {
      type: "boolean" as const,
      default: false,
      env: "POE_ENABLED",
      doc: "Whether feature is enabled"
    }
  };

  it("returns defaults when file and env are empty", () => {
    expect(resolveScope(schema)).toEqual({
      apiKey: "",
      timeout: 30,
      enabled: false
    });
  });

  it("prefers file values over defaults", () => {
    expect(
      resolveScope(schema, {
        apiKey: "file-key",
        timeout: 45,
        enabled: true
      })
    ).toEqual({
      apiKey: "file-key",
      timeout: 45,
      enabled: true
    });
  });

  it("prefers env values over file values", () => {
    expect(
      resolveScope(
        schema,
        {
          apiKey: "file-key",
          timeout: 45,
          enabled: false
        },
        {
          POE_API_KEY: "env-key",
          POE_TIMEOUT: "90",
          POE_ENABLED: "true"
        }
      )
    ).toEqual({
      apiKey: "env-key",
      timeout: 90,
      enabled: true
    });
  });

  it("coerces number and boolean env values", () => {
    expect(
      resolveScope(schema, undefined, {
        POE_TIMEOUT: "5",
        POE_ENABLED: "1"
      })
    ).toEqual({
      apiKey: "",
      timeout: 5,
      enabled: true
    });

    expect(
      resolveScope(schema, undefined, {
        POE_ENABLED: "0"
      })
    ).toEqual({
      apiKey: "",
      timeout: 30,
      enabled: false
    });
  });

  it("ignores non-finite number env values", () => {
    const schema = {
      timeout: {
        type: "number" as const,
        default: 30,
        env: "POE_TIMEOUT",
        doc: "Timeout"
      }
    };

    expect(resolveScope(schema, undefined, { POE_TIMEOUT: "Infinity" })).toEqual({ timeout: 30 });
  });

  it("ignores whitespace-only number env values", () => {
    expect(resolveScope(schema, { timeout: 45 }, { POE_TIMEOUT: "   " })).toEqual({
      apiKey: "",
      timeout: 45,
      enabled: false
    });
  });

  it("falls back to file values when env coercion fails", () => {
    expect(
      resolveScope(
        schema,
        {
          apiKey: "file-key",
          timeout: 45,
          enabled: true
        },
        {
          POE_TIMEOUT: "not-a-number",
          POE_ENABLED: "maybe"
        }
      )
    ).toEqual({
      apiKey: "file-key",
      timeout: 45,
      enabled: true
    });
  });

  it("ignores inherited file values", () => {
    const inherited = Object.create({
      apiKey: "inherited-key",
      timeout: 45,
      enabled: true
    }) as Record<string, unknown>;

    expect(resolveScope(schema, inherited)).toEqual({
      apiKey: "",
      timeout: 30,
      enabled: false
    });
  });

  it("ignores inherited environment values", () => {
    const inherited = Object.create({
      POE_API_KEY: "inherited-key",
      POE_TIMEOUT: "45",
      POE_ENABLED: "true"
    }) as Record<string, string | undefined>;

    expect(resolveScope(schema, undefined, inherited)).toEqual({
      apiKey: "",
      timeout: 30,
      enabled: false
    });
  });

  it("parses json values from file and env", () => {
    const jsonSchema = {
      plugins: {
        type: "json" as const,
        default: null as Array<{ name: string; options?: unknown }> | null,
        env: "POE_AGENT_PLUGINS",
        parse: parseNullablePluginEntries,
        doc: "Configured poe-agent plugins"
      }
    };

    expect(resolveScope(jsonSchema, { plugins: [{ name: "web" }] })).toEqual({
      plugins: [{ name: "web" }]
    });

    expect(
      resolveScope(jsonSchema, undefined, {
        POE_AGENT_PLUGINS: JSON.stringify([{ name: "shell", options: { cwd: "." } }])
      })
    ).toEqual({
      plugins: [{ name: "shell", options: { cwd: "." } }]
    });
  });

  it("throws for invalid json values", () => {
    const jsonSchema = {
      plugins: {
        type: "json" as const,
        default: null as Array<{ name: string; options?: unknown }> | null,
        parse: parseNullablePluginEntries,
        doc: "Configured poe-agent plugins"
      }
    };

    expect(() => resolveScope(jsonSchema, { plugins: "nope" })).toThrow("plugins");
  });
});

describe("defineScope", () => {
  it("returns scope metadata for later store binding", () => {
    const schema = {
      apiKey: {
        type: "string" as const,
        default: "",
        env: "POE_API_KEY",
        doc: "Poe API key"
      }
    };

    expect(defineScope("core", schema)).toEqual({
      scope: "core",
      schema
    });
  });
});

describe("store", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an empty document when config file is missing", async () => {
    const fs = createMockFs(undefined, homeDir);

    await expect(readDocument(fs, configPath)).resolves.toEqual({});
  });

  it("reads an existing scoped document", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            core: { apiKey: "stored-key" },
            configured_services: {
              codex: { files: ["/tmp/config.toml"] }
            }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );

    await expect(readDocument(fs, configPath)).resolves.toEqual({
      core: { apiKey: "stored-key" },
      configured_services: {
        codex: { files: ["/tmp/config.toml"] }
      }
    });
  });

  it("rejects merged reads through a symlinked global config file", async () => {
    const volume = new Volume();
    volume.mkdirSync(`${homeDir}/.poe-code`, { recursive: true });
    volume.mkdirSync("/outside", { recursive: true });
    volume.writeFileSync("/outside/config.json", '{"core":{"apiKey":"outside-key"}}\n');
    volume.symlinkSync("/outside/config.json", configPath);
    const fs = createFsFromVolume(volume).promises as FileSystem;

    await expect(readMergedDocument(fs, configPath)).rejects.toThrow(
      `Refusing configuration access through symbolic link: ${configPath}`
    );
  });

  it("rejects merged reads through a symlinked project config file", async () => {
    const projectConfigPath = `${homeDir}/workspace/.poe-code/config.json`;
    const volume = new Volume();
    volume.mkdirSync(`${homeDir}/.poe-code`, { recursive: true });
    volume.mkdirSync(`${homeDir}/workspace/.poe-code`, { recursive: true });
    volume.mkdirSync("/outside", { recursive: true });
    volume.writeFileSync(configPath, '{"core":{"apiKey":"global-key"}}\n');
    volume.writeFileSync("/outside/config.json", '{"core":{"apiKey":"outside-key"}}\n');
    volume.symlinkSync("/outside/config.json", projectConfigPath);
    const fs = createFsFromVolume(volume).promises as FileSystem;

    await expect(readMergedDocument(fs, configPath, projectConfigPath)).rejects.toThrow(
      `Refusing configuration access through symbolic link: ${projectConfigPath}`
    );
  });

  it("backs up invalid JSON and resets the document", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-23T12:34:56.789Z"));

    const fs = createMockFs(
      {
        "~/.poe-code/config.json": "not json\n"
      },
      homeDir
    );

    await expect(readDocument(fs, configPath)).resolves.toEqual({});

    const directoryEntries = await fs.readdir(path.dirname(configPath));
    expect(directoryEntries).toContain("config.json.invalid-2026-03-23T12-34-56-789Z.json");
    expect(fs.getContent("~/.poe-code/config.json.invalid-2026-03-23T12-34-56-789Z.json")).toBe(
      "not json\n"
    );
    expect(fs.getContent("~/.poe-code/config.json")).toBe("{}\n");
  });

  it("keeps separate invalid backups created in the same millisecond", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-23T12:34:56.789Z"));
    const fs = createMockFs({ "~/.poe-code/config.json": "first invalid\n" }, homeDir);

    await readDocument(fs, configPath);
    await fs.writeFile(configPath, "second invalid\n", { encoding: "utf8" });
    await readDocument(fs, configPath);

    const backups = (await fs.readdir(path.dirname(configPath))).filter((entry) => entry.includes(".invalid-")).sort();
    expect(backups).toHaveLength(2);
    expect(backups.map((entry) => fs.getContent(`~/.poe-code/${entry}`))).toEqual(
      expect.arrayContaining(["first invalid\n", "second invalid\n"])
    );
  });

  it("cleans a partial invalid config backup when recovery fails", async () => {
    const original = "not json\n";
    const base = createMockFs({ "~/.poe-code/config.json": original }, homeDir);
    let backupPath: string | undefined;
    const fs: FileSystem = {
      ...base,
      async writeFile(targetPath, content, options) {
        if (targetPath.includes(".invalid-")) {
          backupPath = targetPath;
          await base.writeFile(targetPath, "partial backup\n", options);
          throw new Error("config backup disk full");
        }
        await base.writeFile(targetPath, content, options);
      }
    };

    await expect(readDocument(fs, configPath)).rejects.toThrow("config backup disk full");
    expect(backupPath).toBeDefined();
    expect(base.getContent(backupPath ?? "")).toBeUndefined();
    await expect(base.readFile(configPath, "utf8")).resolves.toBe(original);
  });

  it("writes a scope while preserving unrelated scopes", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            core: { apiKey: "stored-key" },
            configured_services: {
              codex: { files: ["/tmp/config.toml"] }
            }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );

    await writeScope(fs, configPath, "core", {
      apiKey: "updated-key",
      poeBaseUrl: "https://api.poe.com/v1"
    });

    expect(JSON.parse(fs.getContent("~/.poe-code/config.json") as string)).toEqual({
      core: {
        apiKey: "updated-key",
        poeBaseUrl: "https://api.poe.com/v1"
      },
      configured_services: {
        codex: { files: ["/tmp/config.toml"] }
      }
    });
  });

  it("preserves the existing document when a scope write fails", async () => {
    const original = '{"core":{"apiKey":"old"}}\n';
    const base = createMockFs({ "~/.poe-code/config.json": original }, homeDir);
    const fs: FileSystem = {
      ...base,
      async writeFile(targetPath, content, options) {
        if (targetPath === configPath || targetPath.includes(".tmp")) {
          await base.writeFile(targetPath, "{", options);
          throw new Error("config scope disk full");
        }
        await base.writeFile(targetPath, content, options);
      }
    };

    await expect(writeScope(fs, configPath, "ui", { darkMode: true })).rejects.toThrow("config scope disk full");
    await expect(base.readFile(configPath, "utf8")).resolves.toBe(original);
    const entries = await base.readdir(path.dirname(configPath));
    expect(entries.some((entry) => entry.includes(".tmp"))).toBe(false);
  });

  it("removes partial temporary config files after inherited existing-path errors", async () => {
    const original = '{"core":{"apiKey":"old"}}\n';
    const base = createMockFs({ "~/.poe-code/config.json": original }, homeDir);
    let tempPath: string | undefined;
    const fs: FileSystem = {
      ...base,
      async writeFile(targetPath, content, options) {
        if (targetPath.startsWith(`${configPath}.`) && targetPath.endsWith(".tmp")) {
          tempPath = targetPath;
          await base.writeFile(targetPath, "partial temp\n", options);
          throw new Error("config temp exists");
        }

        await base.writeFile(targetPath, content, options);
      }
    };

    await withObjectPrototypeProperties({ code: "EEXIST" }, async () => {
      await expect(writeScope(fs, configPath, "ui", { darkMode: true })).rejects.toThrow(
        "config temp exists"
      );
    });

    expect(tempPath).toBeDefined();
    await expect(base.readFile(configPath, "utf8")).resolves.toBe(original);
    expect(base.getContent(tempPath as string)).toBeUndefined();
  });

  it("does not remove a colliding temporary config file it did not create", async () => {
    const original = '{"core":{"apiKey":"old"}}\n';
    const base = createMockFs({ "~/.poe-code/config.json": original }, homeDir);
    let tempPath: string | undefined;
    const fs: FileSystem = {
      ...base,
      async writeFile(targetPath, content, options) {
        if (targetPath.startsWith(`${configPath}.`) && targetPath.endsWith(".tmp")) {
          tempPath = targetPath;
          base.files[targetPath] = "preexisting-temp\n";
        }

        await base.writeFile(targetPath, content, options);
      }
    };

    await expect(writeScope(fs, configPath, "ui", { darkMode: true })).rejects.toMatchObject({
      code: "EEXIST"
    });

    expect(tempPath).toBeDefined();
    await expect(base.readFile(configPath, "utf8")).resolves.toBe(original);
    expect(base.getContent(tempPath as string)).toBe("preexisting-temp\n");
  });

  it("preserves a stored __proto__ key inside a normal scope", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": '{"core":{"__proto__":"stored-value"}}\n'
      },
      homeDir
    );

    const document = await readDocument(fs, configPath);

    expect(Object.hasOwn(document.core, "__proto__")).toBe(true);
    expect(document.core.__proto__).toBe("stored-value");
  });

  it("writes a __proto__ key inside a normal scope", async () => {
    const fs = createMockFs(undefined, homeDir);
    const values = JSON.parse('{"__proto__":"written-value"}') as Record<string, unknown>;

    await writeScope(fs, configPath, "core", values);

    const persisted = JSON.parse(fs.getContent("~/.poe-code/config.json") as string) as Record<string, Record<string, unknown>>;
    expect(Object.hasOwn(persisted.core, "__proto__")).toBe(true);
    expect(persisted.core.__proto__).toBe("written-value");
  });

  it("writes a scope named __proto__ as configuration data", async () => {
    const fs = createMockFs(undefined, homeDir);

    await writeScope(fs, configPath, "__proto__", { enabled: true });

    const persisted = JSON.parse(fs.getContent("~/.poe-code/config.json") as string) as Record<string, Record<string, unknown>>;
    expect(Object.hasOwn(persisted, "__proto__")).toBe(true);
    expect(persisted.__proto__).toEqual({ enabled: true });
  });

  it("removes a scope when writing an empty object", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            core: { apiKey: "stored-key" },
            configured_services: {
              codex: { files: ["/tmp/config.toml"] }
            }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );

    await writeScope(fs, configPath, "configured_services", {});

    expect(JSON.parse(fs.getContent("~/.poe-code/config.json") as string)).toEqual({
      core: { apiKey: "stored-key" }
    });
  });

  it("merges global and project documents with project overrides", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            core: { apiKey: "global-key", poeBaseUrl: "https://global.example.test" },
            ui: { darkMode: false }
          },
          null,
          2
        )}\n`,
        "~/workspace/.poe-code/config.json": `${JSON.stringify(
          {
            core: { apiKey: "project-key" },
            models: { default: "anthropic/claude-opus-4.6" }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );

    await expect(
      readMergedDocument(fs, configPath, `${homeDir}/workspace/.poe-code/config.json`)
    ).resolves.toEqual({
      core: {
        apiKey: "project-key",
        poeBaseUrl: "https://global.example.test"
      },
      ui: { darkMode: false },
      models: { default: "anthropic/claude-opus-4.6" }
    });
  });

  it("deep merges nested scope objects across global and project documents", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            configured_services: {
              codex: {
                files: ["/tmp/global.toml"],
                env: {
                  GLOBAL_ONLY: "true"
                }
              }
            }
          },
          null,
          2
        )}\n`,
        "~/workspace/.poe-code/config.json": `${JSON.stringify(
          {
            configured_services: {
              codex: {
                env: {
                  PROJECT_ONLY: "true"
                }
              }
            }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );

    await expect(
      readMergedDocument(fs, configPath, `${homeDir}/workspace/.poe-code/config.json`)
    ).resolves.toEqual({
      configured_services: {
        codex: {
          files: ["/tmp/global.toml"],
          env: {
            GLOBAL_ONLY: "true",
            PROJECT_ONLY: "true"
          }
        }
      }
    });
  });

  it("does not auto-inherit from global when project config sets extends false", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            core: { apiKey: "global-key" },
            ui: { darkMode: true }
          },
          null,
          2
        )}\n`,
        "~/workspace/.poe-code/config.json": `${JSON.stringify(
          {
            extends: false,
            core: { apiKey: "project-key" }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );

    await expect(
      readMergedDocument(fs, configPath, `${homeDir}/workspace/.poe-code/config.json`)
    ).resolves.toEqual({
      core: { apiKey: "project-key" }
    });
  });

  it("uses only the global document when project config is missing", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            core: { apiKey: "global-key" }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );

    await expect(
      readMergedDocument(fs, configPath, `${homeDir}/workspace/.poe-code/config.json`)
    ).resolves.toEqual({
      core: { apiKey: "global-key" }
    });
  });

  it("uses only the global document when project config resolves to the global path", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            extends: true,
            core: { apiKey: "global-key" }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );

    await expect(readMergedDocument(fs, configPath, configPath)).resolves.toEqual({
      core: { apiKey: "global-key" }
    });
  });

  it("resolves the project config path from the current working directory", () => {
    expect(resolveProjectConfigPath("/workspace/app")).toBe("/workspace/app/.poe-code/config.json");
  });
});
