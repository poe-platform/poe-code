import type { Command } from "commander";
import type { CliContainer } from "../../../container.js";
import { createExecutionResources, resolveCommandFlags } from "../../shared.js";
import {
  attachJob,
  createRuntimeState,
  resolveJob,
  syncJob,
  waitForGracefulStop
} from "./shared.js";

export function registerRuntimeJobsStopCommand(
  jobs: Command,
  root: Command,
  container: CliContainer
): void {
  jobs
    .command("stop")
    .description("Stop a detached runtime job.")
    .argument("[jobId]", "Detached job id")
    .option("--sync", "Download the workspace after stopping")
    .option("--force-sync", "Overwrite local files when syncing")
    .action(
      async (
        jobId: string | undefined,
        options: { sync?: boolean; forceSync?: boolean }
      ) => {
        await executeRuntimeJobsStop(root, container, jobId, options);
      }
    );
}

async function executeRuntimeJobsStop(
  root: Command,
  container: CliContainer,
  jobId: string | undefined,
  options: { sync?: boolean; forceSync?: boolean }
): Promise<void> {
  const flags = resolveCommandFlags(root);
  const resources = createExecutionResources(container, flags, "runtime:jobs:stop");
  const state = createRuntimeState(container);
  const entry = await resolveJob(state, jobId, "pullable");
  const { handle } = await attachJob(entry);

  await waitForGracefulStop(handle);
  await state.jobs.update(entry.id, {
    status: "killed",
    exit_code: 130,
    exited_at: new Date().toISOString()
  });

  if (options.sync === true || options.forceSync === true) {
    await syncJob(entry, { forceSync: options.forceSync === true, close: false });
  }

  resources.logger.success(`Stopped runtime job ${entry.id}.`);
}
