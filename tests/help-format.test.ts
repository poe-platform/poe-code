import { describe, it, expect } from "vitest";
import { createProgram } from "../src/cli/program.js";
import { createHomeFs } from "./test-helpers.js";

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
  it("adds a design header to subcommand help output", () => {
    const program = createHelpProgram();
    const configureCommand = program.commands.find(
      (command) => command.name() === "configure"
    );
    expect(configureCommand).toBeDefined();

    const help = configureCommand?.helpInformation() ?? "";
    expect(stripAnsi(help)).toContain("Poe - configure");
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
