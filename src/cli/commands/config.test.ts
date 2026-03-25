import { beforeEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { Command } from "commander";
import { resolveConfigPath, resolveProjectConfigPath } from "@poe-code/poe-code-config";
import { createCliContainer } from "../container.js";
import { registerConfigCommand } from "./config.js";
import type { FileSystem } from "../utils/file-system.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn()
}));

const cwd = "/repo";
const homeDir = "/home/test";
const globalConfigPath = resolveConfigPath(homeDir);
const projectConfigPath = resolveProjectConfigPath(cwd);

function createMemFs(): FileSystem {
  const volume = new Volume();
  volume.mkdirSync(homeDir, { recursive: true });
  volume.mkdirSync(cwd, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

function createBaseProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program
    .name("poe-code")
    .option("-y, --yes")
    .option("--dry-run")
    .option("--verbose");
  return program;
}

describe("config command", () => {
  let fs: FileSystem;
  let logs: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    fs = createMemFs();
    logs = [];
  });

  it("shows global and project config paths with status", async () => {
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(globalConfigPath, "{}\n", { encoding: "utf8" });

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerConfigCommand(program, container);

    await program.parseAsync(["node", "cli", "config"]);

    expect(logs.some((message) => message.includes(`Global config: ${globalConfigPath} (exists)`)))
      .toBe(true);
    expect(logs.some((message) => message.includes(`Project config: ${projectConfigPath} (missing)`)))
      .toBe(true);
    expect(logs.some((message) => message.includes('Run "poe-code config show" to see resolved configuration')))
      .toBe(true);
  });

  it("shows global, project, env, and resolved config", async () => {
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.mkdir(`${cwd}/.poe-code`, { recursive: true });
    await fs.writeFile(
      globalConfigPath,
      `${JSON.stringify({ core: { apiKey: "sk-global", poeBaseUrl: "https://global.example.test" } }, null, 2)}\n`,
      { encoding: "utf8" }
    );
    await fs.writeFile(
      projectConfigPath,
      `${JSON.stringify({ core: { apiKey: "sk-project" }, models: { default: "anthropic/claude-sonnet-4.5" } }, null, 2)}\n`,
      { encoding: "utf8" }
    );

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: {
        cwd,
        homeDir,
        variables: {
          POE_API_KEY: "sk-env"
        }
      },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerConfigCommand(program, container);

    await program.parseAsync(["node", "cli", "config", "show"]);

    const output = logs.join("\n");
    expect(output).toContain("Global config");
    expect(output).toContain("Project config");
    expect(output).toContain("Environment variable overrides");
    expect(output).toContain("Resolved (merged)");
    expect(output).toContain('"apiKey": "sk-global"');
    expect(output).toContain('"apiKey": "sk-project"');
    expect(output).toContain("POE_API_KEY = sk-env");
    expect(output).toContain('"apiKey": "sk-env"');
    expect(output).toContain('"poeBaseUrl": "https://global.example.test"');
    expect(output).toContain('"default": "anthropic/claude-sonnet-4.5"');
  });

  it("shows empty sections when config files are missing", async () => {
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir, variables: {} },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerConfigCommand(program, container);

    await program.parseAsync(["node", "cli", "config", "show"]);

    const output = logs.join("\n");
    expect(output).toContain("Global config");
    expect(output).toContain("Project config");
    expect(output).toContain("Environment variable overrides");
    expect(output).toContain("Resolved (merged)");
    expect(output.match(/\(empty\)/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("creates an empty project config file", async () => {
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerConfigCommand(program, container);

    await program.parseAsync(["node", "cli", "config", "init"]);

    await expect(fs.readFile(projectConfigPath, "utf8")).resolves.toBe("{}\n");
    expect(logs.some((message) => message.includes(`Created project config at ${projectConfigPath}`)))
      .toBe(true);
  });

  it("does nothing when project config already exists", async () => {
    await fs.mkdir(`${cwd}/.poe-code`, { recursive: true });
    await fs.writeFile(projectConfigPath, '{\n  "core": {\n    "apiKey": "sk-project"\n  }\n}\n', {
      encoding: "utf8"
    });

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerConfigCommand(program, container);

    await program.parseAsync(["node", "cli", "config", "init"]);

    await expect(fs.readFile(projectConfigPath, "utf8")).resolves.toContain("sk-project");
    expect(logs.some((message) => message.includes(`Project config already exists at ${projectConfigPath}`)))
      .toBe(true);
  });

  it("does not write files in dry-run init mode", async () => {
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerConfigCommand(program, container);

    await program.parseAsync(["node", "cli", "--dry-run", "config", "init"]);

    await expect(fs.stat(projectConfigPath)).rejects.toBeTruthy();
    expect(logs.some((message) => message.includes(`Dry run: would create project config at ${projectConfigPath}`)))
      .toBe(true);
  });

  it("opens the project config in the configured editor", async () => {
    const { execSync } = await import("node:child_process");
    await fs.mkdir(`${cwd}/.poe-code`, { recursive: true });
    await fs.writeFile(projectConfigPath, "{}\n", { encoding: "utf8" });

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: {
        cwd,
        homeDir,
        variables: {
          EDITOR: "vim"
        }
      },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerConfigCommand(program, container);

    await program.parseAsync(["node", "cli", "config", "edit"]);

    expect(execSync).toHaveBeenCalledWith(`vim ${projectConfigPath}`, {
      stdio: "inherit"
    });
    await expect(fs.readFile(projectConfigPath, "utf8")).resolves.toBe("{}\n");
  });

  it("opens the global config when --global is passed", async () => {
    const { execSync } = await import("node:child_process");
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: {
        cwd,
        homeDir,
        variables: {
          VISUAL: "code -w"
        }
      },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerConfigCommand(program, container);

    await program.parseAsync(["node", "cli", "config", "edit", "--global"]);

    expect(execSync).toHaveBeenCalledWith(`code -w ${globalConfigPath}`, {
      stdio: "inherit"
    });
    await expect(fs.readFile(globalConfigPath, "utf8")).resolves.toBe("{}\n");
  });

  it("fails when no editor is configured", async () => {
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir, variables: {} },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerConfigCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "config", "edit"])
    ).rejects.toThrow("Set $EDITOR to use this command");
  });
});
