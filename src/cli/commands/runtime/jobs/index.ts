import type { Command } from "commander";
import type { CliContainer } from "../../../container.js";
import { registerRuntimeJobsAttachCommand } from "./attach.js";
import { registerRuntimeJobsLogsCommand } from "./logs.js";
import { registerRuntimeJobsLsCommand } from "./ls.js";
import { registerRuntimeJobsSandboxCommand } from "./sandbox.js";
import { registerRuntimeJobsShowCommand } from "./show.js";
import { registerRuntimeJobsStopCommand } from "./stop.js";
import { registerRuntimeJobsSyncCommand } from "./sync.js";

export function registerRuntimeJobsCommand(
  runtime: Command,
  root: Command,
  container: CliContainer
): void {
  const jobs = runtime.command("jobs").description("Manage detached runtime jobs.");

  registerRuntimeJobsLsCommand(jobs, root, container);
  registerRuntimeJobsShowCommand(jobs, root, container);
  registerRuntimeJobsAttachCommand(jobs, root, container);
  registerRuntimeJobsLogsCommand(jobs, root, container);
  registerRuntimeJobsStopCommand(jobs, root, container);
  registerRuntimeJobsSyncCommand(jobs, root, container);
  registerRuntimeJobsSandboxCommand(jobs, root, container);
}
