import { describe, it, expect, vi, afterEach } from "vitest";
import { Command } from "commander";
import { Volume, createFsFromVolume } from "memfs";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../utils/file-system.js";
import type { ProviderService } from "../service-registry.js";
import { registerUnconfigureCommand } from "./unconfigure.js";
import { createProviderStub } from "../../../tests/provider-stub.js";
import type {
  MutationLogDetails,
  ServiceMutationOutcome
} from "../services/service-manifest.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(): FileSystem {
  const vol = new Volume();
  vol.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

function createBaseProgram(): Command {
  const program = new Command();
  program
    .name("poe-code")
    .option("-y, --yes")
    .option("--dry-run")
    .option("--verbose")
    .exitOverride();
  return program;
}

describe("unconfigure command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invokes provider unconfigure and reports the result", async () => {
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

    const unconfigureSpy = vi.fn();

    const adapter: ProviderService = createProviderStub({
      name: "test-service",
      label: "Test Service",
      async unconfigure(context) {
        unconfigureSpy(context.options);
        return true;
      }
    });

    container.registry.register(adapter);

    const program = createBaseProgram();
    registerUnconfigureCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "unconfigure",
      "test-service"
    ]);

    expect(unconfigureSpy).toHaveBeenCalledTimes(1);
    expect(
      logs.some((line) =>
        line.includes("Removed Test Service configuration.")
      )
    ).toBe(true);
  });

  it("logs mutation outcomes when provider reports them", async () => {
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

    const details: MutationLogDetails = {
      manifestId: "test-service",
      kind: "transformFile",
      label: "Transform file /home/test/.config/opencode/config.json",
      targetPath: "/home/test/.config/opencode/config.json"
    };
    const outcome: ServiceMutationOutcome = {
      changed: true,
      effect: "delete",
      detail: "delete"
    };

    const adapter: ProviderService = createProviderStub({
      name: "test-service",
      label: "Test Service",
      async unconfigure(_context, runOptions) {
        runOptions?.observers?.onComplete?.(details, outcome);
        return true;
      }
    });

    container.registry.register(adapter);

    const program = createBaseProgram();
    registerUnconfigureCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "--verbose",
      "unconfigure",
      "test-service"
    ]);

    expect(
      logs.some((line) =>
        line.includes(
          "Transform file /home/test/.config/opencode/config.json: delete"
        )
      )
    ).toBe(true);
  });

});
