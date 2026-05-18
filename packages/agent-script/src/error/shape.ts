export type ErrorSourceSpan = {
  start: ErrorSourcePosition;
  end: ErrorSourcePosition;
};

export type ErrorSourcePosition = {
  line: number;
  column: number;
  offset: number;
};

const wrappedErrorCause = Symbol("wrappedErrorCause");

export function formatErrorStack(
  name: string,
  message: string,
  stackFrames: readonly string[] = []
): string {
  const header = message.length === 0 ? name : `${name}: ${message}`;
  return [header, ...stackFrames].join("\n");
}

export function replaceErrorStack(
  error: { message: string; name: string; stack?: string },
  stackFrames: readonly string[] = []
): void {
  error.stack = formatErrorStack(error.name, error.message, stackFrames);
}

export function attachErrorSpan(error: object, span: ErrorSourceSpan | undefined): void {
  if (span === undefined || "span" in error) {
    return;
  }

  Object.defineProperty(error, "span", {
    configurable: true,
    value: span
  });
}

export function attachErrorCause(error: object, cause: unknown): void {
  if (cause === undefined || "cause" in error) {
    return;
  }

  Object.defineProperty(error, "cause", {
    configurable: true,
    value: cause
  });
}

export function attachWrappedErrorCause(error: object, cause: unknown): void {
  if (cause === undefined || wrappedErrorCause in error) {
    return;
  }

  Object.defineProperty(error, wrappedErrorCause, {
    configurable: true,
    value: cause
  });
}

export function materializeWrappedErrorCause(value: unknown): void {
  if (typeof value !== "object" || value === null || !(wrappedErrorCause in value)) {
    return;
  }

  attachErrorCause(value, (value as { [wrappedErrorCause]?: unknown })[wrappedErrorCause]);
}

export function readErrorSpan(value: unknown): ErrorSourceSpan | undefined {
  if (typeof value !== "object" || value === null || !("span" in value)) {
    return undefined;
  }

  const span = (value as { span?: unknown }).span;
  return isErrorSourceSpan(span) ? span : undefined;
}

export function readErrorCause(value: unknown): unknown {
  return typeof value === "object" && value !== null && "cause" in value
    ? (value as { cause?: unknown }).cause
    : undefined;
}

export function isErrorSourceSpan(value: unknown): value is ErrorSourceSpan {
  if (typeof value !== "object" || value === null || !("start" in value) || !("end" in value)) {
    return false;
  }

  const span = value as {
    end: unknown;
    start: unknown;
  };
  return isErrorSourcePosition(span.start) && isErrorSourcePosition(span.end);
}

export function createSourceSpan(
  source: string,
  line: number,
  column: number,
  endLine: number,
  endColumn: number
): ErrorSourceSpan {
  const start = createSourcePosition(source, line, column);
  const rawEnd = createSourcePosition(source, endLine, endColumn);
  const end =
    rawEnd.offset > start.offset
      ? rawEnd
      : createSourcePositionFromOffset(source, Math.min(start.offset + 1, source.length));

  return { start, end };
}

export function describeThrownValue(value: unknown): string {
  if (value instanceof Error) {
    return value.message.length > 0 ? `${value.name}: ${value.message}` : value.name;
  }

  if (typeof value === "string") {
    return value;
  }

  if (
    value === undefined ||
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    typeof value === "symbol"
  ) {
    return String(value);
  }

  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}

function isErrorSourcePosition(value: unknown): value is ErrorSourcePosition {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { line?: unknown }).line === "number" &&
    typeof (value as { column?: unknown }).column === "number" &&
    typeof (value as { offset?: unknown }).offset === "number"
  );
}

function createSourcePosition(source: string, line: number, column: number): ErrorSourcePosition {
  return createSourcePositionFromOffset(source, findSourceOffset(source, line, column));
}

function createSourcePositionFromOffset(source: string, offset: number): ErrorSourcePosition {
  let line = 1;
  let column = 1;

  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return {
    column,
    line,
    offset
  };
}

function findSourceOffset(source: string, line: number, column: number): number {
  let currentLine = 1;
  let currentColumn = 1;

  for (let offset = 0; offset <= source.length; offset += 1) {
    if (currentLine === line && currentColumn === column) {
      return offset;
    }

    const character = source[offset];
    if (character === undefined) {
      return source.length;
    }

    if (character === "\n") {
      currentLine += 1;
      currentColumn = 1;
    } else {
      currentColumn += 1;
    }
  }

  return source.length;
}
