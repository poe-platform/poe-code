import { describe, it, expect, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { Command } from "commander";
import { registerTestCommand } from "./test.js";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../utils/file-system.js";
import { createProviderStub } from "../../../tests/provider-stub.js";
import { createCommandExpectationCheck } from "../../utils/command-checks.js";

const cwd = "/repo";
const homeDir = "/home/test";
const credentialsPath = `${homeDir}/.poe-code/credentials.json`;

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

describe("test command (isolated)", () => {
  it("runs checks with isolated env variables", async () => {
    const fs = createMemFs();
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(credentialsPath, JSON.stringify({ apiKey: "sk-test" }), {
      encoding: "utf8"
    });

    const commandRunner = vi.fn(async (_command, _args, options) => {
      expect(options?.env?.DEMO_HOME).toBe(`${homeDir}/.poe-code/demo-service`);
      return { stdout: "OK\n", stderr: "", exitCode: 0 };
    });

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {},
      commandRunner
    });

    container.registry.register(
      createProviderStub({
        name: "demo-service",
        label: "Demo Service",
        isolatedEnv: {
          agentBinary: "demo",
          configProbe: { kind: "isolatedFile", relativePath: "probe.txt" },
          env: { DEMO_HOME: { kind: "isolatedDir" } }
        },
        async configure(context) {
          const mapped =
            context.pathMapper?.mapTargetDirectory({ targetDirectory: "~/.demo" }) ??
            `${homeDir}/.poe-code/demo-service`;
          await context.fs.mkdir(mapped, { recursive: true });
          await context.fs.writeFile(`${mapped}/probe.txt`, "ok", {
            encoding: "utf8"
          });
        },
        async test(context) {
          await context.runCheck(
            createCommandExpectationCheck({
              id: "demo-check",
              command: "demo",
              args: ["--version"],
              expectedOutput: "OK"
            })
          );
        }
      })
    );

    const program = createBaseProgram();
    registerTestCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "test",
      "demo-service",
      "--isolated"
    ]);
  });
});
