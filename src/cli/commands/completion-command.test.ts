import { afterEach, describe, expect, it, vi } from "vitest";
import { Command, CommanderError } from "commander";
import { Volume, createFsFromVolume } from "memfs";
import { createProgram } from "../program.js";
import { registerCompletionCommand } from "./completion.js";
import type { FileSystem } from "../../utils/file-system.js";

function createMemFs(): FileSystem {
  const volume = new Volume();
  volume.mkdirSync("/home/test", { recursive: true });
  volume.mkdirSync("/repo", { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

/** A tiny stand-in tree: completion output must be derived from commander, not hand-written. */
function createFixtureProgram(): Command {
  const program = new Command();
  program.name("poe-code").option("-y, --yes", "Accept defaults without prompting.");
  program
    .command("configure")
    .description("Configure an agent.")
    .option("--agent <name>", "Agent to configure");
  const agent = program.command("agent").description("Manage agents.");
  agent.command("list").description("List agents.");
  agent.command("add").alias("new").description("Add an agent.");
  program.command("secret", { hidden: true }).description("Hidden command.");
  registerCompletionCommand(program);
  return program;
}

async function emitCompletion(shell: string): Promise<string> {
  const chunks: string[] = [];
  const stdoutWrite = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as unknown as typeof process.stdout.write);
  const program = createFixtureProgram();
  for (const command of [program, ...program.commands]) {
    command.exitOverride();
    command.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  }
  try {
    await program.parseAsync(["node", "cli", "completion", shell]);
  } finally {
    stdoutWrite.mockRestore();
  }
  return chunks.join("");
}

describe("completion command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits a bash script that completes root commands from the commander tree", async () => {
    const script = await emitCompletion("bash");

    expect(script).toContain("complete -F _poe_code_complete poe-code");
    expect(script).toContain("complete -F _poe_code_complete poe");
    expect(script).toContain('"") completions="agent completion configure --yes"');
  });

  it("emits bash completions for nested commands, aliases, and their options", async () => {
    const script = await emitCompletion("bash");

    expect(script).toContain('"configure") completions="--agent"');
    expect(script).toContain('"agent") completions="add new list"');
  });

  it("omits commands hidden from help", async () => {
    const script = await emitCompletion("bash");

    expect(script).not.toContain("secret");
  });

  it("emits a zsh script registered with compdef", async () => {
    const script = await emitCompletion("zsh");

    expect(script).toContain("#compdef poe-code poe");
    expect(script).toContain("compdef _poe_code poe-code poe");
    expect(script).toContain('"agent") completions=(add new list)');
  });

  it("emits fish completions carrying command descriptions", async () => {
    const script = await emitCompletion("fish");

    expect(script).toContain(
      "complete -c poe-code -n \"__fish_use_subcommand\" -a 'configure' -d 'Configure an agent.'"
    );
    expect(script).toContain(
      "complete -c poe-code -n \"__fish_seen_subcommand_from agent\" -a 'list' -d 'List agents.'"
    );
  });

  it("rejects an unsupported shell", async () => {
    await expect(emitCompletion("powershell")).rejects.toBeInstanceOf(CommanderError);
  });

  it("is registered on the real program and listed in root help", async () => {
    const chunks: string[] = [];
    const stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: unknown) => {
        chunks.push(String(chunk));
        return true;
      }) as unknown as typeof process.stdout.write);
    const program = createProgram({
      fs: createMemFs(),
      prompts: async () => ({}),
      env: { cwd: "/repo", homeDir: "/home/test", variables: {} },
      logger: () => {}
    });

    expect(program.commands.find((command) => command.name() === "completion")).toBeDefined();

    try {
      await program.parseAsync(["node", "cli", "--help"]);
    } catch (error) {
      if (!(error instanceof CommanderError) || error.code !== "commander.helpDisplayed") {
        throw error;
      }
    } finally {
      stdoutWrite.mockRestore();
    }

    expect(chunks.join("")).toContain("completion");
  });
});
