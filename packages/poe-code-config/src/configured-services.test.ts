import { createMockFs } from "@poe-code/config-mutations/testing";
import type { FileSystem } from "@poe-code/config-mutations";
import { describe, expect, it, vi } from "vitest";
import { loadConfiguredServices, saveConfiguredService, unconfigureService } from "./configured-services.js";

const homeDir = "/home/test";
const configPath = `${homeDir}/.poe-code/config.json`;

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T>
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

  it("preserves non-secret configuration preferences for isolated repair", async () => {
    const fs = createMockFs(undefined, homeDir);

    await saveConfiguredService({
      fs,
      filePath: configPath,
      service: "codex",
      metadata: {
        provider: "cloudflare",
        files: ["/home/test/.codex/config.toml"],
        model: "@cf/meta/llama-3.1-8b-instruct",
        reasoningEffort: "high",
        baseUrl: "https://gateway.example.test/",
        shapeBaseUrl: ["openai-responses=https://responses.example.test"]
      }
    });

    await expect(loadConfiguredServices({ fs, filePath: configPath })).resolves.toMatchObject({
      codex: {
        provider: "cloudflare",
        model: "@cf/meta/llama-3.1-8b-instruct",
        reasoningEffort: "high",
        baseUrl: "https://gateway.example.test/",
        shapeBaseUrl: ["openai-responses=https://responses.example.test"]
      }
    });
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

  it("ignores inherited legacy credential document fields", async () => {
    const fs = createMockFs({ "~/.poe-code/credentials.json": "{}\n" }, homeDir);

    await withObjectPrototypeProperties(
      {
        apiKey: "polluted-key",
        configured_services: {
          codex: {
            provider: "poe",
            files: ["/polluted"]
          }
        }
      },
      async () => {
        await expect(loadConfiguredServices({ fs, filePath: configPath })).resolves.toEqual({});
      }
    );

    expect(fs.getContent("~/.poe-code/config.json")).toBeUndefined();
    expect(fs.getContent("~/.poe-code/credentials.json")).toBeUndefined();
  });

  it("ignores inherited configured service metadata fields", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": '{"configured_services":{"codex":{}}}\n'
      },
      homeDir
    );

    await withObjectPrototypeProperties(
      {
        provider: "cloudflare",
        apiShape: "google-generations",
        files: ["/polluted"],
        model: "polluted-model",
        reasoningEffort: "high",
        baseUrl: "https://polluted.example.test",
        shapeBaseUrl: ["openai-responses=https://polluted.example.test"]
      },
      async () => {
        await expect(loadConfiguredServices({ fs, filePath: configPath, readOnly: true })).resolves.toEqual({
          codex: {
            provider: "poe",
            files: []
          }
        });
      }
    );
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

  it("keeps separate invalid legacy credential backups created in the same millisecond", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-23T12:34:56.789Z"));

    try {
      const fs = createMockFs({ "~/.poe-code/credentials.json": "first invalid\n" }, homeDir);

      await expect(loadConfiguredServices({ fs, filePath: configPath })).resolves.toEqual({});
      await fs.writeFile(`${homeDir}/.poe-code/credentials.json`, "second invalid\n", {
        encoding: "utf8"
      });
      await expect(loadConfiguredServices({ fs, filePath: configPath })).resolves.toEqual({});

      const backups = (await fs.readdir(`${homeDir}/.poe-code`)).filter((entry) =>
        entry.includes(".invalid-")
      );
      expect(backups).toEqual(
        expect.arrayContaining([
          "credentials.json.invalid-2026-03-23T12-34-56-789Z.json",
          "credentials.json.invalid-2026-03-23T12-34-56-789Z-1.json"
        ])
      );
      expect(backups.map((entry) => fs.getContent(`${homeDir}/.poe-code/${entry}`))).toEqual(
        expect.arrayContaining(["first invalid\n", "second invalid\n"])
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("cleans a partial legacy credential reset temp file when invalid recovery fails", async () => {
    const legacyPath = `${homeDir}/.poe-code/credentials.json`;
    const base = createMockFs({ "~/.poe-code/credentials.json": "not json\n" }, homeDir);
    const fs: FileSystem = {
      ...base,
      async writeFile(targetPath, content, options) {
        if (targetPath.startsWith(`${legacyPath}.`) && targetPath.endsWith(".tmp")) {
          await base.writeFile(targetPath, "partial\n", options);
          throw new Error("legacy reset disk full");
        }
        await base.writeFile(targetPath, content, options);
      }
    };

    await expect(loadConfiguredServices({ fs, filePath: configPath })).rejects.toThrow(
      "legacy reset disk full"
    );

    const entries = await base.readdir(`${homeDir}/.poe-code`);
    expect(entries.some((entry) => entry.includes(".tmp"))).toBe(false);
    await expect(base.readFile(legacyPath, "utf8")).resolves.toBe("not json\n");
  });

  it("cleans partial legacy credential reset temps after inherited existing-path errors", async () => {
    const legacyPath = `${homeDir}/.poe-code/credentials.json`;
    const base = createMockFs({ "~/.poe-code/credentials.json": "not json\n" }, homeDir);
    let tempPath: string | undefined;
    const fs: FileSystem = {
      ...base,
      async writeFile(targetPath, content, options) {
        if (targetPath.startsWith(`${legacyPath}.`) && targetPath.endsWith(".tmp")) {
          tempPath = targetPath;
          await base.writeFile(targetPath, "partial\n", options);
          throw new Error("legacy reset temp exists");
        }

        await base.writeFile(targetPath, content, options);
      }
    };

    await withObjectPrototypeProperties({ code: "EEXIST" }, async () => {
      await expect(loadConfiguredServices({ fs, filePath: configPath })).rejects.toThrow(
        "legacy reset temp exists"
      );
    });

    expect(tempPath).toBeDefined();
    expect(base.getContent(tempPath ?? "")).toBeUndefined();
    await expect(base.readFile(legacyPath, "utf8")).resolves.toBe("not json\n");
  });

  it("cleans a partial invalid legacy credential backup when recovery fails", async () => {
    const legacyPath = `${homeDir}/.poe-code/credentials.json`;
    const base = createMockFs({ "~/.poe-code/credentials.json": "not json\n" }, homeDir);
    let backupPath: string | undefined;
    const fs: FileSystem = {
      ...base,
      async writeFile(targetPath, content, options) {
        if (targetPath.includes(".invalid-")) {
          backupPath = targetPath;
          await base.writeFile(targetPath, "partial backup\n", options);
          throw new Error("legacy backup disk full");
        }
        await base.writeFile(targetPath, content, options);
      }
    };

    await expect(loadConfiguredServices({ fs, filePath: configPath })).rejects.toThrow(
      "legacy backup disk full"
    );

    expect(backupPath).toBeDefined();
    expect(base.getContent(backupPath ?? "")).toBeUndefined();
    await expect(base.readFile(legacyPath, "utf8")).resolves.toBe("not json\n");
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
