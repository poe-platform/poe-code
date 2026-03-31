import { describe, it, expect } from "bun:test";
import { createMockFs } from "@poe-code/config-mutations/testing";
import { createCliContainer } from "../cli/container.js";

const cwd = "/repo";
const homeDir = "/home/test";

describe("provider filtering", () => {
  it("omits disabled providers from the registry list", () => {
    const container = createCliContainer({
      fs: createMockFs({}, homeDir),
      prompts: async () => ({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const names = container.registry.list().map((adapter) => adapter.name);
    expect(names).not.toContain("roo-code");
  });
});
