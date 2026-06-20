import {
  getTheme,
  renderInspectorCard,
  renderResourceBrowser,
  runTwoPaneExplorer,
  select,
  isCancel,
  PromptCancelledError,
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
import { hookEventFromFragmentContent } from "./hook-items.js";
import { loadInventory } from "./inventory.js";
import { MANIFEST_FILENAME } from "./manifest.js";
import { normalizeAgent } from "./locations.js";
import { copyOrMoveItem, validateCopyOrMoveItem } from "./operations/copy-move.js";
import { downloadBundle } from "./operations/download.js";
import { syncBundle } from "./operations/sync.js";
import { uploadBundle } from "./operations/upload.js";
import { readBaselineManifest, resolveProfileGist } from "./profile-store.js";
import { traceAgentStash, traceItems } from "./trace.js";
import { assertAgentStashScope } from "./validation.js";
import type {
  AgentStashContext,
  AgentStashItem,
  AgentStashLocationKind,
  AgentStashScope,
  ConflictPolicy,
  ConflictResolution,
  CopyMoveResult,
  DownloadResult,
  GistClient,
  GistRecord,
  SyncConflict,
  SyncOptions,
  SyncResult,
  UploadResult
} from "./types.js";

const GIST_PANE_BASELINE_MANIFEST_READ_ATTEMPTS = 6;
const GIST_PANE_FRESH_MANIFEST_READ_ATTEMPTS = 2;
const GIST_PANE_MANIFEST_RETRY_DELAY_MS = 500;

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
type BrowsePaneId = "left" | "right";

interface BrowseActionRefresh {
  action: BrowseActionName;
  fromPane: BrowsePaneId;
  selectedIds: string[];
  result: BrowseActionResult;
}

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
  let nextModel: BrowseModel | undefined;
  const loadModel = () => {
    if (modelPromise === undefined) {
      if (nextModel !== undefined) {
        const model = nextModel;
        nextModel = undefined;
        modelPromise = Promise.resolve(model);
      } else {
        modelPromise = buildBrowseModel(ctx, options);
      }
    }
    return modelPromise;
  };
  const prepareRefresh = async (input: BrowseActionRefresh) => {
    nextModel = applyBrowseActionResultToModel(await buildBrowseModel(ctx, options), input);
    await traceBrowseGistRefresh(ctx, nextModel, input);
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
    actions: browseTwoPaneActions(ctx, options, runAction, prepareRefresh),
    refresh: () => {
      modelPromise = undefined;
    },
    trace: (record) => {
      const { event, ...fields } = record;
      void traceAgentStash(ctx, `browse.ui.${event}`, fields);
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
    syncedDeletedLocal: result.synced?.deletedLocal.length,
    syncedDeletedRemote: result.synced?.deletedRemote.length,
    syncedUnchanged: result.synced?.unchanged.length,
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
  await traceAgentStash(ctx, "browse.gist.load.start", {
    profile: options.profile,
    gistId: resolved.gistId,
    scope: options.scope,
    agent: options.agentId
  });
  const manifestReadAttempts = (await readBaselineManifest(ctx, options.profile)) === null
    ? GIST_PANE_FRESH_MANIFEST_READ_ATTEMPTS
    : GIST_PANE_BASELINE_MANIFEST_READ_ATTEMPTS;
  const gist = await readGistPaneRecord(client, resolved.gistId, manifestReadAttempts);
  const bundle = gist.files[MANIFEST_FILENAME] ? loadBundleFromGist(gist) : undefined;
  if (bundle) {
    verifyBundleHashes(bundle);
  }
  const items = (bundle?.manifest.items ?? [])
    .filter((item) => item.scope === options.scope && item.agentId === options.agentId)
    .sort((left, right) => left.id.localeCompare(right.id));
  await traceAgentStash(ctx, "browse.gist.load.finish", {
    profile: options.profile,
    gistId: resolved.gistId,
    hasManifest: bundle !== undefined,
    remoteItemCount: bundle?.manifest.items.length ?? 0,
    matchedItemCount: items.length,
    items: traceItems(items)
  });

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

async function readGistPaneRecord(client: GistClient, gistId: string, manifestReadAttempts: number): Promise<GistRecord> {
  let latest = await client.read(gistId);
  for (let attempt = 1; attempt < manifestReadAttempts && isGistWithoutManifest(latest); attempt += 1) {
    await sleep(GIST_PANE_MANIFEST_RETRY_DELAY_MS);
    latest = await client.read(gistId);
  }
  return latest;
}

function isGistWithoutManifest(gist: GistRecord): boolean {
  return gist.files[MANIFEST_FILENAME] === undefined;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
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
  runAction: typeof runBrowseAction,
  prepareRefresh: (input: BrowseActionRefresh) => Promise<void>
): Array<TwoPaneAction<BrowseExplorerResult>> {
  return [
    browseTwoPaneAction(ctx, options, runAction, prepareRefresh, "copy", "copy", "c"),
    browseTwoPaneAction(ctx, options, runAction, prepareRefresh, "move", "move", "m"),
    browseTwoPaneAction(ctx, options, runAction, prepareRefresh, "upload", "upload", "u"),
    browseTwoPaneAction(ctx, options, runAction, prepareRefresh, "download", "download", "d"),
    browseTwoPaneAction(ctx, options, runAction, prepareRefresh, "sync", "sync", "s")
  ];
}

function browseTwoPaneAction(
  ctx: AgentStashContext,
  options: BrowseExplorerOptions,
  runAction: typeof runBrowseAction,
  prepareRefresh: (input: BrowseActionRefresh) => Promise<void>,
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
      const selectedIds = rowsForTwoPaneAction(actionCtx).map((row) => row.id);
      let result: BrowseActionResult | undefined;
      await actionCtx.suspendAnd(async () => {
        result = await runAction(ctx, {
          ...options,
          action,
          fromPane,
          selectedIds,
          ...browseConflictOptions(action),
          yes: true
        });
      });
      const completed = requireBrowseActionResult(result);
      await traceAgentStash(ctx, "browse.refresh.prepare.start", { action, fromPane });
      await prepareRefresh({ action, fromPane, selectedIds, result: completed });
      await traceAgentStash(ctx, "browse.refresh.prepare.finish", { action, fromPane });
      await traceAgentStash(ctx, "browse.refresh.render.start", { action, fromPane });
      await actionCtx.refresh();
      await traceAgentStash(ctx, "browse.refresh.rendered", { action, fromPane });
      toastBrowseActionResult(actionCtx.toast, label, completed);
      await traceAgentStash(ctx, "browse.action.toast", { action, fromPane });
    }
  };
}

function browseConflictOptions(action: BrowseActionName): Pick<BrowseActionOptions, "onConflict" | "resolveConflict"> {
  if (action !== "sync") {
    return {};
  }
  return {
    onConflict: "ask",
    resolveConflict: promptBrowseConflictResolution
  };
}

function promptBrowseConflictResolution(conflict: SyncConflict): Promise<ConflictResolution> {
  return promptSelectConflict({
    message: `Resolve conflict: ${conflict.item.name}`,
    options: [
      { label: "Local (upload local item)", value: "local" },
      { label: "Remote (download remote item)", value: "remote" },
      { label: "Newer (use newest timestamp)", value: "newer" },
      { label: "Fail (leave unresolved)", value: "fail" }
    ],
    initialValue: "fail"
  });
}

async function promptSelectConflict(options: {
  message: string;
  options: Array<{ label: string; value: ConflictResolution }>;
  initialValue: ConflictResolution;
}): Promise<ConflictResolution> {
  const result = await select(options);
  if (isCancel(result)) {
    throw new PromptCancelledError();
  }
  return result as ConflictResolution;
}

function applyBrowseActionResultToModel(model: BrowseModel, input: BrowseActionRefresh): BrowseModel {
  const sourcePane = model[input.fromPane];
  const targetPaneId = input.fromPane === "left" ? "right" : "left";
  const targetPane = model[targetPaneId];
  let next = model;

  if (input.result.uploaded !== undefined) {
    return updateGistPaneContents(
      replaceGistPaneFromManifest(next, input.result.uploaded.manifest.items),
      browseContentsForItems(sourcePane, input.result.uploaded.uploaded)
    );
  }

  if (input.result.synced !== undefined) {
    const synced = input.result.synced;
    const uploaded = synced.uploaded;
    const uploadedHookEvents = hookEventsForUploadedItems(sourcePane, uploaded);
    const deletedLocal = new Set(synced.deletedLocal.map((item) => item.id));
    next = updateGistPaneItems(next, (items) => {
      const removed = new Set([
        ...synced.deletedRemote.map((item) => item.id),
        ...deletedLocal
      ]);
      return upsertBrowseItems(
        items.filter((item) => !removed.has(item.id) && !isLegacyHookChunkForEvents(item, uploadedHookEvents)),
        uploaded
      );
    });
    next = updateLocalPaneItems(next, (items) => items.filter((item) => !deletedLocal.has(item.id)));
    next = updateGistPaneContents(next, browseContentsForItems(sourcePane, uploaded));
  }

  if (input.result.copied !== undefined && targetPane.location === "gist") {
    const copied = input.result.copied.map((copy) => copy.item);
    next = updatePaneItems(next, targetPaneId, (items) => upsertBrowseItems(items, copied));
    next = updateGistPaneContents(next, browseContentsForItems(sourcePane, copied));
  }

  if (input.result.moved !== undefined) {
    const moved = input.result.moved.map((move) => move.item);
    if (sourcePane.location === "gist") {
      const selected = new Set(input.selectedIds);
      next = updatePaneItems(next, input.fromPane, (items) => items.filter((item) => !selected.has(item.id)));
    }
    if (targetPane.location === "gist") {
      next = updatePaneItems(next, targetPaneId, (items) => upsertBrowseItems(items, moved));
      next = updateGistPaneContents(next, browseContentsForItems(sourcePane, moved));
    }
  }

  return next;
}

async function traceBrowseGistRefresh(
  ctx: AgentStashContext,
  model: BrowseModel,
  input: BrowseActionRefresh
): Promise<void> {
  await traceAgentStash(ctx, "browse.refresh.model", {
    action: input.action,
    left: {
      location: model.left.location,
      itemCount: model.left.items.length,
      items: traceItems(model.left.items)
    },
    right: {
      location: model.right.location,
      itemCount: model.right.items.length,
      items: traceItems(model.right.items)
    }
  });
  await traceBrowseGistRefreshPane(ctx, model.left, "left", input.action);
  await traceBrowseGistRefreshPane(ctx, model.right, "right", input.action);
}

async function traceBrowseGistRefreshPane(
  ctx: AgentStashContext,
  pane: BrowsePane,
  paneId: BrowsePaneId,
  action: BrowseActionName
): Promise<void> {
  if (pane.location !== "gist") {
    return;
  }
  await traceAgentStash(ctx, "browse.gist.refresh.finish", {
    action,
    pane: paneId,
    profile: pane.profile,
    scope: pane.scope,
    agent: pane.agentId,
    itemCount: pane.items.length,
    items: traceItems(pane.items)
  });
}

function replaceGistPaneFromManifest(model: BrowseModel, items: AgentStashItem[]): BrowseModel {
  return updateGistPaneItems(model, (_items, pane) => browsePaneItemsForManifest(pane, items));
}

function updateGistPaneItems(
  model: BrowseModel,
  update: (items: AgentStashItem[], pane: BrowsePane) => AgentStashItem[]
): BrowseModel {
  let next = model;
  if (model.left.location === "gist") {
    next = updatePaneItems(next, "left", (items, pane) => update(items, pane));
  }
  if (model.right.location === "gist") {
    next = updatePaneItems(next, "right", (items, pane) => update(items, pane));
  }
  return next;
}

function updateLocalPaneItems(
  model: BrowseModel,
  update: (items: AgentStashItem[], pane: BrowsePane) => AgentStashItem[]
): BrowseModel {
  let next = model;
  if (model.left.location !== "gist") {
    next = updatePaneItems(next, "left", (items, pane) => update(items, pane));
  }
  if (model.right.location !== "gist") {
    next = updatePaneItems(next, "right", (items, pane) => update(items, pane));
  }
  return next;
}

function updatePaneItems(
  model: BrowseModel,
  paneId: BrowsePaneId,
  update: (items: AgentStashItem[], pane: BrowsePane) => AgentStashItem[]
): BrowseModel {
  return updatePane(model, paneId, (pane) => ({
      ...pane,
      items: sortBrowseItems(update(pane.items, pane))
  }));
}

function updateGistPaneContents(model: BrowseModel, contents: Map<string, string>): BrowseModel {
  if (contents.size === 0) {
    return model;
  }
  return updateGistPane(model, (pane) => ({
    ...pane,
    contents: new Map([...(pane.contents ?? new Map()), ...contents])
  }));
}

function updateGistPane(model: BrowseModel, update: (pane: BrowsePane) => BrowsePane): BrowseModel {
  let next = model;
  if (model.left.location === "gist") {
    next = updatePane(next, "left", update);
  }
  if (model.right.location === "gist") {
    next = updatePane(next, "right", update);
  }
  return next;
}

function updatePane(model: BrowseModel, paneId: BrowsePaneId, update: (pane: BrowsePane) => BrowsePane): BrowseModel {
  return {
    ...model,
    [paneId]: update(model[paneId])
  };
}

function upsertBrowseItems(items: AgentStashItem[], replacements: AgentStashItem[]): AgentStashItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const item of replacements) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

function hookEventsForUploadedItems(pane: BrowsePane, items: AgentStashItem[]): Set<string> {
  const events = new Set<string>();
  for (const item of items) {
    if (item.kind !== "hook") {
      continue;
    }
    for (const file of item.files) {
      const event = hookEventFromFragmentContent(contentForItem(pane, item, file.path) ?? "");
      if (event !== undefined && event !== item.name) {
        events.add(event);
      }
    }
  }
  return events;
}

function isLegacyHookChunkForEvents(item: AgentStashItem, events: Set<string>): boolean {
  return item.kind === "hook" && events.has(item.name);
}

function browsePaneItemsForManifest(pane: BrowsePane, items: AgentStashItem[]): AgentStashItem[] {
  return items.filter((item) => item.scope === pane.scope && item.agentId === pane.agentId);
}

function sortBrowseItems(items: AgentStashItem[]): AgentStashItem[] {
  return [...items].sort((left, right) => left.id.localeCompare(right.id));
}

function browseContentsForItems(pane: BrowsePane, items: AgentStashItem[]): Map<string, string> {
  const sourceById = new Map(pane.items.map((item) => [item.id, item]));
  const contents = new Map<string, string>();
  for (const item of items) {
    const sourceItem = sourceById.get(item.id) ?? item;
    for (const file of item.files) {
      const content = contentForItem(pane, sourceItem, file.path);
      if (content !== undefined) {
        contents.set(file.path, content);
      }
    }
  }
  return contents;
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
      let result: BrowseActionResult | undefined;
      await actionCtx.suspendAnd(async () => {
        result = await runAction(ctx, {
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
      toastBrowseActionResult(actionCtx.toast, label, requireBrowseActionResult(result));
    }
  };
}

function requireBrowseActionResult(result: BrowseActionResult | undefined): BrowseActionResult {
  if (result === undefined) {
    throw new Error("Browse action did not return a result.");
  }
  return result;
}

function toastBrowseActionResult(
  toast: (message: string, tone: "success" | "warning") => void,
  label: string,
  result: BrowseActionResult
): void {
  const conflicts = result.synced?.conflicts.length ?? 0;
  if (conflicts > 0) {
    toast(`${label} conflicts: ${conflicts}`, "warning");
    return;
  }
  toast(`${label} complete`, "success");
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
  return preview ?? `${item.kind} ${item.scope ?? pane.location}`;
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
