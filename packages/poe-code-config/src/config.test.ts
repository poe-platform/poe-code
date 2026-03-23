import { createMockFs } from "@poe-code/config-mutations/testing";
import { describe, expect, it } from "vitest";
import { createConfigStore } from "./config.js";
import { defineScope } from "./schema.js";

const homeDir = "/home/test";
const configPath = `${homeDir}/.poe-code/config.json`;

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

describe("createConfigStore", () => {
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
});
