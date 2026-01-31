import { describe, it, expect, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { Command } from "commander";
import { registerInstallCommand } from "./install.js";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../utils/file-system.js";
import type { ProviderService } from "../service-registry.js";
import { createProviderStub } from "../../../tests/provider-stub.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(): FileSystem {
  const vol = new Volume();
  vol.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

function createBaseProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program
    .name("poe-code")
    .option("-y, --yes")
    .option("--dry-run");
  return program;
}

describe("install command", () => {
  it("installs a registered provider", async () => {
    const fs = createMemFs();
    const logs: string[] = [];
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      }
    });

    const callOrder: string[] = [];
    const adapter: ProviderService = createProviderStub({
      name: "test-service",
      label: "Test Service",
      async install() {
        callOrder.push("install");
      }
    });

    container.registry.register(adapter);

    const program = createBaseProgram();
    registerInstallCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "install",
      "test-service"
    ]);

    expect(callOrder).toEqual(["install"]);
    expect(logs.some((line) => line.includes("Installed Test Service"))).toBe(
      true
    );
  });
});
