import { renderMarkdownHtml } from "toolcraft-design";
import type { AgentTraceSource, NormalizedTraceTurn } from "@poe-code/agent-traces";
import type {
  ContextBreakdown,
  ContextBreakdownCategory,
  ContextUsage,
  TraceTreeNode,
  TraceView
} from "./types.js";

export interface RenderTraceHtmlOptions {
  generatedAt?: Date;
  pageSizeLimitBytes?: number;
}

const DEFAULT_PAGE_SIZE_LIMIT_BYTES = 8 * 1024 * 1024;
const MAX_MARKDOWN_TURN_CHARS = 65_536;
const COLLAPSED_TURN_LINES = 3;
const COLLAPSED_TURN_MAX_CHARS = 240;
const MAX_BREAKDOWN_ITEMS = 5;
const CATEGORY_ORDER = [
  "system-prompt",
  "skills",
  "mcp",
  "system-reminders",
  "tools",
  "reasoning",
  "messages",
  "other"
] as const;

interface TraceHtmlTurn {
  role: NormalizedTraceTurn["role"];
  toolName?: string;
  sourceKind?: string;
  timestamp?: string;
  bodyHtml: string;
  previewHtml: string;
  collapsedByDefault: boolean;
  redacted: boolean;
  spawnedChildren: TraceHtmlNode[];
}

interface TraceHtmlNode {
  title: string;
  source: AgentTraceSource;
  agentType?: string;
  model?: string;
  id: string;
  path?: string;
  cwd?: string;
  createdAt?: string;
  updatedAt?: string;
  turnCount: number;
  context: ContextUsage;
  breakdown: ContextBreakdown;
  turns: TraceHtmlTurn[];
  unanchoredChildren: TraceHtmlNode[];
  depth: number;
  collapsedByDefault: boolean;
  unavailable?: { title: string; reason: string };
}

interface TraceHtmlModel {
  root: TraceHtmlNode;
  truncated: boolean;
  omittedTurnCount: number;
  generatedAt: string;
}

interface BuildState {
  remainingBytes: number;
  omittedTurnCount: number;
  truncated: boolean;
}

export function renderTraceHtml(
  tree: TraceTreeNode,
  options: RenderTraceHtmlOptions = {}
): string {
  const model = buildTraceHtmlModel(tree, options);
  return renderDocument(model);
}

function buildTraceHtmlModel(
  tree: TraceTreeNode,
  options: RenderTraceHtmlOptions
): TraceHtmlModel {
  const state: BuildState = {
    remainingBytes: options.pageSizeLimitBytes ?? DEFAULT_PAGE_SIZE_LIMIT_BYTES,
    omittedTurnCount: 0,
    truncated: false
  };
  const generatedAt = (options.generatedAt ?? new Date()).toISOString();
  const root = buildNode(tree, 0, state);
  return {
    root,
    truncated: state.truncated,
    omittedTurnCount: state.omittedTurnCount,
    generatedAt
  };
}

function buildNode(tree: TraceTreeNode, depth: number, state: BuildState): TraceHtmlNode {
  const view = tree.view;
  if (tree.unavailable !== undefined) {
    return {
      title: tree.unavailable.reference.title?.trim() || tree.unavailable.reference.id,
      source: tree.unavailable.reference.source,
      agentType:
        typeof tree.unavailable.reference.agentType === "string"
          ? tree.unavailable.reference.agentType
          : undefined,
      id: tree.unavailable.reference.id,
      path: tree.unavailable.reference.path,
      turnCount: 0,
      context: view.context,
      breakdown: view.breakdown,
      turns: [],
      unanchoredChildren: [],
      depth,
      collapsedByDefault: depth > 0,
      unavailable: {
        title: tree.unavailable.reference.title?.trim() || tree.unavailable.reference.id,
        reason: tree.unavailable.reason
      }
    };
  }

  const childNodes = tree.children.map((child) => buildNode(child, depth + 1, state));
  const { turns, unanchoredChildren } = attachChildrenToTurns(view, childNodes, state);
  const agentType =
    typeof tree.reference?.agentType === "string" ? tree.reference.agentType : undefined;

  return {
    title: view.title?.trim() || view.id,
    source: view.source,
    agentType,
    model: view.model,
    id: view.id,
    path: view.path,
    cwd: view.cwd,
    createdAt: formatDate(view.createdAt),
    updatedAt: formatDate(view.updatedAt),
    turnCount: view.turns.length,
    context: view.context,
    breakdown: view.breakdown,
    turns,
    unanchoredChildren,
    depth,
    collapsedByDefault: depth > 0
  };
}

function attachChildrenToTurns(
  view: TraceView,
  children: TraceHtmlNode[],
  state: BuildState
): { turns: TraceHtmlTurn[]; unanchoredChildren: TraceHtmlNode[] } {
  const remaining = [...children];
  const turns: TraceHtmlTurn[] = [];

  for (const turn of view.turns) {
    if (state.remainingBytes <= 0) {
      state.truncated = true;
      state.omittedTurnCount += 1;
      continue;
    }

    const htmlTurn = buildTurn(view, turn, state);
    if (isSpawnToolTurn(turn) && remaining.length > 0) {
      htmlTurn.spawnedChildren = [remaining.shift()!];
    }
    turns.push(htmlTurn);
  }

  return {
    turns,
    unanchoredChildren: remaining
  };
}

function isSpawnToolTurn(turn: NormalizedTraceTurn): boolean {
  return (
    turn.role === "tool" &&
    turn.sourceKind === "tool_use" &&
    (turn.toolName === "Task" || turn.toolName === "Agent")
  );
}

function buildTurn(
  view: TraceView,
  turn: NormalizedTraceTurn,
  state: BuildState
): TraceHtmlTurn {
  const redacted = view.source === "poe-code" && isRedactedTurnText(turn.text);
  const collapsedByDefault = turn.role === "tool" || turn.role === "system";
  let bodyHtml: string;
  let previewHtml: string;

  if (redacted) {
    bodyHtml = renderRedacted();
    previewHtml = bodyHtml;
  } else if (turn.role === "assistant") {
    const source =
      turn.text.length > MAX_MARKDOWN_TURN_CHARS
        ? `${turn.text.slice(0, MAX_MARKDOWN_TURN_CHARS)}\n\n…`
        : turn.text;
    bodyHtml = `<div class="md">${renderMarkdownHtml(source)}</div>`;
    previewHtml = bodyHtml;
  } else {
    const full = escapeHtml(turn.text);
    bodyHtml = `<pre>${full}</pre>`;
    if (collapsedByDefault) {
      const previewText = collapseText(turn.text);
      previewHtml = `<pre>${escapeHtml(previewText.text)}${
        previewText.suffix === undefined
          ? ""
          : `<span class="muted-tail">${escapeHtml(previewText.suffix)}</span>`
      }</pre>`;
    } else {
      previewHtml = bodyHtml;
    }
  }

  const estimated = bodyHtml.length + previewHtml.length + 64;
  state.remainingBytes -= estimated;
  if (state.remainingBytes < 0) {
    state.truncated = true;
  }

  return {
    role: turn.role,
    toolName: turn.toolName,
    sourceKind: turn.sourceKind,
    timestamp: formatTime(turn.timestamp),
    bodyHtml,
    previewHtml,
    collapsedByDefault,
    redacted,
    spawnedChildren: []
  };
}

function collapseText(value: string): { text: string; suffix?: string } {
  const lines = value.split("\n");
  let text = lines.slice(0, COLLAPSED_TURN_LINES).join("\n");
  let suffix: string | undefined;
  if (lines.length > COLLAPSED_TURN_LINES) {
    suffix = `\n… +${lines.length - COLLAPSED_TURN_LINES} lines`;
  }
  if (text.length > COLLAPSED_TURN_MAX_CHARS) {
    text = text.slice(0, COLLAPSED_TURN_MAX_CHARS);
    suffix = "…";
  }
  return { text, suffix };
}

function renderDocument(model: TraceHtmlModel): string {
  const title = escapeHtml(model.root.title);
  const root = renderNode(model.root, true);
  const notice =
    model.truncated || model.omittedTurnCount > 0
      ? `<p class="footnote">Trace truncated for HTML export${
          model.omittedTurnCount > 0 ? ` (${model.omittedTurnCount} turns omitted)` : ""
        }.</p>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${DOCUMENT_CSS}
</style>
</head>
<body>
<header class="topbar">
  <div class="brand">poe-code <em>traces</em></div>
  <div class="meta-pill">${escapeHtml(model.root.source)} · ${escapeHtml(String(model.root.context.percent))}%</div>
</header>
<main class="page">
${root}
${notice}
<footer class="footer">
  <span>generated by poe-code traces · ${escapeHtml(model.generatedAt)}</span>
  <span>source ${escapeHtml(model.root.source)} · id ${escapeHtml(model.root.id)}</span>
</footer>
</main>
<script>
${DOCUMENT_JS}
</script>
</body>
</html>
`;
}

function renderNode(node: TraceHtmlNode, isRoot: boolean): string {
  if (node.unavailable !== undefined && !isRoot) {
    return renderUnavailable(node);
  }

  if (!isRoot) {
    return renderChildPanel(node);
  }

  return [
    renderHeader(node, true),
    renderContext(node.context),
    renderBreakdown(node.breakdown),
    renderConversation(node)
  ].join("\n");
}

function renderChildPanel(node: TraceHtmlNode): string {
  if (node.unavailable !== undefined) {
    return renderUnavailable(node);
  }

  const expanded = !node.collapsedByDefault;
  const summary = [
    `<button type="button" class="node-summary" data-toggle="node" aria-expanded="${expanded ? "true" : "false"}">`,
    `<span class="chev" aria-hidden="true">▸</span>`,
    `<span class="node-title-block">`,
    `<span class="node-title">${sourceBadge(node.source)}<span class="name">${escapeHtml(nodeTitle(node))}</span></span>`,
    `<span class="node-sub">${renderMiniGauge(node.context)}<span>${node.turnCount} ${
      node.turnCount === 1 ? "turn" : "turns"
    }</span></span>`,
    `</span>`,
    `<span class="chip">${expanded ? "Collapse" : "Expand"}</span>`,
    `</button>`
  ].join("");

  const body = [
    `<div class="node-body">`,
    renderHeader(node, false),
    renderContext(node.context),
    renderBreakdown(node.breakdown),
    renderConversation(node),
    `</div>`
  ].join("\n");

  return `<section class="node${expanded ? " is-expanded" : ""}" data-depth="${node.depth}">${summary}${body}</section>`;
}

function renderUnavailable(node: TraceHtmlNode): string {
  const title = node.unavailable?.title ?? node.title;
  const reason = node.unavailable?.reason ?? "unavailable";
  return `<section class="node unavailable" data-depth="${node.depth}">
<div class="node-summary">
  <span class="chev" aria-hidden="true">⚠</span>
  <span class="node-title-block">
    <span class="node-title"><span class="name">unavailable · ${escapeHtml(title)}</span></span>
    <span class="node-sub"><span>${escapeHtml(reason)}</span></span>
  </span>
  <span class="chip chip-warn">skipped</span>
</div>
</section>`;
}

function renderHeader(node: TraceHtmlNode, isRoot: boolean): string {
  const heading = isRoot
    ? `<h1 class="title">${escapeHtml(node.title)}</h1>`
    : `<div class="meta-row">${sourceBadge(node.source)}${
        node.model === undefined
          ? ""
          : `<span>model: ${escapeHtml(node.model)}</span><span class="sep">·</span>`
      }<span>${node.turnCount} turns</span></div>`;

  if (!isRoot) {
    return heading;
  }

  const model =
    node.model === undefined
      ? ""
      : `<span>model: ${escapeHtml(node.model)}</span><span class="sep">·</span>`;
  const secondary = [
    node.createdAt === undefined ? undefined : `started ${escapeHtml(node.createdAt)}`,
    node.updatedAt === undefined ? undefined : `updated ${escapeHtml(node.updatedAt)}`
  ]
    .filter((part): part is string => part !== undefined)
    .join('<span class="sep">·</span>');

  return [
    heading,
    `<div class="meta-row">${sourceBadge(node.source)}${model}<span>${node.turnCount} turns</span><span class="chip chip-${gaugeTone(node.context.percent)}">${escapeHtml(String(node.context.percent))}%</span></div>`,
    secondary.length === 0 ? "" : `<div class="meta-row secondary">${secondary}</div>`,
    node.path === undefined ? "" : `<p class="path-row">${escapeHtml(node.path)}</p>`
  ]
    .filter((part) => part.length > 0)
    .join("\n");
}

function renderContext(context: ContextUsage): string {
  const tone = gaugeTone(context.percent);
  return `<section class="section">
<div class="section-head"><h2 class="section-title">Context</h2></div>
<div class="card gauge-block tone-${tone}">
  <div class="gauge-row">
    <div class="gauge" aria-hidden="true"><div class="gauge-frame"><div class="gauge-fill" style="width:${clamp(context.percent, 0, 100)}%"></div></div></div>
    <div class="gauge-stats">${escapeHtml(formatCount(context.tokens))} / ${escapeHtml(formatCount(context.window))} · <span class="pct">${escapeHtml(String(context.percent))}%</span></div>
    <div class="gauge-source">${escapeHtml(context.source)}</div>
  </div>
</div>
</section>`;
}

function renderBreakdown(breakdown: ContextBreakdown): string {
  const categories = sortCategories(breakdown.categories).filter((category) => category.tokens > 0);
  const chip =
    breakdown.source === "estimated"
      ? `<span class="chip chip-warn">estimated</span>`
      : `<span class="chip">exact</span>`;

  if (categories.length === 0) {
    return `<section class="section">
<div class="section-head"><h2 class="section-title">Breakdown</h2>${chip}</div>
<div class="card"><p class="empty-soft">No context tokens measured</p></div>
</section>`;
  }

  const total = categories.reduce((sum, category) => sum + Math.max(0, category.tokens), 0);
  const segbar =
    total === 0
      ? ""
      : `<div class="segbar" aria-hidden="true">${categories
          .map((category) => {
            const width = Math.max(2, Math.round((Math.max(0, category.tokens) / total) * 100));
            return `<div class="seg seg-${escapeHtml(category.id)}" style="width:${width}%"></div>`;
          })
          .join("")}</div>`;

  const rows = categories
    .map((category) => {
      const items =
        category.id === "skills" || category.id === "mcp" || category.id === "tools"
          ? renderBreakdownItems(category)
          : "";
      return `<li class="cat"><span class="cat-swatch" style="background:${categoryColor(category.id)}"></span><span class="cat-name">${escapeHtml(category.label)}</span><span class="cat-tokens">${escapeHtml(formatCount(category.tokens))}</span><span class="cat-pct">${escapeHtml(String(category.percent))}%</span>${items}</li>`;
    })
    .join("");

  const footnote =
    breakdown.source === "estimated"
      ? `<p class="footnote">Token counts are estimated from character length. Exact tokens may differ.</p>`
      : "";

  return `<section class="section">
<div class="section-head"><h2 class="section-title">Breakdown</h2>${chip}</div>
<div class="card">${segbar}<ul class="cat-list">${rows}</ul>${footnote}</div>
</section>`;
}

function renderBreakdownItems(category: ContextBreakdownCategory): string {
  if (category.items.length === 0) {
    return "";
  }
  const shown = category.items.slice(0, MAX_BREAKDOWN_ITEMS);
  const rows = shown
    .map(
      (item) =>
        `<li><span>${escapeHtml(item.name)}</span><span>${escapeHtml(formatCount(item.tokens))}</span><span>×${escapeHtml(String(item.count))}</span></li>`
    )
    .join("");
  const more =
    category.items.length > shown.length
      ? `<li class="more">… ${category.items.length - shown.length} more</li>`
      : "";
  return `<ul class="cat-items">${rows}${more}</ul>`;
}

function renderConversation(node: TraceHtmlNode): string {
  if (node.turns.length === 0 && node.unanchoredChildren.length === 0) {
    return `<section class="section">
<div class="section-head"><h2 class="section-title">Conversation</h2></div>
<div class="card"><p class="empty-soft">No turns recorded in this trace.</p></div>
</section>`;
  }

  const parts: string[] = [];
  for (const turn of node.turns) {
    parts.push(renderTurn(turn));
    for (const child of turn.spawnedChildren) {
      parts.push(`<div class="spawn-block">${renderNode(child, false)}</div>`);
    }
  }

  if (node.unanchoredChildren.length > 0) {
    parts.push(`<p class="unanchored-label">Additional subagents</p>`);
    for (const child of node.unanchoredChildren) {
      parts.push(`<div class="spawn-block">${renderNode(child, false)}</div>`);
    }
  }

  return `<section class="section">
<div class="section-head"><h2 class="section-title">Conversation</h2></div>
<div class="timeline">${parts.join("\n")}</div>
</section>`;
}

function renderTurn(turn: TraceHtmlTurn): string {
  const collapsedClass = turn.collapsedByDefault ? " is-collapsed" : "";
  const roleLabel = turnRoleLabel(turn);
  const time =
    turn.timestamp === undefined ? "" : `<span class="turn-time">${escapeHtml(turn.timestamp)}</span>`;

  if (!turn.collapsedByDefault) {
    return `<article class="turn" data-role="${turn.role}">
<div class="turn-head"><span class="turn-role">${roleLabel}</span>${time}</div>
<div class="turn-body">${turn.bodyHtml}</div>
</article>`;
  }

  return `<article class="turn${collapsedClass}" data-role="${turn.role}">
<div class="turn-head"><span class="turn-role">${roleLabel}</span>${time}</div>
<div class="turn-body">
  <div class="turn-preview">${turn.previewHtml}<button type="button" class="toggle" data-toggle="turn" aria-expanded="false">Expand</button></div>
  <div class="turn-full">${turn.bodyHtml}<button type="button" class="toggle" data-toggle="turn" aria-expanded="true">Collapse</button></div>
</div>
</article>`;
}

function turnRoleLabel(turn: TraceHtmlTurn): string {
  const glyph =
    turn.role === "human" ? "›" : turn.role === "assistant" ? "✦" : turn.role === "tool" ? "⚙" : "⚠";
  const extras = [turn.toolName, turn.sourceKind]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .filter((value, index, all) => all.indexOf(value) === index);
  const suffix = extras.length === 0 ? "" : ` · ${extras.map((part) => escapeHtml(part)).join(" · ")}`;
  return `${glyph} ${escapeHtml(turn.role)}${suffix}`;
}

function renderMiniGauge(context: ContextUsage): string {
  const tone = gaugeTone(context.percent);
  return `<span class="mini-gauge tone-${tone}"><span class="gauge-frame"><span class="gauge-fill" style="width:${clamp(context.percent, 0, 100)}%"></span></span>${escapeHtml(formatCount(context.tokens))} · ${escapeHtml(String(context.percent))}%</span>`;
}

function renderRedacted(): string {
  return `<div class="redacted"><span class="redacted-icon" aria-hidden="true">⊘</span><span>Content redacted in poe-code traces.</span></div>`;
}

function nodeTitle(node: TraceHtmlNode): string {
  if (node.agentType !== undefined && node.agentType.length > 0 && node.title !== node.agentType) {
    return `${node.agentType} · ${node.title}`;
  }
  return node.title;
}

function sourceBadge(source: AgentTraceSource): string {
  return `<span class="badge badge-${escapeHtml(source)}">${escapeHtml(source)}</span>`;
}

function sortCategories(categories: ContextBreakdownCategory[]): ContextBreakdownCategory[] {
  const order = new Map<string, number>(CATEGORY_ORDER.map((id, index) => [id, index]));
  return [...categories].sort((left, right) => {
    const leftIndex = order.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = order.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex === rightIndex
      ? left.label.localeCompare(right.label)
      : leftIndex - rightIndex;
  });
}

function categoryColor(id: string): string {
  const colors: Record<string, string> = {
    "system-prompt": "var(--info)",
    skills: "var(--ok)",
    mcp: "var(--accent)",
    "system-reminders": "var(--warn)",
    tools: "var(--bad)",
    reasoning: "#8b93a7",
    messages: "#5ec8f0",
    other: "#5c6578"
  };
  return colors[id] ?? "#5c6578";
}

export function gaugeTone(percent: number): "ok" | "warn" | "danger" {
  if (percent >= 85) {
    return "danger";
  }
  if (percent >= 60) {
    return "warn";
  }
  return "ok";
}

function isRedactedTurnText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length === 0 || trimmed === "[redacted]";
}

function formatCount(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return String(value);
}

function formatDate(date: Date | undefined): string | undefined {
  return date === undefined ? undefined : date.toISOString();
}

function formatTime(date: Date | undefined): string | undefined {
  if (date === undefined) {
    return undefined;
  }
  return date.toISOString().slice(11, 19);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const DOCUMENT_CSS = String.raw`
:root {
  --bg: #0c0d10;
  --surface: #13151a;
  --surface-2: #181b22;
  --ink: #e7e9ef;
  --muted: #9aa1b2;
  --faint: #6b7280;
  --line: #262a33;
  --line-2: #323846;
  --accent: #b57bff;
  --accent-soft: rgba(181, 123, 255, 0.12);
  --ok: #3ecf8e;
  --ok-soft: rgba(62, 207, 142, 0.12);
  --warn: #e6b84d;
  --warn-soft: rgba(230, 184, 77, 0.12);
  --bad: #f07178;
  --bad-soft: rgba(240, 113, 120, 0.12);
  --info: #6aa8ff;
  --radius: 10px;
  --radius-sm: 8px;
  --sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --max: 820px;
  --pad: clamp(16px, 3vw, 24px);
  --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
}
*, *::before, *::after { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  min-height: 100vh;
  color: var(--ink);
  background: var(--bg);
  font-family: var(--sans);
  font-size: 14.5px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
button {
  font: inherit;
  color: inherit;
  cursor: pointer;
  border: 0;
  background: none;
}
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px; }
.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
  padding: 12px var(--pad);
  border-bottom: 1px solid var(--line);
  background: rgba(12, 13, 16, 0.92);
  backdrop-filter: blur(12px);
}
.brand {
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 650;
  color: var(--faint);
}
.brand em { font-style: normal; color: var(--ink); font-weight: 700; }
.meta-pill {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  padding: 3px 8px;
  border: 1px solid var(--line);
  border-radius: 999px;
}
.page {
  width: min(100% - (var(--pad) * 2), var(--max));
  margin: 0 auto;
  padding: 28px 0 72px;
}
.title {
  margin: 0 0 10px;
  font-size: clamp(1.35rem, 1.15rem + 1.1vw, 1.7rem);
  line-height: 1.2;
  letter-spacing: -0.03em;
  font-weight: 650;
  text-wrap: balance;
}
.meta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 2px;
  margin: 0 0 2px;
  color: var(--muted);
  font-size: 13px;
}
.meta-row > span:not(.badge):not(.chip):not(.sep) { padding: 0 6px; }
.meta-row > span.sep { color: var(--line-2); padding: 0 1px; }
.meta-row.secondary {
  margin-top: 6px;
  color: var(--faint);
  font-size: 12px;
  font-family: var(--mono);
}
.path-row {
  margin: 12px 0 0;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--faint);
  word-break: break-all;
}
.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 600;
  border: 1px solid transparent;
}
.badge-claude { color: var(--accent); background: var(--accent-soft); border-color: rgba(181,123,255,.22); }
.badge-codex { color: var(--info); background: rgba(106,168,255,.12); border-color: rgba(106,168,255,.22); }
.badge-pi { color: var(--warn); background: var(--warn-soft); border-color: rgba(230,184,77,.22); }
.badge-poe-code { color: var(--ok); background: var(--ok-soft); border-color: rgba(62,207,142,.22); }
.chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-family: var(--mono);
  color: var(--muted);
  border: 1px solid var(--line);
  white-space: nowrap;
}
.chip-warn { color: var(--warn); border-color: rgba(230,184,77,.28); background: var(--warn-soft); }
.chip-danger, .chip-bad { color: var(--bad); border-color: rgba(240,113,120,.28); background: var(--bad-soft); }
.chip-ok { color: var(--ok); border-color: rgba(62,207,142,.28); background: var(--ok-soft); }
.section { margin-top: 28px; }
.section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.section-title {
  margin: 0;
  font-size: 11px;
  font-family: var(--mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--faint);
  font-weight: 600;
}
.card {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  padding: 14px 16px;
}
.gauge-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; }
.gauge { display: inline-flex; flex: 1 1 160px; min-width: min(100%, 160px); max-width: 240px; }
.gauge-frame {
  display: block;
  height: 8px;
  width: 100%;
  border-radius: 999px;
  overflow: hidden;
  background: var(--surface-2);
  border: 1px solid var(--line);
}
.gauge-fill { height: 100%; border-radius: inherit; }
.tone-ok .gauge-fill { background: var(--ok); }
.tone-warn .gauge-fill { background: var(--warn); }
.tone-danger .gauge-fill { background: var(--bad); }
.gauge-stats { font-family: var(--mono); font-size: 13px; color: var(--ink); font-variant-numeric: tabular-nums; }
.gauge-stats .pct { font-weight: 700; }
.tone-ok .pct { color: var(--ok); }
.tone-warn .pct { color: var(--warn); }
.tone-danger .pct { color: var(--bad); }
.gauge-source { color: var(--faint); font-size: 12px; font-family: var(--mono); margin-left: auto; }
.segbar {
  display: flex;
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--surface-2);
  border: 1px solid var(--line);
  margin-bottom: 14px;
}
.seg { height: 100%; min-width: 2px; }
.seg-system-prompt { background: var(--info); }
.seg-skills { background: var(--ok); }
.seg-mcp { background: var(--accent); }
.seg-system-reminders { background: var(--warn); }
.seg-tools { background: var(--bad); }
.seg-reasoning { background: #8b93a7; }
.seg-messages { background: #5ec8f0; }
.seg-other { background: #5c6578; }
.cat-list { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
.cat {
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr) auto auto;
  gap: 4px 10px;
  align-items: baseline;
  font-size: 13px;
  padding: 5px 6px;
  margin: 0 -6px;
  border-radius: 6px;
}
.cat-swatch { width: 8px; height: 8px; border-radius: 2px; margin-top: 5px; }
.cat-name { color: var(--ink); }
.cat-tokens, .cat-pct {
  font-family: var(--mono);
  font-size: 12px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.cat-tokens { color: var(--muted); }
.cat-pct { color: var(--faint); min-width: 3.5ch; }
.cat-items {
  grid-column: 2 / -1;
  margin: 0;
  padding: 1px 0 4px 10px;
  list-style: none;
  display: grid;
  gap: 2px;
  border-left: 1px solid var(--line);
}
.cat-items li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 10px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.cat-items .more { color: var(--faint); font-style: italic; }
.footnote { margin: 12px 0 0; font-size: 12px; color: var(--faint); }
.empty-soft { margin: 0; color: var(--muted); font-size: 13.5px; text-align: center; padding: 28px 12px; }
.timeline { display: grid; gap: 10px; }
.spawn-block { display: grid; gap: 6px; }
.spawn-block > .node {
  margin-left: 12px;
  border-left: 2px solid var(--line-2);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}
.unanchored-label {
  margin: 2px 0 0;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--faint);
}
.turn {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
  overflow: hidden;
  border-left-width: 2px;
}
.turn[data-role="human"] { border-left-color: var(--accent); }
.turn[data-role="assistant"] { border-left-color: var(--ok); }
.turn[data-role="tool"] { border-left-color: var(--info); }
.turn[data-role="system"] { border-left-color: var(--warn); }
.turn-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 10px;
  padding: 10px 12px 0;
}
.turn-role {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 600;
}
.turn[data-role="human"] .turn-role { color: var(--accent); }
.turn[data-role="assistant"] .turn-role { color: var(--ok); }
.turn[data-role="tool"] .turn-role { color: var(--info); }
.turn[data-role="system"] .turn-role { color: var(--warn); }
.turn-time { font-family: var(--mono); font-size: 11px; color: var(--faint); font-variant-numeric: tabular-nums; }
.turn-body { padding: 6px 12px 12px; font-size: 14px; }
.turn-body pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  font-family: var(--mono);
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--muted);
}
.turn-body .md { color: var(--ink); }
.turn-body .md > :first-child { margin-top: 0; }
.turn-body .md > :last-child { margin-bottom: 0; }
.turn-body .md h1, .turn-body .md h2, .turn-body .md h3 {
  margin: 0.7em 0 0.35em;
  letter-spacing: -0.02em;
  font-weight: 650;
}
.turn-body .md p { margin: 0.4em 0; }
.turn-body .md ol, .turn-body .md ul { margin: 0.4em 0; padding-left: 1.2em; }
.turn-body .md code {
  font-family: var(--mono);
  font-size: 0.9em;
  padding: 0.1em 0.35em;
  border-radius: 4px;
  background: var(--bg);
  border: 1px solid var(--line);
}
.turn-body .md pre {
  margin: 0.6em 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--bg);
  border: 1px solid var(--line);
  overflow-x: auto;
  color: #d5dbe8;
}
.turn-body .md pre code { padding: 0; border: 0; background: none; }
.turn.is-collapsed .turn-full { display: none; }
.turn:not(.is-collapsed) .turn-preview { display: none; }
.turn:not(.is-collapsed) .turn-full {
  display: block;
  max-height: min(320px, 50vh);
  overflow: auto;
}
.turn-full pre {
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--bg);
  border: 1px solid var(--line);
}
.toggle {
  display: inline-flex;
  align-items: center;
  margin-top: 8px;
  min-height: 28px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
  font-family: var(--mono);
}
.toggle:hover { color: var(--ink); border-color: var(--line-2); background: var(--surface-2); }
.muted-tail { color: var(--faint); }
.redacted {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border: 1px dashed var(--line-2);
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--muted);
  font-size: 13px;
}
.redacted-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  background: var(--surface);
  border: 1px solid var(--line);
  color: var(--faint);
  flex-shrink: 0;
}
.node {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
  overflow: hidden;
}
.node-summary {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  gap: 8px 10px;
  align-items: center;
  width: 100%;
  padding: 11px 12px;
  text-align: left;
}
.node-summary:hover { background: rgba(255,255,255,0.02); }
.chev {
  width: 16px;
  color: var(--faint);
  font-family: var(--mono);
  font-size: 11px;
  transition: transform 0.15s var(--ease);
}
.node.is-expanded > .node-summary .chev { transform: rotate(90deg); color: var(--muted); }
.node-title-block { min-width: 0; }
.node-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  font-weight: 600;
  font-size: 13.5px;
}
.node-title .name { color: var(--ink); overflow-wrap: anywhere; }
.node-sub {
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--faint);
  font-family: var(--mono);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  font-variant-numeric: tabular-nums;
}
.mini-gauge { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); }
.mini-gauge .gauge-frame { width: 44px; height: 6px; flex: 0 0 auto; }
.node-body {
  display: none;
  padding: 0 12px 12px;
  border-top: 1px solid var(--line);
  background: var(--bg);
}
.node.is-expanded > .node-body { display: block; padding-top: 12px; }
.node-body .section { margin-top: 16px; }
.node-body .section:first-child { margin-top: 0; }
.node-body .card { background: var(--surface); }
.node.unavailable { border-style: dashed; }
.node.unavailable .node-summary { cursor: default; }
.node.unavailable .name { color: var(--warn); }
.node.unavailable .chev { transform: none; color: var(--warn); }
.footer {
  margin-top: 32px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
  font-family: var(--mono);
  font-size: 11px;
  color: var(--faint);
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  justify-content: space-between;
}
img { display: none !important; }
@media (max-width: 720px) {
  .gauge-source { margin-left: 0; width: 100%; }
  .node-summary { grid-template-columns: 18px minmax(0, 1fr); }
  .node-summary > .chip { grid-column: 2; justify-self: start; }
  .spawn-block > .node { margin-left: 8px; }
}
@media (max-width: 560px) {
  .cat { grid-template-columns: 10px minmax(0, 1fr) auto; }
  .cat-pct { display: none; }
  .cat-items li { grid-template-columns: minmax(0, 1fr) auto; }
  .cat-items li span:last-child { display: none; }
}
@media print {
  .topbar { position: static; }
  body { background: white; color: black; }
  .card, .turn, .node { background: white; border-color: #ccc; break-inside: avoid; }
}
`;

const DOCUMENT_JS = String.raw`
(function () {
  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!(target instanceof Element)) return;
    var toggle = target.closest("[data-toggle]");
    if (!toggle) return;
    var kind = toggle.getAttribute("data-toggle");
    if (kind === "turn") {
      var turn = toggle.closest(".turn");
      if (!turn) return;
      var collapsed = turn.classList.toggle("is-collapsed");
      turn.querySelectorAll('[data-toggle="turn"]').forEach(function (btn) {
        btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
        btn.textContent = collapsed ? "Expand" : "Collapse";
      });
      return;
    }
    if (kind === "node") {
      var node = toggle.closest(".node");
      if (!node || node.classList.contains("unavailable")) return;
      var expanded = node.classList.toggle("is-expanded");
      toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
      var chip = toggle.querySelector(".chip");
      if (chip) chip.textContent = expanded ? "Collapse" : "Expand";
    }
  });
})();
`;
