const wrappedErrorCause = Symbol("wrappedErrorCause");
export function formatErrorStack(name, message, stackFrames = []) {
    const header = message.length === 0 ? name : `${name}: ${message}`;
    return [header, ...stackFrames].join("\n");
}
export function replaceErrorStack(error, stackFrames = []) {
    error.stack = formatErrorStack(error.name, error.message, stackFrames);
}
export function attachErrorSpan(error, span) {
    if (span === undefined || hasOwnProperty(error, "span")) {
        return;
    }
    Object.defineProperty(error, "span", {
        configurable: true,
        value: span
    });
}
export function attachErrorCause(error, cause) {
    if (cause === undefined || hasOwnProperty(error, "cause")) {
        return;
    }
    Object.defineProperty(error, "cause", {
        configurable: true,
        value: cause
    });
}
export function attachWrappedErrorCause(error, cause) {
    if (cause === undefined || wrappedErrorCause in error) {
        return;
    }
    Object.defineProperty(error, wrappedErrorCause, {
        configurable: true,
        value: cause
    });
}
export function materializeWrappedErrorCause(value) {
    if (typeof value !== "object" || value === null || !(wrappedErrorCause in value)) {
        return;
    }
    attachErrorCause(value, value[wrappedErrorCause]);
}
export function readErrorSpan(value) {
    if (typeof value !== "object" || value === null || !hasOwnProperty(value, "span")) {
        return undefined;
    }
    const span = value.span;
    return isErrorSourceSpan(span) ? span : undefined;
}
export function readErrorCause(value) {
    return typeof value === "object" && value !== null && hasOwnProperty(value, "cause")
        ? value.cause
        : undefined;
}
export function isErrorSourceSpan(value) {
    if (typeof value !== "object" ||
        value === null ||
        !hasOwnProperty(value, "start") ||
        !hasOwnProperty(value, "end")) {
        return false;
    }
    return isErrorSourcePosition(value.start) && isErrorSourcePosition(value.end);
}
export function createSourceSpan(source, line, column, endLine, endColumn) {
    const start = createSourcePosition(source, line, column);
    const rawEnd = createSourcePosition(source, endLine, endColumn);
    const end = rawEnd.offset > start.offset
        ? rawEnd
        : createSourcePositionFromOffset(source, Math.min(start.offset + 1, source.length));
    return { start, end };
}
export function describeThrownValue(value) {
    if (value instanceof Error) {
        return value.message.length > 0 ? `${value.name}: ${value.message}` : value.name;
    }
    if (typeof value === "string") {
        return value;
    }
    if (value === undefined ||
        value === null ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        typeof value === "bigint" ||
        typeof value === "symbol") {
        return String(value);
    }
    try {
        const serialized = JSON.stringify(value);
        return serialized === undefined ? String(value) : serialized;
    }
    catch {
        return String(value);
    }
}
function isErrorSourcePosition(value) {
    return (typeof value === "object" &&
        value !== null &&
        hasOwnProperty(value, "line") &&
        typeof value.line === "number" &&
        hasOwnProperty(value, "column") &&
        typeof value.column === "number" &&
        hasOwnProperty(value, "offset") &&
        typeof value.offset === "number");
}
function hasOwnProperty(value, name) {
    return Object.prototype.hasOwnProperty.call(value, name);
}
function createSourcePosition(source, line, column) {
    return createSourcePositionFromOffset(source, findSourceOffset(source, line, column));
}
function createSourcePositionFromOffset(source, offset) {
    let line = 1;
    let column = 1;
    for (let index = 0; index < offset; index += 1) {
        if (source[index] === "\n") {
            line += 1;
            column = 1;
        }
        else {
            column += 1;
        }
    }
    return {
        column,
        line,
        offset
    };
}
function findSourceOffset(source, line, column) {
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
        }
        else {
            currentColumn += 1;
        }
    }
    return source.length;
}
