import { AS001 } from "./rules/AS001.js";
import { AS003 } from "./rules/AS003.js";
import { AS004 } from "./rules/AS004.js";
import { AS005 } from "./rules/AS005.js";
import { AS006_007 } from "./rules/AS006-007.js";
import { AS008 } from "./rules/AS008.js";
import { AS009 } from "./rules/AS009.js";
import { AS010 } from "./rules/AS010.js";
import { AS011 } from "./rules/AS011.js";
import { AS013 } from "./rules/AS013.js";
import { AS015 } from "./rules/AS015.js";
import { AS_ASYNC_NOT_NEEDED } from "./rules/AS-async-not-needed.js";
import { AS_AWAIT_NON_PROMISE } from "./rules/AS-await-non-promise.js";
import { AS_DESTRUCTURE_NULL_DEFAULT } from "./rules/AS-destructure-null-default.js";
import { AS_EXPORT_IMPORT_META } from "./rules/AS-export-import-meta.js";
import { AS_FLOATING_PROMISE } from "./rules/AS-floating-promise.js";
import { AS_FRONTMATTER_FIELD_UNUSED } from "./rules/AS-frontmatter-field-unused.js";
import { AS_IMPORT_CYCLE } from "./rules/AS-import-cycle.js";
import { AS_JSDOC_TYPE } from "./rules/AS-jsdoc-type.js";
import { AS_LARGE_LITERAL } from "./rules/AS-large-literal.js";
import { AS_MISSING_ASYNC } from "./rules/AS-missing-async.js";
import { AS_MUTATING_FROZEN } from "./rules/AS-mutating-frozen.js";
import { AS_NEEDLESS_TEMPLATE } from "./rules/AS-needless-template.js";
import { AS_SHADOW_GLOBAL } from "./rules/AS-shadow-global.js";
import { AS_UNBOUNDED_LOOP } from "./rules/AS-unbounded-loop.js";
import { AS_UNREACHABLE } from "./rules/AS-unreachable.js";
import { AS_UNUSED_IMPORT } from "./rules/AS-unused-import.js";
import { collectComments, tokenize } from "../parse/tokenizer.js";
import { parseModule } from "../parse/parser.js";
const RULES = [
    AS003,
    AS004,
    AS005,
    AS_SHADOW_GLOBAL,
    AS_UNUSED_IMPORT,
    AS006_007,
    AS_MISSING_ASYNC,
    AS008,
    AS009,
    AS010,
    AS011,
    AS013,
    AS015,
    AS_IMPORT_CYCLE,
    AS_AWAIT_NON_PROMISE,
    AS_FLOATING_PROMISE,
    AS_ASYNC_NOT_NEEDED,
    AS_JSDOC_TYPE,
    AS_NEEDLESS_TEMPLATE,
    AS_LARGE_LITERAL,
    AS_MUTATING_FROZEN,
    AS_FRONTMATTER_FIELD_UNUSED,
    AS_DESTRUCTURE_NULL_DEFAULT,
    AS_UNBOUNDED_LOOP,
    AS_UNREACHABLE,
    AS_EXPORT_IMPORT_META
];
const KNOWN_DIAGNOSTIC_CODES = new Set([
    "AS001",
    "AS002",
    "AS003",
    "AS004",
    "AS005",
    "AS006",
    "AS007",
    "AS008",
    "AS009",
    "AS010",
    "AS011",
    "AS012",
    "AS013",
    "AS014",
    "AS015",
    "AS-ASYNC-NOT-NEEDED",
    "AS-AWAIT-NON-PROMISE",
    "AS-EXPORT-DEFAULT-MISSING",
    "AS-DESTRUCTURE-NULL-DEFAULT",
    "AS-EXPORT-DEFAULT-MULTIPLE",
    "AS-EXPORT-DEFAULT-NOT-ARROW",
    "AS-EXPORT-DEFAULT-SIGNATURE",
    "AS-EXPORT-IMPORT-META",
    "AS-EXPORT-UNKNOWN",
    "AS-FLOATING-PROMISE",
    "AS-FRONTMATTER-FIELD-UNUSED",
    "AS-IMPORT-CYCLE",
    "AS-IMPORT-META-ASSIGN",
    "AS-JSDOC-TYPE",
    "AS-LARGE-LITERAL",
    "AS-MISSING-ASYNC",
    "AS-MUTATING-FROZEN",
    "AS-NEEDLESS-TEMPLATE",
    "AS-RETURN-AT-TOP",
    "AS-SHADOW-GLOBAL",
    "AS-UNBOUNDED-LOOP",
    "AS-UNKNOWN-DIRECTIVE",
    "AS-UNREACHABLE",
    "AS-UNUSED-IMPORT"
]);
export function lint(source, options = {}) {
    const diagnostics = collectDiagnostics(source, options);
    if (!options.fix) {
        return diagnostics;
    }
    const { fixed, fixes } = applyNonOverlappingFixes(source, diagnostics, options.fixRanges);
    return {
        diagnostics: fixed === source ? diagnostics : collectDiagnostics(fixed, { ...options, fix: false }),
        fixed,
        fixes
    };
}
function collectDiagnostics(source, options) {
    const suppressions = buildSuppressionState(source, options);
    const as001Diagnostics = AS001(source, options);
    if (as001Diagnostics.length > 0 && !hasOnlyRegexLiteralDiagnostics(as001Diagnostics)) {
        return finalizeDiagnostics(as001Diagnostics, suppressions);
    }
    const diagnostics = [...as001Diagnostics];
    for (const rule of RULES) {
        diagnostics.push(...rule(source, options));
    }
    const as010Keys = new Set(diagnostics
        .filter((diagnostic) => diagnostic.code === "AS010")
        .map((diagnostic) => createSpanKey(diagnostic.span)));
    return finalizeDiagnostics(diagnostics.filter((diagnostic) => diagnostic.code !== "AS007" || !as010Keys.has(createSpanKey(diagnostic.span))), suppressions);
}
function applyNonOverlappingFixes(source, diagnostics, ranges) {
    const fixes = diagnostics
        .flatMap((diagnostic) => (diagnostic.fix === undefined ? [] : [diagnostic.fix]))
        .filter((fix) => ranges === undefined ||
        ranges.some((range) => fix.range[0] >= range[0] && fix.range[1] <= range[1]))
        .sort(compareFixes);
    const selected = [];
    for (const fix of fixes) {
        if (selected.some((applied) => fixesOverlap(applied, fix))) {
            continue;
        }
        selected.push(fix);
    }
    selected.sort((left, right) => right.range[0] - left.range[0] || right.range[1] - left.range[1]);
    return {
        fixes: selected,
        fixed: selected.reduce((result, fix) => `${result.slice(0, fix.range[0])}${fix.replacement}${result.slice(fix.range[1])}`, source)
    };
}
function compareFixes(left, right) {
    return left.range[0] - right.range[0] || left.range[1] - right.range[1];
}
function fixesOverlap(left, right) {
    return left.range[0] < right.range[1] && right.range[0] < left.range[1];
}
function finalizeDiagnostics(diagnostics, suppressions) {
    return [
        ...diagnostics.filter((diagnostic) => !isSuppressed(diagnostic, suppressions)),
        ...suppressions.diagnostics
    ].sort(compareDiagnostics);
}
function isSuppressed(diagnostic, suppressions) {
    return (suppressions.fileCodes.has(diagnostic.code) ||
        suppressions.lineCodes.has(createSuppressionKey(diagnostic.line, diagnostic.code)));
}
function buildSuppressionState(source, options) {
    const comments = collectComments(source);
    const lineCodes = new Set();
    const fileCodes = new Set();
    const diagnostics = [];
    const statementSpans = collectStatementSpans(source);
    const lineStarts = createLineStarts(source);
    const filename = options.filename ?? "<input>";
    for (const comment of comments) {
        const directive = parseDirective(comment);
        if (directive === undefined) {
            continue;
        }
        const codes = directive.codes.filter(({ code, startOffset, endOffset }) => {
            if (KNOWN_DIAGNOSTIC_CODES.has(code)) {
                return true;
            }
            diagnostics.push(createUnknownDirectiveDiagnostic(filename, source, lineStarts, code, startOffset, endOffset));
            return false;
        });
        if (directive.kind === "file") {
            if (comment.type !== "block" || !isTopOfFileComment(source, comment)) {
                continue;
            }
            for (const { code } of codes) {
                fileCodes.add(code);
            }
            continue;
        }
        if (directive.kind === "line") {
            const span = findContainingStatementSpan(comment, statementSpans);
            if (span !== undefined) {
                for (const { code } of codes) {
                    for (let line = span.start.line; line <= span.end.line; line += 1) {
                        lineCodes.add(createSuppressionKey(line, code));
                    }
                }
                continue;
            }
            for (const { code } of codes) {
                lineCodes.add(createSuppressionKey(comment.start.line, code));
            }
            continue;
        }
        const span = findNextStatementSpan(comment, statementSpans) ?? findNextTokenSpan(source, comment);
        if (span === undefined) {
            continue;
        }
        for (const { code } of codes) {
            for (let line = span.start.line; line <= span.end.line; line += 1) {
                lineCodes.add(createSuppressionKey(line, code));
            }
        }
    }
    return { diagnostics, fileCodes, lineCodes };
}
function compareDiagnostics(left, right) {
    return (left.line - right.line || left.column - right.column || left.code.localeCompare(right.code));
}
function parseDirective(comment) {
    const words = splitCommentWords(comment);
    const markerIndex = words.findIndex((word) => isDirectiveMarker(word.value));
    if (markerIndex < 0) {
        return undefined;
    }
    const marker = words[markerIndex];
    const codes = [];
    for (const word of words.slice(markerIndex + 1)) {
        if (!isDirectiveCodeLike(word.value)) {
            break;
        }
        codes.push({
            code: word.value,
            startOffset: word.startOffset,
            endOffset: word.endOffset
        });
    }
    if (marker.value === "@as-disable-file") {
        if (comment.type !== "block") {
            return undefined;
        }
        return { kind: "file", codes };
    }
    if (comment.type !== "line") {
        return undefined;
    }
    if (marker.value === "@as-disable-line") {
        return { kind: "line", codes };
    }
    return { kind: "next", codes };
}
function splitCommentWords(comment) {
    const words = [];
    const contentOffset = comment.start.offset + 2;
    let index = 0;
    while (index < comment.value.length) {
        while (index < comment.value.length && isWhitespace(comment.value[index])) {
            index += 1;
        }
        const start = index;
        while (index < comment.value.length && !isWhitespace(comment.value[index])) {
            index += 1;
        }
        if (start < index) {
            words.push({
                value: comment.value.slice(start, index),
                startOffset: contentOffset + start,
                endOffset: contentOffset + index
            });
        }
    }
    return words;
}
function isDirectiveMarker(value) {
    return value === "@as-disable" || value === "@as-disable-line" || value === "@as-disable-file";
}
function isDirectiveCodeLike(value) {
    if (value.length <= 2 || value.slice(0, 2).toUpperCase() !== "AS") {
        return false;
    }
    for (let index = 2; index < value.length; index += 1) {
        const char = value[index];
        if (!isAsciiLetter(char) && !isDecimalDigit(char) && char !== "-") {
            return false;
        }
    }
    return true;
}
function collectStatementSpans(source) {
    try {
        const module = parseModule(source);
        const spans = [];
        for (const statement of module.body) {
            collectStatementSpan(statement, spans);
        }
        return spans.sort((left, right) => left.start.offset - right.start.offset);
    }
    catch {
        return [];
    }
}
function collectStatementSpan(statement, spans) {
    spans.push(statement.span);
    switch (statement.type) {
        case "BlockStatement":
            for (const child of statement.body) {
                collectStatementSpan(child, spans);
            }
            return;
        case "DoWhileStatement":
        case "ForInStatement":
        case "ForOfStatement":
        case "ForStatement":
        case "WhileStatement":
            collectStatementSpan(statement.body, spans);
            return;
        case "IfStatement": {
            collectStatementSpan(statement.consequent, spans);
            if (statement.alternate !== undefined) {
                collectStatementSpan(statement.alternate, spans);
            }
            return;
        }
        case "TryStatement": {
            collectStatementSpan(statement.block, spans);
            if (statement.handler !== undefined) {
                collectStatementSpan(statement.handler.body, spans);
            }
            if (statement.finalizer !== undefined) {
                collectStatementSpan(statement.finalizer, spans);
            }
            return;
        }
    }
}
function findNextStatementSpan(comment, statementSpans) {
    return statementSpans.find((span) => span.start.offset >= comment.end.offset);
}
function findContainingStatementSpan(comment, statementSpans) {
    return statementSpans
        .filter((span) => span.start.offset <= comment.start.offset && comment.start.offset <= span.end.offset)
        .sort((left, right) => spanLength(left) - spanLength(right))[0];
}
function spanLength(span) {
    return span.end.offset - span.start.offset;
}
function findNextTokenSpan(source, comment) {
    try {
        const token = tokenize(source, { allowRegexLiterals: true }).find((candidate) => candidate.type !== "eof" && candidate.start.offset >= comment.end.offset);
        if (token === undefined) {
            return undefined;
        }
        return { start: token.start, end: token.end };
    }
    catch {
        return undefined;
    }
}
function isTopOfFileComment(source, comment) {
    for (let index = 0; index < comment.start.offset; index += 1) {
        if (!isWhitespace(source[index])) {
            return false;
        }
    }
    return true;
}
function createUnknownDirectiveDiagnostic(filename, source, lineStarts, code, startOffset, endOffset) {
    const start = positionAt(lineStarts, startOffset);
    const end = positionAt(lineStarts, endOffset);
    return {
        code: "AS-UNKNOWN-DIRECTIVE",
        severity: "warning",
        message: `Unknown lint disable rule code '${code}'.`,
        filename,
        line: start.line,
        column: start.column,
        span: { start, end }
    };
}
function createLineStarts(source) {
    const starts = [0];
    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        if (char === "\r" || char === "\n") {
            if (char === "\r" && source[index + 1] === "\n")
                index += 1;
            starts.push(index + 1);
        }
    }
    return starts;
}
function positionAt(lineStarts, offset) {
    let lineIndex = 0;
    for (let index = 0; index < lineStarts.length; index += 1) {
        if (lineStarts[index] > offset) {
            break;
        }
        lineIndex = index;
    }
    const lineStart = lineStarts[lineIndex];
    return {
        line: lineIndex + 1,
        column: offset - lineStart + 1,
        offset
    };
}
function createSuppressionKey(line, code) {
    return `${line}:${code}`;
}
function isWhitespace(value) {
    return value === " " || value === "\t" || value === "\n" || value === "\r";
}
function isAsciiLetter(value) {
    return (value >= "A" && value <= "Z") || (value >= "a" && value <= "z");
}
function isDecimalDigit(value) {
    return value >= "0" && value <= "9";
}
function createSpanKey(span) {
    return `${span.start.offset}:${span.end.offset}`;
}
function hasOnlyRegexLiteralDiagnostics(diagnostics) {
    return diagnostics.every((diagnostic) => diagnostic.message === "Disallowed syntax: regex literal.");
}
