export interface ExtractBlockResult {
  endOffset: number;
  source: string;
  lineOffset: number;
  startOffset: number;
  ranges: readonly (readonly [number, number])[];
}

export function extractBlock(markdown: string, startLine = 1): ExtractBlockResult {
  let index = 0;
  let line = startLine;
  const blocks: { start: number; end: number; line: number }[] = [];

  while (index < markdown.length) {
    const lineStart = index;
    const lineEnd = findLineEnd(markdown, index);
    const lineContent = markdown.slice(lineStart, lineEnd.index);
    const fence = readOpeningFence(lineContent);

    if (fence !== undefined) {
      const blockStart = lineEnd.index + lineEnd.lineBreakLength;
      const closingFence = findClosingFence(markdown, blockStart, fence);

      if (matchesScriptInfo(fence.info)) {
        if (!closingFence.found) {
          throw new Error(
            `Unclosed ${readInfoWord(fence.info)} fenced block opened at line ${line}.`
          );
        }

        blocks.push({ start: blockStart, end: closingFence.start, line });
      }

      const resumeIndex = findBlockResumeIndex(markdown, closingFence);
      line += countLineBreaks(markdown, index, resumeIndex);
      index = resumeIndex;
      continue;
    }

    if (lineEnd.lineBreakLength === 0) {
      break;
    }

    index = lineEnd.index + lineEnd.lineBreakLength;
    line += 1;
  }

  if (blocks.length === 0)
    return {
      endOffset: markdown.length,
      lineOffset: 1,
      source: markdown,
      startOffset: 0,
      ranges: [[0, markdown.length]]
    };

  const first = blocks[0];
  const parts: string[] = [];
  let cursor = first.start;
  for (const block of blocks) {
    parts.push(
      maskSource(markdown.slice(cursor, block.start)),
      markdown.slice(block.start, block.end)
    );
    cursor = block.end;
  }
  return {
    endOffset: cursor,
    lineOffset: first.line,
    source: parts.join(""),
    startOffset: first.start,
    ranges: blocks.map((block) => [block.start, block.end])
  };
}

export function maskSource(source: string): string {
  let masked = "";
  for (let offset = 0; offset < source.length; offset++) {
    const character = source[offset];
    masked += character === "\n" || character === "\r" ? character : " ";
  }
  return masked;
}

interface Fence {
  indent: string;
  marker: string;
  markerCharacter: "`" | "~";
  info: string;
}

function readOpeningFence(line: string): Fence | undefined {
  const fenceStart = readFenceStart(line);
  if (fenceStart === undefined) {
    return undefined;
  }

  let markerEnd = fenceStart.indentLength;
  while (line[markerEnd] === fenceStart.markerCharacter) {
    markerEnd += 1;
  }

  const marker = line.slice(fenceStart.indentLength, markerEnd);
  if (marker.length < 3) {
    return undefined;
  }

  const info = line.slice(markerEnd).trimStart();

  return {
    indent: line.slice(0, fenceStart.indentLength),
    marker,
    markerCharacter: fenceStart.markerCharacter,
    info
  };
}

function readFenceStart(
  line: string
): { indentLength: number; markerCharacter: "`" | "~" } | undefined {
  let index = 0;

  while (index < line.length && line[index] === " ") {
    index += 1;
  }

  const markerCharacter = line[index];
  return markerCharacter === "`" || markerCharacter === "~"
    ? {
        indentLength: index,
        markerCharacter
      }
    : undefined;
}

function matchesScriptInfo(info: string): boolean {
  const infoWord = readInfoWord(info);
  return infoWord === "js" || infoWord === "javascript" || infoWord === "ajs";
}

function readInfoWord(info: string): string {
  let index = 0;

  while (index < info.length && !isWhitespace(info[index])) {
    index += 1;
  }

  return info.slice(0, index);
}

function isWhitespace(character: string): boolean {
  return character === " " || character === "\t";
}

interface ClosingFence {
  found: boolean;
  start: number;
}

function findBlockResumeIndex(markdown: string, closingFence: ClosingFence): number {
  if (!closingFence.found || closingFence.start >= markdown.length) {
    return markdown.length;
  }

  const closingLineEnd = findLineEnd(markdown, closingFence.start);
  return closingLineEnd.index + closingLineEnd.lineBreakLength;
}

export function countLineBreaks(markdown: string, start = 0, end = markdown.length): number {
  let count = 0;
  let index = start;

  while (index < end) {
    const character = markdown[index];
    if (character === "\n") {
      count += 1;
      index += 1;
      continue;
    }

    if (character === "\r") {
      count += 1;
      index += markdown[index + 1] === "\n" ? 2 : 1;
      continue;
    }

    index += 1;
  }

  return count;
}

function findClosingFence(markdown: string, searchStart: number, fence: Fence): ClosingFence {
  let lineStart = searchStart;

  while (lineStart <= markdown.length) {
    const lineEnd = findLineEnd(markdown, lineStart);
    const lineContent = markdown.slice(lineStart, lineEnd.index);
    if (isClosingFence(lineContent, fence)) {
      return {
        found: true,
        start: lineStart
      };
    }

    if (lineEnd.lineBreakLength === 0) {
      return {
        found: false,
        start: markdown.length
      };
    }

    lineStart = lineEnd.index + lineEnd.lineBreakLength;
  }

  return {
    found: false,
    start: markdown.length
  };
}

function isClosingFence(line: string, fence: Fence): boolean {
  const fenceStart = readFenceStart(line);
  if (fenceStart === undefined || fenceStart.markerCharacter !== fence.markerCharacter) {
    return false;
  }

  const { indentLength } = fenceStart;
  if (line.slice(0, indentLength) !== fence.indent) {
    return false;
  }

  let markerEnd = indentLength;
  while (line[markerEnd] === fence.markerCharacter) {
    markerEnd += 1;
  }

  const closingMarker = line.slice(indentLength, markerEnd);
  if (closingMarker.length < fence.marker.length) {
    return false;
  }

  for (let index = markerEnd; index < line.length; index += 1) {
    if (line[index] !== " ") {
      return false;
    }
  }

  return true;
}

interface LineEnd {
  index: number;
  lineBreakLength: 0 | 1 | 2;
}

function findLineEnd(markdown: string, start: number): LineEnd {
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
