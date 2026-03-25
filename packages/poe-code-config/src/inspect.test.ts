import { createMockFs } from "@poe-code/config-mutations/testing";
import { describe, expect, it } from "vitest";
import { defineScope } from "./schema.js";
import {
  collectEnvOverrides,
  initProjectConfig,
  resolveEditTarget
} from "./inspect.js";

const homeDir = "/home/test";
const configPath = `${homeDir}/.poe-code/config.json`;
const projectConfigPath = "/repo/.poe-code/config.json";

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

describe("collectEnvOverrides", () => {
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
});

describe("resolveEditTarget", () => {
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
});
