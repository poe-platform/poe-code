import { getTheme, renderDetailCard, text, type DetailCardRow } from "toolcraft-design";
import type { Command } from "commander";
import type { CliContainer } from "../../../container.js";
import { createExecutionResources, resolveCommandFlags } from "../../shared.js";
import { createRuntimeState, resolveJob } from "./shared.js";

export function registerRuntimeJobsShowCommand(
  jobs: Command,
  root: Command,
  container: CliContainer
): void {
  jobs
    .command("show")
    .description("Show details for a single detached runtime job.")
    .argument("[jobId]", "Detached job id")
    .action(async (jobId: string | undefined) => {
      await executeRuntimeJobsShow(root, container, jobId);
    });
}

async function executeRuntimeJobsShow(
  root: Command,
  container: CliContainer,
  jobId: string | undefined
): Promise<void> {
  const flags = resolveCommandFlags(root);
  const resources = createExecutionResources(container, flags, "runtime:jobs:show");
  const state = createRuntimeState(container);
  const entry = await resolveJob(state, jobId, "pullable");

  const result: DetailCardRow[] = [
    ...(entry.exit_code === undefined ? [] : [{ label: "Exit code", value: String(entry.exit_code) }]),
    ...(entry.exited_at === undefined ? [] : [{ label: "Exited", value: entry.exited_at }]),
    ...(entry.log_file === undefined ? [] : [{ label: "Log file", value: entry.log_file }])
  ];

  resources.logger.intro("runtime jobs show");
  resources.logger.info(
    renderDetailCard({
      theme: getTheme(),
      title: entry.id,
      subtitle: entry.tool,
      badges: [entry.status],
      sections: [
        {
          title: "Job",
          rows: [
            { label: "Runtime", value: entry.env_kind },
            { label: "Sandbox", value: entry.env_id },
            { label: "Started", value: entry.started_at || text.muted("-") },
            { label: "Command", value: entry.argv.join(" ") },
            { label: "Directory", value: entry.cwd }
          ]
        },
        { title: "Result", rows: result }
      ]
    })
  );
}
