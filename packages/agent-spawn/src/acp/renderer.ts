import { acp, text } from "@poe-code/design-system";
import type { AcpEvent } from "./types.js";

function writeLine(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * Render a single ACP event using design-system rendering primitives.
 *
 * Example:
 * `await renderAcpStream(spawnStreaming(...).events)`
 */
export function renderAcpEvent(event: AcpEvent): void {
  switch (event.event) {
    case "session_start":
      return;
    case "agent_message":
      acp.renderAgentMessage((event as { text: string }).text);
      return;
    case "tool_start":
      acp.renderToolStart(
        (event as { kind: string }).kind,
        (event as { title: string }).title
      );
      return;
    case "tool_complete":
      acp.renderToolComplete((event as { kind: string }).kind);
      return;
    case "reasoning":
      acp.renderReasoning((event as { text: string }).text);
      return;
    case "usage":
      acp.renderUsage({
        input: (event as { inputTokens: number }).inputTokens,
        output: (event as { outputTokens: number }).outputTokens,
        cached: (event as { cachedTokens?: number }).cachedTokens,
        costUsd: (event as { costUsd?: number }).costUsd
      });
      return;
    case "error":
      acp.renderError(
        (() => {
          const { message, stack } = event as { message: string; stack?: string };
          return typeof stack === "string" && stack.length > 0
            ? `${message}\n${stack}`
            : message;
        })()
      );
      return;
    default:
      writeLine(
        typeof (text as { muted?: unknown }).muted === "function"
          ? (text as { muted: (content: string) => string }).muted(event.event)
          : event.event
      );
      return;
  }
}

export async function renderAcpStream(
  events: AsyncIterable<AcpEvent>
): Promise<void> {
  let messageBuffer = "";

  function flushBuffer(): void {
    if (messageBuffer.length > 0) {
      acp.renderAgentMessage(messageBuffer);
      messageBuffer = "";
    }
  }

  for await (const event of events) {
    if (event.event === "agent_message") {
      messageBuffer += (event as { text: string }).text;
      continue;
    }
    flushBuffer();
    renderAcpEvent(event);
  }
  flushBuffer();
}
