import {
  getTheme,
  renderInspectorCard,
  renderResourceBrowser,
  runTwoPaneExplorer,
  stripAnsi,
  type ActionContext,
  type ExplorerConfig,
  type Row,
  type TwoPaneAction,
  type TwoPaneActionContext,
  type TwoPaneExplorerConfig,
  type TwoPaneRow
} from "toolcraft-design";
import { loadBundleFromGist, verifyBundleHashes } from "./bundle.js";
import { createDefaultGistClient } from "./gist-client.js";
import { loadInventory } from "./inventory.js";
import { MANIFEST_FILENAME } from "./manifest.js";
import { normalizeAgent } from "./locations.js";
import { copyOrMoveItem, validateCopyOrMoveItem } from "./operations/copy-move.js";
import { downloadBundle } from "./operations/download.js";
import { syncBundle } from "./operations/sync.js";
import { uploadBundle } from "./operations/upload.js";
import { resolveProfileGist } from "./profile-store.js";
import { traceAgentStash, traceItems } from "./trace.js";
import { assertAgentStashScope } from "./validation.js";
import type {
  AgentStashContext,
  AgentStashItem,
  AgentStashLocationKind,
  AgentStashScope,
  ConflictPolicy,
  CopyMoveResult,
  DownloadResult,
  SyncOptions,
  SyncResult,
  UploadResult
} from "./types.js";

export interface BrowseOptions {
  profile?: string;
  scope?: AgentStashScope;
  agent?: string;
}

export interface BrowsePane {
  title: string;
  location: Extract<AgentStashLocationKind, "project" | "global" | "gist">;
  agentId: string;
  scope?: AgentStashScope;
  profile?: string;
  items: AgentStashItem[];
  contents?: Map<string, string>;
}

export interface BrowseModel {
  left: BrowsePane;
  right: BrowsePane;
  activePane: "left" | "right";
}

export type BrowseActionName = "copy" | "move" | "upload" | "download" | "sync";

export interface BrowseActionOptions extends BrowseOptions {
  action: BrowseActionName;
  selectedIds: string[];
  fromPane?: "left" | "right";
  yes?: boolean;
  onConflict?: ConflictPolicy;
  resolveConflict?: SyncOptions["resolveConflict"];
  createProfileIfMissing?: boolean;
}

export interface BrowseActionResult {
  copied?: CopyMoveResult[];
  moved?: CopyMoveResult[];
  uploaded?: UploadResult;
  downloaded?: DownloadResult | CopyMoveResult[];
  synced?: SyncResult;
}

export interface BrowseExplorerOptions extends BrowseOptions {
  runAction?: typeof runBrowseAction;
}

type BrowseExplorerResult = void;

export async function buildBrowseModel(
  ctx: AgentStashContext,
  options: BrowseOptions = {}
): Promise<BrowseModel> {
  const scope = options.scope ?? "project";
  assertAgentStashScope(scope);
  const agentId = normalizeAgent(options.agent ?? "claude-code");
  const leftItems = await loadInventory(ctx, { scope, agent: agentId });
  const right = options.profile
    ? await loadGistPane(ctx, { profile: options.profile, scope, agentId })
    : await loadLocalPane(ctx, counterpartScope(scope), agentId);

  return {
    left: {
      title: `${titleCase(scope)}: ${agentId}`,
      location: scope,
      scope,
      agentId,
      items: leftItems
    },
    right,
    activePane: "left"
  };
}

export function renderBrowse(model: BrowseModel): string {
  return renderResourceBrowser({
    theme: getTheme(),
    title: "agent-stash browse",
    subtitle: `${model.left.title} -> ${model.right.title}`,
    groups: [
      paneResourceGroup(model.left),
      paneResourceGroup(model.right)
    ],
    footer: "tab switch   / search   space select   c copy   m move   u upload   d download   s sync   q quit"
  });
}

export async function browse(ctx: AgentStashContext, options: BrowseOptions = {}): Promise<string> {
  return renderBrowse(await buildBrowseModel(ctx, options));
}

export function buildBrowseExplorerConfig(
  ctx: AgentStashContext,
  options: BrowseExplorerOptions = {}
): ExplorerConfig<BrowseExplorerResult> {
  const runAction = options.runAction ?? runBrowseAction;
  return {
    title: "agent-stash browse",
    rows: async () => browseRows(await buildBrowseModel(ctx, options)),
    detail: {
      items: async (row) => {
        const model = await buildBrowseModel(ctx, options);
        const parsed = parseBrowseRowId(row.id);
        const pane = model[parsed.fromPane];
        const item = pane.items.find((candidate) => candidate.id === parsed.itemId);
        if (!item) {
          throw new Error(`Browse detail item not found: ${parsed.itemId}`);
        }
        return [{
          id: row.id,
          render: (detailCtx) => renderBrowseItemDetail(pane, item, detailCtx.width)
        }];
      }
    },
    actions: browseExplorerActions(ctx, options, runAction),
    multiSelect: true,
    emptyHint: "No agent stash items match the current filter"
  };
}

export function buildBrowseTwoPaneConfig(
  ctx: AgentStashContext,
  options: BrowseExplorerOptions = {}
): TwoPaneExplorerConfig<BrowseExplorerResult> {
  const runAction = options.runAction ?? runBrowseAction;
  const scope = options.scope ?? "project";
  const rightScope = counterpartScope(scope);
  const agentId = normalizeAgent(options.agent ?? "claude-code");
  let modelPromise: Promise<BrowseModel> | undefined;
  const loadModel = () => {
    modelPromise ??= buildBrowseModel(ctx, options);
    return modelPromise;
  };

  return {
    title: "agent-stash browse",
    panes: [
      {
        id: "left",
        title: `${titleCase(scope)}: ${agentId}`,
        rows: async () => paneTwoPaneRows((await loadModel()).left),
        emptyHint: "No items in left pane"
      },
      {
        id: "right",
        title: options.profile
          ? `Gist ${options.profile}: ${agentId}`
          : `${titleCase(rightScope)}: ${agentId}`,
        rows: async () => paneTwoPaneRows((await loadModel()).right),
        emptyHint: "No items in right pane"
      }
    ],
    actions: browseTwoPaneActions(ctx, options, runAction),
    refresh: () => {
      modelPromise = undefined;
    }
  };
}

export async function runBrowseTui(
  ctx: AgentStashContext,
  options: BrowseOptions = {}
): Promise<void> {
  await runTwoPaneExplorer(buildBrowseTwoPaneConfig(ctx, options));
}

export async function runBrowseAction(
  ctx: AgentStashContext,
  options: BrowseActionOptions
): Promise<BrowseActionResult> {
  assertBrowseAction(options.action);
  const model = await buildBrowseModel(ctx, await browseModelOptionsForAction(ctx, options));
  const source = model[options.fromPane ?? model.activePane];
  const target = model[(options.fromPane ?? model.activePane) === "left" ? "right" : "left"];
  const selected = selectItems(source.items, options.selectedIds);
  if (selected.length === 0) {
    throw new Error("Select at least one item.");
  }
  await traceAgentStash(ctx, "browse.action.start", {
    action: options.action,
    fromPane: options.fromPane ?? model.activePane,
    source: source.location,
    target: target.location,
    selected: traceItems(selected)
  });

  if (options.action === "copy" || options.action === "move") {
    const operation = options.action;
    const copyMoveOptions = selected.map((item) => ({
      operation,
      from: source.location,
      to: target.location,
      profile: source.profile ?? target.profile ?? options.profile,
      agent: item.agentId,
      kind: item.kind,
      name: item.name,
      sourceId: source.location === "gist" ? item.id : undefined,
      yes: options.yes
    }));
    for (const option of copyMoveOptions) {
      await validateCopyOrMoveItem(ctx, option);
    }
    const results: CopyMoveResult[] = [];
    for (const option of copyMoveOptions) {
      results.push(await copyOrMoveItem(ctx, option));
    }
    return finishBrowseAction(ctx, options.action, options.action === "copy" ? { copied: results } : { moved: results });
  }

  if (options.action === "upload") {
    if (source.location === "gist" || !source.scope) {
      throw new Error("Upload requires a project or global source pane.");
    }
    const profile = options.profile ?? target.profile;
    if (!profile) {
      throw new Error("Upload requires a Gist target.");
    }
    const selectedNames = namesByKind(selected);
    return finishBrowseAction(ctx, options.action, {
      uploaded: await uploadBundle(ctx, {
        profile,
        scope: source.scope,
        agent: source.agentId,
        skills: selectedNames.skills.length > 0 ? selectedNames.skills : undefined,
        hooks: selectedNames.hooks.length > 0 ? selectedNames.hooks : undefined,
        yes: options.yes
      })
    });
  }

  const selectedNames = namesByKind(selected);
  if (options.action === "download") {
    if (source.location === "gist") {
      const profile = source.profile ?? options.profile;
      if (!profile || !source.scope) {
        throw new Error("Download requires a Gist source.");
      }
      return finishBrowseAction(ctx, options.action, {
        downloaded: await downloadBundle(ctx, {
          profile,
          scope: source.scope,
          agent: source.agentId,
          skills: selectedNames.skills.length > 0 ? selectedNames.skills : undefined,
          hooks: selectedNames.hooks.length > 0 ? selectedNames.hooks : undefined,
          yes: options.yes
        })
      });
    }
    const profile = options.profile ?? target.profile;
    if (!profile) {
      throw new Error("Download requires a Gist target.");
    }
    return finishBrowseAction(ctx, options.action, {
      downloaded: await downloadBundle(ctx, {
        profile,
        scope: source.scope ?? options.scope ?? "project",
        agent: source.agentId,
        skills: selectedNames.skills.length > 0 ? selectedNames.skills : undefined,
        hooks: selectedNames.hooks.length > 0 ? selectedNames.hooks : undefined,
        yes: options.yes
      })
    });
  }

  const profile = options.profile ?? source.profile ?? target.profile;
  if (!profile) {
    throw new Error("Sync requires a Gist target.");
  }
  return finishBrowseAction(ctx, options.action, {
    synced: await syncBundle(ctx, {
      profile,
      scope: source.scope ?? options.scope ?? "project",
      agent: source.agentId,
      skills: selectedNames.skills.length > 0 ? selectedNames.skills : undefined,
      hooks: selectedNames.hooks.length > 0 ? selectedNames.hooks : undefined,
      onConflict: options.onConflict ?? "fail",
      resolveConflict: options.resolveConflict,
      yes: options.yes
    })
  });
}

async function finishBrowseAction(
  ctx: AgentStashContext,
  action: BrowseActionName,
  result: BrowseActionResult
): Promise<BrowseActionResult> {
  await traceAgentStash(ctx, "browse.action.finish", {
    action,
    copied: result.copied?.length,
    moved: result.moved?.length,
    uploaded: result.uploaded?.uploaded.length,
    downloaded: Array.isArray(result.downloaded) ? result.downloaded.length : result.downloaded?.downloaded.length,
    syncedUploaded: result.synced?.uploaded.length,
    syncedDownloaded: result.synced?.downloaded.length,
    syncedConflicts: result.synced?.conflicts.length
  });
  return result;
}

function assertBrowseAction(action: BrowseActionName): void {
  if (action !== "copy" && action !== "move" && action !== "upload" && action !== "download" && action !== "sync") {
    throw new Error(`Invalid browse action: ${String(action)}`);
  }
}

async function loadLocalPane(ctx: AgentStashContext, scope: AgentStashScope, agentId: string): Promise<BrowsePane> {
  return {
    title: `${titleCase(scope)}: ${agentId}`,
    location: scope,
    scope,
    agentId,
    items: await loadInventory(ctx, { scope, agent: agentId })
  };
}

function counterpartScope(scope: AgentStashScope): AgentStashScope {
  return scope === "project" ? "global" : "project";
}

async function loadGistPane(
  ctx: AgentStashContext,
  options: { profile: string; scope: AgentStashScope; agentId: string }
): Promise<BrowsePane> {
  const resolved = await resolveProfileGist(ctx, options.profile);
  if (!resolved.gistId) {
    throw new Error(`Profile does not have a Gist: ${options.profile}`);
  }
  const client = ctx.gistClient ?? (await createDefaultGistClient());
  const gist = await client.read(resolved.gistId);
  const bundle = gist.files[MANIFEST_FILENAME] ? loadBundleFromGist(gist) : undefined;
  if (bundle) {
    verifyBundleHashes(bundle);
  }
  const items = (bundle?.manifest.items ?? [])
    .filter((item) => item.scope === options.scope && item.agentId === options.agentId)
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    title: `Gist ${options.profile}: ${options.agentId}`,
    location: "gist",
    scope: options.scope,
    profile: options.profile,
    agentId: options.agentId,
    items,
    contents: bundle?.files
  };
}

function selectItems(items: AgentStashItem[], ids: string[]): AgentStashItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return ids.map((id) => {
    const item = byId.get(id);
    if (!item) {
      throw new Error(`Selected browse item not found: ${id}`);
    }
    return item;
  });
}

function browseRows(model: BrowseModel): Row[] {
  return [
    ...paneRows("left", model.left),
    ...paneRows("right", model.right)
  ];
}

function paneRows(paneId: "left" | "right", pane: BrowsePane): Row[] {
  return pane.items.map((item) => ({
    id: `${paneId}:${item.id}`,
    title: item.name,
    subtitle: itemSubtitle(pane, item),
    badge: { text: pane.location, tone: pane.location === "gist" ? "info" : "muted" },
    group: pane.title
  }));
}

function paneTwoPaneRows(pane: BrowsePane): TwoPaneRow[] {
  return pane.items.map((item) => ({
    id: item.id,
    title: item.name,
    subtitle: itemSubtitle(pane, item),
    badge: { text: pane.location, tone: pane.location === "gist" ? "info" : "muted" }
  }));
}

function renderBrowseItemDetail(pane: BrowsePane, item: AgentStashItem, width: number): string {
  return stripAnsi(renderInspectorCard({
    theme: getTheme(),
    title: item.name,
    subtitle: `${item.kind} ${item.scope}`,
    badges: [pane.location, item.agentId],
    preview: itemPreviewContent(pane, item),
    sections: [{
      title: "Details",
      fields: [
        { label: "ID", value: item.id },
        { label: "Path", value: item.path },
        { label: "Files", value: String(item.files.length) },
        { label: "Updated", value: item.updatedAt },
        { label: "Hash", value: item.contentHash }
      ]
    }, {
      title: "Bundle files",
      fields: item.files.map((file) => ({
        label: file.path,
        value: `${file.size} bytes ${file.sha256}`
      }))
    }],
    width,
    maxPreviewLines: 32
  }));
}

function browseTwoPaneActions(
  ctx: AgentStashContext,
  options: BrowseExplorerOptions,
  runAction: typeof runBrowseAction
): Array<TwoPaneAction<BrowseExplorerResult>> {
  return [
    browseTwoPaneAction(ctx, options, runAction, "copy", "copy", "c"),
    browseTwoPaneAction(ctx, options, runAction, "move", "move", "m"),
    browseTwoPaneAction(ctx, options, runAction, "upload", "upload", "u"),
    browseTwoPaneAction(ctx, options, runAction, "download", "download", "d"),
    browseTwoPaneAction(ctx, options, runAction, "sync", "sync", "s")
  ];
}

function browseTwoPaneAction(
  ctx: AgentStashContext,
  options: BrowseExplorerOptions,
  runAction: typeof runBrowseAction,
  action: BrowseActionName,
  label: string,
  key: string
): TwoPaneAction<BrowseExplorerResult> {
  return {
    id: action,
    label,
    key,
    handler: async (actionCtx) => {
      const fromPane = parseTwoPaneId(actionCtx.activePane.id);
      await actionCtx.suspendAnd(async () => {
        await runAction(ctx, {
          ...options,
          action,
          fromPane,
          selectedIds: rowsForTwoPaneAction(actionCtx).map((row) => row.id),
          yes: true
        });
      });
      await actionCtx.refresh();
      actionCtx.toast(`${label} complete`, "success");
    }
  };
}

function browseExplorerActions(
  ctx: AgentStashContext,
  options: BrowseExplorerOptions,
  runAction: typeof runBrowseAction
): Array<import("toolcraft-design").Action<BrowseExplorerResult>> {
  return [
    browseExplorerAction(ctx, options, runAction, "copy", "Copy", "c"),
    browseExplorerAction(ctx, options, runAction, "move", "Move", "m", true),
    browseExplorerAction(ctx, options, runAction, "upload", "Upload", "u"),
    browseExplorerAction(ctx, options, runAction, "download", "Download", "d"),
    browseExplorerAction(ctx, options, runAction, "sync", "Sync", "s")
  ];
}

function browseExplorerAction(
  ctx: AgentStashContext,
  options: BrowseExplorerOptions,
  runAction: typeof runBrowseAction,
  action: BrowseActionName,
  label: string,
  key: string,
  destructive = false
): import("toolcraft-design").Action<BrowseExplorerResult> {
  return {
    id: action,
    label,
    key,
    destructive,
    showInFooter: true,
    handler: async (actionCtx) => {
      const rows = rowsForAction(actionCtx);
      const parsedRows = rows.map((row) => parseBrowseRowId(row.id));
      const firstPane = parsedRows[0]?.fromPane;
      if (!firstPane) {
        actionCtx.toast("Select an item first", "warning");
        return;
      }
      if (parsedRows.some((row) => row.fromPane !== firstPane)) {
        actionCtx.toast("Select items from one pane", "warning");
        return;
      }
      const profile = await profileForBrowseAction(options, action, actionCtx.confirm);
      await actionCtx.suspendAnd(async () => {
        await runAction(ctx, {
          ...options,
          profile,
          createProfileIfMissing: profile !== options.profile,
          action,
          fromPane: firstPane,
          selectedIds: parsedRows.map((row) => row.itemId),
          yes: true
        });
      });
      await actionCtx.refresh();
      actionCtx.toast(`${label} complete`, "success");
    }
  };
}

async function browseModelOptionsForAction(
  ctx: AgentStashContext,
  options: BrowseActionOptions
): Promise<BrowseOptions> {
  if (
    options.createProfileIfMissing &&
    options.profile &&
    (options.action === "upload" || options.action === "sync")
  ) {
    const resolved = await resolveProfileGist(ctx, options.profile);
    if (!resolved.gistId) {
      return { ...options, profile: undefined };
    }
  }
  return options;
}

async function profileForBrowseAction(
  options: BrowseExplorerOptions,
  action: BrowseActionName,
  confirm: (prompt: string) => Promise<boolean>
): Promise<string | undefined> {
  if (options.profile || action === "copy" || action === "move" || action === "download") {
    return options.profile;
  }
  if (!await confirm('Create profile "default" with a new secret Gist?')) {
    throw new Error("Operation cancelled.");
  }
  return "default";
}

function rowsForAction(ctx: ActionContext<BrowseExplorerResult>): Row[] {
  return ctx.rows.length > 0 ? ctx.rows : [ctx.row];
}

function rowsForTwoPaneAction(ctx: TwoPaneActionContext<BrowseExplorerResult>): TwoPaneRow[] {
  return ctx.rows.length > 0 ? ctx.rows : [ctx.row];
}

function parseTwoPaneId(id: string): "left" | "right" {
  if (id === "left" || id === "right") {
    return id;
  }
  throw new Error(`Invalid browse pane id: ${id}`);
}

function parseBrowseRowId(id: string): { fromPane: "left" | "right"; itemId: string } {
  const separator = id.indexOf(":");
  const pane = id.slice(0, separator);
  if (separator === -1 || (pane !== "left" && pane !== "right")) {
    throw new Error(`Invalid browse row id: ${id}`);
  }
  return {
    fromPane: pane,
    itemId: id.slice(separator + 1)
  };
}

function namesByKind(items: AgentStashItem[]): { skills: string[]; hooks: string[] } {
  return {
    skills: items.filter((item) => item.kind === "skill").map((item) => item.name),
    hooks: items.filter((item) => item.kind === "hook").map((item) => item.name)
  };
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function paneResourceGroup(pane: BrowsePane) {
  return {
    title: pane.title,
    description: pane.profile === undefined ? undefined : `Profile ${pane.profile}`,
    emptyHint: `No ${pane.location} items`,
    items: pane.items.map((item) => ({
      label: item.name,
      badge: pane.location,
      meta: [item.kind, item.scope, fileCountLabel(item.files.length)],
      preview: itemPreview(pane, item)
    }))
  };
}

function fileCountLabel(count: number): string {
  return count === 1 ? "1 file" : `${count} files`;
}

function itemSubtitle(pane: BrowsePane, item: AgentStashItem): string {
  const preview = itemPreview(pane, item);
  const prefix = `${item.kind} ${item.scope ?? pane.location}`;
  return preview ? `${prefix} - ${preview}` : prefix;
}

function itemPreview(pane: BrowsePane, item: AgentStashItem): string | undefined {
  const firstFile = item.files[0];
  if (!firstFile) {
    return undefined;
  }
  const content = contentForItem(pane, item, firstFile.path);
  if (!content) {
    return undefined;
  }
  if (item.kind === "hook") {
    return hookPreview(content);
  }
  return firstNonEmptyLine(content);
}

function itemPreviewContent(pane: BrowsePane, item: AgentStashItem): string | undefined {
  const firstFile = item.files[0];
  if (!firstFile) {
    return undefined;
  }
  const content = contentForItem(pane, item, firstFile.path);
  if (content === undefined) {
    return undefined;
  }
  return item.kind === "hook" ? hookDetailPreview(content) : content;
}

function contentForItem(pane: BrowsePane, item: AgentStashItem, filePath: string): string | undefined {
  const loaded = item as AgentStashItem & { bundleFiles?: Array<{ path: string; content: string }> };
  return loaded.bundleFiles?.find((file) => file.path === filePath)?.content ?? pane.contents?.get(filePath);
}

function hookPreview(content: string): string | undefined {
  const summary = parseHookSummary(content);
  if (summary !== undefined) {
    return summary.row;
  }
  return firstNonEmptyLine(content);
}

function hookDetailPreview(content: string): string | undefined {
  const summary = parseHookSummary(content);
  if (summary !== undefined) {
    return summary.detail;
  }
  return firstNonEmptyLine(content);
}

interface HookSummary {
  row: string;
  detail: string;
}

function parseHookSummary(content: string): HookSummary | undefined {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.hooks)) {
      return undefined;
    }
    const eventSummaries: string[] = [];
    const detailLines: string[] = [];
    let groupCount = 0;
    let commandCount = 0;

    for (const [event, groups] of Object.entries(parsed.hooks)) {
      if (!Array.isArray(groups)) {
        continue;
      }
      let eventCommandCount = 0;
      detailLines.push(event);

      for (const group of groups) {
        if (!isRecord(group)) {
          continue;
        }
        const matcher = typeof group.matcher === "string" && group.matcher.trim().length > 0
          ? group.matcher.trim()
          : "all tools";
        const commands = Array.isArray(group.hooks)
          ? group.hooks
            .map((hook) => isRecord(hook) && typeof hook.command === "string" ? hook.command.trim() : undefined)
            .filter((command): command is string => command !== undefined && command.length > 0)
          : [];
        groupCount += 1;
        commandCount += commands.length;
        eventCommandCount += commands.length;
        detailLines.push(`- ${matcher}${commands.length > 0 ? ` -> ${commands.join(" | ")}` : ""}`);
      }

      eventSummaries.push(`${event} ${groupLabel(groups.length)}, ${commandLabel(eventCommandCount)}`);
    }

    if (eventSummaries.length === 0) {
      return undefined;
    }
    const row = eventSummaries.length === 1
      ? eventSummaries[0]
      : `${eventSummaries.join("; ")} (${groupLabel(groupCount)}, ${commandLabel(commandCount)})`;
    return {
      row: compactPreview(row) ?? "",
      detail: compactPreviewLines(detailLines)
    };
  } catch {
    return undefined;
  }
}

function groupLabel(count: number): string {
  return count === 1 ? "1 matcher group" : `${count} matcher groups`;
}

function commandLabel(count: number): string {
  return count === 1 ? "1 command" : `${count} commands`;
}

function compactPreviewLines(lines: string[]): string {
  return lines.map((line) => compactPreview(line) ?? "").filter((line) => line.length > 0).join("\n");
}

function firstNonEmptyLine(content: string): string | undefined {
  return compactPreview(splitLines(content).find((line) => line.trim().length > 0)?.trim() ?? "");
}

function compactPreview(value: string): string | undefined {
  const normalized = collapseWhitespace(value);
  if (normalized.length === 0) {
    return undefined;
  }
  return normalized.length > 96 ? `${normalized.slice(0, 93)}...` : normalized;
}

function splitLines(content: string): string[] {
  return content.split("\n").map((line) => line.endsWith("\r") ? line.slice(0, -1) : line);
}

function collapseWhitespace(value: string): string {
  const parts: string[] = [];
  let previousWasWhitespace = true;
  for (const character of value) {
    if (isWhitespace(character)) {
      if (!previousWasWhitespace) {
        parts.push(" ");
      }
      previousWasWhitespace = true;
    } else {
      parts.push(character);
      previousWasWhitespace = false;
    }
  }
  if (parts.at(-1) === " ") {
    parts.pop();
  }
  return parts.join("");
}

function isWhitespace(character: string): boolean {
  return character === " " || character === "\t" || character === "\n" || character === "\r" || character === "\v" || character === "\f";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
