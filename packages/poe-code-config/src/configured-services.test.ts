import { createMockFs } from "@poe-code/config-mutations/testing";
import { describe, expect, it, vi } from "vitest";
import { loadConfiguredServices, saveConfiguredService } from "./configured-services.js";

const homeDir = "/home/test";
const configPath = `${homeDir}/.poe-code/config.json`;

describe("configured services", () => {
  it("derives apiShape when saving a new service entry", async () => {
    const fs = createMockFs(undefined, homeDir);

    await saveConfiguredService({
      fs,
      filePath: configPath,
      service: "claude-code",
      metadata: {
        provider: "poe",
        files: ["/home/test/.claude/settings.json"]
      }
    });

    expect(fs.getContent("~/.poe-code/config.json")).toMatchInlineSnapshot(`
      "{
        "configured_services": {
          "claude-code": {
            "provider": "poe",
            "apiShape": "anthropic-messages",
            "files": [
              "/home/test/.claude/settings.json"
            ]
          }
        }
      }
      "
    `);
  });

  it("migrates missing apiShape on read and preserves it on save", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            configured_services: {
              "claude-code": {
                provider: "poe",
                files: ["/home/test/.claude/settings.json"]
              }
            }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    await saveConfiguredService({
      fs,
      filePath: configPath,
      service: "claude-code",
      metadata: services["claude-code"]!
    });

    expect(fs.getContent("~/.poe-code/config.json")).toMatchInlineSnapshot(`
      "{
        "configured_services": {
          "claude-code": {
            "provider": "poe",
            "apiShape": "anthropic-messages",
            "files": [
              "/home/test/.claude/settings.json"
            ]
          }
        }
      }
      "
    `);
  });

  it("migrates existing service entries before saving another service", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            configured_services: {
              "claude-code": {
                provider: "poe",
                files: ["/home/test/.claude/settings.json"]
              }
            }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );

    await saveConfiguredService({
      fs,
      filePath: configPath,
      service: "codex",
      metadata: {
        provider: "poe",
        files: ["/home/test/.codex/config.toml"]
      }
    });

    expect(JSON.parse(fs.getContent("~/.poe-code/config.json") as string)).toEqual({
      configured_services: {
        "claude-code": {
          provider: "poe",
          apiShape: "anthropic-messages",
          files: ["/home/test/.claude/settings.json"]
        },
        codex: {
          provider: "poe",
          apiShape: "openai-responses",
          files: ["/home/test/.codex/config.toml"]
        }
      }
    });
  });

  it("does not rewrite or warn when apiShape already exists", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            configured_services: {
              codex: {
                provider: "legacy-provider",
                apiShape: "openai-responses",
                files: ["/home/test/.codex/config.toml"]
              }
            }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );
    const warn = vi.fn();
    const writeSpy = vi.spyOn(fs, "writeFile");

    await expect(loadConfiguredServices({ fs, filePath: configPath, warn })).resolves.toEqual({
      codex: {
        provider: "legacy-provider",
        apiShape: "openai-responses",
        files: ["/home/test/.codex/config.toml"]
      }
    });

    expect(warn).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("does not rewrite or warn after apiShape migration has already run", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            configured_services: {
              "claude-code": {
                provider: "poe",
                files: ["/home/test/.claude/settings.json"]
              }
            }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );
    const warn = vi.fn();

    await loadConfiguredServices({ fs, filePath: configPath, warn });
    const writeSpy = vi.spyOn(fs, "writeFile");
    await loadConfiguredServices({ fs, filePath: configPath, warn });

    expect(warn).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("warns and leaves apiShape unset when compatibility cannot be resolved", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            configured_services: {
              "claude-code": {
                provider: "legacy-provider",
                files: ["/home/test/.claude/settings.json"]
              }
            }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );
    const warn = vi.fn();

    await expect(loadConfiguredServices({ fs, filePath: configPath, warn })).resolves.toEqual({
      "claude-code": {
        files: ["/home/test/.claude/settings.json"],
        provider: "legacy-provider"
      }
    });
    expect(warn).toHaveBeenCalledWith(
      'Unable to derive apiShape for configured service "claude-code" with provider "legacy-provider".'
    );
    expect(fs.getContent("~/.poe-code/config.json")).toContain('"provider": "legacy-provider"');
    expect(fs.getContent("~/.poe-code/config.json")).not.toContain("apiShape");
  });
});
