import type { Command } from "commander";
import type { CliContainer } from "../../../container.js";
import { createExecutionResources, resolveCommandFlags } from "../../shared.js";
import {
  attachJob,
  createRuntimeState,
  parseSince,
  resolveJob,
  streamJobLog,
  syncJob
} from "./shared.js";

export function registerRuntimeJobsAttachCommand(
  jobs: Command,
  root: Command,
  container: CliContainer
): void {
  jobs
    .command("attach")
    .description("Attach to a detached runtime job log stream.")
    .argument("[jobId]", "Detached job id")
    .option("--since <duration>", "Only include logs from recently modified log files")
    .option("--sync-on-exit", "Download the workspace after the job exits")
    .option("--force-sync", "Overwrite local files when syncing")
    .action(
      async (
        jobId: string | undefined,
        options: { since?: string; syncOnExit?: boolean; forceSync?: boolean }
      ) => {
        await executeRuntimeJobsAttach(root, container, jobId, options);
      }
    );
}

async function executeRuntimeJobsAttach(
  root: Command,
  container: CliContainer,
  jobId: string | undefined,
  options: { since?: string; syncOnExit?: boolean; forceSync?: boolean }
): Promise<void> {
  const flags = resolveCommandFlags(root);
  const resources = createExecutionResources(container, flags, "runtime:jobs:attach");
  const state = createRuntimeState(container);
  const entry = await resolveJob(state, jobId, "running");
  const { handle } = await attachJob(entry);

  await streamJobLog(handle, {
    since: parseSince(options.since),
    follow: true,
    write(chunk) {
      resources.logger.info(chunk.trimEnd());
    },
    onDetach() {
      resources.logger.info("detaching (job continues running)");
    }
  });

  if (options.syncOnExit === true && (await handle.status()) !== "running") {
    await syncJob(entry, { forceSync: options.forceSync === true, close: false });
  }
}
