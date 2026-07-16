import { DEFAULT_SPAWN_MODE } from "../types.js";
import type { OtelSink, OtelSpan, SpawnMode, SpawnResult } from "../types.js";

export const noopOtelSink: OtelSink = {
  startSpan: () => noopOtelSpan,
  recordException: () => undefined
};

const noopOtelSpan: OtelSpan = {
  setAttribute: () => undefined,
  addEvent: () => undefined,
  end: () => undefined
};

export function observeAgentSpawn(
  input: {
    agent: string;
    cwd?: string;
    mode?: SpawnMode;
    otelSink?: OtelSink;
    prompt: string;
  },
  operation: () => Promise<SpawnResult>
): Promise<SpawnResult> {
  const span = safeStartSpan(input.otelSink, "agent.spawn", {
    agent: input.agent,
    mode: input.mode ?? DEFAULT_SPAWN_MODE,
    cwd: input.cwd ?? process.cwd()
  });
  safeAddEvent(span, "prompt", { prompt: input.prompt });

  return (async () => {
    try {
      const result = await operation();
      safeAddEvent(span, "summary", { summary: readSummary(result) });
      safeAddEvent(span, "exit", { exitCode: result.exitCode });
      return result;
    } catch (error) {
      safeRecordException(input.otelSink, span, error);
      throw error;
    } finally {
      safeEndSpan(span);
    }
  })();
}

function safeStartSpan(
  sink: OtelSink | undefined,
  name: string,
  attrs: Record<string, unknown>
): OtelSpan {
  if (sink === undefined) {
    return noopOtelSpan;
  }

  try {
    return sink.startSpan(name, attrs);
  } catch (error) {
    warnOtelSinkFailure("startSpan", error);
    return noopOtelSpan;
  }
}

function safeAddEvent(
  span: OtelSpan | undefined,
  name: string,
  attrs: Record<string, unknown>
): void {
  if (span === undefined) {
    return;
  }

  try {
    span.addEvent(name, attrs);
  } catch (error) {
    warnOtelSinkFailure("addEvent", error);
  }
}

function safeRecordException(sink: OtelSink | undefined, span: OtelSpan, error: unknown): void {
  if (sink === undefined) {
    return;
  }

  try {
    sink.recordException(span, error);
  } catch (recordError) {
    warnOtelSinkFailure("recordException", recordError);
  }
}

function safeEndSpan(span: OtelSpan): void {
  try {
    span.end();
  } catch (error) {
    warnOtelSinkFailure("end", error);
  }
}

function readSummary(result: SpawnResult): string {
  return result.stdout.trim() || result.stderr.trim();
}

function warnOtelSinkFailure(method: string, error: unknown): void {
  console.warn(`OpenTelemetry sink ${method} failed: ${readErrorMessage(error)}`);
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
