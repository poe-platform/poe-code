import { describe, it, expect, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createCliContainer } from "../cli/container.js";
import {
  buildProviderContext,
  createExecutionResources
} from "../cli/commands/shared.js";
import { createProviderStub } from "../../tests/provider-stub.js";
import type { FileSystem } from "../utils/file-system.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(): FileSystem {
  const vol = new Volume();
  vol.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

describe("buildProviderContext", () => {
  it("skips resolving provider paths", () => {
    const fs = createMemFs();
    const container = createCliContainer({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      logger: vi.fn()
    });

    const adapter = createProviderStub({
      name: "noop",
      label: "Noop"
    });

    const resources = createExecutionResources(
      container,
      { dryRun: false, assumeYes: true },
      "test-scope"
    );

    const context = buildProviderContext(container, adapter, resources);

    expect("paths" in context).toBe(false);
  });
});
