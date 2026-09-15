import { randomUUID } from "node:crypto";
import { acp, dashboard } from "toolcraft-design";
import type { AcpEvent } from "./types.js";
import { renderAcpEvent } from "./renderer.js";

/** Render live message previews with stable ids; other events remain individual log entries. */
export async function streamAcpEventsToDashboard(options: {
  events: AsyncIterable<AcpEvent>;
  onToolOutput(chunk: string, id?: string): void;
  onErrorOutput(chunk: string): void;
}): Promise<boolean> {
  let sawEvents = false;
  let block: { event: "agent_message" | "reasoning"; text: string; id: string } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  let rendering = Promise.resolve();
  let renderFailure: unknown;

  async function publish(event: AcpEvent, id?: string): Promise<void> {
    const lines: string[] = [];
    await acp.withAcpWriter(
      (line) => lines.push(line),
      async () => renderAcpEvent(event)
    );
    if (lines.length === 0) return;
    const output = lines.join("\n") + "\n";
    if (event.event === "error") options.onErrorOutput(output);
    else options.onToolOutput(output, id);
  }

  async function finishBlock(): Promise<void> {
    clearTimeout(timer);
    timer = undefined;
    await rendering;
    if (renderFailure !== undefined) throw renderFailure;
    if (dirty && block) {
      dirty = false;
      await publish({ event: block.event, text: block.text }, block.id);
    }
    block = undefined;
  }

  try {
    for await (const event of options.events) {
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
          text: dashboard.limitOutputPreview(event.text),
          id: randomUUID()
        };
        await publish({ event: block.event, text: block.text }, block.id);
        continue;
      }
      block.text = dashboard.limitOutputPreview(block.text + event.text);
      dirty = true;
      if (timer !== undefined) continue;
      timer = setTimeout(() => {
        timer = undefined;
        if (!dirty || !block) return;
        const preview = { event: block.event, text: block.text };
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
