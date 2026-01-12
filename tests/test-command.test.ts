import { describe, it, expect, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { Command } from "commander";
import { registerTestCommand } from "../src/cli/commands/test.js";
import { createCliContainer } from "../src/cli/container.js";
import type { FileSystem } from "../src/utils/file-system.js";
import { createProviderStub } from "./provider-stub.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(): FileSystem {
  const vol = new Volume();
  vol.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

function createContainer(logs: string[] = []) {
  const fs = createMemFs();
  return createCliContainer({
    fs,
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd, homeDir },
    commandRunner: vi.fn().mockResolvedValue({
      stdout: "STDIN_OK\n",
      stderr: "",
      exitCode: 0
    }),
    logger: (message) => {
      logs.push(message);
    }
  });
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

describe("test command", () => {
  it("runs the provider test routine and logs success", async () => {
    const logs: string[] = [];
    const container = createContainer(logs);
    const testFn = vi.fn();
    const adapter = createProviderStub({
      name: "demo-service",
      label: "Demo Service",
      async test(context) {
        expect(context.logger).toBeDefined();
        testFn();
      }
    });
    container.registry.register(adapter);

    const program = createBaseProgram();
    registerTestCommand(program, container);

    await program.parseAsync(["node", "cli", "test", "demo-service"]);

    expect(testFn).toHaveBeenCalled();
    expect(logs.some((line) => line.includes("Tested Demo Service"))).toBe(true);
  });

  it("fails when the provider does not support the test command", async () => {
    const container = createContainer();
    container.registry.register(
      createProviderStub({
        name: "demo-service",
        label: "Demo Service"
      })
    );

    const program = createBaseProgram();
    registerTestCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "test", "demo-service"])
    ).rejects.toThrow(/does not support test/i);
  });

  it("propagates provider test failures", async () => {
    const container = createContainer();
    container.registry.register(
      createProviderStub({
        name: "demo-service",
        label: "Demo Service",
        async test() {
          throw new Error("health check failed");
        }
      })
    );

    const program = createBaseProgram();
    registerTestCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "test", "demo-service"])
    ).rejects.toThrow(/health check failed/);
  });

  it("runs a stdin spawn test when --stdin is provided", async () => {
    const logs: string[] = [];
    const container = createContainer(logs);
    const runCommand = container.dependencies
      .commandRunner as unknown as ReturnType<typeof vi.fn>;

    container.registry.register(
      createProviderStub({
        name: "demo-service",
        label: "Demo Service",
        supportsStdinPrompt: true,
        async spawn(context, options) {
          expect((options as any).useStdin).toBe(true);
          expect((options as any).prompt).toBe("Output exactly: STDIN_OK");
          return context.command.runCommand("demo", ["-"], {
            stdin: (options as any).prompt
          });
        }
      })
    );

    const program = createBaseProgram();
    registerTestCommand(program, container);

    await program.parseAsync(["node", "cli", "test", "--stdin", "demo-service"]);

    expect(runCommand).toHaveBeenCalledWith("demo", ["-"], {
      stdin: "Output exactly: STDIN_OK"
    });
    expect(logs.some((line) => line.includes("Tested Demo Service"))).toBe(true);
  });

  it("passes --model through when running a stdin spawn test", async () => {
    const container = createContainer();

    container.registry.register(
      createProviderStub({
        name: "demo-service",
        label: "Demo Service",
        supportsStdinPrompt: true,
        async spawn(context, options) {
          expect((options as any).useStdin).toBe(true);
          expect((options as any).model).toBe("demo-model");
          return context.command.runCommand("demo", ["-"], {
            stdin: (options as any).prompt
          });
        }
      })
    );

    const program = createBaseProgram();
    registerTestCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "test",
      "--stdin",
      "--model",
      "demo-model",
      "demo-service"
    ]);
  });

  it("fails when --model is used without --stdin", async () => {
    const container = createContainer();
    container.registry.register(
      createProviderStub({
        name: "demo-service",
        label: "Demo Service",
        async test() {}
      })
    );

    const program = createBaseProgram();
    registerTestCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "test", "--model", "demo-model", "demo-service"])
    ).rejects.toThrow(/--model.*--stdin/i);
  });

  it("fails when --stdin is provided but the provider does not support stdin prompts", async () => {
    const container = createContainer();
    container.registry.register(
      createProviderStub({
        name: "demo-service",
        label: "Demo Service",
        supportsStdinPrompt: false,
        async spawn() {}
      })
    );

    const program = createBaseProgram();
    registerTestCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "test", "--stdin", "demo-service"])
    ).rejects.toThrow(/does not support stdin prompts/i);
  });
});
