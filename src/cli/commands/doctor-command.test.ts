import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";
import type { CommandRunner } from "../../utils/command-checks.js";
import { createHomeFs, createTestProgram } from "../../../tests/test-helpers.js";
import type { LoggerFn } from "../types.js";
import { executeDoctor } from "./doctor.js";

const cwd = "/repo";
const homeDir = "/home/test";
const configPath = homeDir + "/.poe-code/config.json";

describe("doctor command", () => {
  let fs: FileSystem;

  beforeEach(() => {
    fs = createHomeFs(homeDir);
  });

  function createContainer(
    overrides: {
      commandRunner?: CommandRunner;
      logger?: LoggerFn;
    } = {}
  ) {
    const prompts = vi.fn().mockResolvedValue({});
    const commandRunner: CommandRunner =
      overrides.commandRunner ??
      vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const logger = overrides.logger ?? (() => {});
    const httpClient = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ current_point_balance: 1000 })
    }));
    const container = createCliContainer({
      fs,
      prompts,
      env: { cwd, homeDir },
      logger,
      commandRunner,
      httpClient
    });
    return { container, prompts, commandRunner, httpClient };
  }

  it("runs system and auth checks on empty config", async () => {
    const messages: string[] = [];
    const { container } = createContainer({
      logger: (msg) => messages.push(msg)
    });
    vi.spyOn(container, "readApiKey").mockResolvedValue("sk-test");

    const program = createTestProgram();
    await executeDoctor(program, container, undefined, {});

    expect(messages.some((m) => m.includes("home-dir"))).toBe(false);
    // Should have intro
    expect(messages[0]).toBe("doctor");
  });

  it("reports pass when all system checks pass", async () => {
    const messages: string[] = [];
    await fs.mkdir(homeDir + "/.poe-code", { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({ apiKey: "sk-test" }));
    const { container } = createContainer({
      logger: (msg) => messages.push(msg)
    });
    vi.spyOn(container, "readApiKey").mockResolvedValue("sk-test");

    const program = createTestProgram();
    await executeDoctor(program, container, undefined, {});

    // Should have summary
    const summaryLine = messages.find((m) => m.includes("pass"));
    expect(summaryLine).toBeDefined();
  });

  it("runs agent-specific checks when agent argument is provided", async () => {
    const messages: string[] = [];
    await fs.mkdir(homeDir + "/.poe-code", { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({
        apiKey: "sk-test",
        configured_services: {
          codex: { files: ["~/.codex/config.toml"] }
        }
      })
    );
    const commandRunner = vi.fn(async (command: string) => {
      if (command === "which") {
        return { stdout: "/usr/local/bin/codex\n", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const { container } = createContainer({
      commandRunner,
      logger: (msg) => messages.push(msg)
    });
    vi.spyOn(container, "readApiKey").mockResolvedValue("sk-test");

    const program = createTestProgram();
    await executeDoctor(program, container, "codex", {});

    // Should include codex-specific checks
    const hasCodexCheck = messages.some(
      (m) => m.includes("codex")
    );
    expect(hasCodexCheck).toBe(true);
  });

  it("exits with failure summary when checks fail", async () => {
    const messages: string[] = [];
    // No .poe-code dir => system.home-dir fails
    const { container } = createContainer({
      logger: (msg) => messages.push(msg)
    });
    vi.spyOn(container, "readApiKey").mockResolvedValue(null);

    const program = createTestProgram();
    const result = await executeDoctor(program, container, undefined, {});

    expect(result.summary.fail).toBeGreaterThan(0);
  });

  it("respects dry-run mode", async () => {
    const messages: string[] = [];
    await fs.mkdir(homeDir + "/.poe-code", { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({ apiKey: "sk-test" }));
    const { container, httpClient } = createContainer({
      logger: (msg) => messages.push(msg)
    });
    vi.spyOn(container, "readApiKey").mockResolvedValue("sk-test");

    const program = createTestProgram(["node", "cli", "--dry-run"]);
    await executeDoctor(program, container, undefined, {});

    // HTTP client should not be called in dry-run
    expect(httpClient).not.toHaveBeenCalled();
  });
});
