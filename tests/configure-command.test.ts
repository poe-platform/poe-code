import { describe, it, expect, vi, beforeEach } from "vitest";
import chalk from "chalk";
import { executeConfigure } from "../src/cli/commands/configure.js";
import { createCliContainer } from "../src/cli/container.js";
import type { FileSystem } from "../src/utils/file-system.js";
import type { CommandRunner } from "../src/utils/command-checks.js";
import { createHomeFs, createTestProgram } from "./test-helpers.js";
import type { LoggerFn } from "../src/cli/types.js";

const cwd = "/repo";
const homeDir = "/home/test";
const credentialsPath = homeDir + "/.poe-code/credentials.json";

describe("configure command", () => {
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
      vi.fn(async (command, args) => {
        if (command === "codex" && args.includes("exec")) {
          return { stdout: "CODEX_OK\n", stderr: "", exitCode: 0 };
        }
        if (command === "opencode" && args.includes("run")) {
          return { stdout: "OPEN_CODE_OK\n", stderr: "", exitCode: 0 };
        }
        if (command === "claude" && args[0] === "-p") {
          return { stdout: "CLAUDE_CODE_OK\n", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      });
    const logger = overrides.logger ?? (() => {});
    const container = createCliContainer({
      fs,
      prompts,
      env: { cwd, homeDir },
      logger,
      commandRunner
    });
    return { container, prompts, commandRunner };
  }

  it("does not invoke install when configuring a service", async () => {
    const { container } = createContainer();

    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    vi.spyOn(container.options, "resolveModel").mockResolvedValue(
      "test-model"
    );
    vi.spyOn(container.options, "resolveReasoning").mockResolvedValue("none");

    const invokeSpy = vi.spyOn(container.registry, "invoke");
    const program = createTestProgram();

    await executeConfigure(program, container, "codex", {});

    expect(invokeSpy).toHaveBeenCalledTimes(1);
    const [, operation] = invokeSpy.mock.calls[0]!;
    expect(operation).toBe("configure");
  });

  it("stores configured service metadata", async () => {
    const { container } = createContainer();
    await fs.mkdir(`${homeDir}/.poe-code/opencode/.config/opencode`, {
      recursive: true
    });
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-opencode");
    vi.spyOn(container.options, "resolveModel").mockImplementation(
      async ({ defaultValue }) => defaultValue
    );

    const program = createTestProgram();
    await executeConfigure(program, container, "opencode", {});

    const content = JSON.parse(await fs.readFile(credentialsPath, "utf8"));
    expect(content.configured_services.opencode).toEqual({
      files: [
        homeDir + "/.config/opencode/config.json",
        homeDir + "/.local/share/opencode/auth.json"
      ]
    });
  });

  it("skips metadata persistence during dry run", async () => {
    const { container } = createContainer();
    await fs.mkdir(`${homeDir}/.poe-code/opencode/.config/opencode`, {
      recursive: true
    });
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-opencode");
    vi.spyOn(container.options, "resolveModel").mockImplementation(
      async ({ defaultValue }) => defaultValue
    );

    const program = createTestProgram(["node", "cli", "--dry-run"]);
    await executeConfigure(program, container, "opencode", {});

    await expect(fs.readFile(credentialsPath, "utf8")).rejects.toThrow();
  });

  it("uses provider-defined prompt metadata for configure flows", async () => {
    const { container } = createContainer();
    const provider = container.registry.require("codex") as any;
    provider.configurePrompts = {
      model: {
        label: "Custom Codex model",
        defaultValue: "custom-model",
        choices: [{ title: "Custom", value: "custom-model" }]
      },
      reasoningEffort: {
        label: "Custom reasoning label",
        defaultValue: "extra"
      }
    };

    const resolveModel = vi
      .spyOn(container.options, "resolveModel")
      .mockImplementation(async (input) => {
        expect(input.label).toBe("Custom Codex model");
        expect(input.defaultValue).toBe("custom-model");
        return input.defaultValue;
      });
    const resolveReasoning = vi
      .spyOn(container.options, "resolveReasoning")
      .mockImplementation(async (input) => {
        expect(input.label).toBe("Custom reasoning label");
        expect(input.defaultValue).toBe("extra");
        return input.defaultValue;
      });
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");

    const program = createTestProgram();
    await executeConfigure(program, container, "codex", {});

    expect(resolveModel).toHaveBeenCalled();
    expect(resolveReasoning).toHaveBeenCalled();
  });

  it("resolves the model when configuring kimi", async () => {
    const { container } = createContainer();
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-kimi");
    const resolvedModel = "Kimi-Custom";
    const resolveModel = vi
      .spyOn(container.options, "resolveModel")
      .mockResolvedValue(resolvedModel);

    const program = createTestProgram();
    await executeConfigure(program, container, "kimi", {});

    expect(resolveModel).toHaveBeenCalled();
  });

  it("accepts --model option to set a model without prompting", async () => {
    const { container } = createContainer();
    const customModel = "Custom-Model";

    const resolveModel = vi.spyOn(container.options, "resolveModel");
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");

    const program = createTestProgram();
    await executeConfigure(program, container, "opencode", {
      model: customModel
    });

    expect(resolveModel).toHaveBeenCalledWith(
      expect.objectContaining({
        value: customModel
      })
    );

    const configPath = homeDir + "/.config/opencode/config.json";
    const settings = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(settings.model).toBe(`poe/${customModel}`);
  });

  it("accepts the `claude` alias for Claude Code", async () => {
    const { container } = createContainer();
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    vi.spyOn(container.options, "resolveModel").mockImplementation(
      async ({ defaultValue }) => defaultValue
    );

    const program = createTestProgram();
    await executeConfigure(program, container, "claude", {});

    const content = JSON.parse(await fs.readFile(credentialsPath, "utf8"));
    expect(content.configured_services["claude-code"]).toBeDefined();
    expect(content.configured_services.claude).toBeUndefined();
  });

  it("prints a VSCode post-configure hint for Claude Code after configure", async () => {
    const logs: string[] = [];
    const { container } = createContainer({
      logger: (message) => logs.push(message),
    });

    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    vi.spyOn(container.options, "resolveModel").mockImplementation(
      async ({ defaultValue }) => defaultValue
    );

    const program = createTestProgram();
    await executeConfigure(program, container, "claude-code", {});

    expect(logs).toEqual([
      chalk.green("Configured Claude Code."),
      "",
      chalk.cyan(
        "If using VSCode - Open the Disable Login Prompt setting and check the box. vscode://settings/claudeCode.disableLoginPrompt"
      )
    ]);
  });

});
