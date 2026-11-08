import { color } from "../components/color.js";
import { plainTerminalText } from "../dashboard/ansi.js";
import { truncateToWidth } from "../dashboard/terminal-width.js";
import { resolveOutputFormat } from "../internal/output-format.js";
import { getAcpWriter } from "./writer.js";

export type AgentPlanEntry = {
  content: string;
  status: "pending" | "in_progress" | "completed";
};

/** A compact preview of an agent's checklist; the complete list stays in details. */
export function formatAgentPlan(entries: readonly AgentPlanEntry[]): { text: string; detail?: string } {
  if (entries.length === 0) return { text: "Agent checklist cleared" };
  const completed = entries.filter((entry) => entry.status === "completed").length;
  const heading = `Agent checklist · ${completed}/${entries.length}`;
  const active = entries.findIndex((entry) => entry.status === "in_progress");
  const pending = entries.findIndex((entry) => entry.status === "pending");
  const focus = active >= 0 ? active : pending >= 0 ? pending : entries.length;
  const start = Math.max(0, Math.min(focus - 1, entries.length - 5));
  const end = Math.min(entries.length, start + 5);
  const lines = [heading];
  const full = [heading];
  if (start > 0) lines.push(`  ↑ ${start} earlier step${start === 1 ? "" : "s"}`);
  let shortened = start > 0 || end < entries.length;
  for (const [index, entry] of entries.entries()) {
    const marker = { completed: "✓", in_progress: "›", pending: "○" }[entry.status];
    const content = plainTerminalText(entry.content);
    full.push(`  ${marker} ${content}`);
    if (index < start || index >= end) continue;
    const preview = truncateToWidth(content, 100);
    shortened ||= content !== preview;
    lines.push(`  ${marker} ${preview}`);
  }
  if (end < entries.length) lines.push(`  ↓ ${entries.length - end} more step${entries.length - end === 1 ? "" : "s"} · d Details`);
  return { text: lines.join("\n"), ...(shortened ? { detail: full.join("\n") } : {}) };
}

export function renderAgentPlan(entries: readonly AgentPlanEntry[]): void {
  const format = resolveOutputFormat();
  if (format === "json") {
    getAcpWriter()(JSON.stringify({ event: "plan", entries }));
    return;
  }
  const plan = formatAgentPlan(entries);
  const text = plan.detail ?? plan.text;
  if (format === "markdown") {
    const [heading, ...lines] = text.split("\n");
    getAcpWriter()([`**${heading}**`, ...lines.map((line) => `- ${line.trimStart()}`)].join("\n"));
  } else getAcpWriter()(color.dim(text));
}
