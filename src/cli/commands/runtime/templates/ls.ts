import { getTheme, renderTable, text, type TableColumn } from "toolcraft-design";
import {
  createStateManager,
  type TemplateBackend,
  type TemplateEntry
} from "@poe-code/poe-code-config/core";
import type { Command } from "commander";
import type { CliContainer } from "../../../container.js";
import { createExecutionResources, resolveCommandFlags } from "../../shared.js";
import {
  listWindowHint,
  resolveListWindow,
  withListWindowOptions,
  type ListWindow,
  type ListWindowFlags
} from "../list-window.js";

const backends: TemplateBackend[] = ["docker"];

export function registerRuntimeTemplatesLsCommand(
  templates: Command,
  root: Command,
  container: CliContainer
): void {
  withListWindowOptions(
    templates
      .command("list")
      .alias("ls")
      .description("List cached runtime templates, newest first."),
    "templates"
  ).action(async (options: ListWindowFlags) => {
    await executeRuntimeTemplatesLs(root, container, options);
  });
}

async function executeRuntimeTemplatesLs(
  program: Command,
  container: CliContainer,
  options: ListWindowFlags
): Promise<void> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, "runtime:templates:list");
  const window = resolveListWindow(options);
  const state = createStateManager(
    container.env.homeDir,
    container.fs as unknown as Parameters<typeof createStateManager>[1]
  );
  const theme = getTheme();
  const rows: Record<string, string>[] = [];
  let shown = 0;

  for (const backend of backends) {
    const entries = selectRecentTemplates(await state.templates.list(backend), window);
    shown += entries.length;
    rows.push(...entries.map((entry) => formatEntryRow(backend, entry, theme)));
  }

  resources.logger.intro("runtime templates list");

  if (shown === 0) {
    resources.logger.info(
      "No local runtime template cache entries. Build one with poe-code runtime build."
    );
    return;
  }

  resources.logger.info(renderTable({ theme, columns, rows }));

  const hint = listWindowHint(window, shown, "templates");
  if (hint !== undefined) {
    resources.logger.info(hint);
  }
}

function selectRecentTemplates(entries: TemplateEntry[], window: ListWindow): TemplateEntry[] {
  const recent = entries
    .filter((entry) => isWithinSince(entry.built_at, window.since))
    .sort((left, right) => builtAtTime(right) - builtAtTime(left));
  return window.limit === undefined ? recent : recent.slice(0, window.limit);
}

function isWithinSince(builtAt: string, since: Date | undefined): boolean {
  if (since === undefined) {
    return true;
  }

  const parsed = Date.parse(builtAt);
  return !Number.isFinite(parsed) || parsed >= since.getTime();
}

function builtAtTime(entry: TemplateEntry): number {
  const parsed = Date.parse(entry.built_at);
  return Number.isFinite(parsed) ? parsed : 0;
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
