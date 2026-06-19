import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { AgentStashContext, AgentStashFileSystem } from "./types.js";
import { addProfile, loadConfig, parseGistRef, readBaselineManifest, recordProfilePush, removeProfile, renameProfile, resolveProfileGist, saveConfig, writeBaselineManifest } from "./profile-store.js";

function createContext(files: Record<string, string> = {}): {
  ctx: AgentStashContext;
  volume: Volume;
} {
  const volume = Volume.fromJSON(files, "/");
  return {
    volume,
    ctx: {
      cwd: "/repo",
      homeDir: "/home/user",
      fs: createFsFromVolume(volume).promises as unknown as AgentStashFileSystem
    }
  };
}

function ctx(files: Record<string, string> = {}): AgentStashContext {
  return createContext(files).ctx;
}

describe("profile store", () => {
  it("extracts ids from Gist URLs", () => {
    expect(parseGistRef("https://gist.github.com/kjopek/abc123")).toEqual({
      gistId: "abc123",
      gistUrl: "https://gist.github.com/abc123"
    });
  });

  it("rejects non-Gist URLs instead of treating their path as a Gist id", () => {
    expect(() => parseGistRef("https://example.com/not-a-gist")).toThrow(/Gist URL/);
  });

  it("rejects Gist URLs with extra path segments instead of guessing the id", () => {
    expect(() => parseGistRef("https://gist.github.com/kjopek/abc123/revisions")).toThrow("Unable to extract Gist id from https://gist.github.com/kjopek/abc123/revisions");
  });

  it("rejects raw Gist ids that are not safe URL path segments", () => {
    expect(() => parseGistRef("../user")).toThrow("Invalid Gist id: ../user");
    expect(() => parseGistRef("bad id")).toThrow("Invalid Gist id: bad id");
  });

  it("adds, renames, and removes profiles", async () => {
    const context = ctx();
    await addProfile(context, "default", "gist-1");
    await renameProfile(context, "default", "work");
    expect(await loadConfig(context)).toEqual({ profiles: { work: { gistId: "gist-1" } } });
    await removeProfile(context, "work");
    expect(await loadConfig(context)).toEqual({ profiles: {} });
  });

  it("removes profiles when the filesystem has no rm and no baseline cache", async () => {
    const context = ctx();
    context.fs.rm = undefined;
    await addProfile(context, "default", "gist-1");

    await removeProfile(context, "default");

    expect(await loadConfig(context)).toEqual({ profiles: {} });
  });

  it("rejects malformed profile config JSON with a stable error", async () => {
    const context = ctx({
      "/home/user/.agent-stash/config.json": "{"
    });

    await expect(loadConfig(context)).rejects.toThrow("Malformed agent stash config.");
  });

  it("rejects directory baseline paths before removing profile config", async () => {
    const config = { profiles: { default: { gistId: "gist-1" } } };
    const { ctx: context, volume } = createContext({
      "/home/user/.agent-stash/config.json": JSON.stringify(config, null, 2)
    });
    context.fs.rm = undefined;
    volume.mkdirSync("/home/user/.agent-stash/cache/default.manifest.json", { recursive: true });

    await expect(removeProfile(context, "default")).rejects.toThrow(
      "Agent stash file path is a directory: /home/user/.agent-stash/cache/default.manifest.json"
    );

    expect(await loadConfig(context)).toEqual(config);
    expect(volume.statSync("/home/user/.agent-stash/cache/default.manifest.json").isDirectory()).toBe(true);
  });

  it("refuses to overwrite an existing profile", async () => {
    const context = ctx();
    await addProfile(context, "default", "gist-1");
    await expect(addProfile(context, "default", "gist-2")).rejects.toThrow(/already exists/);
    expect(await loadConfig(context)).toEqual({ profiles: { default: { gistId: "gist-1" } } });
  });

  it("rejects malformed baseline manifests before renaming profile config", async () => {
    const config = { profiles: { default: { gistId: "gist-1" } } };
    const context = ctx({
      "/home/user/.agent-stash/config.json": JSON.stringify(config, null, 2),
      "/home/user/.agent-stash/cache/default.manifest.json": "{"
    });

    await expect(renameProfile(context, "default", "work")).rejects.toThrow();

    expect(await loadConfig(context)).toEqual(config);
    await expect(readBaselineManifest(context, "work")).resolves.toBeNull();
  });

  it("rejects unsafe renamed baseline targets before renaming profile config", async () => {
    const config = { profiles: { default: { gistId: "gist-1" } } };
    const { ctx: context, volume } = createContext({
      "/home/user/.agent-stash/config.json": JSON.stringify(config, null, 2),
      "/home/user/.agent-stash/cache/default.manifest.json": JSON.stringify({
        schemaVersion: 1,
        createdAt: "2026-01-02T03:04:05.000Z",
        updatedAt: "2026-01-02T03:04:05.000Z",
        items: []
      }, null, 2)
    });
    volume.mkdirSync("/home/user/.agent-stash/cache/work.manifest.json", { recursive: true });

    await expect(renameProfile(context, "default", "work")).rejects.toThrow(
      "Agent stash file path is a directory: /home/user/.agent-stash/cache/work.manifest.json"
    );

    expect(await loadConfig(context)).toEqual(config);
    expect(volume.statSync("/home/user/.agent-stash/cache/work.manifest.json").isDirectory()).toBe(true);
  });

  it("rejects stored profile Gist ids that are not safe URL path segments", async () => {
    const context = ctx({
      "/home/user/.agent-stash/config.json": JSON.stringify({ profiles: { default: { gistId: "../user" } } }, null, 2)
    });

    await expect(resolveProfileGist(context, "default")).rejects.toThrow("Invalid Gist id: ../user");
  });

  it("rejects stored profile Gist URLs that do not point at the stored Gist id", async () => {
    const context = ctx({
      "/home/user/.agent-stash/config.json": JSON.stringify({
        profiles: {
          default: { gistId: "gist-1", gistUrl: "https://example.com/gist-1" },
          mismatched: { gistId: "gist-1", gistUrl: "https://gist.github.com/gist-2" }
        }
      }, null, 2)
    });

    await expect(loadConfig(context)).rejects.toThrow("Gist URL must use gist.github.com: https://example.com/gist-1");
  });

  it("rejects profile updates with unsafe Gist ids before saving config", async () => {
    const context = ctx({
      "/home/user/.agent-stash/config.json": JSON.stringify({ profiles: { default: { gistId: "gist-1" } } }, null, 2)
    });

    await expect(recordProfilePush(context, "default", "../poison", "https://gist.github.com/poison", "2026-01-02T03:04:05.000Z")).rejects.toThrow("Invalid Gist id: ../poison");
    expect(await loadConfig(context)).toEqual({ profiles: { default: { gistId: "gist-1" } } });
  });

  it("rejects profile updates with mismatched Gist URLs before saving config", async () => {
    const context = ctx({
      "/home/user/.agent-stash/config.json": JSON.stringify({ profiles: { default: { gistId: "gist-1" } } }, null, 2)
    });

    await expect(recordProfilePush(context, "default", "gist-1", "https://gist.github.com/gist-2", "2026-01-02T03:04:05.000Z")).rejects.toThrow(
      "Profile default Gist URL id mismatch: https://gist.github.com/gist-2"
    );
    expect(await loadConfig(context)).toEqual({ profiles: { default: { gistId: "gist-1" } } });
  });

  it("rejects stored profile timestamps that are not exact ISO timestamps", async () => {
    const context = ctx({
      "/home/user/.agent-stash/config.json": JSON.stringify({
        profiles: {
          default: { gistId: "gist-1", lastPulledAt: "not-a-date" }
        }
      }, null, 2)
    });

    await expect(loadConfig(context)).rejects.toThrow("Invalid profile lastPulledAt: default");
  });

  it("rejects profile update timestamps before saving config", async () => {
    const context = ctx({
      "/home/user/.agent-stash/config.json": JSON.stringify({ profiles: { default: { gistId: "gist-1" } } }, null, 2)
    });

    await expect(recordProfilePush(context, "default", "gist-1", "https://gist.github.com/gist-1", "not-a-date")).rejects.toThrow(
      "Invalid profile lastPushedAt: default"
    );
    expect(await loadConfig(context)).toEqual({ profiles: { default: { gistId: "gist-1" } } });
  });

  it("rejects unsafe profile config writes before saving", async () => {
    const context = ctx({
      "/home/user/.agent-stash/config.json": JSON.stringify({ profiles: { default: { gistId: "gist-1" } } }, null, 2)
    });

    await expect(saveConfig(context, { profiles: { "../escape": { gistId: "gist-2" } } })).rejects.toThrow("Invalid profile name: ../escape");
    expect(await loadConfig(context)).toEqual({ profiles: { default: { gistId: "gist-1" } } });
  });

  it("refuses to save profile config through a symbolic link", async () => {
    const { ctx: context, volume } = createContext({
      "/outside/config.json": JSON.stringify({ profiles: {} }, null, 2)
    });
    volume.mkdirSync("/home/user/.agent-stash", { recursive: true });
    volume.symlinkSync("/outside/config.json", "/home/user/.agent-stash/config.json");

    await expect(saveConfig(context, { profiles: { default: { gistId: "gist-1" } } })).rejects.toThrow(
      "Refusing to write through symbolic link: /home/user/.agent-stash/config.json"
    );
    expect(JSON.parse(volume.readFileSync("/outside/config.json", "utf8") as string)).toEqual({ profiles: {} });
  });

  it("refuses to load profile config through a symbolic link", async () => {
    const { ctx: context, volume } = createContext({
      "/outside/config.json": JSON.stringify({ profiles: { default: { gistId: "gist-1" } } }, null, 2)
    });
    volume.mkdirSync("/home/user/.agent-stash", { recursive: true });
    volume.symlinkSync("/outside/config.json", "/home/user/.agent-stash/config.json");

    await expect(loadConfig(context)).rejects.toThrow(
      "Refusing to write through symbolic link: /home/user/.agent-stash/config.json"
    );
  });

  it("refuses to save baseline manifests through symbolic link ancestors", async () => {
    const { ctx: context, volume } = createContext({
      "/outside/sentinel.txt": "keep\n"
    });
    volume.mkdirSync("/home/user/.agent-stash", { recursive: true });
    volume.mkdirSync("/outside/cache", { recursive: true });
    volume.symlinkSync("/outside/cache", "/home/user/.agent-stash/cache");

    await expect(writeBaselineManifest(context, "default", {
      schemaVersion: 1,
      createdAt: "2026-01-02T03:04:05.000Z",
      updatedAt: "2026-01-02T03:04:05.000Z",
      items: []
    })).rejects.toThrow("Refusing to write through symbolic link: /home/user/.agent-stash/cache");
    expect(volume.readFileSync("/outside/sentinel.txt", "utf8")).toBe("keep\n");
    expect(() => volume.statSync("/outside/cache/default.manifest.json")).toThrow();
  });

  it("refuses to read baseline manifests through symbolic link ancestors", async () => {
    const { ctx: context, volume } = createContext({
      "/outside/cache/default.manifest.json": JSON.stringify({
        schemaVersion: 1,
        createdAt: "2026-01-02T03:04:05.000Z",
        updatedAt: "2026-01-02T03:04:05.000Z",
        items: []
      }, null, 2)
    });
    volume.mkdirSync("/home/user/.agent-stash", { recursive: true });
    volume.mkdirSync("/outside/cache", { recursive: true });
    volume.symlinkSync("/outside/cache", "/home/user/.agent-stash/cache");

    await expect(readBaselineManifest(context, "default")).rejects.toThrow(
      "Refusing to write through symbolic link: /home/user/.agent-stash/cache"
    );
  });

  it("refuses to remove baseline manifests through symbolic link ancestors", async () => {
    const config = {
      profiles: {
        default: { gistId: "gist-1" }
      }
    };
    const { ctx: context, volume } = createContext({
      "/home/user/.agent-stash/config.json": JSON.stringify(config, null, 2),
      "/outside/cache/default.manifest.json": JSON.stringify({
        schemaVersion: 1,
        createdAt: "2026-01-02T03:04:05.000Z",
        updatedAt: "2026-01-02T03:04:05.000Z",
        items: []
      }, null, 2)
    });
    volume.mkdirSync("/home/user/.agent-stash", { recursive: true });
    volume.mkdirSync("/outside/cache", { recursive: true });
    volume.symlinkSync("/outside/cache", "/home/user/.agent-stash/cache");

    await expect(removeProfile(context, "default")).rejects.toThrow(
      "Refusing to write through symbolic link: /home/user/.agent-stash/cache"
    );
    expect(JSON.parse(volume.readFileSync("/home/user/.agent-stash/config.json", "utf8") as string)).toEqual(config);
    expect(volume.readFileSync("/outside/cache/default.manifest.json", "utf8")).toContain("\"schemaVersion\": 1");
  });

  it("rejects stored profile names that would escape profile storage paths", async () => {
    const context = ctx({
      "/home/user/.agent-stash/config.json": JSON.stringify({ profiles: { "../escape": { gistId: "gist-1" } } }, null, 2)
    });

    await expect(loadConfig(context)).rejects.toThrow("Invalid profile name: ../escape");
  });

  it("rejects profile names that would escape profile storage paths", async () => {
    const context = ctx();

    await expect(addProfile(context, "../escape", "gist-1")).rejects.toThrow(/Invalid profile name/);
    await addProfile(context, "default", "gist-1");
    await expect(renameProfile(context, "default", "../escape")).rejects.toThrow(/Invalid profile name/);
    await expect(readBaselineManifest(context, "../escape")).rejects.toThrow(/Invalid profile name/);
    await expect(writeBaselineManifest(context, "../escape", {
      schemaVersion: 1,
      createdAt: "2026-01-02T03:04:05.000Z",
      updatedAt: "2026-01-02T03:04:05.000Z",
      items: []
    })).rejects.toThrow(/Invalid profile name/);
  });
});
