import { describe, it, expect, vi } from "vitest";
import { Command } from "commander";
import { Volume, createFsFromVolume } from "memfs";
import { createCliContainer } from "../container.js";
import { registerTestCommand } from "./test.js";
import { createProviderStub } from "../../../tests/provider-stub.js";
import type { FileSystem } from "../../utils/file-system.js";
import type { CommandCheck, CommandCheckContext } from "../../utils/command-checks.js";

vi.mock("toolcraft-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("toolcraft-design")>();
  return {
    ...actual,
    withSpinner: async <T>({ fn }: { fn: () => Promise<T> }) => await fn()
  };
});

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(): FileSystem {
  const vol = new Volume();
  vol.mkdirSync(homeDir, { recursive: true });
  vol.mkdirSync(cwd, { recursive: true });
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

function createBaseProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.name("poe-code").option("-y, --yes").option("--dry-run").option("--verbose");
  return program;
}

/**
 * Records the check context without running a command, so the health check never
 * needs a real agent binary or resolved provider config.
 */
function createRecordingCheck(): { check: CommandCheck; contexts: CommandCheckContext[] } {
  const contexts: CommandCheckContext[] = [];
  return {
    contexts,
    check: {
      id: "demo-health",
      async run(context) {
        contexts.push(context);
      }
    }
  };
}

function createProgramForProvider(
  recording: ReturnType<typeof createRecordingCheck>,
  providerOverrides: Record<string, unknown> = {}
): Command {
  const container = createCliContainer({
    fs: createMemFs(),
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd, homeDir },
    logger: () => {}
  });
  container.registry.register(
    createProviderStub({
      name: "demo-service",
      label: "Demo Service",
      async test(context) {
        await context.runCheck(recording.check);
      },
      ...providerOverrides
    })
  );

  const program = createBaseProgram();
  registerTestCommand(program, container);
  return program;
}

describe("test command verbose wiring", () => {
  it("marks health checks as non-verbose by default", async () => {
    const recording = createRecordingCheck();
    const program = createProgramForProvider(recording);

    await program.parseAsync(["node", "cli", "test", "demo-service"]);

    expect(recording.contexts).toHaveLength(1);
    expect(recording.contexts[0].verbose).toBe(false);
  });

  it("marks health checks as verbose when --verbose is passed", async () => {
    const recording = createRecordingCheck();
    const program = createProgramForProvider(recording);

    await program.parseAsync(["node", "cli", "--verbose", "test", "demo-service"]);

    expect(recording.contexts).toHaveLength(1);
    expect(recording.contexts[0].verbose).toBe(true);
  });

  it("marks health checks as verbose for providers that resolve a runtime env", async () => {
    const recording = createRecordingCheck();
    const program = createProgramForProvider(recording, {
      runtimeEnv: { DEMO_TOKEN: { kind: "envVar", name: "DEMO_TOKEN" } }
    });

    await program.parseAsync(["node", "cli", "--verbose", "test", "demo-service"]);

    expect(recording.contexts).toHaveLength(1);
    expect(recording.contexts[0].verbose).toBe(true);
  });
});
