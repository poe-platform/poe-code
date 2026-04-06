import type { MdNode } from "../ast.js";

type ParserState = {
  input: string;
  position: number;
  preferListToThematicBreak: boolean;
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

type ParsedHeading = {
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
};

type ParsedListMarker = {
  ordered: boolean;
  start?: number;
  indent: number;
  contentIndent: number;
  contentStart: number;
};

type ParseOptions = {
  preferListToThematicBreak: boolean;
};

type ParsedTaskMarker = {
  checked: boolean;
  content: string;
};

export function parseBlocks(input: string): MdNode[] {
  return parseBlocksWithOptions(input, { preferListToThematicBreak: false });
}

function parseBlocksWithOptions(input: string, options: ParseOptions): MdNode[] {
  const state: ParserState = {
    input: stripBom(input),
    position: 0,
    preferListToThematicBreak: options.preferListToThematicBreak
  };
  const blocks: MdNode[] = [];
  const rules = createBlockRules(state.preferListToThematicBreak);

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

function createBlockRules(preferListToThematicBreak: boolean): BlockRule[] {
  if (preferListToThematicBreak) {
    return [
      parseFencedCodeBlock,
      parseAtxHeading,
      parseBlockquote,
      parseList,
      parseThematicBreak,
      parseSetextHeading
    ];
  }

  return [
    parseFencedCodeBlock,
    parseAtxHeading,
    parseThematicBreak,
    parseBlockquote,
    parseList,
    parseSetextHeading
  ];
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

function parseAtxHeading(state: ParserState): MdNode | null {
  const line = readLine(state.input, state.position);
  const heading = parseAtxHeadingLine(line.text);

  if (heading === null) {
    return null;
  }

  state.position = line.nextPosition;

  return {
    type: "heading",
    depth: heading.depth,
    children: createTextChildren(heading.text)
  };
}

function parseThematicBreak(state: ParserState): MdNode | null {
  const line = readLine(state.input, state.position);

  if (!isThematicBreakLine(line.text)) {
    return null;
  }

  state.position = line.nextPosition;

  return { type: "thematicBreak" };
}

function parseSetextHeading(state: ParserState): MdNode | null {
  const contentLine = readLine(state.input, state.position);

  if (isBlankLine(contentLine.text)) {
    return null;
  }

  if (contentLine.nextPosition >= state.input.length) {
    return null;
  }

  const underlineLine = readLine(state.input, contentLine.nextPosition);
  const depth = parseSetextUnderline(underlineLine.text);

  if (depth === null) {
    return null;
  }

  state.position = underlineLine.nextPosition;

  return {
    type: "heading",
    depth,
    children: createTextChildren(trimAsciiWhitespace(contentLine.text))
  };
}

function parseBlockquote(state: ParserState): MdNode | null {
  const firstLine = readLine(state.input, state.position);

  if (stripBlockquoteMarker(firstLine.text) === null) {
    return null;
  }

  const contentLines: string[] = [];

  while (state.position < state.input.length) {
    const line = readLine(state.input, state.position);
    const content = stripBlockquoteMarker(line.text);

    if (content === null) {
      break;
    }

    contentLines.push(content);
    state.position = line.nextPosition;
  }

  return {
    type: "blockquote",
    children: parseBlocksWithOptions(contentLines.join("\n"), {
      preferListToThematicBreak: state.preferListToThematicBreak
    })
  };
}

function parseList(state: ParserState): MdNode | null {
  const firstLine = readLine(state.input, state.position);
  const firstMarker = parseListMarker(firstLine.text);

  if (firstMarker === null) {
    return null;
  }

  const children: MdNode[] = [];
  const ordered = firstMarker.ordered;
  const start = firstMarker.start;
  const indent = firstMarker.indent;

  while (state.position < state.input.length) {
    const item = parseListItem(state, {
      ordered,
      indent,
      preferListToThematicBreak: true
    });

    if (item === null) {
      break;
    }

    children.push(item);
  }

  return {
    type: "list",
    ordered,
    ...(ordered && start !== undefined ? { start } : {}),
    children
  };
}

function parseParagraph(state: ParserState): MdNode {
  const lines: string[] = [];

  while (state.position < state.input.length) {
    const line = readLine(state.input, state.position);

    if (isBlankLine(line.text)) {
      break;
    }

    if (lines.length > 0 && startsBlock(line.text, state.preferListToThematicBreak)) {
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

function createTextChildren(value: string): MdNode[] {
  return value.length === 0 ? [] : [{ type: "text", value }];
}

function startsBlock(line: string, preferListToThematicBreak: boolean): boolean {
  if (parseOpeningFence(line) !== null || parseAtxHeadingLine(line) !== null) {
    return true;
  }

  if (stripBlockquoteMarker(line) !== null) {
    return true;
  }

  if (preferListToThematicBreak) {
    return parseListMarker(line) !== null || isThematicBreakLine(line);
  }

  return isThematicBreakLine(line) || parseListMarker(line) !== null;
}

function parseOpeningFence(line: string): Fence | null {
  const fenceStart = skipLeadingBlockIndent(line);

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

function parseAtxHeadingLine(line: string): ParsedHeading | null {
  const markerStart = skipLeadingBlockIndent(line);

  if (markerStart === -1 || markerStart >= line.length || line[markerStart] !== "#") {
    return null;
  }

  let markerEnd = markerStart;

  while (markerEnd < line.length && line[markerEnd] === "#") {
    markerEnd += 1;
  }

  const depth = markerEnd - markerStart;

  if (depth < 1 || depth > 6) {
    return null;
  }

  if (markerEnd < line.length && line[markerEnd] !== " " && line[markerEnd] !== "\t") {
    return null;
  }

  const rawContent = trimAsciiWhitespaceStart(line.slice(markerEnd));

  return {
    depth: depth as ParsedHeading["depth"],
    text: stripClosingHeadingSequence(rawContent)
  };
}

function stripClosingHeadingSequence(value: string): string {
  const trimmedValue = trimAsciiWhitespaceEnd(value);

  if (trimmedValue.length === 0) {
    return "";
  }

  let hashStart = trimmedValue.length;

  while (hashStart > 0 && trimmedValue[hashStart - 1] === "#") {
    hashStart -= 1;
  }

  if (hashStart === trimmedValue.length) {
    return trimmedValue;
  }

  if (hashStart === 0) {
    return "";
  }

  const prefixEnd = hashStart - 1;

  if (trimmedValue[prefixEnd] !== " " && trimmedValue[prefixEnd] !== "\t") {
    return trimmedValue;
  }

  return trimAsciiWhitespaceEnd(trimmedValue.slice(0, prefixEnd));
}

function isClosingFence(line: string, fence: Fence): boolean {
  const fenceStart = skipLeadingBlockIndent(line);

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

function isThematicBreakLine(line: string): boolean {
  const start = skipLeadingBlockIndent(line);

  if (start === -1 || start >= line.length) {
    return false;
  }

  const marker = line[start];

  if (marker !== "-" && marker !== "*" && marker !== "_") {
    return false;
  }

  let markerCount = 0;

  for (let index = start; index < line.length; index += 1) {
    const char = line[index];

    if (char === marker) {
      markerCount += 1;
      continue;
    }

    if (char === " " || char === "\t") {
      continue;
    }

    return false;
  }

  return markerCount >= 3;
}

function parseSetextUnderline(line: string): 1 | 2 | null {
  const start = skipLeadingBlockIndent(line);

  if (start === -1 || start >= line.length) {
    return null;
  }

  const marker = line[start];

  if (marker !== "=" && marker !== "-") {
    return null;
  }

  let index = start;

  while (index < line.length && line[index] === marker) {
    index += 1;
  }

  const markerCount = index - start;

  if (markerCount === 0) {
    return null;
  }

  for (; index < line.length; index += 1) {
    const char = line[index];

    if (char !== " " && char !== "\t") {
      return null;
    }
  }

  return marker === "=" ? 1 : 2;
}

function stripBlockquoteMarker(line: string): string | null {
  const markerStart = skipLeadingBlockIndent(line);

  if (markerStart === -1 || markerStart >= line.length || line[markerStart] !== ">") {
    return null;
  }

  let contentStart = markerStart + 1;

  if (contentStart < line.length && (line[contentStart] === " " || line[contentStart] === "\t")) {
    contentStart += 1;
  }

  return line.slice(contentStart);
}

function parseListMarker(line: string): ParsedListMarker | null {
  const markerStart = skipLeadingBlockIndent(line);

  if (markerStart === -1 || markerStart >= line.length) {
    return null;
  }

  const marker = line[markerStart];

  if (marker === "-" || marker === "+" || marker === "*") {
    return parseBulletListMarker(line, markerStart);
  }

  if (isDigit(marker)) {
    return parseOrderedListMarker(line, markerStart);
  }

  return null;
}

function parseBulletListMarker(line: string, markerStart: number): ParsedListMarker | null {
  const contentStart = parseContentStart(line, markerStart + 1);

  if (contentStart === null) {
    return null;
  }

  return {
    ordered: false,
    indent: measureColumns(line.slice(0, markerStart)),
    contentIndent: measureColumns(line.slice(0, contentStart)),
    contentStart
  };
}

function parseOrderedListMarker(line: string, markerStart: number): ParsedListMarker | null {
  let markerEnd = markerStart;

  while (markerEnd < line.length && isDigit(line[markerEnd])) {
    markerEnd += 1;
  }

  if (markerEnd >= line.length || (line[markerEnd] !== "." && line[markerEnd] !== ")")) {
    return null;
  }

  const contentStart = parseContentStart(line, markerEnd + 1);

  if (contentStart === null) {
    return null;
  }

  return {
    ordered: true,
    start: Number.parseInt(line.slice(markerStart, markerEnd), 10),
    indent: measureColumns(line.slice(0, markerStart)),
    contentIndent: measureColumns(line.slice(0, contentStart)),
    contentStart
  };
}

function parseContentStart(line: string, afterMarker: number): number | null {
  if (afterMarker >= line.length) {
    return afterMarker;
  }

  if (line[afterMarker] !== " " && line[afterMarker] !== "\t") {
    return null;
  }

  let pos = afterMarker;

  while (pos < line.length && (line[pos] === " " || line[pos] === "\t")) {
    pos += 1;
  }

  return pos;
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

function skipLeadingBlockIndent(line: string): number {
  const leadingWhitespace = readLeadingWhitespace(line);

  if (leadingWhitespace.columns > 3) {
    return -1;
  }

  return leadingWhitespace.offset;
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

function isDigit(value: string): boolean {
  return value >= "0" && value <= "9";
}

function stripBom(input: string): string {
  return input[0] === "\uFEFF" ? input.slice(1) : input;
}

function parseListItem(
  state: ParserState,
  list: { ordered: boolean; indent: number; preferListToThematicBreak: boolean }
): MdNode | null {
  const firstLine = readLine(state.input, state.position);
  const marker = parseListMarker(firstLine.text);

  if (marker === null || marker.ordered !== list.ordered || marker.indent !== list.indent) {
    return null;
  }

  state.position = firstLine.nextPosition;

  let firstLineContent = firstLine.text.slice(marker.contentStart);
  let checked: boolean | undefined;
  const taskMarker = parseTaskMarker(firstLineContent);

  if (taskMarker !== null) {
    checked = taskMarker.checked;
    firstLineContent = taskMarker.content;
  }

  const continuationLines: string[] = [];
  const pendingBlankLines: string[] = [];

  while (state.position < state.input.length) {
    const line = readLine(state.input, state.position);

    if (isBlankLine(line.text)) {
      pendingBlankLines.push("");
      state.position = line.nextPosition;
      continue;
    }

    const nextMarker = parseListMarker(line.text);

    if (
      nextMarker !== null &&
      nextMarker.ordered === list.ordered &&
      nextMarker.indent === list.indent
    ) {
      break;
    }

    const strippedLine = stripIndent(line.text, marker.contentIndent);

    if (strippedLine === null) {
      break;
    }

    state.position = line.nextPosition;
    continuationLines.push(...pendingBlankLines, strippedLine);
    pendingBlankLines.length = 0;
  }

  const children = parseListItemChildren(
    firstLineContent,
    continuationLines,
    list.preferListToThematicBreak
  );

  return {
    type: "listItem",
    ...(checked === undefined ? {} : { checked }),
    children
  };
}

function parseListItemChildren(
  firstLineContent: string,
  continuationLines: string[],
  preferListToThematicBreak: boolean
): MdNode[] {
  const blocks: MdNode[] = [];
  let paragraphLines = firstLineContent.length === 0 ? [] : [firstLineContent];
  let lineIndex = 0;

  while (lineIndex < continuationLines.length) {
    const line = continuationLines[lineIndex];

    if (isBlankLine(line)) {
      if (paragraphLines.length > 0) {
        blocks.push(createParagraphNode(paragraphLines));
        paragraphLines = [];
      }

      lineIndex += 1;
      continue;
    }

    if (startsBlock(line, preferListToThematicBreak)) {
      if (paragraphLines.length > 0) {
        blocks.push(createParagraphNode(paragraphLines));
      }

      blocks.push(
        ...parseBlocksWithOptions(continuationLines.slice(lineIndex).join("\n"), {
          preferListToThematicBreak
        })
      );

      return blocks;
    }

    paragraphLines.push(line);
    lineIndex += 1;
  }

  if (paragraphLines.length > 0) {
    blocks.push(createParagraphNode(paragraphLines));
  }

  return blocks;
}

function createParagraphNode(lines: string[]): MdNode {
  return {
    type: "paragraph",
    children: [{ type: "text", value: lines.join("\n") }]
  };
}

function parseTaskMarker(content: string): ParsedTaskMarker | null {
  if (content.length < 3 || content[0] !== "[" || content[2] !== "]") {
    return null;
  }

  const marker = content[1];

  if (marker !== " " && marker !== "x" && marker !== "X") {
    return null;
  }

  if (content.length > 3 && content[3] !== " " && content[3] !== "\t") {
    return null;
  }

  return {
    checked: marker === "x" || marker === "X",
    content: trimAsciiWhitespaceStart(content.slice(3))
  };
}

function stripIndent(line: string, columns: number): string | null {
  const leadingWhitespace = readLeadingWhitespace(line);

  if (leadingWhitespace.columns < columns) {
    return null;
  }

  return leadingWhitespace.normalized.slice(columns) + line.slice(leadingWhitespace.offset);
}

function readLeadingWhitespace(line: string): { columns: number; offset: number; normalized: string } {
  let columns = 0;
  let offset = 0;
  let normalized = "";

  while (offset < line.length) {
    const char = line[offset];

    if (char === " ") {
      columns += 1;
      normalized += " ";
      offset += 1;
      continue;
    }

    if (char === "\t") {
      columns += 4;
      normalized += "    ";
      offset += 1;
      continue;
    }

    break;
  }

  return { columns, offset, normalized };
}

function measureColumns(value: string): number {
  let columns = 0;

  for (let index = 0; index < value.length; index += 1) {
    columns += value[index] === "\t" ? 4 : 1;
  }

  return columns;
}
