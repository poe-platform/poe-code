import { drainWork } from "./work.js";
import { parseDocument } from "yaml";
import {
  MermaidBudget,
  MermaidError,
  type MermaidSourceSpan
} from "./contracts.js";

export interface ScannedStatement {
  readonly text: string;
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

const encoder = new TextEncoder();

export function isAsciiWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

export function isIdentifierChar(ch: string): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    ch === "_" ||
    ch === "-" ||
    ch === "." ||
    code > 127
  );
}

export function checkSafeLabelText(
  label: string,
  budget: MermaidBudget,
  span?: MermaidSourceSpan
): string {
  const bytes = encoder.encode(label);
  budget.checkLabelBytes(bytes.byteLength, span);
  const lower = label.toLowerCase();
  const forbidden = [
    "<script",
    "</script",
    "<iframe",
    "<object",
    "<embed",
    "<svg",
    "<img",
    "<a ",
    "javascript:",
    "onerror=",
    "onload="
  ];
  for (const token of forbidden) {
    if (lower.includes(token)) {
      throw new MermaidError(
        "E_UNSUPPORTED",
        `Unsupported HTML or active content '${token}' in diagram label`,
        { span }
      );
    }
  }
  return label;
}

export function unquoteText(raw: string): string {
  const trimmed = raw.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    let out = "";
    const inner = trimmed.slice(1, -1);
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i]!;
      if (ch === "\\" && i + 1 < inner.length) {
        const next = inner[i + 1]!;
        if (next === "n") {
          out += "\n";
          i++;
          continue;
        }
        if (next === '"' || next === "'" || next === "\\") {
          out += next;
          i++;
          continue;
        }
      }
      out += ch;
    }
    return out;
  }
  return trimmed;
}

export function* scanStatementsSteps(
  rawSource: string,
  budget: MermaidBudget,
  metadata?: { title?: string; config?: Record<string, unknown> }
): Generator<void, readonly ScannedStatement[], void> {
  yield;

  let work = 0;

  if (typeof rawSource !== "string") {
    throw new MermaidError("E_SYNTAX", "Diagram source must be a string");
  }
  const utf8Bytes = encoder.encode(rawSource);
  budget.chargeSourceBytes(utf8Bytes.byteLength);

  let source = rawSource;
  let baseOffset = 0;
  if (source.startsWith("\uFEFF")) {
    source = source.slice(1);
    baseOffset = 1;
  }

  let firstNonWs = 0;
  while (firstNonWs < source.length && isAsciiWhitespace(source[firstNonWs]!)) {
    if (++work % 256 === 0) yield;
    firstNonWs++;
  }
  if (source.slice(firstNonWs).startsWith("---\n") || source.slice(firstNonWs).startsWith("---\r\n")) {
    const openingEnd = source.indexOf("\n", firstNonWs);
    let closingStart = openingEnd + 1;
    while (closingStart < source.length) {
      if (++work % 256 === 0) yield;
      const end = source.indexOf("\n", closingStart);
      const line = source.slice(closingStart, end < 0 ? source.length : end).trim();
      if (line === "---") break;
      closingStart = end < 0 ? source.length : end + 1;
    }
    if (closingStart >= source.length) throw new MermaidError("E_SYNTAX", "Unclosed YAML frontmatter");
    budget.chargeWork(closingStart - openingEnd);
    const parsed = parseSourceConfig(source.slice(openingEnd + 1, closingStart));
    if (metadata) {
      if (typeof parsed.title === "string") metadata.title = checkSafeLabelText(parsed.title, budget);
      if (parsed.config && typeof parsed.config === "object" && !Array.isArray(parsed.config)) metadata.config = parsed.config as Record<string, unknown>;
    }
    const closingEnd = source.indexOf("\n", closingStart);
    const end = closingEnd < 0 ? source.length : closingEnd;
    source = source.slice(0, end).split("").map(ch => ch === "\n" || ch === "\r" ? ch : " ").join("") + source.slice(end);
  }

  const statements: ScannedStatement[] = [];
  let current = "";
  let stmtLine = 1;
  let stmtCol = 1;
  let stmtOffset = 0;
  let hasStmtStart = false;

  let line = 1;
  let col = 1;
  let inQuote: '"' | "'" | null = null;
  let bracketDepth = 0;
  let inPipeLabel = false;
  let i = 0;

  const flushStatement = (): void => {
    const trimmed = current.trim();
    if (trimmed.length > 0) {
      budget.chargeTokens(1);
      statements.push({
        text: trimmed,
        line: stmtLine,
        column: stmtCol,
        offset: baseOffset + stmtOffset
      });
    }
    current = "";
    hasStmtStart = false;
  };

  while (i < source.length) {
    if (++work % 256 === 0) yield;

    budget.chargeWork(1);
    const ch = source[i]!;

    if (ch === "\r") {
      if (source[i + 1] === "\n") i++;
      if (inQuote !== null) {
        current += "\n";
      } else {
        bracketDepth = 0;
        inPipeLabel = false;
        flushStatement();
      }
      line++;
      col = 1;
      i++;
      continue;
    }

    if (ch === "\n") {
      if (inQuote !== null) {
        current += "\n";
      } else {
        bracketDepth = 0;
        inPipeLabel = false;
        flushStatement();
      }
      line++;
      col = 1;
      i++;
      continue;
    }

    // Comments and %%{init:...}%% directives outside quotes
    if (inQuote === null && ch === "%" && source[i + 1] === "%") {
      if (source[i + 2] === "{") {
        const end = source.indexOf("}%%", i + 3);
        if (end < 0) throw new MermaidError("E_SYNTAX", "Unclosed Mermaid directive", { span: { offset: baseOffset + i, line, column: col } });
        const directive = source.slice(i + 3, end).trim();
        const colon = directive.indexOf(":");
        if (colon >= 0 && ["init", "initialize"].includes(directive.slice(0, colon).trim()) && metadata) {
          metadata.config = mergeSourceConfig(metadata.config ?? {}, parseSourceConfig(directive.slice(colon + 1)));
        }
        while (i < end + 3) {
          budget.chargeWork(1);
          if (source[i] === "\n") { line++; col = 1; } else col++;
          i++;
        }
        continue;
      }
      // Skip to end of line
      while (i < source.length && source[i] !== "\n" && source[i] !== "\r") {
        if (++work % 256 === 0) yield;

        i++;
        col++;
      }
      continue;
    }

    if (inQuote !== null) {
      if (ch === "\\" && i + 1 < source.length) {
        current += ch + source[i + 1]!;
        i += 2;
        col += 2;
        continue;
      }
      if (ch === inQuote) {
        inQuote = null;
      }
      current += ch;
      i++;
      col++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      if (!hasStmtStart) {
        hasStmtStart = true;
        stmtLine = line;
        stmtCol = col;
        stmtOffset = i;
      }
      inQuote = ch;
      current += ch;
      i++;
      col++;
      continue;
    }

    if (ch === "|" && bracketDepth === 0) {
      inPipeLabel = !inPipeLabel;
    }
    if (!inPipeLabel && (ch === "[" || ch === "(" || ch === "{")) {
      bracketDepth++;
    } else if (!inPipeLabel && (ch === "]" || ch === ")" || ch === "}") && bracketDepth > 0) {
      bracketDepth--;
    }

    if (ch === ";" && bracketDepth === 0 && !inPipeLabel) {
      flushStatement();
      i++;
      col++;
      continue;
    }

    if (!hasStmtStart && !isAsciiWhitespace(ch)) {
      hasStmtStart = true;
      stmtLine = line;
      stmtCol = col;
      stmtOffset = i;
    }

    if (hasStmtStart) {
      current += ch;
    }

    i++;
    col++;
  }

  if (inQuote !== null) {
    throw new MermaidError("E_SYNTAX", "Unterminated quoted string in diagram source", {
      span: { offset: baseOffset + stmtOffset, line: stmtLine, column: stmtCol }
    });
  }

  flushStatement();

  if (statements.length === 0) {
    throw new MermaidError("E_SYNTAX", "Diagram source is empty", {
      span: { offset: 0, line: 1, column: 1 }
    });
  }

  return statements;
}

export function scanStatements(rawSource: string, budget: MermaidBudget): readonly ScannedStatement[] {
  return drainWork(scanStatementsSteps(rawSource, budget));
}

export function mergeSourceConfig(left: Record<string, unknown>, right: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...left };
  for (const [key, value] of Object.entries(right)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    const existing = result[key];
    result[key] = value && typeof value === "object" && !Array.isArray(value) && existing && typeof existing === "object" && !Array.isArray(existing)
      ? mergeSourceConfig(existing as Record<string, unknown>, value as Record<string, unknown>) : value;
  }
  return result;
}

function parseSourceConfig(source: string): Record<string, unknown> {
  const document = parseDocument(source);
  if (document.errors.length) throw new MermaidError("E_CONFIG", document.errors[0]!.message);
  const value: unknown = document.toJS({ maxAliasCount: 0 });
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MermaidError("E_CONFIG", "Mermaid configuration must be a mapping");
  return value as Record<string, unknown>;
}
