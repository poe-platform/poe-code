import { parse } from "yaml";

export interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const content = markdown.startsWith("\uFEFF") ? markdown.slice(1) : markdown;
  const openingLineBreak = readOpeningLineBreak(content);
  if (openingLineBreak === undefined) {
    return {
      frontmatter: {},
      body: markdown
    };
  }

  const frontmatterStart = 3 + openingLineBreak.length;
  const closingFenceIndex = findClosingFence(content, frontmatterStart);
  const yamlBlock = content.slice(frontmatterStart, closingFenceIndex);
  const bodyStart = closingFenceIndex + 4;
  const body = readBody(content, bodyStart);
  const parsedFrontmatter = parseYamlFrontmatter(yamlBlock);

  return {
    frontmatter: parsedFrontmatter,
    body
  };
}

function readOpeningLineBreak(markdown: string): "\n" | "\r\n" | undefined {
  if (!markdown.startsWith("---")) {
    return undefined;
  }

  const nextCharacter = markdown[3];
  if (nextCharacter === "\n") {
    return "\n";
  }

  if (nextCharacter === "\r" && markdown[4] === "\n") {
    return "\r\n";
  }

  return nextCharacter === undefined ? "\n" : undefined;
}

function findClosingFence(markdown: string, searchFrom: number): number {
  let currentIndex = searchFrom - 1;

  while (currentIndex < markdown.length) {
    const candidateIndex = markdown.indexOf("\n---", currentIndex);
    if (candidateIndex === -1) {
      throw new Error("Missing YAML frontmatter end delimiter (---).");
    }

    const fenceEnd = candidateIndex + 4;
    const nextCharacter = markdown[fenceEnd];
    if (nextCharacter === "\n" || nextCharacter === undefined) {
      return candidateIndex;
    }

    if (nextCharacter === "\r" && markdown[fenceEnd + 1] === "\n") {
      return candidateIndex;
    }

    currentIndex = fenceEnd;
  }

  throw new Error("Missing YAML frontmatter end delimiter (---).");
}

function readBody(markdown: string, bodyStart: number): string {
  const nextCharacter = markdown[bodyStart];
  if (nextCharacter === "\n") {
    return markdown.slice(bodyStart + 1);
  }

  if (nextCharacter === "\r" && markdown[bodyStart + 1] === "\n") {
    return markdown.slice(bodyStart + 2);
  }

  return markdown.slice(bodyStart);
}

function parseYamlFrontmatter(yamlBlock: string): Record<string, unknown> {
  const normalizedYamlBlock = yamlBlock.includes("\r")
    ? yamlBlock.replaceAll("\r\n", "\n").replaceAll("\r", "")
    : yamlBlock;
  let parsed: unknown;

  try {
    parsed = parse(normalizedYamlBlock);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown YAML parse error";
    throw new Error(`Invalid YAML frontmatter: ${message}`);
  }

  if (parsed === null) {
    return {};
  }

  if (!isRecord(parsed)) {
    throw new Error("YAML frontmatter must parse to an object.");
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
