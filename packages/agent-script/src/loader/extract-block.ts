export interface ExtractBlockResult {
  endOffset: number;
  source: string;
  lineOffset: number;
  startOffset: number;
}

export function extractBlock(markdown: string): ExtractBlockResult {
  let index = 0;
  let line = 1;

  while (index < markdown.length) {
    const lineStart = index;
    const lineEnd = findLineEnd(markdown, index);
    const lineContent = markdown.slice(lineStart, lineEnd.index);
    const fence = readOpeningFence(lineContent);

    if (fence !== undefined) {
      const blockStart = lineEnd.index + lineEnd.lineBreakLength;
      const closingFenceStart = findClosingFenceStart(markdown, blockStart, fence.marker);

      if (matchesScriptInfo(fence.info)) {
        return {
          endOffset: closingFenceStart,
          lineOffset: line,
          source: markdown.slice(blockStart, closingFenceStart),
          startOffset: blockStart
        };
      }

      const resumeIndex = findBlockResumeIndex(markdown, closingFenceStart);
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

  return {
    endOffset: markdown.length,
    lineOffset: 1,
    source: markdown,
    startOffset: 0
  };
}

function readOpeningFence(line: string): { marker: string; info: string } | undefined {
  const indentLength = readFenceIndentLength(line);
  if (indentLength === undefined) {
    return undefined;
  }

  let markerEnd = indentLength;
  while (line[markerEnd] === "`") {
    markerEnd += 1;
  }

  const marker = line.slice(indentLength, markerEnd);
  if (marker.length < 3) {
    return undefined;
  }

  const info = line.slice(markerEnd).trimStart();

  return {
    marker,
    info
  };
}

function readFenceIndentLength(line: string): number | undefined {
  let index = 0;

  while (index < line.length && index < 3 && line[index] === " ") {
    index += 1;
  }

  return line[index] === "`" ? index : undefined;
}

function matchesScriptInfo(info: string): boolean {
  const infoWord = readInfoWord(info);
  return infoWord === "js" || infoWord === "ajs";
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

function findBlockResumeIndex(markdown: string, closingFenceStart: number): number {
  if (closingFenceStart >= markdown.length) {
    return markdown.length;
  }

  const closingLineEnd = findLineEnd(markdown, closingFenceStart);
  return closingLineEnd.index + closingLineEnd.lineBreakLength;
}

function countLineBreaks(markdown: string, start: number, end: number): number {
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

function findClosingFenceStart(markdown: string, searchStart: number, marker: string): number {
  let lineStart = searchStart;

  while (lineStart <= markdown.length) {
    const lineEnd = findLineEnd(markdown, lineStart);
    const lineContent = markdown.slice(lineStart, lineEnd.index);
    if (isClosingFence(lineContent, marker)) {
      return lineStart;
    }

    if (lineEnd.lineBreakLength === 0) {
      return markdown.length;
    }

    lineStart = lineEnd.index + lineEnd.lineBreakLength;
  }

  return markdown.length;
}

function isClosingFence(line: string, marker: string): boolean {
  const indentLength = readFenceIndentLength(line);
  if (indentLength === undefined) {
    return false;
  }

  let markerEnd = indentLength;
  while (line[markerEnd] === "`") {
    markerEnd += 1;
  }

  const closingMarker = line.slice(indentLength, markerEnd);
  if (closingMarker.length < marker.length) {
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
