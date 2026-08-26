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

function readCompletionWords(script: string, path: string, optionsEnded = false, parentOperands = false): string[] {
  const prefix = `    "${Number(optionsEnded)}:${Number(parentOperands)}:${path}") completions=`;
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
    expect(script).toContain('"0:0:") completions="agent completion configure plan plans p --yes --help"');
  });

  it("emits bash completions for nested commands, aliases, and their options", async () => {
    const script = await emitCompletion("bash");

    expect(script).toContain('"0:0:configure") completions="--agent --yes --help"');
    expect(script).toContain('"0:0:agent") completions="add new list --yes --help"');
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
        ? `"0:0:${parent}") completions="open view show --directory --yes --help";;`
        : `"0:0:${parent}") completions=(open view show --directory --yes --help);;`
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
        ? `"0:0:${path}") completions="--editor --directory --yes --help";;`
        : `"0:0:${path}") completions=(--editor --directory --yes --help);;`
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
    expect(script).toContain('"0:0:agent") completions=(add new list --yes --help)');
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

        expect(readCompletionWords(script, path)).toEqual(["--yes", "--help"]);
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
      { input: "--", path: "", prefix: "--", ended: false, expected: ["--yes", "--dry-run", "--verbose", "--version", "--help"] },
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
      expect(script).toContain('  case "$options_ended:$parent_operands:$key" in');
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
        "    (( parent_operands )) && continue",
        '    case "$key" in'
      ].join("\n"));
    });
  });

  it("does not add terminator state to fish output", async () => {
    expect(await emitCompletion("fish")).not.toContain("options_ended");
  });

  describe.each(["bash", "zsh"])("%s leaf positional operands", (shell) => {
    it.each([
      { input: "plan view docs/plans/example.md --out", path: "plan view", prefix: "--out", ended: false, expected: ["--output"] },
      { input: "plans view docs/plans/example.md --ar", path: "plans view", prefix: "--ar", ended: false, expected: ["--archived"] },
      { input: "harness run one.md two.md --re", path: "harness run", prefix: "--re", ended: false, expected: ["--resume"] },
      { input: "spawn codex --mo", path: "spawn", prefix: "--mo", ended: false, expected: ["--model", "--mode"] },
      { input: "s codex hello --mo", path: "s", prefix: "--mo", ended: false, expected: ["--model", "--mode"] },
      { input: 'plan view "docs/plans/with spaces.md" --out', path: "plan view", prefix: "--out", ended: false, expected: ["--output"] },
      { input: 'plan view "" --out', path: "plan view", prefix: "--out", ended: false, expected: ["--output"] },
      { input: "harness run models plan --re", path: "harness run", prefix: "--re", ended: false, expected: ["--resume"] },
      { input: "harness run --dir tmp one.md --re", path: "harness run", prefix: "--re", ended: false, expected: ["--resume"] },
      { input: "harness run one.md --dir tmp --re", path: "harness run", prefix: "--re", ended: false, expected: ["--resume"] },
      { input: "spawn codex hello --model example --mo", path: "spawn", prefix: "--mo", ended: false, expected: ["--model", "--mode"] },
      { input: "harness run one.md --dir -- --re", path: "harness run", prefix: "--re", ended: false, expected: ["--resume"] },
      { input: "harness run one.md --dir -- -- --re", path: "harness run", prefix: "--re", ended: true, expected: [] },
      { input: "plan view example.md -- --out", path: "plan view", prefix: "--out", ended: true, expected: [] },
      { input: "plans view example.md -- --ar", path: "plans view", prefix: "--ar", ended: true, expected: [] },
      { input: "spawn codex -- --model forwarded --mo", path: "spawn", prefix: "--mo", ended: true, expected: [] },
      { input: "s codex hello -- --model -- --mo", path: "s", prefix: "--mo", ended: true, expected: [] }
    ])("emits leaf retention and candidates for $input", async ({ path, prefix, ended, expected }) => {
      const program = createProgram({
        fs: createMemFs(),
        prompts: async () => ({}),
        env: { cwd: "/repo", homeDir: "/home/test", variables: {} },
        logger: () => {},
        exitOverride: true
      });
      const script = await emitCompletion(shell, program);

      expect(script).toContain(`      "${path}") continue;;`);
      expect(readCompletionWords(script, path, ended).filter((word) => word.startsWith(prefix)))
        .toEqual(expected);
    });

    it("derives retention for all aliases but excludes nonleaves and hidden-child parents", async () => {
      const program = createFixtureProgram();
      const plan = program.commands.find((command) => command.name() === "plan")!;
      plan.argument("[workflow]");
      plan.commands.find((command) => command.name() === "open")!.argument("[path]");
      program.command("hidden-parent").argument("[value]")
        .command("internal", { hidden: true });
      const script = await emitCompletion(shell, program);

      for (const parent of ["plan", "plans", "p"]) {
        expect(script).not.toContain(`      "${parent}") continue;;`);
        for (const child of ["open", "view", "show"]) {
          expect(script).toContain(`      "${parent} ${child}") continue;;`);
        }
      }
      for (const path of ["", "configure", "hidden-parent", "hidden-parent internal"]) {
        expect(script).not.toContain(`      "${path}") continue;;`);
      }
      const retentionCases = script.split('    case "$key" in\n')[1]?.split("    esac")[0];
      expect(retentionCases).toBeDefined();
      expect(retentionCases).not.toContain("*");
    });

    it("keeps positional-only leaves in metadata even without regular options", async () => {
      const program = new Command().name("poe-code");
      program.command("leaf").argument("[value]");
      registerCompletionCommand(program);
      const script = await emitCompletion(shell, program);

      expect(script).toContain('      "leaf") continue;;');
      expect(readCompletionWords(script, "leaf")).toEqual(["--help"]);
    });

    it("does not treat unknown paths, no-positional leaves, or parents as positional leaves", async () => {
      const program = createProgram({
        fs: createMemFs(),
        prompts: async () => ({}),
        env: { cwd: "/repo", homeDir: "/home/test", variables: {} },
        logger: () => {},
        exitOverride: true
      });
      const script = await emitCompletion(shell, program);

      for (const path of ["", "models", "maestro", "plan", "plans", "harness"]) {
        expect(script).not.toContain(`      "${path}") continue;;`);
      }
      for (const path of ["unknown", "plan unknown", "models unexpected", "maestro WORKFLOW.md"]) {
        expect(script).not.toContain(`      "${path}") continue;;`);
        expect(readCompletionWords(script, path)).toEqual([]);
      }
    });

    it("handles flags, pending values, and terminators before retaining an operand", async () => {
      const program = createFixtureProgram();
      program.commands.find((command) => command.name() === "plan")!
        .commands.find((command) => command.name() === "open")!.argument("[path]");
      const script = await emitCompletion(shell, program);

      expect(script).toContain('"plan open:--editor"');
      expect(script).toContain([
        "      esac",
        '      [[ "$word" == -* ]] && continue',
        "    fi",
        "    (( parent_operands )) && continue",
        '    case "$key" in'
      ].join("\n"));
      expect(script).toContain([
        "    esac",
        '    key="${key:+$key }$word"',
        "  done",
        "  (( expecting_value )) && return"
      ].join("\n"));
      expect(readCompletionWords(script, "plan open", true)).toEqual([]);
    });
  });

  it("does not change fish output when a leaf gains positional arguments", async () => {
    const program = createFixtureProgram();
    const before = await emitCompletion("fish", program);
    program.commands.find((command) => command.name() === "plan")!
      .commands.find((command) => command.name() === "open")!.argument("[path]");

    expect(await emitCompletion("fish", program)).toBe(before);
  });

  describe.each(["bash", "zsh"])("%s parent positional operands", (shell) => {
    it.each([
      { input: "maestro WORKFLOW.md --co", path: "maestro", prefix: "--co", parent: true, ended: false, expected: ["--config"] },
      { input: "gaslight one.md --ag", path: "gaslight", prefix: "--ag", parent: true, ended: false, expected: ["--agent"] },
      { input: "gaslight one.md daemon --ag", path: "gaslight", prefix: "--ag", parent: true, ended: false, expected: ["--agent"] },
      { input: "gaslight one.md install", path: "gaslight", prefix: "install", parent: true, ended: false, expected: [] },
      { input: "experiment journal experiment.md --verb", path: "experiment journal", prefix: "--verb", parent: true, ended: false, expected: ["--verbose"] },
      { input: "experiment journal experiment.md log", path: "experiment journal", prefix: "log", parent: true, ended: false, expected: [] },
      { input: "experiment journal log experiment.md --verb", path: "experiment journal log", prefix: "--verb", parent: false, ended: false, expected: ["--verbose"] },
      { input: "maestro r", path: "maestro", prefix: "r", parent: false, ended: false, expected: ["run"] },
      { input: "maestro --config run r", path: "maestro", prefix: "r", parent: false, ended: false, expected: ["run"] },
      { input: "maestro --config other.md run --co", path: "maestro run", prefix: "--co", parent: false, ended: false, expected: ["--config"] },
      { input: "maestro --config other.md WORKFLOW.md --co", path: "maestro", prefix: "--co", parent: true, ended: false, expected: ["--config"] },
      { input: "maestro WORKFLOW.md --config other.md --co", path: "maestro", prefix: "--co", parent: true, ended: false, expected: ["--config"] },
      { input: "maestro WORKFLOW.md --config run --co", path: "maestro", prefix: "--co", parent: true, ended: false, expected: ["--config"] },
      { input: "maestro --config -- r", path: "maestro", prefix: "r", parent: false, ended: false, expected: ["run"] },
      { input: "maestro WORKFLOW.md --config -- --co", path: "maestro", prefix: "--co", parent: true, ended: false, expected: ["--config"] },
      { input: "maestro WORKFLOW.md --config -- -- --co", path: "maestro", prefix: "--co", parent: true, ended: true, expected: [] },
      { input: "maestro -- r", path: "maestro", prefix: "r", parent: false, ended: true, expected: ["run"] },
      { input: "maestro -- WORKFLOW.md --co", path: "maestro", prefix: "--co", parent: true, ended: true, expected: [] },
      { input: "maestro WORKFLOW.md -- --co", path: "maestro", prefix: "--co", parent: true, ended: true, expected: [] },
      { input: "gaslight one.md -- daemon --ag", path: "gaslight", prefix: "--ag", parent: true, ended: true, expected: [] },
      { input: "maestro -- --config run r", path: "maestro", prefix: "r", parent: true, ended: true, expected: [] },
      { input: "plan unexpected --y", path: "plan unexpected", prefix: "--y", parent: false, ended: false, expected: [] },
      { input: "unknown WORKFLOW.md --co", path: "unknown WORKFLOW.md", prefix: "--co", parent: false, ended: false, expected: [] }
    ])("generates the real-tree branch for $input", async ({ path, prefix, parent, ended, expected }) => {
      const program = createProgram({
        fs: createMemFs(),
        prompts: async () => ({}),
        env: { cwd: "/repo", homeDir: "/home/test", variables: {} },
        logger: () => {},
        exitOverride: true
      });
      const script = await emitCompletion(shell, program);

      if (parent) {
        expect(script).toContain(`      "${path}:"*) parent_operands=1; continue;;`);
      }
      expect(readCompletionWords(script, path, ended, parent).filter((word) => word.startsWith(prefix)))
        .toEqual(expected);
    });

    it("checks every registered child and alias before starting parent operands", async () => {
      const program = createFixtureProgram();
      program.commands.find((command) => command.name() === "plan")!.argument("[paths...]");
      const script = await emitCompletion(shell, program);

      for (const parent of ["plan", "plans", "p"]) {
        const childCase = `      "${parent}:open"|"${parent}:view"|"${parent}:show"|"${parent}:internal"|"${parent}:private") ;;`;
        const operandCase = `      "${parent}:"*) parent_operands=1; continue;;`;
        expect(script).toContain(childCase);
        expect(script).toContain(operandCase);
        expect(script.indexOf(childCase)).toBeLessThan(script.indexOf(operandCase));
        expect(readCompletionWords(script, parent)).toEqual(["open", "view", "show", "--directory", "--yes", "--help"]);
        expect(readCompletionWords(script, parent, false, true)).toEqual(["--directory", "--yes", "--help"]);
        expect(readCompletionWords(script, parent, true)).toEqual(["open", "view", "show"]);
        expect(readCompletionWords(script, parent, true, true)).toEqual([]);
        for (const child of ["internal", "private"]) {
          expect(readCompletionWords(script, `${parent} ${child}`)).toEqual([]);
          expect(readCompletionWords(script, `${parent} ${child}`, false, true)).toEqual([]);
        }
      }
    });

    it("keeps metadata for positional parents with only hidden children and no regular options", async () => {
      const program = new Command().name("poe-code");
      program.command("parent").argument("[value]")
        .command("internal", { hidden: true }).alias("private");
      registerCompletionCommand(program);
      const script = await emitCompletion(shell, program);

      expect(script).toContain('      "parent:internal"|"parent:private") ;;');
      expect(script).toContain('      "parent:"*) parent_operands=1; continue;;');
      expect(script).not.toContain('      "parent") continue;;');
      expect(readCompletionWords(script, "parent", false, true)).toEqual(["--help"]);
    });

    it("keeps pending values and terminators ahead of parent retention and later child-looking operands", async () => {
      const program = createFixtureProgram();
      program.commands.find((command) => command.name() === "plan")!.argument("[paths...]");
      const script = await emitCompletion(shell, program);

      expect(script).toContain("  options_ended=0\n  parent_operands=0\n");
      expect(script).toContain('"plan:--directory"');
      expect(script).toContain([
        "      esac",
        '      [[ "$word" == -* ]] && continue',
        "    fi",
        "    (( parent_operands )) && continue",
        '    case "$key" in'
      ].join("\n"));
      expect(script).toContain('    esac\n    case "$key:$word" in\n');
      expect(script).toContain([
        "    esac",
        '    key="${key:+$key }$word"',
        "  done",
        "  (( expecting_value )) && return"
      ].join("\n"));
    });

    it("does not enable parent operands for leaves, unknown paths, or no-argument groups", async () => {
      const script = await emitCompletion(shell);

      for (const path of ["", "plan", "plans", "plan open", "configure", "unknown", "plan unknown"]) {
        expect(script).not.toContain(`      "${path}:"*) parent_operands=1; continue;;`);
        expect(readCompletionWords(script, path, false, true)).toEqual([]);
      }
    });
  });

  it("leaves fish output unchanged when a parent gains positional operands", async () => {
    const program = createFixtureProgram();
    const before = await emitCompletion("fish", program);
    program.commands.find((command) => command.name() === "plan")!.argument("[paths...]");

    expect(await emitCompletion("fish", program)).toBe(before);
  });

  describe.each(["bash", "zsh", "fish"])("%s implicit help options", (shell) => {
    it.each(["", "models", "plan view", "harness run", "maestro", "plans view"])(
      "includes current-command help and description at real path '%s'",
      async (path) => {
        const program = createProgram({
          fs: createMemFs(),
          prompts: async () => ({}),
          env: { cwd: "/repo", homeDir: "/home/test", variables: {} },
          logger: () => {},
          exitOverride: true
        });
        const script = await emitCompletion(shell, program);

        if (shell === "fish") {
          const condition = path === "" ? "__fish_use_subcommand" : `__fish_seen_subcommand_from ${path.split(" ").at(-1)}`;
          expect(script).toContain(
            `complete -c poe-code -n "${condition}" -l help -d 'Display help for command'`
          );
        } else {
          expect(readCompletionWords(script, path).filter((word) => word.startsWith("--he")))
            .toEqual(["--help"]);
          expect(readCompletionWords(script, path, true)).not.toContain("--help");
          expect(script).not.toContain(`"${path}:--help"`);
          expect(script).not.toContain(`"${path}:-h"`);
        }
      }
    );

    it.each(["eval", "gh", "code-review", "superintendent"])(
      "does not inherit implicit help into disabled real wrapper %s",
      async (path) => {
        const program = createProgram({
          fs: createMemFs(),
          prompts: async () => ({}),
          env: { cwd: "/repo", homeDir: "/home/test", variables: {} },
          logger: () => {},
          exitOverride: true
        });
        const script = await emitCompletion(shell, program);

        if (shell === "fish") {
          expect(script).not.toContain(`complete -c poe-code -n "__fish_seen_subcommand_from ${path}" -l help `);
        } else {
          expect(readCompletionWords(script, path)).not.toContain("--help");
        }
      }
    );

    it("keeps help-only leaves and their aliases in the generated tree", async () => {
      const program = new Command().name("poe-code");
      program.command("bare").alias("empty");
      registerCompletionCommand(program);
      const script = await emitCompletion(shell, program);

      for (const path of ["bare", "empty"]) {
        if (shell === "fish") {
          expect(script).toContain(
            `complete -c poe-code -n "__fish_seen_subcommand_from ${path}" -l help -d 'display help for command'`
          );
        } else {
          expect(readCompletionWords(script, path)).toEqual(["--help"]);
          expect(readCompletionWords(script, path, true)).toEqual([]);
        }
      }
    });

    it.each([
      {
        name: "custom help and description",
        setup: (command: Command) => command.helpOption("-h, --assist", "Custom assistance."),
        expected: ["--assist"],
        description: "Custom assistance."
      },
      {
        name: "disabled help",
        setup: (command: Command) => command.helpOption(false),
        expected: [],
        description: ""
      },
      {
        name: "hidden addHelpOption",
        setup: (command: Command) => command.addHelpOption(new Option("--assist <value>", "Hidden assistance.").hideHelp()),
        expected: [],
        description: ""
      },
      {
        name: "short-only help without inventing a long spelling",
        setup: (command: Command) => command.helpOption("-?", "Short assistance."),
        expected: [],
        description: ""
      }
    ])("respects $name across aliases", async ({ setup, expected, description }) => {
      const program = createFixtureProgram();
      const target = program.commands.find((command) => command.name() === "configure")!;
      target.aliases(["setup", "cfg"]);
      setup(target);
      const script = await emitCompletion(shell, program);

      for (const path of ["configure", "setup", "cfg"]) {
        if (shell === "fish") {
          const prefix = `complete -c poe-code -n "__fish_seen_subcommand_from ${path}" -l `;
          const lines = script.split("\n").filter((line) =>
            line.startsWith(`${prefix}help `) || line.startsWith(`${prefix}assist `)
          );
          expect(lines).toEqual(expected.map((flag) => `${prefix}${flag.slice(2)} -d '${description}'`));
        } else {
          expect(readCompletionWords(script, path).filter((word) => word === "--help" || word === "--assist"))
            .toEqual(expected);
          for (const flag of ["--help", "-h", "--assist", "-?"]) {
            expect(script).not.toContain(`"${path}:${flag}"`);
          }
        }
      }
    });

    it.each([
      {
        name: "local regular --help leaves implicit short -h only",
        setup: (_program: Command, command: Command) => command.option("--help <value>", "Regular help value."),
        expected: ["--help"], description: "Regular help value.", required: ["--help"], excluded: ["-h"]
      },
      {
        name: "local regular -h leaves implicit --help",
        setup: (_program: Command, command: Command) => command.option("-h <value>", "Regular short value."),
        expected: ["--help"], description: "display help for command", required: ["-h"], excluded: ["--help"]
      },
      {
        name: "inherited regular required value wins over child help",
        setup: (program: Command, command: Command) => {
          program.option("--assist <value>", "Inherited assistance value.");
          command.helpOption("--assist", "Implicit assistance.");
        },
        expected: ["--assist"], description: "Inherited assistance value.", required: ["--assist"], excluded: ["--help"]
      },
      {
        name: "hidden nearest regular spelling still masks an ancestor",
        setup: (program: Command, command: Command) => {
          program.option("--help", "Ancestor help.");
          command.addOption(new Option("--help <value>", "Hidden regular value.").hideHelp());
        },
        expected: [], description: "", required: ["--help"], excluded: ["-h"]
      },
      {
        name: "hidden inherited regular spelling is not revived through implicit -h",
        setup: (program: Command, _command: Command) => program.addOption(new Option("--help <value>", "Hidden inherited value.").hideHelp()),
        expected: [], description: "", required: ["--help"], excluded: ["-h"]
      }
    ])("preserves $name", async ({ setup, expected, description, required, excluded }) => {
      const program = createFixtureProgram();
      const target = program.commands.find((command) => command.name() === "configure")!;
      setup(program, target);
      const script = await emitCompletion(shell, program);

      if (shell === "fish") {
        const prefix = 'complete -c poe-code -n "__fish_seen_subcommand_from configure" -l ';
        const lines = script.split("\n").filter((line) =>
          line.startsWith(`${prefix}help `) || line.startsWith(`${prefix}assist `)
        );
        expect(lines).toEqual(expected.map((flag) => `${prefix}${flag.slice(2)} -d '${description}'`));
      } else {
        expect(readCompletionWords(script, "configure").filter((word) => word === "--help" || word === "--assist"))
          .toEqual(expected);
        for (const flag of required) {
          expect(script).toContain(`"configure:${flag}"`);
        }
        for (const flag of excluded) {
          expect(script).not.toContain(`"configure:${flag}"`);
        }
      }
    });
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
        "    (( parent_operands )) && continue",
        '    case "$key" in'
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
          ? '"0:0:plan") completions="browse open view show --kind --optional --many --profile --boolean --help";;'
          : '"0:0:plan") completions=(browse open view show --kind --optional --many --profile --boolean --help);;'
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
