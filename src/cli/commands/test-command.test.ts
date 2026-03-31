import { describe, it, expect, vi } from "bun:test";
import { Volume, createFsFromVolume } from "memfs";
import { Command } from "commander";
import { registerTestCommand } from "./test.js";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../utils/file-system.js";
import { createProviderStub } from "../../../tests/provider-stub.js";

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

  it("passes --model to provider context", async () => {
    const container = createContainer();
    let receivedModel: string | undefined;
    container.registry.register(
      createProviderStub({
        name: "demo-service",
        label: "Demo Service",
        async test(context) {
          receivedModel = context.model;
        }
      })
    );

    const program = createBaseProgram();
    registerTestCommand(program, container);

    await program.parseAsync(["node", "cli", "test", "demo-service", "--model", "claude-opus-4-6"]);

    expect(receivedModel).toBe("claude-opus-4-6");
  });

  it("model is undefined when --model is not provided", async () => {
    const container = createContainer();
    let receivedModel: string | undefined = "sentinel";
    container.registry.register(
      createProviderStub({
        name: "demo-service",
        label: "Demo Service",
        async test(context) {
          receivedModel = context.model;
        }
      })
    );

    const program = createBaseProgram();
    registerTestCommand(program, container);

    await program.parseAsync(["node", "cli", "test", "demo-service"]);

    expect(receivedModel).toBeUndefined();
  });

});
