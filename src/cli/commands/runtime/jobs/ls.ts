import { getTheme, renderTable, text, type TableColumn } from "@poe-code/design-system";
import type { Command } from "commander";
import type { JobEntry } from "@poe-code/poe-code-config";
import type { CliContainer } from "../../../container.js";
import { createExecutionResources, resolveCommandFlags } from "../../shared.js";
import { attachJob, createRuntimeState } from "./shared.js";

export function registerRuntimeJobsLsCommand(jobs: Command, root: Command, container: CliContainer): void {
  jobs
    .command("ls")
    .description("List detached runtime jobs.")
    .action(async () => {
      await executeRuntimeJobsLs(root, container);
    });
}

async function executeRuntimeJobsLs(root: Command, container: CliContainer): Promise<void> {
  const flags = resolveCommandFlags(root);
  const resources = createExecutionResources(container, flags, "runtime:jobs:ls");
  const state = createRuntimeState(container);
  const recordedEntries = await state.jobs.list();
  const entries = flags.dryRun
    ? recordedEntries
    : await reconcileRunningJobs(recordedEntries, state);
  const theme = getTheme();

  if (flags.dryRun) {
    resources.logger.dryRun(
      "Dry run: would inspect active sandboxes and persist reconciled runtime job statuses."
    );
  }
  resources.logger.intro("runtime jobs ls");
  resources.logger.info(
    renderTable({
      theme,
      columns,
      rows: entries.map((entry) => ({
        Job: entry.id,
        Tool: entry.tool,
        Runtime: entry.env_kind,
        Status: entry.status,
        Started: entry.started_at || text.muted("-"),
        Sandbox: entry.env_id || text.muted("-")
      }))
    })
  );
}

async function reconcileRunningJobs(
  entries: JobEntry[],
  state: ReturnType<typeof createRuntimeState>
): Promise<JobEntry[]> {
  const reconciled: JobEntry[] = [];
  for (const entry of entries) {
    if (entry.status !== "running") {
      reconciled.push(entry);
      continue;
    }

    try {
      const { handle } = await attachJob(entry);
      const status = await handle.status();
      const updated = status === entry.status ? entry : await state.jobs.update(entry.id, { status });
      reconciled.push(updated ?? { ...entry, status });
    } catch {
      const updated = await state.jobs.update(entry.id, { status: "lost" });
      reconciled.push(updated ?? { ...entry, status: "lost" });
    }
  }
  return reconciled;
}

const columns: TableColumn[] = [
  { name: "Job", title: "JOB", alignment: "left", maxLen: 28 },
  { name: "Tool", title: "TOOL", alignment: "left", maxLen: 16 },
  { name: "Runtime", title: "RUNTIME", alignment: "left", maxLen: 10 },
  { name: "Status", title: "STATUS", alignment: "left", maxLen: 10 },
  { name: "Started", title: "STARTED", alignment: "left", maxLen: 24 },
  { name: "Sandbox", title: "SANDBOX", alignment: "left", maxLen: 28 }
];
