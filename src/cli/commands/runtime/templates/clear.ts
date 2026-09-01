import { createStateManager, type TemplateBackend } from "@poe-code/poe-code-config/core";
import type { Command } from "commander";
import type { CliContainer } from "../../../container.js";
import { createExecutionResources, resolveCommandFlags } from "../../shared.js";
import { confirmDestructive } from "../../confirm-destructive.js";

const backends: TemplateBackend[] = ["docker"];

export function registerRuntimeTemplatesClearCommand(
  templates: Command,
  root: Command,
  container: CliContainer
): void {
  templates
    .command("clear")
    .description(
      "Danger: deletes locally built runtime template cache entries, forcing a rebuild. Requires --yes to run non-interactively; preview with --dry-run."
    )
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

  const entryLabels = entriesByBackend.flatMap((group) =>
    group.entries.map((entry) => `${group.backend} ${entry.hash} (${entry.image})`)
  );

  if (flags.dryRun) {
    resources.logger.dryRun(
      `Dry run: would clear ${total} local runtime template cache ${total === 1 ? "entry" : "entries"}.`
    );
    for (const label of entryLabels) {
      resources.logger.info(label);
    }
    return;
  }

  await confirmDestructive({
    logger: resources.logger,
    flags,
    action: "runtime templates clear",
    summary: entryLabels,
    message: `Clear ${total} local runtime template cache ${total === 1 ? "entry" : "entries"}?`
  });

  for (const group of entriesByBackend) {
    for (const entry of group.entries) {
      await state.templates.remove(group.backend, entry.hash);
    }
  }

  resources.logger.success(
    `Cleared ${total} local runtime template cache ${total === 1 ? "entry" : "entries"}.`
  );
}
