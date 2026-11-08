import type { AcpEvent } from "../acp/types.js";
import { truncate, isNonEmptyString, extractThreadId } from "./utils.js";

type OpenCodeEvent = {
  type?: unknown;
  sessionID?: unknown;
  sessionId?: unknown;
  session_id?: unknown;
  threadId?: unknown;
  thread_id?: unknown;
  threadID?: unknown;
  part?: unknown;
};

type OpenCodeTextPart = {
  type?: unknown;
  text?: unknown;
};

type OpenCodeToolState = {
  status?: unknown;
  input?: unknown;
  output?: unknown;
};

type OpenCodeToolPart = {
  type?: unknown;
  callID?: unknown;
  tool?: unknown;
  state?: unknown;
};

type OpenCodeStepFinishPart = {
  tokens?: unknown;
};

type OpenCodeTokens = {
  input?: unknown;
  output?: unknown;
  cache?: unknown;
};

type OpenCodeTokenCache = {
  read?: unknown;
  write?: unknown;
};

function guessToolKind(toolName: string): string {
  const normalized = toolName.toLowerCase();

  if (normalized === "bash" || normalized === "shell" || normalized === "sh") return "exec";
  if (normalized.includes("read")) return "read";
  if (normalized.includes("write") || normalized.includes("edit") || normalized.includes("patch")) {
    return "edit";
  }
  if (
    normalized.includes("search") ||
    normalized.includes("grep") ||
    normalized.includes("glob") ||
    normalized.includes("find")
  ) {
    return "search";
  }
  if (normalized.includes("think") || normalized.includes("task")) return "think";

  return "other";
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export async function* adaptOpenCode(
  lines: AsyncIterable<string>
): AsyncGenerator<AcpEvent> {
  let emittedSessionStart = false;
  const toolKindById = new Map<string, string>();

  for await (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    let event: OpenCodeEvent;
    try {
      event = JSON.parse(line) as OpenCodeEvent;
    } catch (error) {
      const stack = error instanceof Error ? error.stack : undefined;
      yield {
        event: "error",
        message: `[adaptOpenCode] Malformed JSON line: ${truncate(line, 200)}`,
        stack
      };
      continue;
    }

    if (!event || typeof event !== "object") continue;

    const sessionID = extractThreadId(event);
    if (!emittedSessionStart && isNonEmptyString(sessionID)) {
      emittedSessionStart = true;
      yield { event: "session_start", threadId: sessionID };
    }

    const eventType = event.type;
    if (!isNonEmptyString(eventType)) continue;

    if (eventType === "text") {
      const part = (event.part ?? null) as OpenCodeTextPart | null;
      if (!part || typeof part !== "object") continue;
      if (!isNonEmptyString(part.text)) continue;
      yield { event: "agent_message", text: part.text };
      continue;
    }

    if (eventType === "tool_use") {
      const part = (event.part ?? null) as OpenCodeToolPart | null;
      if (!part || typeof part !== "object") continue;
      if (!isNonEmptyString(part.callID) || !isNonEmptyString(part.tool)) continue;

      const state = (part.state ?? null) as OpenCodeToolState | null;
      if (!state || typeof state !== "object") continue;

      const kind = guessToolKind(part.tool);
      const status = state.status;
      const terminal = status === "completed" || status === "failed" || status === "cancelled";

      if (!toolKindById.has(part.callID)) {
        toolKindById.set(part.callID, kind);

        let title = part.tool;
        const maybeInput = state.input;
        if (kind === "exec" && maybeInput && typeof maybeInput === "object") {
          const command = (maybeInput as { command?: unknown }).command;
          if (isNonEmptyString(command)) {
            title = truncate(command, 80);
          }
        }

        yield {
          event: "tool_start",
          id: part.callID,
          kind,
          title,
          input: state.input
        };
      }

      if (terminal) {
        const kindFromStart = toolKindById.get(part.callID) ?? kind;
        toolKindById.delete(part.callID);

        yield {
          event: "tool_complete",
          id: part.callID,
          kind: kindFromStart,
          path: safeStringify(state.output),
          status
        };
      }

      continue;
    }

    if (eventType === "step_finish") {
      const part = (event.part ?? null) as OpenCodeStepFinishPart | null;
      if (!part || typeof part !== "object") continue;

      const tokens = (part.tokens ?? null) as OpenCodeTokens | null;
      if (!tokens || typeof tokens !== "object") continue;

      const inputTokens = typeof tokens.input === "number" ? tokens.input : 0;
      const outputTokens = typeof tokens.output === "number" ? tokens.output : 0;

      const cache = (tokens.cache ?? null) as OpenCodeTokenCache | null;
      const cachedTokens =
        cache && typeof cache === "object" && typeof cache.read === "number" ? cache.read : undefined;

      if (inputTokens === 0 && outputTokens === 0 && cachedTokens === undefined) continue;

      yield { event: "usage", inputTokens, outputTokens, cachedTokens };
      continue;
    }
  }
}
