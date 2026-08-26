import { afterEach, describe, expect, it, vi } from "vitest";
import { Command, CommanderError, Option } from "commander";
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
  const plan = program
    .command("plan")
    .aliases(["plans", "p"])
    .option("--directory <path>", "Plan directory.")
    .addOption(new Option("--hidden-option").hideHelp());
  plan
    .command("open")
    .aliases(["view", "show"])
    .description("Open a plan.")
    .option("--editor <name>", "Editor to use.");
  plan
    .command("internal", { hidden: true })
    .alias("private")
    .option("--secret-option", "Hidden option.");
  program.command("secret", { hidden: true }).description("Hidden command.");
  registerCompletionCommand(program);
  return program;
}

function createRequiredValueProgram(): Command {
  const program = new Command()
    .name("poe-code")
    .option("-g, --profile <name>", "Profile.")
    .option("-b, --boolean", "Boolean control.");
  const plan = program
    .command("plan")
    .aliases(["plans", "p"])
    .option("-k, --kind <kind>", "Plan kind.")
    .option("-o, --optional [value]", "Optional value.")
    .option("-v, --many <values...>", "Variadic values.")
    .option("-x <value>", "Short-only value.")
    .addOption(new Option("--hidden-value <value>").hideHelp());
  plan.command("browse").option("--browse-only", "Browse control.");
  plan
    .command("open")
    .aliases(["view", "show"])
    .option("-e, --editor <name>", "Editor.");
  program.command("agent").option("--agent-only <value>", "Unrelated value.");
  registerCompletionCommand(program);
  return program;
}

async function emitCompletion(
  shell: string,
  program: Command = createFixtureProgram()
): Promise<string> {
  const chunks: string[] = [];
  const stdoutWrite = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as unknown as typeof process.stdout.write);
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

function readCompletionWords(script: string, path: string, optionsEnded = false): string[] {
  const prefix = `    "${Number(optionsEnded)}:${path}") completions=`;
  const lines = script.split("\n");
  const line = lines.find((line) => line.startsWith(prefix))
    ?? lines.find((line) => line.startsWith("    *) completions="));
  expect(line, `Missing completion path ${path}`).toBeDefined();
  return line!.split("completions=")[1]!.slice(1, -3).split(" ").filter(Boolean);
}

describe("completion command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits a bash script that completes root commands from the commander tree", async () => {
    const script = await emitCompletion("bash");

    expect(script).toContain("complete -F _poe_code_complete poe-code");
    expect(script).toContain("complete -F _poe_code_complete poe");
    expect(script).toContain('"0:") completions="agent completion configure plan plans p --yes"');
  });

  it("emits bash completions for nested commands, aliases, and their options", async () => {
    const script = await emitCompletion("bash");

    expect(script).toContain('"0:configure") completions="--agent --yes"');
    expect(script).toContain('"0:agent") completions="add new list --yes"');
  });

  it.each(["bash", "zsh", "fish"])(
    "omits hidden commands, aliases, and options from %s",
    async (shell) => {
      const script = await emitCompletion(shell);

      expect(script).not.toContain("secret");
      expect(script).not.toContain("internal");
      expect(script).not.toContain("private");
      expect(script).not.toContain("hidden-option");
    }
  );

  it.each(
    ["bash", "zsh"].flatMap((shell) =>
      ["plan", "plans", "p"].map((parent) => ({ shell, parent }))
    )
  )("emits $shell completions for parent path $parent", async ({ shell, parent }) => {
    const script = await emitCompletion(shell);

    expect(script).toContain(
      shell === "bash"
        ? `"0:${parent}") completions="open view show --directory --yes";;`
        : `"0:${parent}") completions=(open view show --directory --yes);;`
    );
  });

  it.each(
    ["bash", "zsh"].flatMap((shell) =>
      ["plan", "plans", "p"].flatMap((parent) =>
        ["open", "view", "show"].map((child) => ({ shell, path: `${parent} ${child}` }))
      )
    )
  )("emits $shell completions for nested path $path", async ({ shell, path }) => {
    const script = await emitCompletion(shell);

    expect(script).toContain(
      shell === "bash"
        ? `"0:${path}") completions="--editor --directory --yes";;`
        : `"0:${path}") completions=(--editor --directory --yes);;`
    );
  });

  it.each(["plan", "plans", "p"])(
    "emits fish conditions for parent name %s",
    async (parent) => {
      const script = await emitCompletion("fish");

      for (const child of ["open", "view", "show"]) {
        expect(script).toContain(
          `complete -c poe-code -n "__fish_seen_subcommand_from ${parent}" -a '${child}' -d 'Open a plan.'`
        );
      }
      expect(script).toContain(
        `complete -c poe-code -n "__fish_seen_subcommand_from ${parent}" -l directory -d 'Plan directory.'`
      );
    }
  );

  it.each(["open", "view", "show"])(
    "emits fish conditions for nested name %s",
    async (child) => {
      const script = await emitCompletion("fish");

      expect(script).toContain(
        `complete -c poe-code -n "__fish_seen_subcommand_from ${child}" -l editor -d 'Editor to use.'`
      );
    }
  );

  it("emits a zsh script registered with compdef", async () => {
    const script = await emitCompletion("zsh");

    expect(script).toContain("#compdef poe-code poe");
    expect(script).toContain("compdef _poe_code poe-code poe");
    expect(script).toContain('"0:agent") completions=(add new list --yes)');
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

  describe.each(["bash", "zsh"])("%s inherited option candidates", (shell) => {
    it.each([
      { path: "models", prefix: "--v", expected: ["--view", "--verbose", "--version"] },
      { path: "models", prefix: "--y", expected: ["--yes"] },
      { path: "models", prefix: "--o", expected: ["--output"] },
      { path: "plan list", prefix: "--d", expected: ["--dry-run"] },
      { path: "plan list", prefix: "--y", expected: ["--yes"] },
      { path: "plan list", prefix: "--ar", expected: ["--archived"] },
      { path: "plans list", prefix: "--ar", expected: ["--archived"] },
      { path: "plan list", prefix: "--k", expected: ["--kind"] },
      { path: "plans list", prefix: "--k", expected: ["--kind"] },
      { path: "plan list", prefix: "--o", expected: ["--output"] }
    ])("completes real $path $prefix with local and inherited flags", async ({ path, prefix, expected }) => {
      const program = createProgram({
        fs: createMemFs(),
        prompts: async () => ({}),
        env: { cwd: "/repo", homeDir: "/home/test", variables: {} },
        logger: () => {},
        exitOverride: true
      });
      const script = await emitCompletion(shell, program);

      expect(readCompletionWords(script, path).filter((word) => word.startsWith(prefix)))
        .toEqual(expected);
    });

    it.each(["agent list", "agent add", "agent new"])(
      "gives globals to optionless leaf %s",
      async (path) => {
        const script = await emitCompletion(shell);

        expect(readCompletionWords(script, path)).toEqual(["--yes"]);
      }
    );
  });

  describe.each(["bash", "zsh", "fish"])("%s inherited option precedence", (shell) => {
    it.each([
      {
        name: "hidden nearest spelling masks a visible ancestor",
        ancestorHidden: false,
        nearestFlags: "--shared <value>",
        nearestHidden: true,
        expected: [],
        description: ""
      },
      {
        name: "visible nearest spelling exposes a hidden ancestor",
        ancestorHidden: true,
        nearestFlags: "--shared <value>",
        nearestHidden: false,
        expected: ["--shared"],
        description: "Nearest description."
      },
      {
        name: "short-only shadow preserves the inherited long spelling",
        ancestorHidden: false,
        nearestFlags: "-s",
        nearestHidden: false,
        expected: ["--shared"],
        description: "Ancestor description."
      },
      {
        name: "nearest visible spelling wins without duplicate candidates",
        ancestorHidden: false,
        nearestFlags: "--shared <value>",
        nearestHidden: false,
        expected: ["--shared"],
        description: "Nearest description."
      }
    ])("$name", async ({ ancestorHidden, nearestFlags, nearestHidden, expected, description }) => {
      const program = createFixtureProgram();
      program.addOption(new Option("-s, --shared <value>", "Ancestor description.").hideHelp(ancestorHidden));
      program.commands.find((command) => command.name() === "plan")!
        .addOption(new Option(nearestFlags, "Nearest description.").hideHelp(nearestHidden));
      const script = await emitCompletion(shell, program);

      for (const path of ["plan", "plans", "plan open", "plans view"]) {
        if (shell === "fish") {
          const prefix = `complete -c poe-code -n "__fish_seen_subcommand_from ${path.split(" ").at(-1)}" -l shared `;
          const lines = script.split("\n").filter((line) => line.startsWith(prefix));
          if (expected.length === 0) {
            expect(lines).toEqual([]);
          } else {
            expect(lines.length).toBeGreaterThan(0);
            expect(lines.every((line) => line === `${prefix}-d '${description}'`)).toBe(true);
          }
        } else {
          expect(readCompletionWords(script, path).filter((word) => word === "--shared"))
            .toEqual(expected);
        }
      }
    });
  });

  it("emits real inherited fish options with their ancestor descriptions", async () => {
    const program = createProgram({
      fs: createMemFs(),
      prompts: async () => ({}),
      env: { cwd: "/repo", homeDir: "/home/test", variables: {} },
      logger: () => {},
      exitOverride: true
    });
    const script = await emitCompletion("fish", program);

    for (const command of ["models", "list"]) {
      expect(script).toContain(
        `complete -c poe-code -n "__fish_seen_subcommand_from ${command}" -l yes -d 'Accept defaults without prompting.'`
      );
      expect(script).toContain(
        `complete -c poe-code -n "__fish_seen_subcommand_from ${command}" -l verbose -d 'Show verbose logs.'`
      );
    }
    expect(script).toContain(
      "complete -c poe-code -n \"__fish_seen_subcommand_from list\" -l archived -d 'Browse archived plans instead of active plans'"
    );
  });

  describe.each(["bash", "zsh"])("%s option terminator", (shell) => {
    it.each([
      { input: "-- mo", path: "", prefix: "mo", ended: true, expected: ["models"] },
      { input: "plan -- v", path: "plan", prefix: "v", ended: true, expected: ["view"] },
      { input: "plans -- v", path: "plans", prefix: "v", ended: true, expected: ["view"] },
      { input: "-- plans v", path: "plans", prefix: "v", ended: true, expected: ["view"] },
      { input: "-- --verb", path: "", prefix: "--verb", ended: true, expected: [] },
      { input: "-- models --verb", path: "models", prefix: "--verb", ended: true, expected: [] },
      { input: "plan -- view --out", path: "plan view", prefix: "--out", ended: true, expected: [] },
      { input: "plan view -- --out", path: "plan view", prefix: "--out", ended: true, expected: [] },
      { input: "plans -- view --out", path: "plans view", prefix: "--out", ended: true, expected: [] },
      { input: "-- --verbose mo", path: "--verbose", prefix: "mo", ended: true, expected: [] },
      { input: "plan -- --kind v", path: "plan --kind", prefix: "v", ended: true, expected: [] },
      { input: "-- models <empty>", path: "models", prefix: "", ended: true, expected: [] },
      { input: "models --verb", path: "models", prefix: "--verb", ended: false, expected: ["--verbose"] },
      { input: "--", path: "", prefix: "--", ended: false, expected: ["--yes", "--dry-run", "--verbose", "--version"] },
      { input: "harness run --dir -- --re", path: "harness run", prefix: "--re", ended: false, expected: ["--resume"] },
      { input: "harness run --dir -- -- --re", path: "harness run", prefix: "--re", ended: true, expected: [] },
      { input: "harness run --dir=-- --re", path: "harness run", prefix: "--re", ended: false, expected: ["--resume"] },
      { input: "plan --kind=-- v", path: "plan", prefix: "v", ended: false, expected: ["view"] },
      { input: "plan --kind -- v", path: "plan", prefix: "v", ended: false, expected: ["view"] },
      { input: "plan --kind -- -- v", path: "plan", prefix: "v", ended: true, expected: ["view"] }
    ])("generates the real-tree candidate branch for $input", async ({ path, prefix, ended, expected }) => {
      const program = createProgram({
        fs: createMemFs(),
        prompts: async () => ({}),
        env: { cwd: "/repo", homeDir: "/home/test", variables: {} },
        logger: () => {},
        exitOverride: true
      });
      const script = await emitCompletion(shell, program);

      expect(readCompletionWords(script, path, ended).filter((word) => word.startsWith(prefix)))
        .toEqual(expected);
    });

    it("keeps only visible children and aliases after termination", async () => {
      const script = await emitCompletion(shell);

      expect(readCompletionWords(script, "", true))
        .toEqual(["agent", "completion", "configure", "plan", "plans", "p"]);
      for (const parent of ["plan", "plans", "p"]) {
        expect(readCompletionWords(script, parent, true)).toEqual(["open", "view", "show"]);
        for (const child of ["open", "view", "show"]) {
          expect(readCompletionWords(script, `${parent} ${child}`, true)).toEqual([]);
        }
      }
      expect(script).toContain('  case "$options_ended:$key" in');
    });

    it("changes state only for completed standalone terminators after consuming pending values", async () => {
      const script = await emitCompletion(shell, createRequiredValueProgram());

      expect(script).toContain("  expecting_value=0\n  options_ended=0\n");
      expect(script).toContain(
        shell === "bash"
          ? "  for (( index=1; index < COMP_CWORD; index++ )); do"
          : "  for (( index=2; index < CURRENT; index++ )); do"
      );
      expect(script).toContain([
        "    if (( expecting_value )); then",
        "      expecting_value=0",
        "      continue",
        "    fi",
        "    if (( ! options_ended )); then",
        '      if [[ "$word" == "--" ]]; then',
        "        options_ended=1",
        "        continue",
        "      fi",
        '      case "$key:$word" in'
      ].join("\n"));
      expect(script).toContain([
        "      esac",
        '      [[ "$word" == -* ]] && continue',
        "    fi",
        '    key="${key:+$key }$word"'
      ].join("\n"));
    });
  });

  it("does not add terminator state to fish output", async () => {
    expect(await emitCompletion("fish")).not.toContain("options_ended");
  });

  describe.each(["bash", "zsh"])("%s required single-value options", (shell) => {
    it.each([
      "",
      ...["plan", "plans", "p"],
      ...["plan", "plans", "p"].flatMap((parent) =>
        ["open", "view", "show"].map((child) => `${parent} ${child}`)
      )
    ])("keeps global value flags available at path '%s'", async (path) => {
      const script = await emitCompletion(shell, createRequiredValueProgram());

      expect(script).toContain(`"${path}:--profile"`);
      expect(script).toContain(`"${path}:-g"`);
      expect(script).not.toContain(`"${path}:--agent-only"`);
    });

    it.each(["plan", "plans", "p"])(
      "scopes local and inherited required flags under %s",
      async (parent) => {
        const script = await emitCompletion(shell, createRequiredValueProgram());

        for (const flag of ["--kind", "-k", "--hidden-value", "-x"]) {
          expect(script).toContain(`"${parent}:${flag}"`);
          expect(script).not.toContain(`":${flag}"`);
          expect(script).not.toContain(`"agent:${flag}"`);
          for (const child of ["open", "view", "show"]) {
            expect(script).toContain(`"${parent} ${child}:${flag}"`);
          }
        }
        for (const flag of ["--editor", "-e"]) {
          expect(script).not.toContain(`"${parent}:${flag}"`);
          expect(script).not.toContain(`"${parent} browse:${flag}"`);
          for (const child of ["open", "view", "show"]) {
            expect(script).toContain(`"${parent} ${child}:${flag}"`);
          }
        }
      }
    );

    it.each([
      { flags: "--profile", required: ["-g"], excluded: ["--profile"] },
      { flags: "-g", required: ["--profile"], excluded: ["-g"] },
      { flags: "-g, --profile", required: [], excluded: ["--profile", "-g"] },
      { flags: "-g, --profile [name]", required: [], excluded: ["--profile", "-g"] },
      { flags: "-g, --profile <names...>", required: [], excluded: ["--profile", "-g"] },
      { flags: "-g, --profile [names...]", required: [], excluded: ["--profile", "-g"] }
    ])("resolves spelling precedence before filtering $flags", async ({ flags, required, excluded }) => {
      const program = createRequiredValueProgram();
      program.commands.find((command) => command.name() === "plan")!.option(flags);
      const script = await emitCompletion(shell, program);

      for (const path of ["plan", "plans", "plan open", "plans show"]) {
        for (const flag of required) {
          expect(script).toContain(`"${path}:${flag}"`);
        }
        for (const flag of excluded) {
          expect(script).not.toContain(`"${path}:${flag}"`);
          expect(script).toContain(`":${flag}"`);
        }
      }
    });

    it("lets the nearest required option override an ancestor boolean", async () => {
      const program = createRequiredValueProgram();
      const plan = program.commands.find((command) => command.name() === "plan")!;
      plan.option("-g, --profile");
      plan.commands.find((command) => command.name() === "open")!.option("-g, --profile <name>");
      const script = await emitCompletion(shell, program);

      for (const flag of ["--profile", "-g"]) {
        expect(script).not.toContain(`"plan:${flag}"`);
        expect(script).toContain(`"plan open:${flag}"`);
        expect(script).toContain(`"plans show:${flag}"`);
      }
    });

    it("retains value metadata for leaves with no visible long options", async () => {
      const program = createRequiredValueProgram();
      program
        .command("leaf")
        .option("-q <value>")
        .addOption(new Option("--hidden-leaf <value>").hideHelp());
      const script = await emitCompletion(shell, program);

      for (const flag of ["-q", "--hidden-leaf", "-g", "--profile"]) {
        expect(script).toContain(`"leaf:${flag}"`);
      }
    });

    it("consumes one pending value before interpreting command-looking or leading-dash words", async () => {
      const script = await emitCompletion(shell, createRequiredValueProgram());

      expect(script).toContain('  expecting_value=0\n');
      expect(script).toContain([
        shell === "bash" ? '    word="${COMP_WORDS[index]}"' : '    word="${words[index]}"',
        "    if (( expecting_value )); then",
        "      expecting_value=0",
        "      continue",
        "    fi",
        "    if (( ! options_ended )); then",
        '      if [[ "$word" == "--" ]]; then',
        "        options_ended=1",
        "        continue",
        "      fi",
        '      case "$key:$word" in'
      ].join("\n"));
      expect(script).toContain('"plan:--kind"|"plan:-k"');
      expect(script).toContain(') expecting_value=1; continue;;');
      expect(script).toContain([
        "      esac",
        '      [[ "$word" == -* ]] && continue',
        "    fi",
        '    key="${key:+$key }$word"'
      ].join("\n"));
    });

    it("returns without command candidates while a required value is pending", async () => {
      const script = await emitCompletion(shell, createRequiredValueProgram());

      expect(script).toContain("  done\n  (( expecting_value )) && return\n  local");
      if (shell === "bash") {
        expect(script).toContain("  COMPREPLY=()");
      }
    });

    it("does not consume following words for inline, attached, boolean, optional, variadic, or clustered flags", async () => {
      const script = await emitCompletion(shell, createRequiredValueProgram());

      for (const flag of [
        "--kind=pipeline", "-kpipeline", "--profile=work", "-gwork", "--editor=vim", "-evim",
        "--boolean", "-b", "--optional", "-o", "--many", "-v", "-bk"
      ]) {
        for (const path of ["", "plan", "plans", "plan open", "plans show"]) {
          expect(script).not.toContain(`"${path}:${flag}"`);
        }
      }
      const valueCases = script.split('      case "$key:$word" in\n')[1]?.split("      esac")[0];
      expect(valueCases).toBeDefined();
      expect(valueCases).not.toContain("*");
    });

    it("keeps hidden and short-only value flags out of candidate lists", async () => {
      const script = await emitCompletion(shell, createRequiredValueProgram());

      expect(script).toContain(
        shell === "bash"
          ? '"0:plan") completions="browse open view show --kind --optional --many --profile --boolean";;'
          : '"0:plan") completions=(browse open view show --kind --optional --many --profile --boolean);;'
      );
    });
  });

  it("leaves fish output unchanged when hidden and short-only required flags are added", async () => {
    const program = createFixtureProgram();
    const before = await emitCompletion("fish", program);
    program.commands.find((command) => command.name() === "plan")!
      .option("-x <value>")
      .addOption(new Option("--hidden-value <value>").hideHelp());

    expect(await emitCompletion("fish", program)).toBe(before);
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
