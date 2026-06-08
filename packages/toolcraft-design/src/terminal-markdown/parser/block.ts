import type { MdNode, MdRange } from "../ast.js";
import { extractFrontmatter } from "./frontmatter.js";
import { parseInline } from "./inline.js";

type OffsetMap = readonly number[];

type ParserState = {
  input: string;
  position: number;
  offsets: OffsetMap;
  preferListToThematicBreak: boolean;
};

type Line = {
  start: number;
  text: string;
  end: number;
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
  contentStart: number;
  contentEnd: number;
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
  offsets: OffsetMap;
};

type ParsedTaskMarker = {
  checked: boolean;
  content: string;
  contentStart: number;
};

type AlertKind = Extract<MdNode, { type: "alert" }>["kind"];

type ParsedAlertMarker = {
  kind: AlertKind;
  content: string;
  contentStart: number;
};

type TableAlignment = Extract<MdNode, { type: "table" }>["align"][number];

type TableCellSegment = {
  value: string;
  start: number;
  end: number;
};

type MappedText = {
  text: string;
  offsets: OffsetMap;
  lineBreakEnd?: number;
};

type ParsedFootnoteDefinition = {
  label: string;
  contentStart: number;
};

type ParsedHtmlTagStart = {
  tagName: string;
  tagEnd: number;
  closing: boolean;
  selfClosing: boolean;
};

const BLOCK_HTML_TAGS = new Set([
  "address",
  "article",
  "aside",
  "base",
  "basefont",
  "blockquote",
  "body",
  "caption",
  "center",
  "col",
  "colgroup",
  "dd",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "frame",
  "frameset",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hr",
  "html",
  "iframe",
  "legend",
  "li",
  "link",
  "main",
  "menu",
  "menuitem",
  "nav",
  "noframes",
  "ol",
  "optgroup",
  "option",
  "p",
  "param",
  "search",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "track",
  "ul"
]);

const VOID_BLOCK_HTML_TAGS = new Set(["base", "basefont", "col", "hr", "link", "param", "track"]);
const SOURCE_OFFSETS = Symbol("sourceOffsets");

export function parseBlocks(input: string): MdNode[] {
  return parseBlockDocument(input).children;
}

export function parseBlockDocument(input: string): {
  frontmatter?: Record<string, unknown>;
  frontmatterRange?: MdRange;
  children: MdNode[];
} {
  const { frontmatter, body, range } = extractFrontmatter(input);
  const children = applyInlineParsing(
    parseBlocksWithOptions(body, {
      preferListToThematicBreak: false,
      offsets: createOffsetMap(body, range?.end ?? 0)
    })
  );

  return frontmatter === undefined
    ? { children }
    : { frontmatter, frontmatterRange: range, children };
}

function parseBlocksWithOptions(input: string, options: ParseOptions): MdNode[] {
  const state: ParserState = {
    input,
    position: 0,
    offsets: options.offsets,
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

function applyInlineParsing(nodes: MdNode[]): MdNode[] {
  const footnoteLabels = collectFootnoteLabels(nodes);
  return nodes.map((node) => applyInlineParsingToNode(node, footnoteLabels));
}

function collectFootnoteLabels(nodes: MdNode[]): Set<string> {
  const labels = new Set<string>();

  for (const node of nodes) {
    collectFootnoteLabelsFromNode(node, labels);
  }

  return labels;
}

function collectFootnoteLabelsFromNode(node: MdNode, labels: Set<string>): void {
  if (node.type === "footnoteDefinition") {
    labels.add(node.label);
  }

  if (hasBlockChildren(node)) {
    for (const child of node.children) {
      collectFootnoteLabelsFromNode(child, labels);
    }
  }
}

function applyInlineParsingToNode(node: MdNode, footnoteLabels: ReadonlySet<string>): MdNode {
  if (node.type === "paragraph" || node.type === "heading" || node.type === "tableCell") {
    return replaceNodeChildren(node, applyInlineParsingToTextChildren(node.children, footnoteLabels));
  }

  if (hasBlockChildren(node)) {
    return replaceNodeChildren(
      node,
      node.children.map((child) => applyInlineParsingToNode(child, footnoteLabels))
    );
  }

  return node;
}

function applyInlineParsingToTextChildren(
  children: MdNode[],
  footnoteLabels: ReadonlySet<string>
): MdNode[] {
  let rawText = "";
  let offsets: number[] | undefined;

  for (const child of children) {
    if (child.type !== "text") {
      return children;
    }

    rawText += child.value;
    const childOffsets = getTextNodeSourceOffsets(child);

    if (childOffsets === undefined) {
      return children;
    }

    if (offsets === undefined) {
      offsets = [...childOffsets];
      continue;
    }

    offsets.push(...childOffsets.slice(1));
  }

  return parseInline(rawText, {
    footnoteLabels,
    ...(offsets === undefined ? {} : { offsets })
  });
}

function hasBlockChildren(
  node: MdNode
): node is Extract<
  MdNode,
  | { type: "root" }
  | { type: "blockquote" }
  | { type: "list" }
  | { type: "listItem" }
  | { type: "table" }
  | { type: "tableRow" }
  | { type: "alert" }
  | { type: "footnoteDefinition" }
> {
  return (
    node.type === "root" ||
    node.type === "blockquote" ||
    node.type === "list" ||
    node.type === "listItem" ||
    node.type === "table" ||
    node.type === "tableRow" ||
    node.type === "alert" ||
    node.type === "footnoteDefinition"
  );
}

function createBlockRules(preferListToThematicBreak: boolean): BlockRule[] {
  const middleRules: BlockRule[] = preferListToThematicBreak
    ? [parseAlert, parseBlockquote, parseList, parseHtmlBlock, parseThematicBreak]
    : [parseThematicBreak, parseAlert, parseBlockquote, parseList, parseHtmlBlock];

  return [
    parseFencedCodeBlock,
    parseAtxHeading,
    ...middleRules,
    parseTable,
    parseFootnoteDefinition,
    parseSetextHeading
  ];
}

function parseFencedCodeBlock(state: ParserState): MdNode | null {
  const rangeStart = state.position;
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
      return withRange(createCodeNode(fence, contentLines), createNodeRange(state, rangeStart));
    }

    contentLines.push(line.text);
    state.position = line.nextPosition;
  }

  return withRange(createCodeNode(fence, contentLines), createNodeRange(state, rangeStart));
}

function parseAtxHeading(state: ParserState): MdNode | null {
  const rangeStart = state.position;
  const line = readLine(state.input, state.position);
  const heading = parseAtxHeadingLine(line.text);

  if (heading === null) {
    return null;
  }

  state.position = line.nextPosition;
  const content = createMappedTextFromLineSlice(state, line, heading.contentStart, heading.contentEnd);

  return withRange(
    {
      type: "heading",
      depth: heading.depth,
      children: createTextChildren(
        heading.text,
        { start: content.offsets[0] ?? 0, end: content.offsets[content.offsets.length - 1] ?? 0 },
        content.offsets
      )
    },
    createNodeRange(state, rangeStart)
  );
}

function parseThematicBreak(state: ParserState): MdNode | null {
  const rangeStart = state.position;
  const line = readLine(state.input, state.position);

  if (!isThematicBreakLine(line.text)) {
    return null;
  }

  state.position = line.nextPosition;

  return withRange({ type: "thematicBreak" }, createNodeRange(state, rangeStart));
}

function parseSetextHeading(state: ParserState): MdNode | null {
  const rangeStart = state.position;
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

  const content = trimAsciiWhitespaceRange(contentLine.text);
  const mappedContent = createMappedTextFromLineSlice(state, contentLine, content.start, content.end);

  return withRange(
    {
      type: "heading",
      depth,
      children: createTextChildren(
        content.value,
        {
          start: mappedContent.offsets[0] ?? 0,
          end: mappedContent.offsets[mappedContent.offsets.length - 1] ?? 0
        },
        mappedContent.offsets
      )
    },
    createNodeRange(state, rangeStart)
  );
}

function parseBlockquote(state: ParserState): MdNode | null {
  const rangeStart = state.position;
  const firstLine = readLine(state.input, state.position);

  if (parseBlockquoteLine(firstLine.text) === null) {
    return null;
  }

  const contentParts: MappedText[] = [];
  let previousContentLine: Line | undefined;

  while (state.position < state.input.length) {
    const line = readLine(state.input, state.position);
    const content = parseBlockquoteLine(line.text);

    if (content === null) {
      break;
    }

    if (previousContentLine !== undefined) {
      const lineBreak = createMappedLineBreak(state, previousContentLine);

      if (lineBreak !== null) {
        contentParts.push(lineBreak);
      }
    }

    contentParts.push(createMappedTextFromLineSlice(state, line, content.contentStart, line.text.length));
    state.position = line.nextPosition;
    previousContentLine = line;
  }

  const content = joinMappedTexts(contentParts);

  return withRange(
    {
      type: "blockquote",
      children: parseBlocksWithOptions(content.text, {
        preferListToThematicBreak: state.preferListToThematicBreak,
        offsets: content.offsets
      })
    },
    createNodeRange(state, rangeStart)
  );
}

function parseAlert(state: ParserState): MdNode | null {
  const rangeStart = state.position;
  const firstLine = readLine(state.input, state.position);
  const firstLineContent = parseBlockquoteLine(firstLine.text);

  if (firstLineContent === null) {
    return null;
  }

  const alertMarker = parseAlertMarker(firstLineContent.content);

  if (alertMarker === null) {
    return null;
  }

  state.position = firstLine.nextPosition;

  const contentParts: MappedText[] = [];
  let previousContentLine: Line | undefined;

  if (alertMarker.content.length > 0) {
    contentParts.push(
      createMappedTextFromLineSlice(
        state,
        firstLine,
        firstLineContent.contentStart + alertMarker.contentStart,
        firstLine.text.length
      )
    );
    previousContentLine = firstLine;
  }

  while (state.position < state.input.length) {
    const line = readLine(state.input, state.position);
    const content = parseBlockquoteLine(line.text);

    if (content === null) {
      break;
    }

    if (previousContentLine !== undefined) {
      const previousLineBreak = createMappedLineBreak(state, previousContentLine);

      if (previousLineBreak !== null) {
        contentParts.push(previousLineBreak);
      }
    }

    contentParts.push(createMappedTextFromLineSlice(state, line, content.contentStart, line.text.length));
    state.position = line.nextPosition;
    previousContentLine = line;
  }

  const content = joinMappedTexts(contentParts);

  return withRange(
    {
      type: "alert",
      kind: alertMarker.kind,
      children: parseBlocksWithOptions(content.text, {
        preferListToThematicBreak: state.preferListToThematicBreak,
        offsets: content.offsets
      })
    },
    createNodeRange(state, rangeStart)
  );
}

function parseList(state: ParserState): MdNode | null {
  const rangeStart = state.position;
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

  return withRange(
    {
      type: "list",
      ordered,
      ...(ordered && start !== undefined ? { start } : {}),
      children
    },
    createNodeRange(state, rangeStart)
  );
}

function parseTable(state: ParserState): MdNode | null {
  const rangeStart = state.position;
  const table = parseTableAt(state.input, state.position, state.preferListToThematicBreak);

  if (table === null) {
    return null;
  }

  state.position = table.nextPosition;

  return withRange(
    {
      type: "table",
      align: table.align,
      children: [
        createTableRowNode(state, table.header.line, table.header.cells),
        ...table.rows.map((row) => createTableRowNode(state, row.line, row.cells))
      ]
    },
    createNodeRange(state, rangeStart)
  );
}

function parseHtmlBlock(state: ParserState): MdNode | null {
  const rangeStart = state.position;
  const firstLine = readLine(state.input, state.position);
  const openingTag = parseBlockHtmlTagStart(firstLine.text);

  if (openingTag === null) {
    return null;
  }

  state.position = firstLine.nextPosition;
  const lines = [firstLine.text];

  const isSelfContained =
    openingTag.closing ||
    openingTag.selfClosing ||
    VOID_BLOCK_HTML_TAGS.has(openingTag.tagName) ||
    containsClosingHtmlTag(firstLine.text, openingTag.tagName, openingTag.tagEnd);

  if (!isSelfContained) {
    while (state.position < state.input.length) {
      const line = readLine(state.input, state.position);

      lines.push(line.text);
      state.position = line.nextPosition;

      if (containsClosingHtmlTag(line.text, openingTag.tagName)) {
        break;
      }
    }
  }

  return withRange({ type: "html", value: lines.join("\n") }, createNodeRange(state, rangeStart));
}

function parseFootnoteDefinition(state: ParserState): MdNode | null {
  const rangeStart = state.position;
  const firstLine = readLine(state.input, state.position);
  const definition = parseFootnoteDefinitionMarker(firstLine.text);

  if (definition === null) {
    return null;
  }

  state.position = firstLine.nextPosition;

  const continuationLines: MappedText[] = [];
  const pendingBlankLines: MappedText[] = [];

  while (state.position < state.input.length) {
    const line = readLine(state.input, state.position);

    if (isBlankLine(line.text)) {
      pendingBlankLines.push({
        text: "",
        offsets: [state.offsets[line.end] ?? 0],
        lineBreakEnd: state.offsets[line.nextPosition] ?? state.offsets[state.offsets.length - 1] ?? 0
      });
      state.position = line.nextPosition;
      continue;
    }

    const strippedLine = stripIndentLine(state, line, 4);

    if (strippedLine === null) {
      break;
    }

    state.position = line.nextPosition;
    continuationLines.push(...pendingBlankLines, strippedLine);
    pendingBlankLines.length = 0;
  }

  return withRange(
    {
      type: "footnoteDefinition",
      label: definition.label,
      children: parseListItemChildren(
        createMappedTextFromLineSlice(state, firstLine, definition.contentStart, firstLine.text.length),
        continuationLines,
        state.preferListToThematicBreak
      )
    },
    createNodeRange(state, rangeStart)
  );
}

function parseParagraph(state: ParserState): MdNode {
  const rangeStart = state.position;
  const lines: Line[] = [];

  while (state.position < state.input.length) {
    const line = readLine(state.input, state.position);

    if (isBlankLine(line.text)) {
      break;
    }

    if (
      lines.length > 0 &&
      startsBlockAt(state.input, state.position, state.preferListToThematicBreak)
    ) {
      break;
    }

    lines.push(line);
    state.position = line.nextPosition;
  }

  const content = createMappedTextFromLines(state, lines);

  return withRange(
    {
      type: "paragraph",
      children: createTextChildren(
        content.text,
        {
          start: content.offsets[0] ?? 0,
          end: content.offsets[content.offsets.length - 1] ?? 0
        },
        content.offsets
      )
    },
    createNodeRange(state, rangeStart)
  );
}

function createCodeNode(fence: Fence, contentLines: string[]): MdNode {
  return {
    type: "code",
    ...(fence.lang === undefined ? {} : { lang: fence.lang }),
    ...(fence.meta === undefined ? {} : { meta: fence.meta }),
    value: contentLines.join("\n")
  };
}

function createTextChildren(value: string, range?: MdRange, offsets?: OffsetMap): MdNode[] {
  return value.length === 0 ? [] : [createTextNode(value, range, offsets)];
}

function createTableRowNode(state: ParserState, line: Line, cells: TableCellSegment[]): MdNode {
  return withRange(
    {
      type: "tableRow",
      children: cells.map((cell) => {
        const content = createMappedTextFromLineSlice(state, line, cell.start, cell.end);

        return withRange(
          {
            type: "tableCell",
            children: createTextChildren(
              cell.value,
              {
                start: content.offsets[0] ?? 0,
                end: content.offsets[content.offsets.length - 1] ?? 0
              },
              content.offsets
            )
          },
          {
            start: content.offsets[0] ?? 0,
            end: content.offsets[content.offsets.length - 1] ?? 0
          }
        );
      })
    },
    {
      start: state.offsets[line.start] ?? 0,
      end: state.offsets[line.nextPosition] ?? state.offsets[line.end] ?? 0
    }
  );
}

function createTextNode(
  value: string,
  range?: MdRange,
  sourceOffsets?: OffsetMap
): Extract<MdNode, { type: "text" }> {
  const node =
    range === undefined ? ({ type: "text", value } as Extract<MdNode, { type: "text" }>) : withRange({ type: "text", value }, range);

  if (sourceOffsets !== undefined) {
    Object.defineProperty(node, SOURCE_OFFSETS, {
      value: [...sourceOffsets],
      enumerable: false,
      configurable: true,
      writable: true
    });
  }

  return node;
}

function createNodeRange(state: ParserState, start: number, end = state.position): MdRange {
  return {
    start: state.offsets[start] ?? state.offsets[state.offsets.length - 1] ?? 0,
    end: state.offsets[end] ?? state.offsets[state.offsets.length - 1] ?? 0
  };
}

function withRange<T extends MdNode>(node: T, range: MdRange): T {
  Object.defineProperty(node, "range", {
    value: range,
    enumerable: false,
    configurable: true,
    writable: true
  });

  return node;
}

function replaceNodeChildren<T extends MdNode & { children: MdNode[] }>(node: T, children: MdNode[]): T {
  const nextNode = { ...node, children } as T;

  return node.range === undefined ? nextNode : withRange(nextNode, node.range);
}

function getTextNodeSourceOffsets(node: Extract<MdNode, { type: "text" }>): number[] | undefined {
  const sourceOffsets = (node as Extract<MdNode, { type: "text" }> & {
    [SOURCE_OFFSETS]?: number[];
  })[SOURCE_OFFSETS];

  if (sourceOffsets !== undefined) {
    return sourceOffsets;
  }

  return node.range === undefined ? undefined : createOffsetMap(node.value, node.range.start, node.range.end);
}

function createOffsetMap(input: string, absoluteStart = 0, absoluteEnd?: number): number[] {
  const offsets = new Array<number>(input.length + 1).fill(absoluteStart);
  let byteOffset = absoluteStart;
  let index = 0;

  while (index < input.length) {
    offsets[index] = byteOffset;
    const codePoint = input.codePointAt(index) ?? 0;
    const codeUnitLength = codePoint > 0xffff ? 2 : 1;
    const byteLength =
      codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;

    for (let offsetIndex = 1; offsetIndex < codeUnitLength; offsetIndex += 1) {
      offsets[index + offsetIndex] = byteOffset;
    }

    byteOffset += byteLength;
    index += codeUnitLength;
    offsets[index] = byteOffset;
  }

  offsets[input.length] = absoluteEnd ?? byteOffset;
  return offsets;
}

function createMappedText(value: string, offsets: OffsetMap): MappedText {
  return { text: value, offsets };
}

function createMappedTextFromSlice(state: ParserState, start: number, end: number): MappedText {
  return createMappedText(state.input.slice(start, end), state.offsets.slice(start, end + 1));
}

function createMappedTextFromLineSlice(
  state: ParserState,
  line: Line,
  start: number,
  end: number
): MappedText {
  return {
    ...createMappedTextFromSlice(state, line.start + start, line.start + end),
    lineBreakEnd: state.offsets[line.nextPosition] ?? state.offsets[state.offsets.length - 1] ?? 0
  };
}

function createMappedLineBreak(state: ParserState, line: Line): MappedText | null {
  if (line.nextPosition <= line.end) {
    return null;
  }

  return createMappedText("\n", [state.offsets[line.end] ?? 0, state.offsets[line.nextPosition] ?? 0]);
}

function joinMappedTexts(parts: readonly MappedText[]): MappedText {
  if (parts.length === 0) {
    return createMappedText("", [0]);
  }

  let text = "";
  const offsets: number[] = [];

  for (const [index, part] of parts.entries()) {
    text += part.text;

    if (index === 0) {
      offsets.push(...part.offsets);
      continue;
    }

    offsets.push(...part.offsets.slice(1));
  }

  return createMappedText(text, offsets);
}

function createMappedTextFromLines(state: ParserState, lines: readonly Line[]): MappedText {
  const parts: MappedText[] = [];

  for (const [index, line] of lines.entries()) {
    parts.push(createMappedTextFromLineSlice(state, line, 0, line.text.length));

    if (index + 1 < lines.length) {
      const lineBreak = createMappedLineBreak(state, line);

      if (lineBreak !== null) {
        parts.push(lineBreak);
      }
    }
  }

  return joinMappedTexts(parts);
}

function joinMappedLines(lines: readonly MappedText[]): MappedText {
  const parts: MappedText[] = [];

  for (const [index, line] of lines.entries()) {
    parts.push(createMappedText(line.text, line.offsets));

    if (index + 1 < lines.length) {
      const lineBreakStart = line.offsets[line.offsets.length - 1] ?? 0;
      const lineBreakEnd = line.lineBreakEnd ?? lineBreakStart;
      parts.push(createMappedText("\n", [lineBreakStart, lineBreakEnd]));
    }
  }

  return joinMappedTexts(parts);
}

function startsBlockAt(
  input: string,
  position: number,
  preferListToThematicBreak: boolean
): boolean {
  const line = readLine(input, position);

  if (startsSimpleBlock(line.text, preferListToThematicBreak)) {
    return true;
  }

  if (line.nextPosition >= input.length) {
    return false;
  }

  const nextLine = readLine(input, line.nextPosition);

  return parseTableHeaderAndSeparator(line.text, nextLine.text) !== null;
}

function startsBlockInLines(
  lines: MappedText[],
  lineIndex: number,
  preferListToThematicBreak: boolean
): boolean {
  const line = lines[lineIndex]?.text ?? "";

  if (startsSimpleBlock(line, preferListToThematicBreak)) {
    return true;
  }

  return (
    lineIndex + 1 < lines.length &&
    parseTableHeaderAndSeparator(line, lines[lineIndex + 1]?.text ?? "") !== null
  );
}

function startsSimpleBlock(line: string, preferListToThematicBreak: boolean): boolean {
  if (
    parseOpeningFence(line) !== null ||
    parseAtxHeadingLine(line) !== null ||
    parseBlockHtmlTagStart(line) !== null ||
    parseFootnoteDefinitionMarker(line) !== null
  ) {
    return true;
  }

  if (parseBlockquoteLine(line) !== null) {
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
  const meta = languageEnd === -1 ? undefined : trimAsciiWhitespaceStart(info.slice(languageEnd));

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

  let contentStart = markerEnd;

  while (contentStart < line.length && (line[contentStart] === " " || line[contentStart] === "\t")) {
    contentStart += 1;
  }

  const rawContent = line.slice(contentStart);
  const text = stripClosingHeadingSequence(rawContent);

  return {
    depth: depth as ParsedHeading["depth"],
    text,
    contentStart,
    contentEnd: contentStart + text.length
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

function parseTableAt(
  input: string,
  position: number,
  preferListToThematicBreak: boolean
): {
  align: TableAlignment[];
  header: { line: Line; cells: TableCellSegment[] };
  rows: Array<{ line: Line; cells: TableCellSegment[] }>;
  nextPosition: number;
} | null {
  const headerLine = readLine(input, position);

  if (
    parseListMarker(headerLine.text) !== null ||
    parseBlockquoteLine(headerLine.text) !== null
  ) {
    return null;
  }

  if (headerLine.nextPosition >= input.length) {
    return null;
  }

  const separatorLine = readLine(input, headerLine.nextPosition);
  const header = parseTableHeaderAndSeparator(headerLine.text, separatorLine.text);

  if (header === null) {
    return null;
  }

  const rows: Array<{ line: Line; cells: TableCellSegment[] }> = [];
  let nextPosition = separatorLine.nextPosition;

  while (nextPosition < input.length) {
    const rowLine = readLine(input, nextPosition);

    if (isBlankLine(rowLine.text)) {
      break;
    }

    if (startsSimpleBlock(rowLine.text, preferListToThematicBreak)) {
      break;
    }

    const cells = parsePipeTableCellSegments(rowLine.text);

    if (cells === null) {
      break;
    }

    rows.push({
      line: rowLine,
      cells: normalizeTableCellSegments(cells, header.headerCells.length)
    });
    nextPosition = rowLine.nextPosition;
  }

  return {
    align: header.align,
    header: { line: headerLine, cells: header.headerCells },
    rows,
    nextPosition
  };
}

function parseTableHeaderAndSeparator(
  headerLine: string,
  separatorLine: string
): { align: TableAlignment[]; headerCells: TableCellSegment[] } | null {
  const headerCells = parsePipeTableCellSegments(headerLine);

  if (headerCells === null || headerCells.length === 0) {
    return null;
  }

  const align = parsePipeTableSeparator(separatorLine);

  if (align === null || align.length !== headerCells.length) {
    return null;
  }

  return { align, headerCells };
}

function parsePipeTableCells(line: string): string[] | null {
  return parsePipeTableCellSegments(line)?.map((cell) => cell.value) ?? null;
}

function parsePipeTableCellSegments(line: string): TableCellSegment[] | null {
  const start = skipLeadingBlockIndent(line);

  if (start === -1 || start >= line.length) {
    return null;
  }

  const content = trimAsciiWhitespaceEnd(line.slice(start));
  let hasPipe = false;
  const cells: Array<{ start: number; end: number }> = [];
  let cellStart = 0;
  let index = 0;

  while (index < content.length) {
    const char = content[index];

    if (char === "\\" && index + 1 < content.length && content[index + 1] === "|") {
      index += 2;
      continue;
    }

    if (char === "|") {
      cells.push({ start: cellStart, end: index });
      cellStart = index + 1;
      hasPipe = true;
      index += 1;
      continue;
    }

    index += 1;
  }

  if (!hasPipe) {
    return null;
  }

  cells.push({ start: cellStart, end: content.length });

  if (content[0] === "|") {
    cells.shift();
  }

  if (content[content.length - 1] === "|") {
    cells.pop();
  }

  if (cells.length === 0) {
    return null;
  }

  return cells.map((cell) => {
    let cellStart = cell.start;
    let cellEnd = cell.end;

    while (cellStart < cellEnd && (content[cellStart] === " " || content[cellStart] === "\t")) {
      cellStart += 1;
    }

    while (cellEnd > cellStart && (content[cellEnd - 1] === " " || content[cellEnd - 1] === "\t")) {
      cellEnd -= 1;
    }

    return {
      value: decodePipeTableCell(trimAsciiWhitespace(content.slice(cell.start, cell.end))),
      start: start + cellStart,
      end: start + cellEnd
    };
  });
}

function parsePipeTableSeparator(line: string): TableAlignment[] | null {
  const cells = parsePipeTableCells(line);

  if (cells === null || cells.length === 0) {
    return null;
  }

  const alignments: TableAlignment[] = [];

  for (const cell of cells) {
    const alignment = parseTableAlignmentCell(cell);

    if (alignment === undefined) {
      return null;
    }

    alignments.push(alignment);
  }

  return alignments;
}

function parseTableAlignmentCell(value: string): TableAlignment | undefined {
  if (value.length === 0) {
    return undefined;
  }

  const hasLeadingColon = value[0] === ":";
  const hasTrailingColon = value[value.length - 1] === ":";
  const dashStart = hasLeadingColon ? 1 : 0;
  const dashEnd = hasTrailingColon ? value.length - 1 : value.length;

  if (dashEnd - dashStart < 3) {
    return undefined;
  }

  for (let index = dashStart; index < dashEnd; index += 1) {
    if (value[index] !== "-") {
      return undefined;
    }
  }

  if (hasLeadingColon && hasTrailingColon) {
    return "center";
  }

  if (hasLeadingColon) {
    return "left";
  }

  if (hasTrailingColon) {
    return "right";
  }

  return null;
}

function normalizeTableCellSegments(cells: TableCellSegment[], columnCount: number): TableCellSegment[] {
  if (cells.length === columnCount) {
    return cells;
  }

  if (cells.length > columnCount) {
    return cells.slice(0, columnCount);
  }

  return [
    ...cells,
    ...Array.from({ length: columnCount - cells.length }, () => ({
      value: "",
      start: cells[cells.length - 1]?.end ?? 0,
      end: cells[cells.length - 1]?.end ?? 0
    }))
  ];
}

function decodePipeTableCell(value: string): string {
  let decoded = "";
  let index = 0;

  while (index < value.length) {
    if (value[index] === "\\" && value[index + 1] === "|") {
      decoded += "|";
      index += 2;
      continue;
    }

    decoded += value[index] ?? "";
    index += 1;
  }

  return decoded;
}

function parseBlockquoteLine(line: string): { content: string; contentStart: number } | null {
  const markerStart = skipLeadingBlockIndent(line);

  if (markerStart === -1 || markerStart >= line.length || line[markerStart] !== ">") {
    return null;
  }

  let contentStart = markerStart + 1;

  if (contentStart < line.length && (line[contentStart] === " " || line[contentStart] === "\t")) {
    contentStart += 1;
  }

  return {
    content: line.slice(contentStart),
    contentStart
  };
}

function parseAlertMarker(content: string): ParsedAlertMarker | null {
  const endOfKind = content.indexOf("]");

  if (content.length === 0 || !content.startsWith("[!") || endOfKind === -1) {
    return null;
  }

  const kind = content.slice(2, endOfKind);

  if (!isAlertKind(kind)) {
    return null;
  }

  const rawContent = content.slice(endOfKind + 1);
  const trimmedContent = trimAsciiWhitespaceStart(rawContent);

  return {
    kind,
    content: trimmedContent,
    contentStart: endOfKind + 1 + (rawContent.length - trimmedContent.length)
  };
}

function parseFootnoteDefinitionMarker(line: string): ParsedFootnoteDefinition | null {
  const markerStart = skipLeadingBlockIndent(line);

  if (
    markerStart === -1 ||
    markerStart + 3 >= line.length ||
    line[markerStart] !== "[" ||
    line[markerStart + 1] !== "^"
  ) {
    return null;
  }

  let labelEnd = markerStart + 2;

  while (labelEnd < line.length && line[labelEnd] !== "]") {
    if (!isFootnoteLabelChar(line[labelEnd])) {
      return null;
    }

    labelEnd += 1;
  }

  if (labelEnd === markerStart + 2 || labelEnd + 1 >= line.length || line[labelEnd + 1] !== ":") {
    return null;
  }

  let contentStart = labelEnd + 2;

  while (
    contentStart < line.length &&
    (line[contentStart] === " " || line[contentStart] === "\t")
  ) {
    contentStart += 1;
  }

  return {
    label: line.slice(markerStart + 2, labelEnd),
    contentStart
  };
}

function parseBlockHtmlTagStart(line: string): ParsedHtmlTagStart | null {
  const start = skipLeadingBlockIndent(line);

  if (start === -1 || start >= line.length || line[start] !== "<") {
    return null;
  }

  let index = start + 1;
  let closing = false;

  if (index < line.length && line[index] === "/") {
    closing = true;
    index += 1;
  }

  if (index >= line.length || !isAsciiLetter(line[index])) {
    return null;
  }

  const tagNameStart = index;

  while (index < line.length && isHtmlTagNameChar(line[index])) {
    index += 1;
  }

  const tagName = line.slice(tagNameStart, index).toLowerCase();

  if (!BLOCK_HTML_TAGS.has(tagName)) {
    return null;
  }

  if (closing) {
    index = skipHtmlWhitespace(line, index);

    if (index >= line.length || line[index] !== ">") {
      return null;
    }

    return {
      tagName,
      tagEnd: index + 1,
      closing: true,
      selfClosing: false
    };
  }

  while (index < line.length) {
    index = skipHtmlWhitespace(line, index);

    if (index >= line.length) {
      return null;
    }

    if (line[index] === ">") {
      return {
        tagName,
        tagEnd: index + 1,
        closing: false,
        selfClosing: false
      };
    }

    if (line[index] === "/") {
      const selfClosingStart = skipHtmlWhitespace(line, index + 1);

      if (selfClosingStart >= line.length || line[selfClosingStart] !== ">") {
        return null;
      }

      return {
        tagName,
        tagEnd: selfClosingStart + 1,
        closing: false,
        selfClosing: true
      };
    }

    if (!isHtmlAttributeNameStartChar(line[index])) {
      return null;
    }

    index += 1;

    while (index < line.length && isHtmlAttributeNameChar(line[index])) {
      index += 1;
    }

    index = skipHtmlWhitespace(line, index);

    if (index >= line.length || line[index] !== "=") {
      continue;
    }

    index = skipHtmlWhitespace(line, index + 1);

    if (index >= line.length) {
      return null;
    }

    const quote = line[index];

    if (quote === '"' || quote === "'") {
      index += 1;

      while (index < line.length && line[index] !== quote) {
        index += 1;
      }

      if (index >= line.length) {
        return null;
      }

      index += 1;
      continue;
    }

    while (index < line.length && !isHtmlWhitespace(line[index]) && line[index] !== ">") {
      const char = line[index];

      if (char === '"' || char === "'" || char === "<" || char === "=" || char === "`") {
        return null;
      }

      index += 1;
    }
  }

  return null;
}

function containsClosingHtmlTag(line: string, tagName: string, fromIndex = 0): boolean {
  const lowerLine = line.toLowerCase();
  const needle = `</${tagName}`;
  let searchIndex = fromIndex;

  while (searchIndex < lowerLine.length) {
    const matchIndex = lowerLine.indexOf(needle, searchIndex);

    if (matchIndex === -1) {
      return false;
    }

    let endIndex = matchIndex + needle.length;

    while (endIndex < lowerLine.length && isHtmlWhitespace(lowerLine[endIndex])) {
      endIndex += 1;
    }

    if (endIndex < lowerLine.length && lowerLine[endIndex] === ">") {
      return true;
    }

    searchIndex = matchIndex + 1;
  }

  return false;
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
    return { start: position, text, end: index, nextPosition: input.length };
  }

  if (input[index] === "\r" && input[index + 1] === "\n") {
    return { start: position, text, end: index, nextPosition: index + 2 };
  }

  return { start: position, text, end: index, nextPosition: index + 1 };
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
  const bomOffset = line.startsWith("\uFEFF") ? 1 : 0;
  const leadingWhitespace = readLeadingWhitespace(line.slice(bomOffset));

  if (leadingWhitespace.columns > 3) {
    return -1;
  }

  return bomOffset + leadingWhitespace.offset;
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

function trimAsciiWhitespaceRange(value: string): { value: string; start: number; end: number } {
  let start = 0;
  let end = value.length;

  while (start < end && (value[start] === " " || value[start] === "\t")) {
    start += 1;
  }

  while (end > start && (value[end - 1] === " " || value[end - 1] === "\t")) {
    end -= 1;
  }

  return {
    value: value.slice(start, end),
    start,
    end
  };
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

function skipHtmlWhitespace(line: string, start: number): number {
  let index = start;

  while (index < line.length && isHtmlWhitespace(line[index])) {
    index += 1;
  }

  return index;
}

function isDigit(value: string): boolean {
  return value >= "0" && value <= "9";
}

function isAsciiLetter(value: string): boolean {
  return (value >= "a" && value <= "z") || (value >= "A" && value <= "Z");
}

function isHtmlTagNameChar(value: string): boolean {
  return isAsciiLetter(value) || isDigit(value) || value === "-";
}

function isHtmlAttributeNameStartChar(value: string): boolean {
  return isAsciiLetter(value) || value === ":" || value === "_";
}

function isHtmlAttributeNameChar(value: string): boolean {
  return isHtmlAttributeNameStartChar(value) || isDigit(value) || value === "-" || value === ".";
}

function isHtmlWhitespace(value: string): boolean {
  return value === " " || value === "\t";
}

function isFootnoteLabelChar(value: string): boolean {
  return isAsciiLetter(value) || isDigit(value) || value === "-" || value === "_";
}

function isAlertKind(value: string): value is AlertKind {
  return (
    value === "NOTE" ||
    value === "TIP" ||
    value === "IMPORTANT" ||
    value === "WARNING" ||
    value === "CAUTION"
  );
}

function parseListItem(
  state: ParserState,
  list: { ordered: boolean; indent: number; preferListToThematicBreak: boolean }
): MdNode | null {
  const rangeStart = state.position;
  const firstLine = readLine(state.input, state.position);
  const marker = parseListMarker(firstLine.text);

  if (marker === null || marker.ordered !== list.ordered || marker.indent !== list.indent) {
    return null;
  }

  state.position = firstLine.nextPosition;

  let firstLineContentStart = marker.contentStart;
  let firstLineContent = firstLine.text.slice(firstLineContentStart);
  let checked: boolean | undefined;
  const taskMarker = parseTaskMarker(firstLineContent);

  if (taskMarker !== null) {
    checked = taskMarker.checked;
    firstLineContent = taskMarker.content;
    firstLineContentStart += taskMarker.contentStart;
  }

  const continuationLines: MappedText[] = [];
  const pendingBlankLines: MappedText[] = [];

  while (state.position < state.input.length) {
    const line = readLine(state.input, state.position);

    if (isBlankLine(line.text)) {
      pendingBlankLines.push({
        text: "",
        offsets: [state.offsets[line.end] ?? 0],
        lineBreakEnd: state.offsets[line.nextPosition] ?? state.offsets[state.offsets.length - 1] ?? 0
      });
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

    const strippedLine = stripIndentLine(state, line, marker.contentIndent);

    if (strippedLine === null) {
      break;
    }

    state.position = line.nextPosition;
    continuationLines.push(...pendingBlankLines, strippedLine);
    pendingBlankLines.length = 0;
  }

  const children = parseListItemChildren(
    createMappedTextFromLineSlice(state, firstLine, firstLineContentStart, firstLine.text.length),
    continuationLines,
    list.preferListToThematicBreak
  );

  return withRange(
    {
      type: "listItem",
      ...(checked === undefined ? {} : { checked }),
      children
    },
    createNodeRange(state, rangeStart)
  );
}

function parseListItemChildren(
  firstLineContent: MappedText,
  continuationLines: MappedText[],
  preferListToThematicBreak: boolean
): MdNode[] {
  const blocks: MdNode[] = [];
  let paragraphLines = firstLineContent.text.length === 0 ? [] : [firstLineContent];
  let lineIndex = 0;

  while (lineIndex < continuationLines.length) {
    const line = continuationLines[lineIndex];

    if (isBlankLine(line.text)) {
      if (paragraphLines.length > 0) {
        blocks.push(createParagraphNode(paragraphLines));
        paragraphLines = [];
      }

      lineIndex += 1;
      continue;
    }

    if (startsBlockInLines(continuationLines, lineIndex, preferListToThematicBreak)) {
      if (paragraphLines.length > 0) {
        blocks.push(createParagraphNode(paragraphLines));
      }

      const nestedContent = joinMappedLines(continuationLines.slice(lineIndex));
      blocks.push(
        ...parseBlocksWithOptions(nestedContent.text, {
          preferListToThematicBreak,
          offsets: nestedContent.offsets
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

function createParagraphNode(lines: MappedText[]): MdNode {
  const content = joinMappedLines(lines);

  return withRange(
    {
      type: "paragraph",
      children: createTextChildren(
        content.text,
        {
          start: content.offsets[0] ?? 0,
          end: content.offsets[content.offsets.length - 1] ?? 0
        },
        content.offsets
      )
    },
    {
      start: lines[0]?.offsets[0] ?? 0,
      end: content.offsets[content.offsets.length - 1] ?? 0
    }
  );
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
    content: trimAsciiWhitespaceStart(content.slice(3)),
    contentStart: 3 + (content.slice(3).length - trimAsciiWhitespaceStart(content.slice(3)).length)
  };
}

function stripIndentLine(state: ParserState, line: Line, columns: number): MappedText | null {
  const leadingWhitespace = readLeadingWhitespace(line.text);

  if (leadingWhitespace.columns < columns) {
    return null;
  }

  const prefix = leadingWhitespace.normalized.slice(columns);
  const prefixStart = state.offsets[line.start + leadingWhitespace.offset] ?? 0;
  const parts: MappedText[] = [];

  if (prefix.length > 0) {
    parts.push(createMappedText(prefix, new Array<number>(prefix.length + 1).fill(prefixStart)));
  }

  parts.push({
    ...createMappedTextFromLineSlice(state, line, leadingWhitespace.offset, line.text.length),
    lineBreakEnd: state.offsets[line.nextPosition] ?? state.offsets[state.offsets.length - 1] ?? 0
  });

  const stripped = joinMappedTexts(parts);

  return {
    ...stripped,
    lineBreakEnd: state.offsets[line.nextPosition] ?? state.offsets[state.offsets.length - 1] ?? 0
  };
}

function readLeadingWhitespace(line: string): {
  columns: number;
  offset: number;
  normalized: string;
} {
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
