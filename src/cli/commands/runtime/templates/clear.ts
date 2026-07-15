import { cancel as dsCancel, confirm as dsConfirm, isCancel } from "toolcraft-design";
import { createStateManager, type TemplateBackend } from "@poe-code/poe-code-config";
import type { Command } from "commander";
import { OperationCancelledError } from "../../../errors.js";
import type { CliContainer } from "../../../container.js";
import { createExecutionResources, resolveCommandFlags } from "../../shared.js";

const backends: TemplateBackend[] = ["docker"];

export function registerRuntimeTemplatesClearCommand(
  templates: Command,
  root: Command,
  container: CliContainer
): void {
  templates
    .command("clear")
    .description("Clear locally built runtime template cache entries.")
    .action(async () => {
      await executeRuntimeTemplatesClear(root, container);
    });
}

async function executeRuntimeTemplatesClear(
  program: Command,
  container: CliContainer
): Promise<void> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, "runtime:templates:clear");
  const state = createStateManager(
    container.env.homeDir,
    container.fs as unknown as Parameters<typeof createStateManager>[1]
  );
  const entriesByBackend = await Promise.all(
    backends.map(async (backend) => ({
      backend,
      entries: await state.templates.list(backend)
    }))
  );
  const total = entriesByBackend.reduce((sum, group) => sum + group.entries.length, 0);

  resources.logger.intro("runtime templates clear");

  if (total === 0) {
    resources.logger.info("No local runtime template cache entries to clear.");
    return;
  }

  if (!flags.assumeYes) {
    const confirmed = await dsConfirm({
      message: `Clear ${total} local runtime template cache ${total === 1 ? "entry" : "entries"}?`,
      initialValue: false
    });
    if (isCancel(confirmed)) {
      dsCancel("Operation cancelled.");
      throw new OperationCancelledError();
    }
    if (confirmed !== true) {
      resources.logger.info("Runtime template cache unchanged.");
      return;
    }
  }

  if (flags.dryRun) {
    resources.logger.dryRun(
      `Dry run: would clear ${total} local runtime template cache ${total === 1 ? "entry" : "entries"}.`
    );
    return;
  }

  for (const group of entriesByBackend) {
    for (const entry of group.entries) {
      await state.templates.remove(group.backend, entry.hash);
    }
  }

  resources.logger.success(
    `Cleared ${total} local runtime template cache ${total === 1 ? "entry" : "entries"}.`
  );
}
