import { Argument, type Command } from "commander";
import { listBuiltinTemplates } from "@poe-code/agent-harness/templates";
import { withSpinner } from "toolcraft-design";
import type { CliContainer } from "../container.js";
import { ValidationError } from "../errors.js";
import { resolveCommandFlags } from "./shared.js";
import { addWorktreeOptions } from "./worktree-options.js";

export type HarnessRunOptions = {
  agent?: string;
  dir?: string;
  fix?: boolean;
  fs?: boolean;
  fsRoot?: string;
  fsConfig?: string;
  envConfig?: string;
  maxSteps?: number;
  dataSize?: number;
  mcpConfig?: string;
  mode?: string;
  model?: string;
  resume?: boolean;
  snapshotPath?: string;
  worktree?: boolean;
  yes?: boolean;
};

export type HarnessNewOptions = {
  dir?: string;
  yes?: boolean;
};

export function registerHarnessCommand(program: Command, container: CliContainer): void {
  const harness = program.command("harness").description("Run and manage agent harness pairs.");

  addWorktreeOptions(
    harness
      .command("run")
      .description("Run a harness pair.")
      .argument("[md-paths...]", "Paths to harness .md files to run sequentially")
      .option("--dir <path>", "Directory to search for harness pairs when no md-path is given.")
      .option("--fix", "Apply supported lint fixes to the harness .ajs file before running.")
      .option("--fs", "Give the harness a real filesystem module, confined to --fs-root.")
      .option(
        "--fs-root <path>",
        "Directory --fs confines the harness to (default: the harness directory)."
      )
      .option(
        "--fs-config <path>",
        "Configure shared filesystem access from JSON (Node only).",
        (value: string, previous: string | undefined) => {
          if (previous !== undefined)
            throw new ValidationError("--fs-config may be specified only once.");
          if (value.trim().length === 0)
            throw new ValidationError("--fs-config needs a JSON file path.");
          return value;
        }
      )
      .option("--snapshot-path <path>", "File to write/read harness snapshots.")
      .option(
        "--max-steps <n>",
        "Cap interpreter steps; raise explicitly when resuming.",
        (value) => parseBudgetLimit(value, "--max-steps")
      )
      .option(
        "--data-size <n>",
        "Cap retained sandbox data; raise explicitly when resuming.",
        (value) => parseBudgetLimit(value, "--data-size")
      )
      .option("--mcp-config <path>", "Give the harness named MCP servers from a JSON config.")
      .option("--env-config <path>", "Grant environment reads from an explicit JSON config.")
      .option("--resume", "Resume from the snapshot file when it exists.")
      .option("--agent <name>", "Override the agent id from the harness frontmatter agent block.")
      .option("--model <name>", "Override the model from the harness frontmatter agent block.")
      .option(
        "--mode <mode>",
        "Override the mode from the harness frontmatter agent block (read|edit|auto|yolo)."
      )
      .option("-y, --yes", "Accept defaults without prompting.")
  ).action(async (mdPaths: string[], options: HarnessRunOptions) => {
    const { executeHarnessRun } = await import("./harness-runtime.js");
    const selectedPaths: Array<string | undefined> = mdPaths.length > 0 ? mdPaths : [undefined];
    for (const mdPath of selectedPaths) {
      await executeHarnessRun(program, container, mdPath, options);
    }
  });

  harness
    .command("migrate")
    .description("Inspect or explicitly migrate a checkpoint to continuation source.")
    .argument("<snapshot-path>", "Original checkpoint JSON; never overwritten")
    .requiredOption("--from <path>", "Original executable .ajs source")
    .option("--inspect", "Inspect identities and unresolved calls without writing")
    .option("--to <path>", "New continuation .ajs source")
    .option("--plan <path>", "JSON application state and digest-bound reconciliation")
    .option("--output <path>", "New checkpoint path; must not already exist")
    .action(
      async (
        snapshotPath: string,
        options: { from: string; inspect?: boolean; to?: string; plan?: string; output?: string }
      ) => {
        const { migrateSnapshotFile } = await import("@poe-code/safe-js");
        const flags = resolveCommandFlags(program);
        const result = await withSpinner({
          message: options.inspect ? "Inspecting checkpoint" : "Validating checkpoint migration",
          fn: () =>
            migrateSnapshotFile({
              snapshotPath,
              sourcePath: options.from,
              targetSourcePath: options.to,
              planPath: options.plan,
              outputPath: options.output,
              inspect: options.inspect,
              dryRun: flags.dryRun,
              cwd: container.env.cwd
            })
        });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      }
    );

  harness
    .command("new")
    .description("Scaffold a harness pair from a built-in template.")
    .addArgument(
      new Argument("<kind>", "Built-in template kind").choices(
        listBuiltinTemplates().map((template) => template.kind)
      )
    )
    .argument("<basename>", "New harness basename")
    .option("--dir <path>", "Output directory for the harness pair")
    .option("-y, --yes", "Accept defaults without prompting.")
    .action(async (kind: string, basename: string, options: HarnessNewOptions) => {
      const { executeHarnessNew } = await import("./harness-runtime.js");
      await executeHarnessNew(program, container, kind, basename, options);
    });

  harness
    .command("list")
    .description("List discovered harness pairs.")
    .option("--dir <path>", "Additional directory to search for harness pairs.")
    .action(async (options: { dir?: string }) => {
      const { executeHarnessList } = await import("./harness-runtime.js");
      await executeHarnessList(program, container, options.dir);
    });
}

function parseBudgetLimit(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`${flag} must be a positive safe integer.`);
  }
  return parsed;
}
