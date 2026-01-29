import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";

// Mock node:fs/promises and node:os before importing the module
const homeDir = "/home/test";

vi.mock("node:fs/promises", async () => {
  const vol = new Volume();
  const memfs = createFsFromVolume(vol);
  return {
    ...memfs.promises,
    default: memfs.promises
  };
});

vi.mock("node:os", () => ({
  homedir: () => homeDir
}));

describe("getPoeApiKey", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    delete process.env.POE_API_KEY;

    // Reset the mocked fs module
    vi.resetModules();

    // Clear the volume
    const vol = new Volume();
    vi.doMock("node:fs/promises", () => {
      const memfs = createFsFromVolume(vol);
      return {
        ...memfs.promises,
        default: memfs.promises
      };
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("returns POE_API_KEY from environment variable when set", async () => {
    process.env.POE_API_KEY = "env-api-key-123";
    
    // Re-import to get fresh module
    vi.resetModules();
    const { getPoeApiKey } = await import("../src/sdk/credentials.js");
    
    const result = await getPoeApiKey();
    expect(result).toBe("env-api-key-123");
  });

  it("trims whitespace from environment variable", async () => {
    process.env.POE_API_KEY = "  trimmed-key  ";
    
    vi.resetModules();
    const { getPoeApiKey } = await import("../src/sdk/credentials.js");
    
    const result = await getPoeApiKey();
    expect(result).toBe("trimmed-key");
  });

  it("throws error when no credentials found", async () => {
    delete process.env.POE_API_KEY;
    
    vi.resetModules();
    const { getPoeApiKey } = await import("../src/sdk/credentials.js");
    
    await expect(getPoeApiKey()).rejects.toThrow(
      "No API key found. Set POE_API_KEY or run 'poe-code login'."
    );
  });

  it("ignores empty environment variable", async () => {
    process.env.POE_API_KEY = "";
    
    vi.resetModules();
    const { getPoeApiKey } = await import("../src/sdk/credentials.js");
    
    await expect(getPoeApiKey()).rejects.toThrow(
      "No API key found. Set POE_API_KEY or run 'poe-code login'."
    );
  });

  it("ignores whitespace-only environment variable", async () => {
    process.env.POE_API_KEY = "   ";
    
    vi.resetModules();
    const { getPoeApiKey } = await import("../src/sdk/credentials.js");
    
    await expect(getPoeApiKey()).rejects.toThrow(
      "No API key found. Set POE_API_KEY or run 'poe-code login'."
    );
  });
});
