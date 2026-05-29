import type { Command } from "commander";
import type { CliContainer } from "../../../container.js";
import { createExecutionResources, resolveCommandFlags } from "../../shared.js";
import { createRuntimeState, resolveJob, syncJob } from "./shared.js";

export function registerRuntimeJobsSyncCommand(
  jobs: Command,
  root: Command,
  container: CliContainer
): void {
  jobs
    .command("sync")
    .description("Download a detached runtime job workspace.")
    .argument("[jobId]", "Detached job id")
    .option("--force-sync", "Overwrite local files when syncing")
    .option("--close", "Close the sandbox after syncing")
    .action(
      async (
        jobId: string | undefined,
        options: { forceSync?: boolean; close?: boolean }
      ) => {
        await executeRuntimeJobsSync(root, container, jobId, options);
      }
    );
}

async function executeRuntimeJobsSync(
  root: Command,
  container: CliContainer,
  jobId: string | undefined,
  options: { forceSync?: boolean; close?: boolean }
): Promise<void> {
  const flags = resolveCommandFlags(root);
  const resources = createExecutionResources(container, flags, "runtime:jobs:sync");
  const state = createRuntimeState(container);
  const entry = await resolveJob(state, jobId, "pullable");
  if (flags.dryRun) {
    resources.logger.dryRun(`Dry run: would sync workspace from runtime job ${entry.id}.`);
    return;
  }

  await syncJob(entry, {
    forceSync: options.forceSync === true,
    close: options.close === true
  });
  if (options.close === true) {
    await state.jobs.remove(entry.id);
  }
  resources.logger.success(`Synced runtime job ${entry.id}.`);
}
