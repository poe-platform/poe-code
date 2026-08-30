import { SandboxError } from "../interp/budget.js";

export type InterpreterDiagnostic = {
  kind: string;
  filename: string;
  line: number;
  column: number;
  message: string;
};

export type FormatErrorOptions = {
  filename?: string;
  hostCallName?: string;
  maxMessageLength?: number;
  source?: string;
};

type ParseDiagnostic = InterpreterDiagnostic & {
  kind: "ParseError";
  excerpt: string;
  caret: string;
};

type SpanDiagnostic = {
  message: string;
  span: {
    start: {
      line: number;
      column: number;
    };
  };
};

const DEFAULT_MAX_MESSAGE_LENGTH = 10_000;
const MAX_CAUSE_DEPTH = 20;

export function formatInterpreterError(source: string, error: InterpreterDiagnostic): string;
export function formatInterpreterError(error: unknown, options?: FormatErrorOptions): string;
export function formatInterpreterError(
  first: string | unknown,
  second?: InterpreterDiagnostic | FormatErrorOptions
): string {
  if (typeof first === "string" && isInterpreterDiagnostic(second)) {
    return formatSourceDiagnostic(first, second, {
      maxMessageLength: DEFAULT_MAX_MESSAGE_LENGTH
    });
  }

  const options = second as FormatErrorOptions | undefined;
  const formatted = formatTopLevelError(first, normalizeOptions(options));

  if (options?.hostCallName === undefined) {
    return formatted;
  }

  return wrapHostCall(formatted, options.hostCallName);
}

function normalizeOptions(options: FormatErrorOptions | undefined): Required<FormatErrorOptions> {
  return {
    filename: options?.filename ?? "<input>",
    hostCallName: options?.hostCallName ?? "",
    maxMessageLength: options?.maxMessageLength ?? DEFAULT_MAX_MESSAGE_LENGTH,
    source: options?.source ?? ""
  };
}

function formatTopLevelError(error: unknown, options: Required<FormatErrorOptions>): string {
  if (isParseDiagnostic(error)) {
    return formatParseDiagnostic(error, options.maxMessageLength);
  }

  if (error instanceof SandboxError) {
    return formatSandboxError(error, options.maxMessageLength);
  }

  if (isSpanDiagnostic(error)) {
    if (options.source === "") {
      return truncate(error.message, options.maxMessageLength);
    }

    return formatSourceDiagnostic(options.source, {
      kind: "InterpreterError",
      filename: options.filename,
      line: error.span.start.line,
      column: error.span.start.column,
      message: error.message
    });
  }

  if (isErrorLike(error)) {
    return formatErrorLike(error, options.maxMessageLength);
  }

  return `Thrown value: ${truncate(describeThrownValue(error), options.maxMessageLength)}`;
}

function formatParseDiagnostic(error: ParseDiagnostic, maxMessageLength: number): string {
  return [
    `${error.kind}: ${error.filename}:${error.line}:${error.column}`,
    "",
    error.excerpt,
    error.caret,
    "",
    truncate(error.message, maxMessageLength)
  ].join("\n");
}

function formatSandboxError(error: SandboxError, maxMessageLength: number): string {
  const lines = [formatErrorSummary(error, maxMessageLength)];

  if (error.code === "budgetExceeded" && error.budget !== undefined) {
    lines.push("", `Budget exceeded: ${error.budget} (${error.current} > ${error.limit})`);
  }

  return lines.join("\n");
}

function formatErrorLike(error: ErrorLike, maxMessageLength: number): string {
  const stack = formatSandboxStack(error, maxMessageLength);
  const causes = formatCauses(error, maxMessageLength);

  if (causes.length === 0) {
    return stack;
  }

  return [stack, "", ...causes].join("\n");
}

function formatSandboxStack(error: ErrorLike, maxMessageLength: number): string {
  if (typeof error.stack !== "string") {
    return formatErrorSummary(error, maxMessageLength);
  }

  const stackLines = splitLines(error.stack);
  const header = stackLines[0] === undefined || stackLines[0] === "" ? undefined : stackLines[0];
  const sandboxFrames = stackLines.slice(1).filter(isSandboxStackFrame);

  if (sandboxFrames.length === 0) {
    return formatErrorSummary(error, maxMessageLength);
  }

  return [
    truncate(header ?? formatErrorSummary(error, maxMessageLength), maxMessageLength),
    ...sandboxFrames
  ].join("\n");
}

function isSandboxStackFrame(line: string): boolean {
  const trimmed = line.trimStart();

  return (
    trimmed.startsWith("at ") &&
    trimmed.includes("(line ") &&
    trimmed.includes(", column ") &&
    trimmed.endsWith(")")
  );
}

function formatCauses(error: ErrorLike, maxMessageLength: number): string[] {
  const causes: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = readCause(error);

  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current !== undefined; depth += 1) {
    if (seen.has(current)) {
      causes.push("Caused by: [Circular cause]");
      break;
    }

    seen.add(current);
    causes.push(`Caused by: ${formatCause(current, maxMessageLength)}`);
    current = isObject(current) ? readCause(current) : undefined;
  }

  return causes;
}

function formatCause(cause: unknown, maxMessageLength: number): string {
  if (cause instanceof SandboxError) {
    return formatErrorSummary(cause, maxMessageLength);
  }

  if (isErrorLike(cause)) {
    return formatErrorSummary(cause, maxMessageLength);
  }

  return truncate(describeThrownValue(cause), maxMessageLength);
}

function readCause(value: object): unknown {
  return Object.prototype.hasOwnProperty.call(value, "cause")
    ? (value as { cause?: unknown }).cause
    : undefined;
}

function wrapHostCall(formatted: string, hostCallName: string): string {
  const lines = splitLines(formatted);
  const [firstLine = "", ...rest] = lines;

  return [`Host call ${hostCallName} failed: ${firstLine}`, ...rest].join("\n");
}

function formatSourceDiagnostic(
  source: string,
  error: InterpreterDiagnostic,
  options: { maxMessageLength?: number } = {}
): string {
  const lines = splitLines(source);
  const excerpt = createExcerpt(lines, error.line);
  const lineNumberWidth = String(
    excerpt[excerpt.length - 1]?.number ?? Math.max(error.line, 1)
  ).length;
  const reportedLine =
    excerpt.find((line) => line.number === Math.max(error.line, 1)) ?? excerpt[excerpt.length - 1];
  const caretPadding = createCaretPadding(
    reportedLine?.content ?? "",
    error.column,
    reportedLine?.hasSource === true
  );

  return [
    `${error.kind}: ${error.filename}:${error.line}:${error.column}`,
    "",
    ...excerpt.map((line) => `${String(line.number).padStart(lineNumberWidth)} | ${line.content}`),
    `${" ".repeat(lineNumberWidth)} | ${caretPadding}^`,
    "",
    truncate(error.message, options.maxMessageLength ?? DEFAULT_MAX_MESSAGE_LENGTH)
  ].join("\n");
}

function formatErrorSummary(error: ErrorLike, maxMessageLength: number): string {
  const name = typeof error.name === "string" && error.name !== "" ? error.name : "Error";
  const message = typeof error.message === "string" ? error.message : "";

  if (message === "") {
    return name;
  }

  return `${name}: ${truncate(message, maxMessageLength)}`;
}

function truncate(message: string, maxLength: number): string {
  if (message.length <= maxLength) {
    return message;
  }

  return `${message.slice(0, maxLength)}... [truncated ${message.length - maxLength} chars]`;
}

function describeThrownValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (
    value === undefined ||
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  if (typeof value === "symbol" || typeof value === "function") {
    return safeString(value, "[Unserializable thrown value]");
  }

  return stringifyJsonish(value);
}

function stringifyJsonish(value: object): string {
  const seen = new WeakSet<object>();

  try {
    return JSON.stringify(value, (_key, nested) => {
      if (typeof nested === "bigint") {
        return String(nested);
      }

      if (!isObject(nested)) {
        return nested;
      }

      if (seen.has(nested)) {
        return "[Circular]";
      }

      seen.add(nested);
      return nested;
    });
  } catch {
    return safeString(value, "[Unserializable thrown value]");
  }
}

function safeString(value: unknown, fallback: string): string {
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function isInterpreterDiagnostic(value: unknown): value is InterpreterDiagnostic {
  return (
    isObject(value) &&
    typeof value.kind === "string" &&
    typeof value.filename === "string" &&
    typeof value.line === "number" &&
    typeof value.column === "number" &&
    typeof value.message === "string"
  );
}

function isParseDiagnostic(value: unknown): value is ParseDiagnostic {
  return (
    isInterpreterDiagnostic(value) &&
    value.kind === "ParseError" &&
    typeof (value as { excerpt?: unknown }).excerpt === "string" &&
    typeof (value as { caret?: unknown }).caret === "string"
  );
}

function isSpanDiagnostic(value: unknown): value is SpanDiagnostic {
  return (
    isObject(value) &&
    typeof value.message === "string" &&
    isObject(value.span) &&
    isObject(value.span.start) &&
    typeof value.span.start.line === "number" &&
    typeof value.span.start.column === "number"
  );
}

type ErrorLike = {
  cause?: unknown;
  message?: unknown;
  name?: unknown;
  stack?: unknown;
};

function isErrorLike(value: unknown): value is ErrorLike {
  if (!isObject(value)) {
    return false;
  }

  return (
    value instanceof Error ||
    typeof value.name === "string" ||
    typeof value.message === "string" ||
    typeof value.stack === "string"
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function createExcerpt(
  sourceLines: readonly string[],
  reportedLine: number
): Array<{ number: number; content: string; hasSource: boolean }> {
  const safeLineNumber = Math.max(reportedLine, 1);

  if (safeLineNumber > sourceLines.length) {
    return [
      {
        number: safeLineNumber,
        content: "",
        hasSource: false
      }
    ];
  }

  const excerpt: Array<{ number: number; content: string; hasSource: boolean }> = [];
  const startLine = Math.max(1, safeLineNumber - 2);
  const endLine = Math.min(sourceLines.length, safeLineNumber + 1);

  for (let line = startLine; line <= endLine; line += 1) {
    excerpt.push({
      number: line,
      content: sourceLines[line - 1] ?? "",
      hasSource: true
    });
  }

  return excerpt;
}

function splitLines(source: string): string[] {
  return source.split(/\r\n|\n|\r/);
}

function createCaretPadding(line: string, column: number, hasSource: boolean): string {
  let padding = "";
  const maxColumn = hasSource
    ? Math.max(Math.min(column - 1, line.length), 0)
    : Math.max(column - 1, 0);

  for (const character of line.slice(0, maxColumn)) {
    padding += character === "\t" ? "\t" : " ";
  }

  if (maxColumn > line.length) {
    padding += " ".repeat(maxColumn - line.length);
  }

  return padding;
}
