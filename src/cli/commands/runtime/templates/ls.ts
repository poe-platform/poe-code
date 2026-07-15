import { getTheme, renderTable, text, type TableColumn } from "toolcraft-design";
import {
  createStateManager,
  type TemplateBackend,
  type TemplateEntry
} from "@poe-code/poe-code-config";
import type { Command } from "commander";
import type { CliContainer } from "../../../container.js";
import { createExecutionResources, resolveCommandFlags } from "../../shared.js";

const backends: TemplateBackend[] = ["docker"];

export function registerRuntimeTemplatesLsCommand(
  templates: Command,
  root: Command,
  container: CliContainer
): void {
  templates
    .command("ls")
    .description("List cached runtime templates.")
    .action(async () => {
      await executeRuntimeTemplatesLs(root, container);
    });
}

async function executeRuntimeTemplatesLs(program: Command, container: CliContainer): Promise<void> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, "runtime:templates:ls");
  const state = createStateManager(
    container.env.homeDir,
    container.fs as unknown as Parameters<typeof createStateManager>[1]
  );
  const theme = getTheme();
  const rows: Record<string, string>[] = [];

  for (const backend of backends) {
    const entries = await state.templates.list(backend);
    if (entries.length === 0) {
      rows.push({
        Backend: theme.accent(backend),
        Hash: text.muted("(empty)"),
        Artifact: text.muted("-"),
        Dockerfile: text.muted("-"),
        Built: text.muted("-")
      });
      continue;
    }

    rows.push(...entries.map((entry) => formatEntryRow(backend, entry, theme)));
  }

  resources.logger.intro("runtime templates ls");
  resources.logger.info(renderTable({ theme, columns, rows }));
}

function formatEntryRow(
  backend: TemplateBackend,
  entry: TemplateEntry,
  theme: ReturnType<typeof getTheme>
): Record<string, string> {
  return {
    Backend: theme.accent(backend),
    Hash: entry.hash,
    Artifact: entry.image ?? entry.template_id ?? text.muted("-"),
    Dockerfile: entry.dockerfile_path,
    Built: entry.built_at
  };
}

const columns: TableColumn[] = [
  { name: "Backend", title: "Backend", alignment: "left", maxLen: 10 },
  { name: "Hash", title: "Hash", alignment: "left", maxLen: 16 },
  { name: "Artifact", title: "Artifact", alignment: "left", maxLen: 32 },
  { name: "Dockerfile", title: "Dockerfile", alignment: "left", maxLen: 36 },
  { name: "Built", title: "Built", alignment: "left", maxLen: 24 }
];
