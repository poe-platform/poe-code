import type { MdNode } from "../ast.js";

type ParserState = {
  input: string;
  position: number;
};

type Line = {
  text: string;
  nextPosition: number;
};

type BlockRule = (state: ParserState) => MdNode | null;

type Fence = {
  char: "`" | "~";
  length: number;
  lang?: string;
  meta?: string;
};

export function parseBlocks(input: string): MdNode[] {
  const state: ParserState = {
    input: stripBom(input),
    position: 0
  };
  const blocks: MdNode[] = [];
  const rules: BlockRule[] = [parseFencedCodeBlock];

  while (state.position < state.input.length) {
    const line = readLine(state.input, state.position);

    if (isBlankLine(line.text)) {
      state.position = line.nextPosition;
      continue;
    }

    let matchedNode: MdNode | null = null;

    for (const rule of rules) {
      matchedNode = rule(state);

      if (matchedNode !== null) {
        blocks.push(matchedNode);
        break;
      }
    }

    if (matchedNode !== null) {
      continue;
    }

    blocks.push(parseParagraph(state));
  }

  return blocks;
}

function parseFencedCodeBlock(state: ParserState): MdNode | null {
  const openingLine = readLine(state.input, state.position);
  const fence = parseOpeningFence(openingLine.text);

  if (fence === null) {
    return null;
  }

  state.position = openingLine.nextPosition;

  const contentLines: string[] = [];

  while (state.position < state.input.length) {
    const line = readLine(state.input, state.position);

    if (isClosingFence(line.text, fence)) {
      state.position = line.nextPosition;
      return createCodeNode(fence, contentLines);
    }

    contentLines.push(line.text);
    state.position = line.nextPosition;
  }

  return createCodeNode(fence, contentLines);
}

function parseParagraph(state: ParserState): MdNode {
  const lines: string[] = [];

  while (state.position < state.input.length) {
    const line = readLine(state.input, state.position);

    if (isBlankLine(line.text)) {
      break;
    }

    if (lines.length > 0 && parseOpeningFence(line.text) !== null) {
      break;
    }

    lines.push(line.text);
    state.position = line.nextPosition;
  }

  return {
    type: "paragraph",
    children: [{ type: "text", value: lines.join("\n") }]
  };
}

function createCodeNode(fence: Fence, contentLines: string[]): MdNode {
  return {
    type: "code",
    ...(fence.lang === undefined ? {} : { lang: fence.lang }),
    ...(fence.meta === undefined ? {} : { meta: fence.meta }),
    value: contentLines.join("\n")
  };
}

function parseOpeningFence(line: string): Fence | null {
  const fenceStart = skipLeadingFenceIndent(line);

  if (fenceStart === -1 || fenceStart >= line.length) {
    return null;
  }

  const char = line[fenceStart];

  if (char !== "`" && char !== "~") {
    return null;
  }

  let fenceEnd = fenceStart;

  while (fenceEnd < line.length && line[fenceEnd] === char) {
    fenceEnd += 1;
  }

  const fenceLength = fenceEnd - fenceStart;

  if (fenceLength < 3) {
    return null;
  }

  const info = trimAsciiWhitespace(line.slice(fenceEnd));

  if (info.length === 0) {
    return { char, length: fenceLength };
  }

  const languageEnd = findWhitespaceIndex(info);
  const lang = languageEnd === -1 ? info : info.slice(0, languageEnd);
  const meta =
    languageEnd === -1 ? undefined : trimAsciiWhitespaceStart(info.slice(languageEnd));

  return {
    char,
    length: fenceLength,
    lang,
    ...(meta === undefined || meta.length === 0 ? {} : { meta })
  };
}

function isClosingFence(line: string, fence: Fence): boolean {
  const fenceStart = skipLeadingFenceIndent(line);

  if (fenceStart === -1 || fenceStart >= line.length) {
    return false;
  }

  let index = fenceStart;

  while (index < line.length && line[index] === fence.char) {
    index += 1;
  }

  if (index - fenceStart < fence.length) {
    return false;
  }

  if (fenceStart === index) {
    return false;
  }

  for (let restIndex = index; restIndex < line.length; restIndex += 1) {
    const char = line[restIndex];

    if (char !== " " && char !== "\t") {
      return false;
    }
  }

  return true;
}

function readLine(input: string, position: number): Line {
  let index = position;

  while (index < input.length) {
    const char = input[index];

    if (char === "\n" || char === "\r") {
      break;
    }

    index += 1;
  }

  const text = input.slice(position, index);

  if (index >= input.length) {
    return { text, nextPosition: input.length };
  }

  if (input[index] === "\r" && input[index + 1] === "\n") {
    return { text, nextPosition: index + 2 };
  }

  return { text, nextPosition: index + 1 };
}

function isBlankLine(line: string): boolean {
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char !== " " && char !== "\t") {
      return false;
    }
  }

  return true;
}

function skipLeadingFenceIndent(line: string): number {
  let index = 0;

  while (index < line.length && index < 3 && line[index] === " ") {
    index += 1;
  }

  if (index < line.length && line[index] === " ") {
    return -1;
  }

  return index;
}

function trimAsciiWhitespace(value: string): string {
  return trimAsciiWhitespaceEnd(trimAsciiWhitespaceStart(value));
}

function trimAsciiWhitespaceStart(value: string): string {
  let start = 0;

  while (start < value.length) {
    const char = value[start];

    if (char !== " " && char !== "\t") {
      break;
    }

    start += 1;
  }

  return value.slice(start);
}

function trimAsciiWhitespaceEnd(value: string): string {
  let end = value.length;

  while (end > 0) {
    const char = value[end - 1];

    if (char !== " " && char !== "\t") {
      break;
    }

    end -= 1;
  }

  return value.slice(0, end);
}

function findWhitespaceIndex(value: string): number {
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (char === " " || char === "\t") {
      return index;
    }
  }

  return -1;
}

function stripBom(input: string): string {
  return input[0] === "\uFEFF" ? input.slice(1) : input;
}
