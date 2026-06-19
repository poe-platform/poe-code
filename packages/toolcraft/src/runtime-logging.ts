export type LogLevel = "silent" | "error" | "warn" | "info" | "debug" | "trace";

export interface DiagnosticLogEvent {
  level: Exclude<LogLevel, "silent">;
  message: string;
  category?: "runtime" | "http" | "auth" | "retry" | "progress";
  data?: Record<string, unknown>;
}

export interface RuntimeLogger {
  level: LogLevel;
  emit(event: DiagnosticLogEvent): void;
}

export type RuntimeLoggerInput = RuntimeLogger | ((event: DiagnosticLogEvent) => void);

const LOG_LEVEL_RANK = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5
} as const satisfies Record<LogLevel, number>;

export const LOG_LEVELS = Object.freeze([
  "silent",
  "error",
  "warn",
  "info",
  "debug",
  "trace"
] as const satisfies readonly LogLevel[]);

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

export function shouldEmitDiagnostic(eventLevel: LogLevel, configuredLevel: LogLevel): boolean {
  if (eventLevel === "silent" || configuredLevel === "silent") {
    return false;
  }

  return LOG_LEVEL_RANK[eventLevel] <= LOG_LEVEL_RANK[configuredLevel];
}

export function createRuntimeLogger(
  options: {
    level?: LogLevel;
    logger?: RuntimeLoggerInput;
  } = {}
): RuntimeLogger {
  const level = options.level ?? "warn";
  const sink = options.logger;

  return {
    level,
    emit(event): void {
      if (!shouldEmitDiagnostic(event.level, level)) {
        return;
      }

      if (typeof sink === "function") {
        sink(event);
        return;
      }

      sink?.emit(event);
    }
  };
}
