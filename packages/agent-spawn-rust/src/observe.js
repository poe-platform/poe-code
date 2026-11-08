import { DEFAULT_SPAWN_MODE } from "./types.js";
export const noopOtelSink = {
  startSpan: () => noopOtelSpan,
  recordException: () => undefined
};
const noopOtelSpan = {
  setAttribute: () => undefined,
  addEvent: () => undefined,
  end: () => undefined
};
export function observeAgentSpawn(input, operation) {
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
function safeStartSpan(sink, name, attrs) {
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
function safeAddEvent(span, name, attrs) {
  if (span === undefined) {
    return;
  }
  try {
    span.addEvent(name, attrs);
  } catch (error) {
    warnOtelSinkFailure("addEvent", error);
  }
}
function safeRecordException(sink, span, error) {
  if (sink === undefined) {
    return;
  }
  try {
    sink.recordException(span, error);
  } catch (recordError) {
    warnOtelSinkFailure("recordException", recordError);
  }
}
function safeEndSpan(span) {
  try {
    span.end();
  } catch (error) {
    warnOtelSinkFailure("end", error);
  }
}
function readSummary(result) {
  return result.stdout.trim() || result.stderr.trim();
}
function warnOtelSinkFailure(method, error) {
  console.warn(`OpenTelemetry sink ${method} failed: ${readErrorMessage(error)}`);
}
function readErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
