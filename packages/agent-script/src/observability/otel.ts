export type OtelSpan = {
  setAttribute(key: string, value: unknown): void;
  addEvent(name: string, attrs: Record<string, unknown>): void;
  end(): void;
};

export interface OtelSink {
  startSpan(name: string, attrs: Record<string, unknown>): OtelSpan;
  recordException(span: ReturnType<OtelSink["startSpan"]>, error: unknown): void;
}

export const noopOtelSink: OtelSink = {
  startSpan: () => noopOtelSpan,
  recordException: () => undefined
};

const noopOtelSpan: OtelSpan = {
  setAttribute: () => undefined,
  addEvent: () => undefined,
  end: () => undefined
};

const spanByAsyncValue = new WeakMap<object, OtelSpan>();
const activeSpans: OtelSpan[] = [];
const activeSinks: OtelSink[] = [];

export function bindOtelSpan(value: object, span: OtelSpan): void {
  spanByAsyncValue.set(value, span);
}

export function getBoundOtelSpan(value: unknown): OtelSpan | undefined {
  return typeof value === "object" && value !== null ? spanByAsyncValue.get(value) : undefined;
}

export function activateOtelSpan(span: OtelSpan): () => void {
  activeSpans.push(span);
  return () => {
    const index = activeSpans.lastIndexOf(span);
    if (index !== -1) {
      activeSpans.splice(index, 1);
    }
  };
}

export function getActiveOtelSpan(): OtelSpan | undefined {
  return activeSpans.at(-1);
}

export function activateOtelSink(sink: OtelSink | undefined): () => void {
  if (sink === undefined) {
    return () => undefined;
  }

  activeSinks.push(sink);
  return () => {
    const index = activeSinks.lastIndexOf(sink);
    if (index !== -1) {
      activeSinks.splice(index, 1);
    }
  };
}

export function getActiveOtelSink(): OtelSink | undefined {
  return activeSinks.at(-1);
}

export function safeStartSpan(
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

export function safeSetAttribute(span: OtelSpan, key: string, value: unknown): void {
  try {
    span.setAttribute(key, value);
  } catch (error) {
    warnOtelSinkFailure("setAttribute", error);
  }
}

export function safeAddEvent(
  span: OtelSpan | undefined,
  name: string,
  attrs?: Record<string, unknown>
): void {
  if (span === undefined) {
    return;
  }

  try {
    span.addEvent(name, attrs ?? {});
  } catch (error) {
    warnOtelSinkFailure("addEvent", error);
  }
}

export function safeRecordException(
  sink: OtelSink | undefined,
  span: OtelSpan,
  error: unknown
): void {
  if (sink === undefined) {
    return;
  }

  try {
    sink.recordException(span, error);
  } catch (recordError) {
    warnOtelSinkFailure("recordException", recordError);
  }
}

export function safeEndSpan(span: OtelSpan): void {
  try {
    span.end();
  } catch (error) {
    warnOtelSinkFailure("end", error);
  }
}

function warnOtelSinkFailure(method: string, error: unknown): void {
  console.warn(`OpenTelemetry sink ${method} failed: ${readErrorMessage(error)}`);
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
