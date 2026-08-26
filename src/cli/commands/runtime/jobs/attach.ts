import type { Command } from "commander";
import type { CliContainer } from "../../../container.js";
import { createExecutionResources, resolveCommandFlags } from "../../shared.js";
import {
  attachJob,
  createLineBufferedLogWriter,
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
  const since = parseSince(options.since);
  if (flags.dryRun) {
    const syncDetail = options.syncOnExit === true ? " and sync its workspace on exit" : "";
    resources.logger.dryRun(`Dry run: would attach to runtime job ${entry.id}${syncDetail}.`);
    return;
  }
  const { handle } = await attachJob(entry);
  const logWriter = createLineBufferedLogWriter((line) => {
    resources.logger.info(line);
  });
  let detached = false;

  await streamJobLog(handle, {
    since,
    follow: true,
    write(chunk) {
      logWriter.write(chunk);
    },
    onDetach() {
      detached = true;
      logWriter.flush();
      resources.logger.info("detaching (job continues running)");
    }
  });
  logWriter.flush();

  if (!detached && options.syncOnExit === true && (await handle.status()) !== "running") {
    await syncJob(entry, { forceSync: options.forceSync === true, close: false });
  }
}
