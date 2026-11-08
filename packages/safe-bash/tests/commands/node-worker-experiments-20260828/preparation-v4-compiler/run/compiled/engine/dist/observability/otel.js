export const noopOtelSink = {
    startSpan: () => noopOtelSpan,
    recordException: () => undefined
};
const noopOtelSpan = {
    setAttribute: () => undefined,
    addEvent: () => undefined,
    end: () => undefined
};
const spanByAsyncValue = new WeakMap();
const activeSpans = [];
const activeSinks = [];
export function bindOtelSpan(value, span) {
    spanByAsyncValue.set(value, span);
}
export function getBoundOtelSpan(value) {
    return typeof value === "object" && value !== null ? spanByAsyncValue.get(value) : undefined;
}
export function activateOtelSpan(span) {
    activeSpans.push(span);
    return () => {
        const index = activeSpans.lastIndexOf(span);
        if (index !== -1) {
            activeSpans.splice(index, 1);
        }
    };
}
export function getActiveOtelSpan() {
    return activeSpans.at(-1);
}
export function activateOtelSink(sink) {
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
export function getActiveOtelSink() {
    return activeSinks.at(-1);
}
export function safeStartSpan(sink, name, attrs) {
    if (sink === undefined) {
        return noopOtelSpan;
    }
    try {
        return sink.startSpan(name, attrs);
    }
    catch (error) {
        warnOtelSinkFailure("startSpan", error);
        return noopOtelSpan;
    }
}
export function safeSetAttribute(span, key, value) {
    try {
        span.setAttribute(key, value);
    }
    catch (error) {
        warnOtelSinkFailure("setAttribute", error);
    }
}
export function safeAddEvent(span, name, attrs) {
    if (span === undefined) {
        return;
    }
    try {
        span.addEvent(name, attrs ?? {});
    }
    catch (error) {
        warnOtelSinkFailure("addEvent", error);
    }
}
export function safeRecordException(sink, span, error) {
    if (sink === undefined) {
        return;
    }
    try {
        sink.recordException(span, error);
    }
    catch (recordError) {
        warnOtelSinkFailure("recordException", recordError);
    }
}
export function safeEndSpan(span) {
    try {
        span.end();
    }
    catch (error) {
        warnOtelSinkFailure("end", error);
    }
}
function warnOtelSinkFailure(method, error) {
    console.warn(`OpenTelemetry sink ${method} failed: ${readErrorMessage(error)}`);
}
function readErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
