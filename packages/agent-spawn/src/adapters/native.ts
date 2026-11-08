import { truncate, isNonEmptyString } from "./utils.js";

type AcpEvent = { event: string } & Record<string, unknown>;

export async function* adaptNative(
  lines: AsyncIterable<string>
): AsyncGenerator<AcpEvent> {
  for await (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    let event: unknown;
    try {
      event = JSON.parse(line) as unknown;
    } catch (error) {
      const stack = error instanceof Error ? error.stack : undefined;
      yield {
        event: "error",
        message: `[adaptNative] Malformed JSON line: ${truncate(line, 200)}`,
        stack
      };
      continue;
    }

    const maybeEventType = (event as { event?: unknown } | null)?.event;
    if (!isNonEmptyString(maybeEventType)) {
      yield {
        event: "error",
        message: `[adaptNative] Line missing string "event" field: ${truncate(line, 200)}`
      };
      continue;
    }

    yield event as AcpEvent;
  }
}
