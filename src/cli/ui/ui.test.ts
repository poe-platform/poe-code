import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveThemeName,
  getTheme,
  resetThemeCache,
  dark,
  light
} from "@poe-code/design-system";
import { createProgram } from "../program.js";
import { createHomeFs } from "../../../tests/test-helpers.js";
import { renderServiceMenu } from "./service-menu.js";
import type { ProviderService } from "../service-registry.js";
import { createProviderStub } from "../../../tests/provider-stub.js";

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

function createAdapter(
  name: string,
  label: string,
  branding?: ProviderService["branding"]
): ProviderService {
  return createProviderStub({
    name,
    label,
    branding
  });
}

function walkVisibleCommands(program: ReturnType<typeof createProgram>) {
  const commands: ReturnType<typeof createProgram>["commands"] = [];

  const visit = (command: ReturnType<typeof createProgram>) => {
    for (const child of command.commands) {
      if (Reflect.get(child, "_hidden") === true || child.name() === "__run") {
        continue;
      }
      commands.push(child);
      visit(child);
    }
  };

  visit(program);
  return commands;
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
    expect(help).toContain("claude-code | claude");
    expect(help).toContain("codex");
    expect(help).toContain("opencode");
  });

  it("uses live command descriptions in root help output", () => {
    const program = createHelpProgram();
    const configureCommand = program.commands.find(
      (command) => command.name() === "configure"
    );
    const loginCommand = program.commands.find((command) => command.name() === "login");

    const help = stripAnsi(program.helpInformation());
    expect(configureCommand).toBeDefined();
    expect(loginCommand).toBeDefined();
    expect(help).toContain(configureCommand?.description() ?? "");
    expect(help).toContain(loginCommand?.description() ?? "");
  });

  it("uses canonical command names in subcommand usage output", () => {
    const program = createHelpProgram();
    const spawnCommand = program.commands.find(
      (command) => command.name() === "spawn"
    );
    expect(spawnCommand).toBeDefined();

    const help = stripAnsi(spawnCommand?.helpInformation() ?? "");
    expect(help).toContain(
      "Usage: poe-code spawn [options] <agent> [prompt] [agentArgs...]"
    );
    expect(help).not.toContain("spawn|s");
  });

  it("lists accepted agent aliases in spawn help output", () => {
    const program = createHelpProgram();
    const spawnCommand = program.commands.find(
      (command) => command.name() === "spawn"
    );
    expect(spawnCommand).toBeDefined();

    const help = stripAnsi(spawnCommand?.helpInformation() ?? "");
    expect(help).toContain("claude-code | claude");
  });

  it("uses sentence-style descriptions for every visible command", () => {
    const program = createHelpProgram();

    const descriptions = walkVisibleCommands(program).map((command) => ({
      name: command.name(),
      description: command.description()
    }));

    expect(
      descriptions.filter(
        ({ description }) => description.length > 0 && !description.endsWith(".")
      )
    ).toEqual([]);
  });

  it("uses kebab-case command names for every visible command", () => {
    const program = createHelpProgram();

    const commandNames = walkVisibleCommands(program).map((command) => command.name());

    expect(commandNames.filter((name) => name.includes("_"))).toEqual([]);
  });

  it("hides legacy snake_case compatibility commands from help output", () => {
    const program = createHelpProgram();
    const authCommand = program.commands.find((command) => command.name() === "auth");
    expect(authCommand).toBeDefined();

    const help = stripAnsi(authCommand?.helpInformation() ?? "");
    expect(help).toContain("api-key");
    expect(help).not.toContain("api_key");
  });
});

describe("resolveThemeName", () => {
  beforeEach(() => {
    resetThemeCache();
  });

  it("defaults to dark theme when unset", () => {
    const theme = resolveThemeName({});
    expect(theme).toBe("dark");
  });

  it("respects POE_CODE_THEME=light", () => {
    const theme = resolveThemeName({ POE_CODE_THEME: "light" });
    expect(theme).toBe("light");
  });

  it("detects dark mode via Apple interface style", () => {
    const theme = resolveThemeName({ APPLE_INTERFACE_STYLE: "Dark" });
    expect(theme).toBe("dark");
  });

  it("detects light mode via VSCode theme kind", () => {
    const theme = resolveThemeName({ VSCODE_COLOR_THEME_KIND: "light" });
    expect(theme).toBe("light");
  });

  it("uses COLORFGBG background to infer light mode", () => {
    const theme = resolveThemeName({ COLORFGBG: "0;15" });
    expect(theme).toBe("light");
  });
});

describe("getTheme", () => {
  beforeEach(() => {
    resetThemeCache();
  });

  it("wraps structural strings using ANSI styles", () => {
    const palette = getTheme({ POE_CODE_THEME: "dark" });
    expect(palette.header("headline")).toContain("\u001b[");
    expect(palette.number("1")).toContain("\u001b[");
  });

  it("produces different prompt colors for light vs dark themes", () => {
    expect(dark.prompt("Prompt")).not.toEqual(light.prompt("Prompt"));
  });
});

describe("renderServiceMenu", () => {
  it("renders service menu with themed styling", () => {
    const services = [
      createAdapter("claude-code", "Claude Code"),
      createAdapter("codex", "Codex", {
        colors: { dark: "#5bc0ff", light: "#0053a6" }
      })
    ];

    const lines = renderServiceMenu(services, { themeName: "dark" });

    expect(lines.length).toBeGreaterThan(4);
    expect(lines[3]).toContain("Pick an agent to configure:");
    expect(lines[4]).toContain("Claude Code");
    expect(lines[5]).toContain("Codex");
  });
});
