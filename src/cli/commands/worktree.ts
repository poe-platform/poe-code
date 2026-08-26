import type { Command } from "commander";
import {
  listManagedWorktrees,
  reconcileManagedWorktree,
  removeManagedWorktree
} from "../../sdk/worktree.js";
import type { CliContainer } from "../container.js";
import { createExecutionResources, resolveCommandFlags } from "./shared.js";
import { confirmDestructive } from "./confirm-destructive.js";

type WorktreeReconcileOptions = {
  agent?: string;
};

type WorktreeRemoveOptions = {
  deleteBranch?: boolean;
};

export function registerWorktreeCommand(program: Command, container: CliContainer): void {
  const worktree = program
    .command("worktree")
    .description("Manage poe-code worktree runs.")
    .action(async () => {
      await executeWorktreeList(program, container);
    });

  worktree
    .command("list")
    .description("List managed worktrees.")
    .action(async () => {
      await executeWorktreeList(program, container);
    });

  worktree
    .command("reconcile")
    .description("Reconcile an existing failed managed worktree.")
    .argument("<name>", "Managed worktree name")
    .requiredOption("--agent <name>", "Agent to perform reconciliation")
    .action(async (name: string, options: WorktreeReconcileOptions) => {
      await executeWorktreeReconcile(program, container, name, options);
    });

  worktree
    .command("remove")
    .description(
      "Danger: deletes the managed worktree directory, discarding any uncommitted changes it holds. Requires --yes to run non-interactively; preview with --dry-run."
    )
    .argument("<name>", "Managed worktree name")
    .option("--delete-branch", "Delete the managed branch after removing the worktree")
    .action(async (name: string, options: WorktreeRemoveOptions) => {
      await executeWorktreeRemove(program, container, name, options);
    });
}

async function executeWorktreeList(program: Command, container: CliContainer): Promise<void> {
  const resources = createExecutionResources(container, resolveCommandFlags(program), "worktree:list");
  resources.logger.intro("worktree list");
  const entries = await listManagedWorktrees({ cwd: container.env.cwd });
  if (entries.length === 0) {
    resources.logger.info("No managed worktrees.");
    return;
  }
  for (const entry of entries) {
    const state = entry.gitExists ? "present" : "missing";
    resources.logger.info(`${entry.name} ${entry.status} ${state} ${entry.path}`);
  }
}

async function executeWorktreeReconcile(
  program: Command,
  container: CliContainer,
  name: string,
  options: WorktreeReconcileOptions
): Promise<void> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(
    container,
    flags,
    "worktree:reconcile"
  );
  resources.logger.intro("worktree reconcile");
  if (flags.dryRun) {
    resources.logger.dryRun(
      `Dry run: would reconcile worktree ${name} with agent ${options.agent}.`
    );
    return;
  }
  const summary = await reconcileManagedWorktree({
    cwd: container.env.cwd,
    name,
    agent: options.agent as string
  });
  resources.logger.success(
    `Reconciled ${name}: committed ${summary.committed}, uncommitted ${summary.uncommitted}, cleanup ${summary.cleanup}`
  );
}

async function executeWorktreeRemove(
  program: Command,
  container: CliContainer,
  name: string,
  options: WorktreeRemoveOptions
): Promise<void> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, "worktree:remove");
  resources.logger.intro("worktree remove");

  const deleteBranch = options.deleteBranch === true;
  await confirmDestructive({
    logger: resources.logger,
    flags,
    action: `worktree remove ${name}`,
    summary: [
      `Deletes worktree ${name} and any uncommitted changes inside it.`,
      ...(deleteBranch ? [`Deletes the managed branch for ${name}.`] : [])
    ],
    message: `Remove worktree ${name}?`
  });

  if (flags.dryRun) {
    resources.logger.dryRun(
      `Dry run: would remove worktree ${name}${deleteBranch ? " and its managed branch" : ""}.`
    );
    return;
  }

  await removeManagedWorktree({
    cwd: container.env.cwd,
    name,
    deleteBranch
  });
  resources.logger.success(`Removed worktree ${name}`);
}
