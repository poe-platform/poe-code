import { load } from "js-yaml";

export interface SplitFrontmatterResult {
  frontmatter: Record<string, unknown>;
  body: string;
}

export function splitFrontmatter(markdown: string): SplitFrontmatterResult {
  const content = markdown.startsWith("\uFEFF") ? markdown.slice(1) : markdown;
  const openingLineBreak = readOpeningLineBreak(content);
  if (openingLineBreak === undefined) {
    return {
      frontmatter: {},
      body: markdown
    };
  }

  const frontmatterStart = 3 + openingLineBreak.length;
  const closingFence = findClosingFence(content, frontmatterStart);
  const yamlBlock = content.slice(frontmatterStart, closingFence.index);
  const frontmatter = parseFrontmatter(yamlBlock);
  const bodyStart = closingFence.endIndex + closingFence.lineBreakLength;

  return {
    frontmatter,
    body: content.slice(bodyStart)
  };
}

function readOpeningLineBreak(markdown: string): "\n" | "\r" | "\r\n" | undefined {
  if (!markdown.startsWith("---")) {
    return undefined;
  }

  const nextCharacter = markdown[3];
  if (nextCharacter === "\n") {
    return "\n";
  }

  if (nextCharacter === "\r") {
    return markdown[4] === "\n" ? "\r\n" : "\r";
  }

  return undefined;
}

function findClosingFence(
  markdown: string,
  searchStart: number
): { index: number; endIndex: number; lineBreakLength: 0 | 1 | 2 } {
  let lineStart = searchStart;

  while (lineStart <= markdown.length) {
    const lineEnd = findLineEnd(markdown, lineStart);
    if (isClosingFenceLine(markdown.slice(lineStart, lineEnd.index))) {
      return {
        index: lineStart,
        endIndex: lineEnd.index,
        lineBreakLength: lineEnd.lineBreakLength
      };
    }

    if (lineEnd.lineBreakLength === 0) {
      break;
    }

    lineStart = lineEnd.index + lineEnd.lineBreakLength;
  }

  throw new Error(
    `Invalid frontmatter at line ${countLines(markdown)}: missing closing delimiter (---).`
  );
}

function isClosingFenceLine(line: string): boolean {
  if (!line.startsWith("---")) {
    return false;
  }

  for (let index = 3; index < line.length; index += 1) {
    const character = line[index];
    if (character !== " " && character !== "\t") {
      return false;
    }
  }

  return true;
}

function findLineEnd(markdown: string, start: number): { index: number; lineBreakLength: 0 | 1 | 2 } {
  let index = start;

  while (index < markdown.length) {
    const character = markdown[index];
    if (character === "\n") {
      return {
        index,
        lineBreakLength: 1
      };
    }

    if (character === "\r") {
      if (markdown[index + 1] === "\n") {
        return {
          index,
          lineBreakLength: 2
        };
      }

      return {
        index,
        lineBreakLength: 1
      };
    }

    index += 1;
  }

  return {
    index: markdown.length,
    lineBreakLength: 0
  };
}

function parseFrontmatter(yamlBlock: string): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = load(yamlBlock);
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : "unknown YAML parse error";
    const line = readYamlErrorLine(error);
    throw new Error(`Invalid YAML frontmatter at line ${line + 2}: ${message}`);
  }

  if (parsed === undefined || parsed === null) {
    return {};
  }

  if (!isRecord(parsed)) {
    throw new Error("Invalid frontmatter at line 2: expected a YAML mapping.");
  }

  return parsed;
}

function readYamlErrorLine(error: unknown): number {
  if (
    typeof error === "object" &&
    error !== null &&
    hasOwnProperty(error, "mark") &&
    typeof error.mark === "object" &&
    error.mark !== null &&
    hasOwnProperty(error.mark, "line") &&
    typeof error.mark.line === "number"
  ) {
    return error.mark.line;
  }

  return 0;
}

function hasOwnProperty<Name extends PropertyKey>(
  value: object,
  name: Name
): value is Record<Name, unknown> {
  return Object.prototype.hasOwnProperty.call(value, name);
}

function countLines(value: string): number {
  let count = 1;

  for (const character of value) {
    if (character === "\n") {
      count += 1;
    }
  }

  return count;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
