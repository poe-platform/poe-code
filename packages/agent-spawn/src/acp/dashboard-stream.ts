import { randomUUID } from "node:crypto";
import { acp, dashboard } from "toolcraft-design";
import type { AcpEvent, PermissionRejectedEvent, ToolCompleteEvent, ToolStartEvent, UsageEvent } from "./types.js";
import { renderAcpEvent } from "./renderer.js";
import { summarizeToolAction } from "./tool-summary.js";

/** Render live message previews with stable ids; other events remain individual log entries. */
export async function streamAcpEventsToDashboard(options: {
  events: AsyncIterable<AcpEvent>;
  signal?: AbortSignal;
  onToolOutput?(chunk: string, id?: string): void;
  onErrorOutput?(chunk: string): void;
  onOutput?(item: dashboard.OutputItem): void;
  onActivity?(activity: string | undefined): void;
  onUsage?(usage: UsageEvent): void;
}): Promise<boolean> {
  let sawEvents = false;
  let block: { event: "agent_message" | "reasoning"; preview: ReturnType<typeof dashboard.createOutputPreviewBuffer>; id: string } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  let rendering = Promise.resolve();
  let renderFailure: unknown;
  const streamId = randomUUID();
  let toolSequence = 0;
  const activeTools = new Map<string, { id: string; kind: string; label: string; detail: string }>();

  async function publish(event: AcpEvent, id?: string): Promise<void> {
    if (options.signal?.aborted) return;
    if (event.event === "usage") options.onUsage?.(event as UsageEvent);
    if (options.onOutput) {
      const ts = Date.now();
      if (event.event === "agent_message" || event.event === "reasoning") {
        const reasoning = event.event === "reasoning";
        options.onActivity?.([...activeTools.values()].at(-1)?.label ?? (reasoning ? "Thinking" : "Writing response"));
        options.onOutput({ id, ts, kind: "info", role: reasoning ? "reasoning" : "agent", text: event.text as string });
      } else if (event.event === "tool_start") {
        const tool = event as ToolStartEvent;
        const key = tool.id ?? `anonymous-${++toolSequence}`;
        const summary = { ...summarizeToolAction(tool), id: `${streamId}:${key}`, kind: tool.kind };
        activeTools.set(key, summary);
        options.onActivity?.(summary.label);
        options.onOutput({ id: summary.id, ts, kind: "tool", role: "action", text: summary.label, detail: summary.detail });
      } else if (event.event === "tool_complete") {
        const tool = event as ToolCompleteEvent;
        const key = tool.id ?? [...activeTools].find(([, active]) => active.kind === tool.kind)?.[0];
        const summary = key ? activeTools.get(key) : undefined;
        if (key) activeTools.delete(key);
        const label = summary?.label ?? summarizeToolAction({ kind: tool.kind, title: tool.path || "tool" }).label;
        const suffix = tool.status === "failed" ? " · failed" : tool.status === "cancelled" ? " · cancelled" : "";
        options.onOutput({
          id: summary?.id ?? `${streamId}:${key ?? ++toolSequence}`,
          ts, kind: tool.status === "failed" ? "error" : tool.status === "cancelled" ? "status" : "success",
          role: "action", text: label + suffix,
          detail: [summary?.detail, tool.path && tool.path !== summary?.detail ? tool.path : undefined].filter(Boolean).join("\n")
        });
        options.onActivity?.([...activeTools.values()].at(-1)?.label);
      } else if (event.event === "error" || event.event === "permission_rejected") {
        options.onOutput({ ts, kind: "error", role: "action", text: event.event === "error" ? event.message as string : `Permission denied: ${(event as PermissionRejectedEvent).title}` });
      }
      return;
    }
    const lines: string[] = [];
    await acp.withAcpWriter(
      (line) => lines.push(line),
      async () => renderAcpEvent(event)
    );
    // Terminal separators belong between events, not inside timestamped dashboard entries.
    while (lines[0] === "") lines.shift();
    while (lines.at(-1) === "") lines.pop();
    if (lines.length === 0 || options.signal?.aborted) return;
    const output = lines.join("\n") + "\n";
    if (event.event === "error") options.onErrorOutput?.(output);
    else options.onToolOutput?.(output, id);
  }

  async function finishBlock(): Promise<void> {
    clearTimeout(timer);
    timer = undefined;
    await rendering;
    if (renderFailure !== undefined) throw renderFailure;
    if (dirty && block && !options.signal?.aborted) {
      dirty = false;
      await publish({ event: block.event, text: block.preview.text() }, block.id);
    }
    block = undefined;
  }

  try {
    if (options.signal?.aborted) return false;
    for await (const event of options.events) {
      if (options.signal?.aborted) break;
      sawEvents = true;
      if (renderFailure !== undefined) throw renderFailure;
      if (event.event !== "agent_message" && event.event !== "reasoning") {
        await finishBlock();
        await publish(event);
        continue;
      }
      if (typeof event.text !== "string" || event.text.length === 0) continue;
      if (block?.event !== event.event) {
        await finishBlock();
        block = {
          event: event.event,
          preview: dashboard.createOutputPreviewBuffer(),
          id: randomUUID()
        };
        block.preview.push(event.text);
        await publish({ event: block.event, text: block.preview.text() }, block.id);
        continue;
      }
      block.preview.push(event.text);
      dirty = true;
      if (timer !== undefined) continue;
      timer = setTimeout(() => {
        timer = undefined;
        if (!dirty || !block || options.signal?.aborted) return;
        const preview = { event: block.event, text: block.preview.text() };
        const id = block.id;
        dirty = false;
        rendering = rendering
          .then(() => publish(preview, id))
          .catch((error: unknown) => {
            renderFailure = error;
          });
      }, 16);
    }
  } finally {
    await finishBlock();
  }
  return sawEvents;
}
