import { describe, it, expect, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createCliContainer } from "./container.js";
import { ProviderRegistry } from "@poe-code/providers";
import type { FileSystem } from "../utils/file-system.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createMemfs(): FileSystem {
  const volume = new Volume();
  volume.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

describe("createCliContainer", () => {
  it("exposes a ProviderRegistry instance", () => {
    const container = createCliContainer({
      fs: createMemfs(),
      prompts: vi.fn(),
      env: { cwd, homeDir }
    });
    expect(container.providerRegistry).toBeInstanceOf(ProviderRegistry);
  });

  it("registers Poe and Anthropic auth providers", () => {
    const container = createCliContainer({
      fs: createMemfs(),
      prompts: vi.fn(),
      env: { cwd, homeDir }
    });

    expect(container.providerRegistry.list().map((provider) => provider.id)).toEqual([
      "poe",
      "anthropic"
    ]);
  });
});
