import path from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { resolveConfigPath, resolveProjectConfigPath } from "@poe-code/poe-code-config/core";
import { createPoeAgentProgram, normalizePoeAgentArgv } from "./poe-agent-main.js";

vi.mock("@poe-code/agent-spawn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-spawn")>();
  return {
    ...actual,
    renderAcpStream: vi.fn(async (events: AsyncIterable<unknown>) => {
      for await (const ignoredEvent of events) {
        // Drain the event stream so failures propagate through the awaited run promise only.
        void ignoredEvent;
      }
    })
  };
});

vi.mock("toolcraft-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("toolcraft-design")>();
  return {
    ...actual,
    log: {
      info: vi.fn(),
      error: vi.fn(),
      message: vi.fn()
    }
  };
});

const cwd = "/repo";
const homeDir = "/home/test";
type PoeAgentProgramOptions = NonNullable<Parameters<typeof createPoeAgentProgram>[0]>;

async function runProgram(
  args: string[],
  config?: Record<string, unknown>
): Promise<void> {
  const volume = new Volume();
  volume.mkdirSync(cwd, { recursive: true });
  volume.mkdirSync(homeDir, { recursive: true });

  const configPath = resolveConfigPath(homeDir);
  const projectConfigPath = resolveProjectConfigPath(cwd);
  volume.mkdirSync(path.dirname(configPath), { recursive: true });
  volume.mkdirSync(path.dirname(projectConfigPath), { recursive: true });

  if (config) {
    volume.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8"
    });
  }

  const fs = createFsFromVolume(volume).promises;
  const program = createPoeAgentProgram({
    cwd,
    homeDir,
    fs: fs as PoeAgentProgramOptions["fs"]
  });

  program.exitOverride();
  await program.parseAsync(normalizePoeAgentArgv(["node", "poe-agent", ...args]));
}

describe("poe-agent CLI integration", () => {
  it("surfaces ProviderResolutionError details for an unknown --model", async () => {
    await expect(
      runProgram(["--model", "nonexistent-model", "Test prompt"], {
        agent: {
          plugins: [{ name: "openai-responses" }]
        }
      })
    ).rejects.toThrow(
      'No provider supports model "nonexistent-model". Registered providers: openai-responses.'
    );
  });

  it("uses an explicit model even when obsolete model config exists", async () => {
    await expect(
      runProgram(["--model", "nonexistent-model", "Test prompt"], {
        agent: {
          model: "gpt-5.4",
          plugins: [{ name: "openai-responses" }]
        }
      })
    ).rejects.toThrow(
      'No provider supports model "nonexistent-model". Registered providers: openai-responses.'
    );
  });

  it("supports the run subcommand with --prompt for unknown --model errors", async () => {
    await expect(
      runProgram(["run", "--model", "nonexistent-model", "--prompt", "Test prompt"], {
        agent: {
          plugins: [{ name: "openai-responses" }]
        }
      })
    ).rejects.toThrow(
      'No provider supports model "nonexistent-model". Registered providers: openai-responses.'
    );
  });

  it("requires --model in --yes mode", async () => {
    await expect(runProgram(["--yes", "Test prompt"])).rejects.toThrow(
      "Error: --model is required in non-interactive mode (--yes)."
    );
  });
});
