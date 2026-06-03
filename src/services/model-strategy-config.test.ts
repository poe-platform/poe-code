import { afterEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";

async function loadManager(volume: Volume, overrideWrite?: (filePath: string, data: string) => void) {
  const syncFs = createFsFromVolume(volume) as unknown as typeof import("fs");
  vi.resetModules();
  vi.doMock("fs", () => ({
    ...syncFs,
    writeFileSync: overrideWrite ?? syncFs.writeFileSync.bind(syncFs)
  }));
  vi.doMock("os", () => ({ homedir: () => "/home/user" }));
  return (await import("./model-strategy.js")).StrategyConfigManager;
}

afterEach(() => {
  vi.doUnmock("fs");
  vi.doUnmock("os");
  vi.resetModules();
});

describe("StrategyConfigManager", () => {
  it("does not read or write strategy config through a symlinked state directory", async () => {
    const volume = Volume.fromJSON({ "/outside/strategy-config.json": JSON.stringify({ type: "fixed", fixedModel: "gpt-5.4" }) });
    volume.mkdirSync("/home", { recursive: true });
    volume.mkdirSync("/home/user", { recursive: true });
    volume.symlinkSync("/outside", "/home/user/.poe-code");
    const manager = await loadManager(volume);

    expect(() => manager.saveConfig({ type: "fixed", fixedModel: "gpt-5.5" }))
      .toThrow("symbolic link");
    expect(manager.loadConfig()).toBeNull();
    expect(volume.readFileSync("/outside/strategy-config.json", "utf8"))
      .toContain("gpt-5.4");
  });

  it("preserves prior config when replacement persistence fails", async () => {
    const previous = JSON.stringify({ type: "fixed", fixedModel: "gpt-5.4" });
    const volume = Volume.fromJSON({ "/home/user/.poe-code/strategy-config.json": previous });
    const manager = await loadManager(volume, (filePath, data) => {
      volume.writeFileSync(filePath, String(data).slice(0, 1));
      throw new Error("strategy disk full");
    });

    expect(() => manager.saveConfig({ type: "fixed", fixedModel: "gpt-5.5" }))
      .toThrow("strategy disk full");
    expect(manager.loadConfig()).toEqual({ type: "fixed", fixedModel: "gpt-5.4" });
  });

  it("rejects unsupported fixed models loaded from persisted config", async () => {
    const volume = Volume.fromJSON({
      "/home/user/.poe-code/strategy-config.json": JSON.stringify({ type: "fixed", fixedModel: "unknown-model" })
    });
    const manager = await loadManager(volume);

    expect(manager.loadConfig()).toBeNull();
  });

  it("rejects unsupported round-robin models loaded from persisted config", async () => {
    const volume = Volume.fromJSON({
      "/home/user/.poe-code/strategy-config.json": JSON.stringify({ type: "round-robin", customOrder: ["unknown-model"] })
    });
    const manager = await loadManager(volume);

    expect(manager.loadConfig()).toBeNull();
  });
});
