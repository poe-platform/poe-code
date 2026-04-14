import path from "node:path";
import { parseDocument } from "yaml";
import { parseSuperintendentDoc, type StatusBlock } from "./parse.js";

export function updateStatus(filePath: string, content: string, status: StatusBlock): string {
  const resolvedFilePath = path.resolve(filePath);
  const parts = splitDocument(resolvedFilePath, content);
  const frontmatterDocument = parseDocument(parts.frontmatterText);

  if (frontmatterDocument.errors.length > 0) {
    throw new Error(
      `${resolvedFilePath}: invalid YAML frontmatter: ${frontmatterDocument.errors[0].message}`
    );
  }

  frontmatterDocument.set("status", {
    state: status.state,
    round: status.round,
    review_turn: status.review_turn
  });

  return [
    parts.bom,
    "---",
    parts.lineBreak,
    formatFrontmatter(frontmatterDocument.toString(), parts.lineBreak),
    parts.frontmatterSuffix,
    parts.body
  ].join("");
}

export function incrementRound(filePath: string, content: string): string {
  const document = parseSuperintendentDoc(filePath, content);

  return updateStatus(filePath, content, {
    ...document.frontmatter.status,
    round: document.frontmatter.status.round + 1
  });
}

export function setReviewTurn(filePath: string, content: string, turn: number): string {
  const document = parseSuperintendentDoc(filePath, content);

  return updateStatus(filePath, content, {
    ...document.frontmatter.status,
    review_turn: turn
  });
}

export function transitionState(
  filePath: string,
  content: string,
  newState: StatusBlock["state"]
): string {
  const document = parseSuperintendentDoc(filePath, content);

  return updateStatus(filePath, content, {
    ...document.frontmatter.status,
    state: newState,
    review_turn: newState === "in_progress" ? 0 : document.frontmatter.status.review_turn
  });
}

function splitDocument(
  filePath: string,
  content: string
): {
  bom: string;
  lineBreak: "\n" | "\r\n";
  frontmatterText: string;
  frontmatterSuffix: string;
  body: string;
} {
  const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
  const normalizedContent = bom ? content.slice(1) : content;
  const lineBreak = readOpeningLineBreak(normalizedContent);

  if (lineBreak === undefined) {
    throw new Error(`${filePath}: expected YAML frontmatter delimited by ---`);
  }

  const frontmatterStart = 3 + lineBreak.length;
  const closingFenceIndex = findClosingFence(normalizedContent, frontmatterStart, filePath);
  const frontmatterEnd = readFrontmatterEnd(normalizedContent, closingFenceIndex);
  const bodyStart = readBodyStart(normalizedContent, closingFenceIndex + 4);

  return {
    bom,
    lineBreak,
    frontmatterText: normalizedContent.slice(frontmatterStart, frontmatterEnd),
    frontmatterSuffix: normalizedContent.slice(frontmatterEnd, bodyStart),
    body: normalizedContent.slice(bodyStart)
  };
}

function readOpeningLineBreak(content: string): "\n" | "\r\n" | undefined {
  if (!content.startsWith("---")) {
    return undefined;
  }

  const nextCharacter = content[3];
  if (nextCharacter === "\n") {
    return "\n";
  }

  if (nextCharacter === "\r" && content[4] === "\n") {
    return "\r\n";
  }

  return nextCharacter === undefined ? "\n" : undefined;
}

function findClosingFence(content: string, searchFrom: number, filePath: string): number {
  let currentIndex = searchFrom - 1;

  while (currentIndex < content.length) {
    const candidateIndex = content.indexOf("\n---", currentIndex);

    if (candidateIndex === -1) {
      throw new Error(`${filePath}: missing YAML frontmatter end delimiter (---)`);
    }

    const fenceEnd = candidateIndex + 4;
    const nextCharacter = content[fenceEnd];

    if (nextCharacter === "\n" || nextCharacter === undefined) {
      return candidateIndex;
    }

    if (nextCharacter === "\r" && content[fenceEnd + 1] === "\n") {
      return candidateIndex;
    }

    currentIndex = fenceEnd;
  }

  throw new Error(`${filePath}: missing YAML frontmatter end delimiter (---)`);
}

function readBodyStart(content: string, bodyStart: number): number {
  const nextCharacter = content[bodyStart];

  if (nextCharacter === "\n") {
    return bodyStart + 1;
  }

  if (nextCharacter === "\r" && content[bodyStart + 1] === "\n") {
    return bodyStart + 2;
  }

  return bodyStart;
}

function readFrontmatterEnd(content: string, closingFenceIndex: number): number {
  return content[closingFenceIndex - 1] === "\r" ? closingFenceIndex - 1 : closingFenceIndex;
}

function formatFrontmatter(serialized: string, lineBreak: "\n" | "\r\n"): string {
  const normalized = serialized.endsWith("\n") ? serialized.slice(0, -1) : serialized;

  if (lineBreak === "\n") {
    return normalized;
  }

  return normalized.replaceAll("\n", lineBreak);
}
