import chalk from "chalk";
import { resolveOutputFormat } from "../internal/output-format.js";
import { renderMarkdown } from "../terminal-markdown/index.js";

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  if (maxLength <= 3) return text.slice(0, maxLength);
  return `${text.slice(0, maxLength - 3)}...`;
}

const KIND_COLORS: Record<string, (text: string) => string> = {
  exec: (text) => chalk.yellow(text),
  edit: (text) => chalk.magenta(text),
  read: (text) => chalk.cyan(text),
  search: (text) => chalk.blue(text),
  think: (text) => chalk.dim(text),
  other: (text) => chalk.dim(text)
};

function colorForKind(kind: string): (text: string) => string {
  return KIND_COLORS[kind] ?? ((text) => chalk.dim(text));
}

function writeLine(line: string): void {
  process.stdout.write(`${line}\n`);
}

const AGENT_PREFIX = `${chalk.green.bold("✓")} agent: `;

function formatCost(costUsd: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6
  }).format(costUsd);
}

export function renderAgentMessage(text: string): void {
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
  writeLine(`${AGENT_PREFIX}${rendered}`);
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

  writeLine(chalk.dim(`  ✓ ${truncate(text, 80)}`));
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

  writeLine(chalk.green(`✓ tokens: ${tokens.input} in${cached} → ${tokens.output} out${cost}`));
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

  writeLine(chalk.red(`✗ ${message}`));
}
