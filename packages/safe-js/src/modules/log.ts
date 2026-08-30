import {
  addBrokenPipeListener,
  createBrokenPipeState,
  createSafeOutputStream
} from "../output-stream.js";

export type LogModuleEntry =
  | {
      ts: string;
      type: "info" | "error";
      args: unknown[];
    }
  | {
      ts: string;
      type: "event";
      name: string;
      payload: unknown;
    };

export type LogModuleSink = (entry: LogModuleEntry) => void;

export function makeLogModule(sink: LogModuleSink = createJsonlStdoutSink()): {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  event: (name: string, payload: unknown) => void;
} {
  const normalizedSink = readSink(sink);

  return {
    info(...args) {
      normalizedSink({
        ts: new Date().toISOString(),
        type: "info",
        args
      });
    },

    error(...args) {
      normalizedSink({
        ts: new Date().toISOString(),
        type: "error",
        args
      });
    },

    event(name, payload) {
      normalizedSink({
        ts: new Date().toISOString(),
        type: "event",
        name: readNonEmptyString(name, "Event name"),
        payload
      });
    }
  };
}

function createJsonlStdoutSink(): LogModuleSink {
  const brokenPipe = createBrokenPipeState();
  const stdout = createSafeOutputStream(process.stdout, brokenPipe);
  addBrokenPipeListener(process.stdout, brokenPipe);

  return (entry) => {
    stdout.write(`${JSON.stringify(toJsonValue(entry, new WeakSet()))}\n`);
  };
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return normalizedValue;
}

function readSink(value: unknown): LogModuleSink {
  if (typeof value !== "function") {
    throw new Error("Log sink must be a function.");
  }

  return value as LogModuleSink;
}

function toJsonValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === undefined) {
    return null;
  }

  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }

  if (typeof value === "bigint" || typeof value === "symbol") {
    return String(value);
  }

  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
  }

  if (value instanceof Error) {
    const serializedError: Record<string, unknown> = {
      name: value.name,
      message: value.message
    };

    if (typeof value.stack === "string" && value.stack.length > 0) {
      serializedError.stack = value.stack;
    }

    if (Object.prototype.hasOwnProperty.call(value, "cause")) {
      serializedError.cause = toJsonValue(value.cause, seen);
    }

    return serializedError;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);
    const normalized = value.map((entry) => toJsonValue(entry, seen));
    seen.delete(value);
    return normalized;
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);
    const normalized = Object.create(null) as Record<string, unknown>;

    for (const [key, entry] of Object.entries(value)) {
      normalized[key] = toJsonValue(entry, seen);
    }

    seen.delete(value);
    return normalized;
  }

  return String(value);
}
