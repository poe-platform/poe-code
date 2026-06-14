export type FrontmatterBlock = {
  raw: string;
  body: string;
};

export type SplitFrontmatterResult = FrontmatterBlock | { body: string };

type LineEnd = {
  index: number;
  lineBreakLength: 0 | 1 | 2;
};

export function splitFrontmatterBlock(source: string): SplitFrontmatterResult {
  const content = source.startsWith("\uFEFF") ? source.slice(1) : source;
  const opening = readOpeningFence(content);

  if (opening === undefined) {
    return { body: source };
  }

  const closing = findClosingFence(content, opening.next);

  if (closing === undefined) {
    throw new Error("Missing YAML frontmatter end delimiter (---).");
  }

  return {
    raw: content.slice(opening.next, closing.index),
    body: content.slice(closing.end + closing.lineBreakLength)
  };
}

function readOpeningFence(source: string): { next: number } | undefined {
  if (!source.startsWith("---")) {
    return undefined;
  }

  const lineEnd = findLineEnd(source, 0);

  if (lineEnd.lineBreakLength === 0 || source.slice(0, lineEnd.index) !== "---") {
    return undefined;
  }

  return { next: lineEnd.index + lineEnd.lineBreakLength };
}

function findClosingFence(
  source: string,
  start: number
): { index: number; end: number; lineBreakLength: 0 | 1 | 2 } | undefined {
  let lineStart = start;

  while (lineStart <= source.length) {
    const lineEnd = findLineEnd(source, lineStart);

    if (isClosingFenceLine(source.slice(lineStart, lineEnd.index))) {
      return {
        index: lineStart,
        end: lineEnd.index,
        lineBreakLength: lineEnd.lineBreakLength
      };
    }

    if (lineEnd.lineBreakLength === 0) {
      break;
    }

    lineStart = lineEnd.index + lineEnd.lineBreakLength;
  }

  return undefined;
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

function findLineEnd(source: string, start: number): LineEnd {
  let index = start;

  while (index < source.length) {
    const character = source[index];

    if (character === "\n") {
      return { index, lineBreakLength: 1 };
    }

    if (character === "\r") {
      return {
        index,
        lineBreakLength: source[index + 1] === "\n" ? 2 : 1
      };
    }

    index += 1;
  }

  return { index: source.length, lineBreakLength: 0 };
}
