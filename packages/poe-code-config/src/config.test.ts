import { createMockFs } from "@poe-code/config-mutations/testing";
import { describe, expect, it } from "bun:test";
import { createConfigStore } from "./config.js";
import { defineScope } from "./schema.js";

const homeDir = "/home/test";
const configPath = `${homeDir}/.poe-code/config.json`;
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
});
