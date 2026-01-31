import { describe, it, expect } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createCliContainer } from "../cli/container.js";
import type { FileSystem } from "../utils/file-system.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(): FileSystem {
  const vol = new Volume();
  vol.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

describe("provider filtering", () => {
  it("omits disabled providers from the registry list", () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: async () => ({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const names = container.registry.list().map((adapter) => adapter.name);
    expect(names).not.toContain("roo-code");
  });
});
