import { createMockFs } from "@poe-code/config-mutations/testing";
import { describe, expect, it, vi } from "vitest";
import { loadConfiguredServices, saveConfiguredService, unconfigureService } from "./configured-services.js";

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

  it("saves a configured service named __proto__", async () => {
    const fs = createMockFs(undefined, homeDir);

    await saveConfiguredService({
      fs,
      filePath: configPath,
      service: "__proto__",
      metadata: {
        provider: "poe",
        files: ["/tmp/proto.toml"]
      },
      warn: () => undefined
    });

    const services = await loadConfiguredServices({ fs, filePath: configPath, warn: () => undefined });
    expect(Object.hasOwn(services, "__proto__")).toBe(true);
    expect(services.__proto__).toEqual({
      provider: "poe",
      files: ["/tmp/proto.toml"]
    });
  });

  it("does not unconfigure an absent inherited constructor service", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": '{"configured_services":{"codex":{"provider":"poe","files":[]}}}\n'
      },
      homeDir
    );

    await expect(unconfigureService({ fs, filePath: configPath, service: "constructor" })).resolves.toBe(false);
    await expect(loadConfiguredServices({ fs, filePath: configPath })).resolves.toHaveProperty("codex");
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

  it("rolls back layered migrations when a project migration cannot be committed", async () => {
    const globalPath = "/home/test/.poe-code/config.json";
    const projectPath = "/workspace/.poe-code/config.json";
    const base = createMockFs(
      {
        "~/.poe-code/config.json": '{"configured_services":{"codex":{"files":["/global"]}}}\n',
        "/workspace/.poe-code/config.json": '{"configured_services":{"opencode":{"files":["/project"]}}}\n'
      },
      homeDir
    );
    const fs = {
      ...base,
      async rename(oldPath: string, newPath: string) {
        if (newPath === projectPath) {
          throw new Error("project write offline");
        }
        await base.rename(oldPath, newPath);
      }
    };

    await expect(loadConfiguredServices({ fs, filePath: globalPath, projectFilePath: projectPath })).rejects.toThrow(
      "project write offline"
    );
    expect(JSON.parse(await base.readFile(globalPath, "utf8"))).toEqual({
      configured_services: { codex: { files: ["/global"] } }
    });
    expect(JSON.parse(await base.readFile(projectPath, "utf8"))).toEqual({
      configured_services: { opencode: { files: ["/project"] } }
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

  it("does not load an arbitrary apiShape string as typed metadata", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": '{"configured_services":{"codex":{"provider":"poe","apiShape":"attacker-shape","files":[]}}}\n'
      },
      homeDir
    );

    await expect(loadConfiguredServices({ fs, filePath: configPath })).resolves.toEqual({
      codex: {
        provider: "poe",
        apiShape: "openai-responses",
        files: []
      }
    });
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
