import { createMockFs } from "@poe-code/config-mutations/testing";
import { describe, expect, it } from "vitest";
import {
  loadAgentModel,
  loadDefaultModel,
  resolveModel,
  saveAgentModel,
  saveDefaultModel
} from "./models.js";

const homeDir = "/home/test";
const configPath = `${homeDir}/.poe-code/config.json`;

describe("models config", () => {
  it("returns null for agent model when config is missing", async () => {
    const fs = createMockFs(undefined, homeDir);

    await expect(loadAgentModel({ fs, filePath: configPath }, "codex")).resolves.toBeNull();
  });

  it("returns the stored agent-specific model", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            models: {
              codex: "openai/gpt-5.4",
              default: "anthropic/claude-sonnet-4.6"
            }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );

    await expect(loadAgentModel({ fs, filePath: configPath }, "codex")).resolves.toBe(
      "openai/gpt-5.4"
    );
  });

  it("returns null for the global default model when config is missing", async () => {
    const fs = createMockFs(undefined, homeDir);

    await expect(loadDefaultModel({ fs, filePath: configPath })).resolves.toBeNull();
  });

  it("returns the stored global default model", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            models: {
              default: "anthropic/claude-sonnet-4.6"
            }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );

    await expect(loadDefaultModel({ fs, filePath: configPath })).resolves.toBe(
      "anthropic/claude-sonnet-4.6"
    );
  });

  it("prefers the agent-specific model when both agent and global defaults exist", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            models: {
              default: "anthropic/claude-sonnet-4.6",
              codex: "openai/gpt-5.4"
            }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );

    await expect(resolveModel({ fs, filePath: configPath }, "codex")).resolves.toBe(
      "openai/gpt-5.4"
    );
  });

  it("falls back to the global default when no agent-specific model exists", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            models: {
              default: "anthropic/claude-sonnet-4.6"
            }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );

    await expect(resolveModel({ fs, filePath: configPath }, "codex")).resolves.toBe(
      "anthropic/claude-sonnet-4.6"
    );
  });

  it("returns null when neither agent nor global defaults exist", async () => {
    const fs = createMockFs(undefined, homeDir);

    await expect(resolveModel({ fs, filePath: configPath }, "codex")).resolves.toBeNull();
  });

  it("writes only the agent key without clobbering other model entries", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            core: {
              apiKey: "stored-key"
            },
            models: {
              default: "anthropic/claude-sonnet-4.6",
              "claude-code": "anthropic/claude-opus-4.6"
            }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );

    await saveAgentModel({ fs, filePath: configPath }, "codex", "openai/gpt-5.4");

    expect(JSON.parse(fs.getContent("~/.poe-code/config.json") as string)).toEqual({
      core: {
        apiKey: "stored-key"
      },
      models: {
        default: "anthropic/claude-sonnet-4.6",
        "claude-code": "anthropic/claude-opus-4.6",
        codex: "openai/gpt-5.4"
      }
    });
  });

  it("writes the default key without clobbering agent model entries", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            models: {
              codex: "openai/gpt-5.4"
            }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );

    await saveDefaultModel(
      { fs, filePath: configPath },
      "anthropic/claude-sonnet-4.6"
    );

    expect(JSON.parse(fs.getContent("~/.poe-code/config.json") as string)).toEqual({
      models: {
        codex: "openai/gpt-5.4",
        default: "anthropic/claude-sonnet-4.6"
      }
    });
  });
});
