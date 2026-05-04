import type { Command } from "commander";
import type { CliContainer } from "../../../container.js";
import { createExecutionResources, resolveCommandFlags } from "../../shared.js";
import { attachJob, createRuntimeState, parseSince, resolveJob, streamJobLog } from "./shared.js";

export function registerRuntimeJobsLogsCommand(
  jobs: Command,
  root: Command,
  container: CliContainer
): void {
  jobs
    .command("logs")
    .description("Dump a detached runtime job log.")
    .argument("[jobId]", "Detached job id")
    .option("--since <duration>", "Only include logs from recently modified log files")
    .action(async (jobId: string | undefined, options: { since?: string }) => {
      await executeRuntimeJobsLogs(root, container, jobId, options);
    });
}

async function executeRuntimeJobsLogs(
  root: Command,
  container: CliContainer,
  jobId: string | undefined,
  options: { since?: string }
): Promise<void> {
  const flags = resolveCommandFlags(root);
  const resources = createExecutionResources(container, flags, "runtime:jobs:logs");
  const state = createRuntimeState(container);
  const entry = await resolveJob(state, jobId, "pullable");
  const { handle } = await attachJob(entry);

  await streamJobLog(handle, {
    since: parseSince(options.since),
    follow: false,
    write(chunk) {
      resources.logger.info(chunk.trimEnd());
    }
  });
}
