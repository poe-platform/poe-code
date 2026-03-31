import { describe, it, expect, vi } from "bun:test";
import { createMockFs } from "@poe-code/config-mutations/testing";
import { createCliContainer } from "../cli/container.js";
import {
  buildProviderContext,
  createExecutionResources
} from "../cli/commands/shared.js";
import { createProviderStub } from "../../tests/provider-stub.js";

const cwd = "/repo";
const homeDir = "/home/test";

describe("buildProviderContext", () => {
  it("skips resolving provider paths", () => {
    const fs = createMockFs({}, homeDir);
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
