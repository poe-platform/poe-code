import type { MdNode } from "../ast.js";
import { parseInline } from "./inline.js";

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

type AlertKind = Extract<MdNode, { type: "alert" }>["kind"];

type ParsedAlertMarker = {
  kind: AlertKind;
  content: string;
};

type TableAlignment = Extract<MdNode, { type: "table" }>["align"][number];

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

const VOID_BLOCK_HTML_TAGS = new Set([
  "base",
  "basefont",
  "col",
  "hr",
  "link",
  "param",
  "track"
]);

export function parseBlocks(input: string): MdNode[] {
  return applyInlineParsing(parseBlocksWithOptions(input, { preferListToThematicBreak: false }));
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
    return {
      ...node,
      children: applyInlineParsingToTextChildren(node.children, footnoteLabels)
    };
  }

  if (hasBlockChildren(node)) {
    return {
      ...node,
      children: node.children.map((child) => applyInlineParsingToNode(child, footnoteLabels))
    };
  }

  return node;
}

function applyInlineParsingToTextChildren(
  children: MdNode[],
  footnoteLabels: ReadonlySet<string>
): MdNode[] {
  let rawText = "";

  for (const child of children) {
    if (child.type !== "text") {
      return children;
    }

    rawText += child.value;
  }

  return parseInline(rawText, { footnoteLabels });
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

function parseAlert(state: ParserState): MdNode | null {
  const firstLine = readLine(state.input, state.position);
  const firstLineContent = stripBlockquoteMarker(firstLine.text);

  if (firstLineContent === null) {
    return null;
  }

  const alertMarker = parseAlertMarker(firstLineContent);

  if (alertMarker === null) {
    return null;
  }

  state.position = firstLine.nextPosition;

  const contentLines =
    alertMarker.content.length === 0 ? [] : [alertMarker.content];

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
    type: "alert",
    kind: alertMarker.kind,
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

function parseTable(state: ParserState): MdNode | null {
  const table = parseTableAt(
    state.input,
    state.position,
    state.preferListToThematicBreak
  );

  if (table === null) {
    return null;
  }

  state.position = table.nextPosition;

  return {
    type: "table",
    align: table.align,
    children: [
      createTableRowNode(table.headerCells),
      ...table.rows.map((row) => createTableRowNode(row))
    ]
  };
}

function parseHtmlBlock(state: ParserState): MdNode | null {
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

  return { type: "html", value: lines.join("\n") };
}

function parseFootnoteDefinition(state: ParserState): MdNode | null {
  const firstLine = readLine(state.input, state.position);
  const definition = parseFootnoteDefinitionMarker(firstLine.text);

  if (definition === null) {
    return null;
  }

  state.position = firstLine.nextPosition;

  const continuationLines: string[] = [];
  const pendingBlankLines: string[] = [];

  while (state.position < state.input.length) {
    const line = readLine(state.input, state.position);

    if (isBlankLine(line.text)) {
      pendingBlankLines.push("");
      state.position = line.nextPosition;
      continue;
    }

    const strippedLine = stripIndent(line.text, 4);

    if (strippedLine === null) {
      break;
    }

    state.position = line.nextPosition;
    continuationLines.push(...pendingBlankLines, strippedLine);
    pendingBlankLines.length = 0;
  }

  return {
    type: "footnoteDefinition",
    label: definition.label,
    children: parseListItemChildren(
      firstLine.text.slice(definition.contentStart),
      continuationLines,
      state.preferListToThematicBreak
    )
  };
}

function parseParagraph(state: ParserState): MdNode {
  const lines: string[] = [];

  while (state.position < state.input.length) {
    const line = readLine(state.input, state.position);

    if (isBlankLine(line.text)) {
      break;
    }

    if (lines.length > 0 && startsBlockAt(state.input, state.position, state.preferListToThematicBreak)) {
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

function createTableRowNode(values: string[]): MdNode {
  return {
    type: "tableRow",
    children: values.map((value) => ({
      type: "tableCell",
      children: createTextChildren(value)
    }))
  };
}

function startsBlockAt(input: string, position: number, preferListToThematicBreak: boolean): boolean {
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
  lines: string[],
  lineIndex: number,
  preferListToThematicBreak: boolean
): boolean {
  const line = lines[lineIndex];

  if (startsSimpleBlock(line, preferListToThematicBreak)) {
    return true;
  }

  return (
    lineIndex + 1 < lines.length &&
    parseTableHeaderAndSeparator(line, lines[lineIndex + 1]) !== null
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

function parseTableAt(
  input: string,
  position: number,
  preferListToThematicBreak: boolean
): {
  align: TableAlignment[];
  headerCells: string[];
  rows: string[][];
  nextPosition: number;
} | null {
  const headerLine = readLine(input, position);

  if (parseListMarker(headerLine.text) !== null || stripBlockquoteMarker(headerLine.text) !== null) {
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

  const rows: string[][] = [];
  let nextPosition = separatorLine.nextPosition;

  while (nextPosition < input.length) {
    const rowLine = readLine(input, nextPosition);

    if (isBlankLine(rowLine.text)) {
      break;
    }

    if (startsSimpleBlock(rowLine.text, preferListToThematicBreak)) {
      break;
    }

    const cells = parsePipeTableCells(rowLine.text);

    if (cells === null) {
      break;
    }

    rows.push(normalizeTableCells(cells, header.headerCells.length));
    nextPosition = rowLine.nextPosition;
  }

  return {
    align: header.align,
    headerCells: header.headerCells,
    rows,
    nextPosition
  };
}

function parseTableHeaderAndSeparator(
  headerLine: string,
  separatorLine: string
): { align: TableAlignment[]; headerCells: string[] } | null {
  const headerCells = parsePipeTableCells(headerLine);

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
  const start = skipLeadingBlockIndent(line);

  if (start === -1 || start >= line.length) {
    return null;
  }

  const content = trimAsciiWhitespaceEnd(line.slice(start));
  let hasPipe = false;
  const cells: string[] = [];
  let cell = "";
  let index = 0;

  while (index < content.length) {
    const char = content[index];

    if (char === "\\" && index + 1 < content.length && content[index + 1] === "|") {
      cell += "|";
      index += 2;
      continue;
    }

    if (char === "|") {
      cells.push(trimAsciiWhitespace(cell));
      cell = "";
      hasPipe = true;
      index += 1;
      continue;
    }

    cell += char;
    index += 1;
  }

  if (!hasPipe) {
    return null;
  }

  cells.push(trimAsciiWhitespace(cell));

  if (content[0] === "|") {
    cells.shift();
  }

  if (content[content.length - 1] === "|") {
    cells.pop();
  }

  return cells.length === 0 ? null : cells;
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

function normalizeTableCells(cells: string[], columnCount: number): string[] {
  if (cells.length === columnCount) {
    return cells;
  }

  if (cells.length > columnCount) {
    return cells.slice(0, columnCount);
  }

  return [...cells, ...Array.from({ length: columnCount - cells.length }, () => "")];
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

function parseAlertMarker(content: string): ParsedAlertMarker | null {
  const endOfKind = content.indexOf("]");

  if (content.length === 0 || !content.startsWith("[!") || endOfKind === -1) {
    return null;
  }

  const kind = content.slice(2, endOfKind);

  if (!isAlertKind(kind)) {
    return null;
  }

  return {
    kind,
    content: trimAsciiWhitespaceStart(content.slice(endOfKind + 1))
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

  while (contentStart < line.length && (line[contentStart] === " " || line[contentStart] === "\t")) {
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

    if (quote === "\"" || quote === "'") {
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

      if (char === "\"" || char === "'" || char === "<" || char === "=" || char === "`") {
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
  return (
    isHtmlAttributeNameStartChar(value) ||
    isDigit(value) ||
    value === "-" ||
    value === "."
  );
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

    if (startsBlockInLines(continuationLines, lineIndex, preferListToThematicBreak)) {
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
