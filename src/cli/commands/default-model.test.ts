import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerDefaultModelCommand } from "./default-model.js";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../utils/file-system.js";
import { createHomeFs } from "../../../tests/test-helpers.js";
import { Command } from "commander";
import { loadDefaultModels } from "../../services/config.js";

const cwd = "/repo";
const homeDir = "/home/test";
const configPath = homeDir + "/.poe-code/config.json";

describe("default-model command", () => {
  let fs: FileSystem;

  beforeEach(() => {
    fs = createHomeFs(homeDir);
  });

  function createContainer() {
    const prompts = vi.fn().mockResolvedValue({});
    const container = createCliContainer({
      fs,
      prompts,
      env: { cwd, homeDir },
      logger: () => {},
      commandRunner: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }))
    });
    return { container, prompts };
  }

  function buildProgram(container: ReturnType<typeof createContainer>["container"]) {
    const program = new Command();
    program.exitOverride();
    program
      .name("poe-code")
      .option("-y, --yes")
      .option("--dry-run");
    registerDefaultModelCommand(program, container);
    return program;
  }

  it("saves a global default model via set subcommand", async () => {
    const { container } = createContainer();
    vi.spyOn(container.options, "ensure").mockResolvedValue("anthropic/claude-sonnet-4.6");

    const program = buildProgram(container);
    await program.parseAsync(["node", "poe-code", "default-model", "set"]);

    const defaults = await loadDefaultModels({ fs, filePath: configPath });
    expect(defaults.global).toBe("anthropic/claude-sonnet-4.6");
  });

  it("saves a tool-specific default model when --tool is provided", async () => {
    const { container } = createContainer();
    vi.spyOn(container.options, "ensure").mockResolvedValue("openai/gpt-5.2-codex");

    const program = buildProgram(container);
    await program.parseAsync(["node", "poe-code", "default-model", "set", "--tool", "codex"]);

    const defaults = await loadDefaultModels({ fs, filePath: configPath });
    expect(defaults.codex).toBe("openai/gpt-5.2-codex");
    expect(defaults.global).toBeUndefined();
  });

  it("uses --model flag to skip prompting", async () => {
    const { container } = createContainer();
    const ensureSpy = vi.spyOn(container.options, "ensure");

    const program = buildProgram(container);
    await program.parseAsync([
      "node", "poe-code", "default-model", "set",
      "--tool", "codex",
      "--model", "openai/gpt-5.3-codex"
    ]);

    expect(ensureSpy).toHaveBeenCalledWith(
      expect.objectContaining({ value: "openai/gpt-5.3-codex" })
    );
  });

  it("skips writing during dry run", async () => {
    const { container } = createContainer();
    vi.spyOn(container.options, "ensure").mockResolvedValue("anthropic/claude-sonnet-4.6");

    const program = new Command();
    program.exitOverride();
    program
      .name("poe-code")
      .option("-y, --yes")
      .option("--dry-run");
    registerDefaultModelCommand(program, container);

    await program.parseAsync([
      "node", "poe-code", "--dry-run", "default-model", "set"
    ]);

    // Config file should not exist since dry run skips writes
    await expect(fs.readFile(configPath, "utf8")).rejects.toThrow();
  });
});
