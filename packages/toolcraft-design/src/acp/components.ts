import { color } from "../components/color.js";
import { resolveOutputFormat } from "../internal/output-format.js";
import { renderMarkdown } from "../terminal-markdown/index.js";
import { getAcpWriter } from "./writer.js";

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  if (maxLength <= 3) return text.slice(0, maxLength);
  return `${text.slice(0, maxLength - 3)}...`;
}

const KIND_COLORS: Record<string, (text: string) => string> = {
  exec: (text) => color.yellow(text),
  edit: (text) => color.magenta(text),
  read: (text) => color.cyan(text),
  search: (text) => color.blue(text),
  think: (text) => color.dim(text),
  other: (text) => color.dim(text)
};

function colorForKind(kind: string): (text: string) => string {
  return Object.prototype.hasOwnProperty.call(KIND_COLORS, kind)
    ? KIND_COLORS[kind]!
    : (text) => color.dim(text);
}

function writeLine(line: string): void {
  getAcpWriter()(line);
}

/**
 * Status of the agent output being rendered.
 *
 * `streaming` covers partial/in-progress content, which has not reached any outcome yet and so must not
 * claim success. `success`/`error` are terminal outcomes known to the caller.
 */
export type AcpOutputState = "streaming" | "success" | "error";

const STATE_GLYPHS: Record<AcpOutputState, () => string> = {
  streaming: () => color.dim("·"),
  success: () => color.green.bold("✓"),
  error: () => color.red.bold("✗")
};

function agentPrefix(state: AcpOutputState): string {
  return `${STATE_GLYPHS[state]()} agent: `;
}

function formatCost(costUsd: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6
  }).format(costUsd);
}

export function renderAgentMessage(text: string, state: AcpOutputState = "streaming"): void {
  const format = resolveOutputFormat();

  if (format === "markdown") {
    writeLine(`- **agent:** ${text}`);
    return;
  }

  if (format === "json") {
    writeLine(JSON.stringify({ event: "agent_message", text }));
    return;
  }

  const rendered = renderMarkdown(text).trimEnd();
  writeLine(`${agentPrefix(state)}${rendered}`);
}

export function renderToolStart(kind: string, title: string): void {
  const format = resolveOutputFormat();

  if (format === "markdown") {
    writeLine(`- *→ ${kind}: ${title}*`);
    return;
  }

  if (format === "json") {
    writeLine(JSON.stringify({ event: "tool_start", kind, title }));
    return;
  }

  const color = colorForKind(kind);
  writeLine(color(`  → ${kind}: ${title}`));
}

export function renderToolComplete(kind: string): void {
  const format = resolveOutputFormat();

  if (format === "markdown") {
    writeLine(`- *✓ ${kind}*`);
    return;
  }

  if (format === "json") {
    writeLine(JSON.stringify({ event: "tool_complete", kind }));
    return;
  }

  const color = colorForKind(kind);
  writeLine(color(`  ✓ ${kind}`));
}

export function renderReasoning(text: string): void {
  const format = resolveOutputFormat();

  if (format === "markdown") {
    writeLine(`- *thinking:* ${truncate(text, 80)}`);
    return;
  }

  if (format === "json") {
    writeLine(JSON.stringify({ event: "reasoning", text }));
    return;
  }

  writeLine(color.dim(`  · ${truncate(text, 80)}`));
}

export function renderUsage(tokens: {
  input: number;
  output: number;
  cached?: number;
  costUsd?: number;
}): void {
  const format = resolveOutputFormat();
  const cached =
    typeof tokens.cached === "number" && tokens.cached > 0 ? ` (${tokens.cached} cached)` : "";

  let cost = "";
  if (typeof tokens.costUsd === "number") {
    cost = ` (${formatCost(tokens.costUsd)})`;
  }

  if (format === "markdown") {
    writeLine(`- **tokens:** ${tokens.input} in → ${tokens.output} out${cost}`);
    return;
  }

  if (format === "json") {
    writeLine(
      JSON.stringify({
        event: "usage",
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        cachedTokens: tokens.cached ?? 0,
        costUsd: tokens.costUsd ?? 0
      })
    );
    return;
  }

  writeLine("");
  writeLine(color.dim(`· tokens: ${tokens.input} in${cached} → ${tokens.output} out${cost}`));
}

export function renderPermissionRejected(title: string): void {
  const format = resolveOutputFormat();

  if (format === "markdown") {
    writeLine(`- **permission rejected:** ${title}`);
    return;
  }

  if (format === "json") {
    writeLine(JSON.stringify({ event: "permission_rejected", title }));
    return;
  }

  writeLine(color.yellow(`  ✗ permission rejected: ${title}`));
}

export function renderError(message: string): void {
  const format = resolveOutputFormat();

  if (format === "markdown") {
    writeLine(`- **error:** ${message}`);
    return;
  }

  if (format === "json") {
    writeLine(JSON.stringify({ event: "error", message }));
    return;
  }

  writeLine(color.red(`✗ ${message}`));
}
