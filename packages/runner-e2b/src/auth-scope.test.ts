import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "@poe-code/config-mutations";
import { resolveE2bApiKey } from "./auth-scope.js";

const cwd = "/repo";
const homeDir = "/home/test";

function memFs(files: Record<string, string>): FileSystem {
  const volume = Volume.fromJSON(files, "/");
  volume.mkdirSync(cwd, { recursive: true });
  volume.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

describe("resolveE2bApiKey", () => {
  it("reads api_key from global ~/.poe-code/config.json", async () => {
    const fs = memFs({
      "/home/test/.poe-code/config.json": JSON.stringify({ e2b: { api_key: "g_key" } })
    });
    expect(await resolveE2bApiKey({ cwd, homeDir, fs, env: {} })).toBe("g_key");
  });

  it("project .poe-code/config.json overrides global", async () => {
    const fs = memFs({
      "/home/test/.poe-code/config.json": JSON.stringify({ e2b: { api_key: "g_key" } }),
      "/repo/.poe-code/config.json": JSON.stringify({ e2b: { api_key: "p_key" } })
    });
    expect(await resolveE2bApiKey({ cwd, homeDir, fs, env: {} })).toBe("p_key");
  });

  it("E2B_API_KEY env var wins over config files", async () => {
    const fs = memFs({
      "/home/test/.poe-code/config.json": JSON.stringify({ e2b: { api_key: "g_key" } })
    });
    expect(
      await resolveE2bApiKey({ cwd, homeDir, fs, env: { E2B_API_KEY: "env_key" } })
    ).toBe("env_key");
  });

  it("ignores empty E2B_API_KEY env values so project config can resolve", async () => {
    const fs = memFs({
      "/repo/.poe-code/config.json": JSON.stringify({ e2b: { api_key: "p_key" } })
    });

    await expect(resolveE2bApiKey({ cwd, homeDir, fs, env: { E2B_API_KEY: "" } })).resolves.toBe(
      "p_key"
    );
    await expect(
      resolveE2bApiKey({ cwd, homeDir, fs, env: { E2B_API_KEY: "   " } })
    ).resolves.toBe("p_key");
  });

  it("falls back to E2B_API_KEY env var when no config files exist", async () => {
    const fs = memFs({});
    expect(
      await resolveE2bApiKey({ cwd, homeDir, fs, env: { E2B_API_KEY: "env_key" } })
    ).toBe("env_key");
  });

  it("throws when no key is found anywhere", async () => {
    const fs = memFs({});
    await expect(resolveE2bApiKey({ cwd, homeDir, fs, env: {} })).rejects.toThrow(
      "No E2B API key. Set E2B_API_KEY or e2b.api_key in /repo/.poe-code/config.json or ~/.poe-code/config.json."
    );
  });
});
