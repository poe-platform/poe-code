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

export function scanStatements(
  rawSource: string,
  budget: MermaidBudget
): readonly ScannedStatement[] {
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

  // Check for YAML frontmatter at start of document
  let firstNonWs = 0;
  let firstLine = 1;
  let firstCol = 1;
  while (firstNonWs < source.length && isAsciiWhitespace(source[firstNonWs]!)) {
    if (source[firstNonWs] === "\n") {
      firstLine++;
      firstCol = 1;
    } else if (source[firstNonWs] !== "\r") {
      firstCol++;
    }
    firstNonWs++;
  }
  if (source.startsWith("---", firstNonWs)) {
    const afterDashes = firstNonWs + 3;
    if (
      afterDashes >= source.length ||
      source[afterDashes] === "\n" ||
      source[afterDashes] === "\r" ||
      source[afterDashes] === " "
    ) {
      throw new MermaidError(
        "E_UNSUPPORTED",
        "YAML frontmatter is not supported in the initial profile",
        {
          span: {
            offset: baseOffset + firstNonWs,
            line: firstLine,
            column: firstCol,
            length: 3
          }
        }
      );
    }
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
    budget.chargeWork(1);
    const ch = source[i]!;

    if (ch === "\r") {
      if (source[i + 1] === "\n") i++;
      if (inQuote !== null) {
        current += "\n";
      } else {
        bracketDepth = 0;
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
        throw new MermaidError(
          "E_UNSUPPORTED",
          "Mermaid init directives (%%{...}%%) are not supported; supply host theme/limit settings instead",
          { span: { offset: baseOffset + i, line, column: col, length: 3 } }
        );
      }
      // Skip to end of line
      while (i < source.length && source[i] !== "\n" && source[i] !== "\r") {
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

    if (ch === "[" || ch === "(") {
      bracketDepth++;
    } else if ((ch === "]" || ch === ")") && bracketDepth > 0) {
      bracketDepth--;
    }

    if (ch === ";" && bracketDepth === 0) {
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
