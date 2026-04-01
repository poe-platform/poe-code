import { describe, it, expect } from "vitest";
import { createProgram } from "../program.js";
import { createHomeFs } from "../../../tests/test-helpers.js";

const cwd = "/repo";
const homeDir = "/home/test";

function stripAnsi(value: string): string {
  let result = "";
  let index = 0;
  while (index < value.length) {
    const char = value[index];
    if (char === "\u001b" && value[index + 1] === "[") {
      index += 2;
      while (index < value.length && value[index] !== "m") {
        index += 1;
      }
      if (index < value.length) {
        index += 1;
      }
      continue;
    }
    result += char;
    index += 1;
  }
  return result;
}

function createHelpProgram() {
  const fs = createHomeFs(homeDir);
  return createProgram({
    fs,
    prompts: async () => ({}),
    env: { cwd, homeDir },
    logger: () => {}
  });
}

describe("command help formatting", () => {
  it("shows root command aliases inline in the command list", () => {
    const program = createHelpProgram();

    const help = stripAnsi(program.helpInformation());
    expect(help).toContain("install, i");
    expect(help).toContain("configure, c");
    expect(help).toContain("unconfigure, uc");
    expect(help).toContain("spawn, s");
    expect(help).toContain("wrap, w");
    expect(help).toContain("models, m");
    expect(help).toContain("usage, u");
    expect(help).toContain("generate, g");
  });

  it("adds a design header to subcommand help output", () => {
    const program = createHelpProgram();
    const configureCommand = program.commands.find(
      (command) => command.name() === "configure"
    );
    expect(configureCommand).toBeDefined();

    const help = configureCommand?.helpInformation() ?? "";
    expect(stripAnsi(help)).toContain("Poe - configure");
  });

  it("includes parent command names in nested help output", () => {
    const program = createHelpProgram();
    const mcpCommand = program.commands.find((command) => command.name() === "mcp");
    expect(mcpCommand).toBeDefined();

    const mcpConfigure = mcpCommand?.commands.find(
      (command) => command.name() === "configure"
    );
    expect(mcpConfigure).toBeDefined();

    const help = mcpConfigure?.helpInformation() ?? "";
    expect(stripAnsi(help)).toContain("Poe - mcp configure");
  });

  it("lists isolated agents in wrap help output", () => {
    const program = createHelpProgram();
    const wrapCommand = program.commands.find(
      (command) => command.name() === "wrap"
    );
    expect(wrapCommand).toBeDefined();

    const help = stripAnsi(wrapCommand?.helpInformation() ?? "");
    expect(help).toContain("claude-code");
    expect(help).toContain("codex");
    expect(help).toContain("opencode");
  });
});
