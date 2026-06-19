import {
  getTheme,
  renderTable,
  runTwoPaneExplorer,
  withOutputFormat,
  type ActionContext,
  type ExplorerConfig,
  type RenderTableOptions,
  type Row,
  type TableColumn,
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
import { copyOrMoveItem } from "./operations/copy-move.js";
import { downloadBundle } from "./operations/download.js";
import { syncBundle } from "./operations/sync.js";
import { uploadBundle } from "./operations/upload.js";
import { resolveProfileGist } from "./profile-store.js";
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

const itemColumns: TableColumn[] = [
  { name: "kind", title: "Kind", alignment: "left", maxLen: 7 },
  { name: "name", title: "Name", alignment: "left", maxLen: 32 },
  { name: "scope", title: "Scope", alignment: "left", maxLen: 8 },
  { name: "files", title: "Files", alignment: "right", maxLen: 5 }
];

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
  return [
    "agent-stash browse",
    "",
    renderPane(model.left),
    "",
    renderPane(model.right),
    "",
    "tab switch   / search   space select   c copy   m move   u upload   d download   s sync   b backup   q quit"
  ].join("\n");
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
      items: async (row) => [{
        id: row.id,
        render: () => renderBrowseRowDetail(row)
      }]
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
  const model = await buildBrowseModel(ctx, options);
  const source = model[options.fromPane ?? model.activePane];
  const target = model[(options.fromPane ?? model.activePane) === "left" ? "right" : "left"];
  const selected = selectItems(source.items, options.selectedIds);
  if (selected.length === 0) {
    throw new Error("Select at least one item.");
  }

  if (options.action === "copy" || options.action === "move") {
    const results: CopyMoveResult[] = [];
    for (const item of selected) {
      results.push(await copyOrMoveItem(ctx, {
        operation: options.action,
        from: source.location,
        to: target.location,
        profile: source.profile ?? target.profile ?? options.profile,
        agent: item.agentId,
        kind: item.kind,
        name: item.name,
        yes: options.yes
      }));
    }
    return options.action === "copy" ? { copied: results } : { moved: results };
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
    return {
      uploaded: await uploadBundle(ctx, {
        profile,
        scope: source.scope,
        agent: source.agentId,
        skills: selectedNames.skills.length > 0 ? selectedNames.skills : undefined,
        hooks: selectedNames.hooks.length > 0 ? selectedNames.hooks : undefined,
        yes: options.yes
      })
    };
  }

  const selectedNames = namesByKind(selected);
  if (options.action === "download") {
    if (source.location === "gist") {
      const results: CopyMoveResult[] = [];
      for (const item of selected) {
        results.push(await copyOrMoveItem(ctx, {
          operation: "copy",
          from: "gist",
          to: target.location,
          profile: source.profile ?? options.profile,
          agent: item.agentId,
          kind: item.kind,
          name: item.name,
          yes: options.yes
        }));
      }
      return { downloaded: results };
    }
    return {
      downloaded: await downloadBundle(ctx, {
        profile: options.profile ?? target.profile,
        scope: source.scope ?? options.scope ?? "project",
        agent: source.agentId,
        skills: selectedNames.skills.length > 0 ? selectedNames.skills : undefined,
        hooks: selectedNames.hooks.length > 0 ? selectedNames.hooks : undefined,
        yes: options.yes
      })
    };
  }

  return {
    synced: await syncBundle(ctx, {
      profile: options.profile ?? source.profile ?? target.profile,
      scope: source.scope ?? options.scope ?? "project",
      agent: source.agentId,
      skills: selectedNames.skills.length > 0 ? selectedNames.skills : undefined,
      hooks: selectedNames.hooks.length > 0 ? selectedNames.hooks : undefined,
      onConflict: options.onConflict ?? "fail",
      resolveConflict: options.resolveConflict,
      yes: options.yes
    })
  };
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
    profile: options.profile,
    agentId: options.agentId,
    items
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
    subtitle: `${item.kind} ${item.scope}`,
    badge: { text: pane.location, tone: pane.location === "gist" ? "info" : "muted" },
    group: pane.title
  }));
}

function paneTwoPaneRows(pane: BrowsePane): TwoPaneRow[] {
  return pane.items.map((item) => ({
    id: item.id,
    title: item.name,
    subtitle: `${item.kind} ${item.scope ?? pane.location}`,
    badge: { text: pane.location, tone: pane.location === "gist" ? "info" : "muted" }
  }));
}

function renderBrowseRowDetail(row: Row): string {
  const parsed = parseBrowseRowId(row.id);
  return [
    `# ${row.title}`,
    "",
    `Pane: ${parsed.fromPane}`,
    `Item: ${parsed.itemId}`,
    row.subtitle ? `Type: ${row.subtitle}` : undefined
  ].filter((line): line is string => line !== undefined).join("\n");
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
      await actionCtx.suspendAnd(async () => {
        await runAction(ctx, {
          ...options,
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

function renderPane(pane: BrowsePane): string {
  const rows = pane.items.map((item) => ({
    kind: item.kind,
    name: item.name,
    scope: item.scope,
    files: String(item.files.length)
  }));
  const tableRows = rows.length > 0
    ? rows
    : [{ kind: "-", name: "No items", scope: "-", files: "0" }];
  const table = withOutputFormat("terminal", () =>
    renderTable({
      theme: getTheme(),
      columns: itemColumns,
      rows: tableRows
    } satisfies RenderTableOptions)
  );

  return `${pane.title}\n${table}`;
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
