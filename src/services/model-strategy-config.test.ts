import { afterEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";

async function loadManager(
  volume: Volume,
  overrideWrite?: (filePath: string, data: string, options?: unknown) => void
) {
  const syncFs = createFsFromVolume(volume) as unknown as typeof import("fs");
  vi.resetModules();
  vi.doMock("fs", () => ({
    ...syncFs,
    writeFileSync: overrideWrite ?? syncFs.writeFileSync.bind(syncFs)
  }));
  vi.doMock("os", () => ({ homedir: () => "/home/user" }));
  return (await import("./model-strategy.js")).StrategyConfigManager;
}

async function withObjectPrototypeCode<T>(code: string, callback: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "code");
  Object.defineProperty(Object.prototype, "code", {
    configurable: true,
    value: code,
    writable: true
  });

  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(Object.prototype, "code", descriptor);
    } else {
      delete (Object.prototype as { code?: unknown }).code;
    }
  }
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

    expect(() => manager.saveConfig({ type: "fixed", fixedModel: "gpt-5.4-pro" }))
      .toThrow("symbolic link");
    expect(manager.loadConfig()).toBeNull();
    expect(volume.readFileSync("/outside/strategy-config.json", "utf8"))
      .toContain("gpt-5.4");
  });

  it("preserves prior config when replacement persistence fails", async () => {
    const previous = JSON.stringify({ type: "fixed", fixedModel: "gpt-5.4" });
    const volume = Volume.fromJSON({ "/home/user/.poe-code/strategy-config.json": previous });
    let temporaryPath: string | undefined;
    const manager = await loadManager(volume, (filePath, data, options) => {
      if (filePath.includes("strategy-config.json.") && filePath.endsWith(".tmp")) {
        temporaryPath = filePath;
      }

      volume.writeFileSync(filePath, String(data).slice(0, 1), options as never);
      throw new Error("strategy disk full");
    });

    await withObjectPrototypeCode("EEXIST", async () => {
      expect(() => manager.saveConfig({ type: "fixed", fixedModel: "gpt-5.4-pro" }))
        .toThrow("strategy disk full");
    });
    expect(manager.loadConfig()).toEqual({ type: "fixed", fixedModel: "gpt-5.4" });
    expect(temporaryPath).toBeDefined();
    expect(() => volume.readFileSync(temporaryPath as string, "utf8"))
      .toThrow(/ENOENT/);
  });

  it("does not remove a colliding strategy config temp symlink", async () => {
    const previous = JSON.stringify({ type: "fixed", fixedModel: "gpt-5.4" });
    const volume = Volume.fromJSON({
      "/home/user/.poe-code/strategy-config.json": previous,
      "/outside.tmp": "outside-state\n"
    });
    let temporaryPath: string | undefined;
    const manager = await loadManager(volume, (filePath, data, options) => {
      if (
        temporaryPath === undefined &&
        filePath.includes("strategy-config.json.") &&
        filePath.endsWith(".tmp")
      ) {
        temporaryPath = filePath;
        volume.symlinkSync("/outside.tmp", filePath);
        expect(options).toEqual({ flag: "wx" });
      }

      volume.writeFileSync(filePath, String(data), options as never);
    });

    expect(() => manager.saveConfig({ type: "fixed", fixedModel: "gpt-5.4-pro" }))
      .toThrow();

    expect(temporaryPath).toBeDefined();
    expect(volume.readFileSync("/outside.tmp", "utf8")).toBe("outside-state\n");
    expect(volume.lstatSync(temporaryPath as string).isSymbolicLink()).toBe(true);
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
