import { createSourceSpan, replaceErrorStack } from "../error/shape.js";
export class ParseError extends Error {
    filename;
    kind = "ParseError";
    line;
    column;
    excerpt;
    caret;
    span;
    constructor(filename, message, line, column, excerpt, caret, span) {
        super(message);
        this.filename = filename;
        this.name = "ParseError";
        this.line = line;
        this.column = column;
        this.excerpt = excerpt;
        this.caret = caret;
        this.span = span;
        replaceErrorStack(this);
    }
}
const MAX_EXCERPT_CONTENT_LENGTH = 120;
const ELLIPSIS = "...";
export function formatParseError(source, filename, error) {
    const location = parseErrorLocation(error.message);
    if (location === undefined) {
        throw error;
    }
    const lines = splitLines(source);
    const startLine = Math.max(1, location.line - 2);
    const lastSpannedLine = Math.max(location.line, location.endLine);
    const sourceEndLine = Math.max(lines.length, 1);
    const endLine = Math.min(sourceEndLine, Math.max(lastSpannedLine, location.line) + 1);
    const lineNumberWidth = String(endLine).length;
    const excerpt = [];
    for (let line = startLine; line <= endLine; line += 1) {
        excerpt.push(renderLine(line, lines[line - 1] ?? "", getHighlightStartColumn(location, line), getHighlightEndColumn(location, line)));
    }
    const caret = excerpt
        .filter((line) => line.number >= location.line && line.number <= location.endLine)
        .map((line) => createCaret(line, lineNumberWidth, location))
        .join("\n");
    return new ParseError(filename, error.message, location.line, location.column, excerpt
        .map((line) => `${String(line.number).padStart(lineNumberWidth)} | ${line.content}`)
        .join("\n"), caret, createSourceSpan(source, location.line, location.column, location.endLine, location.endColumn));
}
function parseErrorLocation(message) {
    const linePrefix = " at line ";
    const columnPrefix = ", column ";
    const lineIndex = message.lastIndexOf(linePrefix);
    if (lineIndex === -1) {
        return undefined;
    }
    const columnIndex = message.indexOf(columnPrefix, lineIndex + linePrefix.length);
    if (columnIndex === -1) {
        return undefined;
    }
    const line = Number(message.slice(lineIndex + linePrefix.length, columnIndex));
    const columnStart = columnIndex + columnPrefix.length;
    const columnEnd = findNumberEnd(message, columnStart);
    const column = Number(message.slice(columnStart, columnEnd));
    if (!Number.isInteger(line) || !Number.isInteger(column)) {
        return undefined;
    }
    const endLocation = parseEndLocation(message, columnEnd);
    return {
        line,
        column,
        endLine: endLocation?.line ?? line,
        endColumn: endLocation?.column ?? column
    };
}
function splitLines(source) {
    return source.split(/\r\n|\n|\r/);
}
function renderLine(lineNumber, line, startColumn, endColumn) {
    const characters = Array.from(line);
    if (characters.length <= MAX_EXCERPT_CONTENT_LENGTH) {
        return {
            number: lineNumber,
            content: line,
            sourceColumnStart: 1
        };
    }
    const visibleLength = MAX_EXCERPT_CONTENT_LENGTH - ELLIPSIS.length * 2;
    const highlightStartIndex = Math.max(startColumn - 1, 0);
    const highlightEndIndex = endColumn === Number.MAX_SAFE_INTEGER
        ? highlightStartIndex
        : Math.max(endColumn - 1, highlightStartIndex);
    const highlightCenter = Math.floor((highlightStartIndex + highlightEndIndex) / 2);
    let sourceStartIndex = Math.max(0, highlightCenter - Math.floor(visibleLength / 2));
    sourceStartIndex = Math.min(sourceStartIndex, Math.max(characters.length - visibleLength, 0));
    const sourceEndIndex = Math.min(sourceStartIndex + visibleLength, characters.length);
    const prefix = sourceStartIndex > 0 ? ELLIPSIS : "";
    const suffix = sourceEndIndex < characters.length ? ELLIPSIS : "";
    return {
        number: lineNumber,
        content: `${prefix}${characters.slice(sourceStartIndex, sourceEndIndex).join("")}${suffix}`,
        sourceColumnStart: sourceStartIndex + 1 - prefix.length
    };
}
function createCaret(line, lineNumberWidth, location) {
    const contentColumns = Array.from(line.content).length;
    const isSpan = location.line !== location.endLine || location.column !== location.endColumn;
    const startColumn = getHighlightStartColumn(location, line.number);
    const endColumn = isSpan ? getHighlightEndColumn(location, line.number) : startColumn + 1;
    const renderedStartColumn = Math.max(startColumn - line.sourceColumnStart + 1, 1);
    const renderedEndColumn = Math.min(Math.max(endColumn - line.sourceColumnStart + 1, renderedStartColumn + 1), contentColumns + 1);
    const caretPadding = createCaretPadding(line.content, renderedStartColumn);
    const caretLength = Math.max(renderedEndColumn - renderedStartColumn, 1);
    return `${" ".repeat(lineNumberWidth)} | ${caretPadding}${"^".repeat(caretLength)}`;
}
function createCaretPadding(line, column) {
    let padding = "";
    const characters = Array.from(line);
    const maxColumn = Math.max(column - 1, 0);
    // Parser columns are character indexes. Terminals may render full-width glyphs wider.
    for (const character of characters.slice(0, maxColumn)) {
        padding += character === "\t" ? "\t" : " ";
    }
    if (maxColumn > characters.length) {
        padding += " ".repeat(maxColumn - characters.length);
    }
    return padding;
}
function getHighlightStartColumn(location, line) {
    if (line === location.line) {
        return location.column;
    }
    return 1;
}
function getHighlightEndColumn(location, line) {
    if (line === location.endLine) {
        return location.endColumn;
    }
    return Number.MAX_SAFE_INTEGER;
}
function parseEndLocation(message, startIndex) {
    const linePrefix = " to line ";
    const columnPrefix = ", column ";
    const lineIndex = message.indexOf(linePrefix, startIndex);
    if (lineIndex === -1) {
        return undefined;
    }
    const columnIndex = message.indexOf(columnPrefix, lineIndex + linePrefix.length);
    if (columnIndex === -1) {
        return undefined;
    }
    const line = Number(message.slice(lineIndex + linePrefix.length, columnIndex));
    const columnStart = columnIndex + columnPrefix.length;
    const columnEnd = findNumberEnd(message, columnStart);
    const column = Number(message.slice(columnStart, columnEnd));
    if (!Number.isInteger(line) || !Number.isInteger(column)) {
        return undefined;
    }
    return { line, column };
}
function findNumberEnd(value, startIndex) {
    let index = startIndex;
    while (index < value.length) {
        const code = value.charCodeAt(index);
        if (code < 48 || code > 57) {
            break;
        }
        index += 1;
    }
    return index;
}
