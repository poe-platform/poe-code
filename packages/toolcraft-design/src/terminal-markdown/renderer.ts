import { symbols } from "../components/symbols.js";
import { displayWidth, graphemes } from "../dashboard/terminal-width.js";
import { getTheme } from "../internal/theme-detect.js";
import { stripAnsi } from "../internal/strip-ansi.js";
import { spacing } from "../tokens/spacing.js";
import { typography } from "../tokens/typography.js";
import { widths } from "../tokens/widths.js";
import type { MdNode } from "./ast.js";

export interface RenderOptions {
  width?: number;
  showFrontmatter?: boolean;
}

type TextFormatter = (text: string) => string;

type WrapToken =
  | { type: "break" }
  | { type: "space"; value: string }
  | { type: "word"; value: string; formatters: readonly TextFormatter[] };

interface FootnoteState {
  definitions: ReadonlyMap<string, Extract<MdNode, { type: "footnoteDefinition" }>>;
  labelsInOrder: string[];
  numbers: Map<string, number>;
}

interface RenderContext {
  width: number;
  showFrontmatter: boolean;
  theme: ReturnType<typeof getTheme>;
  footnotes?: FootnoteState;
}

const lineChar = "─";

export function render(ast: MdNode, options: RenderOptions = {}): string {
  const requestedWidth = options.width ?? process.stdout.columns ?? widths.maxLine;
  if (!Number.isFinite(requestedWidth) || requestedWidth <= 0) {
    throw new Error("width must be a positive finite number.");
  }
  const width = Math.max(1, requestedWidth);

  const context: RenderContext = {
    width,
    showFrontmatter: options.showFrontmatter ?? false,
    theme: getTheme(),
    footnotes: ast.type === "root" ? createFootnoteState(ast.children) : undefined
  };

  return renderNode(ast, context);
}

function renderNode(node: MdNode, context: RenderContext): string {
  switch (node.type) {
    case "root":
      return renderRoot(node, context);
    case "heading":
      return renderHeading(node, context);
    case "paragraph":
      return renderParagraph(node, context);
    case "blockquote":
      return renderBlockquote(node, context);
    case "alert":
      return renderAlert(node, context);
    case "code":
      return renderCodeBlock(node, context);
    case "list":
      return renderList(node, context);
    case "table":
      return renderTable(node, context);
    case "html":
      return renderHtml(node, context);
    case "text":
    case "strong":
    case "emphasis":
    case "strikethrough":
    case "inlineCode":
    case "link":
    case "image":
    case "break":
    case "footnoteReference":
      return renderInline([node], context).join("\n");
    case "thematicBreak":
      return `${context.theme.divider(lineChar.repeat(context.width))}\n\n`;
    case "frontmatter":
      return context.showFrontmatter ? renderFrontmatter(node.data, context) : "";
    case "footnoteDefinition":
      return "";
    default:
      return "children" in node ? renderChildren(node.children, context) : "";
  }
}

function renderRoot(node: Extract<MdNode, { type: "root" }>, context: RenderContext): string {
  const mainOutput = renderChildren(
    node.children.filter((child) => child.type !== "footnoteDefinition"),
    context
  );
  const footnotesOutput = renderReferencedFootnotes(context);

  return `${mainOutput}${footnotesOutput}`;
}

function renderChildren(children: MdNode[], context: RenderContext): string {
  return children.map((child) => renderNode(child, context)).join("");
}

function renderParagraph(
  node: Extract<MdNode, { type: "paragraph" }>,
  context: RenderContext
): string {
  const lines = renderInline(node.children, context);
  if (lines.length === 0) {
    return "";
  }

  return `${lines.join("\n")}\n\n`;
}

function renderHeading(node: Extract<MdNode, { type: "heading" }>, context: RenderContext): string {
  const lines = renderInline(node.children, context);
  if (lines.length === 0) {
    return "";
  }

  const styledLines = lines.map((line) => styleHeading(line, node.depth, context));
  if (node.depth === 1) {
    const underlineWidth = Math.max(...lines.map((line) => visibleWidth(line)));
    return `${styledLines.join("\n")}\n${context.theme.header(lineChar.repeat(underlineWidth))}\n\n`;
  }

  return `${styledLines.join("\n")}\n\n`;
}

function renderBlockquote(
  node: Extract<MdNode, { type: "blockquote" }>,
  context: RenderContext
): string {
  const prefix = `${symbols.bar} `;
  const body = renderBlockChildren(node.children, reduceWidth(context, prefix));
  if (body.length === 0) {
    return `${symbols.bar}\n\n`;
  }

  const lines = body
    .split("\n")
    .map((line) => (line.length > 0 ? `${prefix}${typography.dim(line)}` : symbols.bar));

  return `${lines.join("\n")}\n\n`;
}

function renderAlert(node: Extract<MdNode, { type: "alert" }>, context: RenderContext): string {
  const prefix = `${symbols.bar} `;
  const labelLine = `${prefix}${formatAlertLabel(node.kind, context)}`;
  const body = renderBlockChildren(node.children, reduceWidth(context, prefix));

  if (body.length === 0) {
    return `${labelLine}\n\n`;
  }

  const lines = body
    .split("\n")
    .map((line) => (line.length > 0 ? `${prefix}${line}` : symbols.bar));

  return `${labelLine}\n${lines.join("\n")}\n\n`;
}

function renderCodeBlock(node: Extract<MdNode, { type: "code" }>, context: RenderContext): string {
  const indent = " ".repeat(spacing.sm);
  const lines = node.value.split("\n").map((line) => stripAnsi(line));
  const longestLine = lines.reduce((max, line) => Math.max(max, visibleWidth(line)), 0);
  const borderWidth = Math.max(3, Math.min(context.width - indent.length, longestLine));
  const border = context.theme.muted(`${indent}${lineChar.repeat(borderWidth)}`);
  const content = lines.map((line) => `${indent}${line}`).join("\n");

  return `${border}\n${content}\n${border}\n\n`;
}

function renderList(node: Extract<MdNode, { type: "list" }>, context: RenderContext): string {
  const items = node.children
    .map((child, index) => {
      if (child.type !== "listItem") {
        return renderNode(child, context).trimEnd();
      }

      return renderListItem(child, node, index, context);
    })
    .filter((item) => item.length > 0);

  if (items.length === 0) {
    return "";
  }

  return `${items.join("\n")}\n\n`;
}

function renderTable(node: Extract<MdNode, { type: "table" }>, context: RenderContext): string {
  const rows = node.children.filter(
    (child): child is Extract<MdNode, { type: "tableRow" }> => child.type === "tableRow"
  );
  if (rows.length === 0) {
    return "";
  }

  const columnCount = Math.max(node.align.length, ...rows.map((row) => row.children.length));
  if (columnCount === 0) {
    return "";
  }

  const renderedRows = rows.map((row) =>
    Array.from({ length: columnCount }, (_, columnIndex) => {
      const cell = row.children[columnIndex];
      return cell?.type === "tableCell" ? renderTableCell(cell, context) : "";
    })
  );
  const columnWidths = Array.from({ length: columnCount }, (_, columnIndex) =>
    Math.max(...renderedRows.map((row) => visibleWidth(row[columnIndex] ?? "")), 0)
  );

  if (getRenderedTableWidth(columnWidths) > context.width) {
    return renderStackedTable(rows, columnCount, context);
  }

  const lines = renderedRows.map((row, rowIndex) =>
    row.map((cell, columnIndex) =>
      alignTableCell(
        rowIndex === 0 ? context.theme.header(typography.bold(cell)) : cell,
        columnWidths[columnIndex] ?? 0,
        node.align[columnIndex] ?? null
      )
    )
  );

  const outputLines = lines.map((row, rowIndex) => {
    const line = `${symbols.bar}${row
      .map((cell) => `${" ".repeat(spacing.sm)}${cell}${" ".repeat(spacing.sm)}`)
      .join(symbols.bar)}${symbols.bar}`;

    if (rowIndex !== 0 || lines.length === 1) {
      return line;
    }

    const divider = context.theme.muted(
      `├${columnWidths.map((width) => lineChar.repeat(width + spacing.sm * 2)).join("┼")}┤`
    );

    return `${line}\n${divider}`;
  });

  return `${outputLines.join("\n")}\n\n`;
}

function renderStackedTable(
  rows: readonly Extract<MdNode, { type: "tableRow" }>[],
  columnCount: number,
  context: RenderContext
): string {
  const headerRow = rows[0];
  if (headerRow === undefined) {
    return "";
  }

  const dataRows = rows.slice(1);
  if (dataRows.length === 0) {
    const headerLines = Array.from({ length: columnCount }, (_, columnIndex) =>
      tokenizeText(getStackedTableLabel(headerRow.children[columnIndex], columnIndex, context), [
        typography.bold
      ])
    ).flatMap((tokens) => wrapTokens(tokens, context.width));

    return headerLines.length === 0 ? "" : `${headerLines.join("\n")}\n\n`;
  }

  const blocks = dataRows
    .map((row) =>
      Array.from({ length: columnCount }, (_, columnIndex) =>
        renderStackedTableField(
          headerRow.children[columnIndex],
          row.children[columnIndex],
          columnIndex,
          context
        )
      )
        .filter((field) => field.length > 0)
        .join("\n")
    )
    .filter((block) => block.length > 0);

  return blocks.length === 0 ? "" : `${blocks.join("\n\n")}\n\n`;
}

function renderListItem(
  node: Extract<MdNode, { type: "listItem" }>,
  list: Extract<MdNode, { type: "list" }>,
  index: number,
  context: RenderContext
): string {
  const marker = getListMarker(node, list, index);
  const indent = " ".repeat(spacing.sm);
  const firstPrefix = `${indent}${marker} `;
  const body = renderBlockChildren(node.children, reduceWidth(context, firstPrefix));
  const continuationPrefix = `${indent}${" ".repeat(marker.length + 1)}`;

  if (body.length === 0) {
    return firstPrefix.trimEnd();
  }

  return prefixBlock(body, firstPrefix, continuationPrefix);
}

function styleHeading(
  value: string,
  depth: Extract<MdNode, { type: "heading" }>["depth"],
  context: RenderContext
): string {
  if (depth <= 2) {
    return context.theme.header(typography.bold(value));
  }

  if (depth <= 4) {
    return typography.bold(value);
  }

  return context.theme.muted(typography.bold(value));
}

function renderFrontmatter(data: Record<string, unknown>, context: RenderContext): string {
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return "";
  }

  const lines = entries.flatMap(([key, value]) =>
    wrapText(`${key}: ${formatFrontmatterValue(value)}`, context.width).map((line) =>
      typography.dim(line)
    )
  );

  return `${lines.join("\n")}\n\n`;
}

function formatFrontmatterValue(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  const ancestors: object[] = [];
  return JSON.stringify(value, function (_key, nestedValue: unknown) {
    if (typeof nestedValue !== "object" || nestedValue === null) {
      return nestedValue;
    }

    while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
      ancestors.pop();
    }

    if (ancestors.includes(nestedValue)) {
      return "[Circular]";
    }

    ancestors.push(nestedValue);
    return nestedValue;
  });
}

function renderHtml(node: Extract<MdNode, { type: "html" }>, context: RenderContext): string {
  const value = stripAnsi(stripHtmlTags(node.value)).trim();
  if (value.length === 0) {
    return "";
  }

  const lines = wrapText(value, context.width);
  if (lines.length === 0) {
    return "";
  }

  return `${lines.join("\n")}\n\n`;
}

function renderBlockChildren(children: MdNode[], context: RenderContext): string {
  const renderedChildren = children
    .map((child) => ({
      type: child.type,
      value: renderNode(child, context).trimEnd()
    }))
    .filter((child) => child.value.length > 0);

  if (renderedChildren.length === 0) {
    return "";
  }

  let output = renderedChildren[0]!.value;

  for (let index = 1; index < renderedChildren.length; index += 1) {
    const previous = renderedChildren[index - 1]!;
    const current = renderedChildren[index]!;
    const separator = previous.type === "paragraph" && current.type === "list" ? "\n" : "\n\n";
    output += `${separator}${current.value}`;
  }

  return output;
}

function renderReferencedFootnotes(context: RenderContext): string {
  const footnotes = context.footnotes;
  if (footnotes === undefined || footnotes.labelsInOrder.length === 0) {
    return "";
  }

  const rendered: string[] = [];

  for (let index = 0; index < footnotes.labelsInOrder.length; index += 1) {
    const label = footnotes.labelsInOrder[index]!;
    const definition = footnotes.definitions.get(label);
    const number = footnotes.numbers.get(label);

    if (definition !== undefined && number !== undefined) {
      rendered.push(renderFootnoteDefinition(definition, number, context));
    }
  }

  if (rendered.length === 0) {
    return "";
  }

  return `${rendered.join("\n")}\n\n`;
}

function renderFootnoteDefinition(
  node: Extract<MdNode, { type: "footnoteDefinition" }>,
  number: number,
  context: RenderContext
): string {
  const marker = typography.dim(`[${number}]`);
  const firstPrefix = `${" ".repeat(spacing.sm)}${marker} `;
  const continuationPrefix = `${" ".repeat(spacing.sm + visibleWidth(`[${number}] `))}`;
  const body = renderBlockChildren(node.children, reduceWidth(context, firstPrefix));

  if (body.length === 0) {
    return firstPrefix.trimEnd();
  }

  return prefixBlock(body, firstPrefix, continuationPrefix);
}

function getListMarker(
  node: Extract<MdNode, { type: "listItem" }>,
  list: Extract<MdNode, { type: "list" }>,
  index: number
): string {
  if (node.checked === true) {
    return symbols.active;
  }

  if (node.checked === false) {
    return symbols.inactive;
  }

  if (list.ordered) {
    return `${(list.start ?? 1) + index}.`;
  }

  return "•";
}

function prefixBlock(rendered: string, firstPrefix: string, restPrefix: string): string {
  return rendered
    .split("\n")
    .map((line, index) => {
      const prefix = index === 0 ? firstPrefix : restPrefix;
      return line.length > 0 ? `${prefix}${line}` : prefix.trimEnd();
    })
    .join("\n");
}

function reduceWidth(context: RenderContext, prefix: string): RenderContext {
  return {
    ...context,
    width: Math.max(1, context.width - visibleWidth(prefix))
  };
}

function renderInline(nodes: readonly MdNode[], context: RenderContext): string[] {
  const tokens = tokenizeInline(nodes, context);
  return wrapTokens(tokens, context.width);
}

function tokenizeInline(nodes: readonly MdNode[], context: RenderContext): WrapToken[] {
  const tokens: WrapToken[] = [];

  for (const node of nodes) {
    collectInlineTokens(node, [], context, tokens);
  }

  return tokens;
}

function collectInlineTokens(
  node: MdNode,
  formatters: readonly TextFormatter[],
  context: RenderContext,
  tokens: WrapToken[]
): void {
  switch (node.type) {
    case "text":
      tokens.push(...tokenizeText(stripAnsi(node.value), formatters));
      return;
    case "strong":
      collectChildren(node.children, [...formatters, typography.bold], context, tokens);
      return;
    case "emphasis":
      collectChildren(node.children, [...formatters, typography.italic], context, tokens);
      return;
    case "strikethrough":
      collectChildren(node.children, [...formatters, typography.strikethrough], context, tokens);
      return;
    case "inlineCode":
      tokens.push(...tokenizeText(stripAnsi(node.value), [...formatters, context.theme.accent]));
      return;
    case "link":
      collectLinkTokens(node, formatters, context, tokens);
      return;
    case "image":
      tokens.push(
        createWordToken(formatImagePlaceholder(stripAnsi(node.alt)), [
          ...formatters,
          context.theme.muted
        ])
      );
      return;
    case "footnoteReference": {
      const footnoteNumber = resolveFootnoteNumber(node.label, context);

      if (footnoteNumber !== null) {
        tokens.push(createWordToken(`[${footnoteNumber}]`, [...formatters, typography.dim]));
      }

      return;
    }
    case "html": {
      const value = stripAnsi(stripHtmlTags(node.value));

      if (value.length > 0) {
        tokens.push(...tokenizeText(value, formatters));
      }

      return;
    }
    case "break":
      tokens.push({ type: "break" });
      return;
    default:
      if ("children" in node) {
        collectChildren(node.children, formatters, context, tokens);
      }
  }
}

function collectChildren(
  children: readonly MdNode[],
  formatters: readonly TextFormatter[],
  context: RenderContext,
  tokens: WrapToken[]
): void {
  for (const child of children) {
    collectInlineTokens(child, formatters, context, tokens);
  }
}

function collectLinkTokens(
  node: Extract<MdNode, { type: "link" }>,
  formatters: readonly TextFormatter[],
  context: RenderContext,
  tokens: WrapToken[]
): void {
  if (isAutolink(node)) {
    tokens.push(createWordToken(stripAnsi(node.url), [...formatters, context.theme.accent]));
    return;
  }

  const childTokens: WrapToken[] = [];
  collectChildren(node.children, formatters, context, childTokens);
  const trimmedChildTokens = trimTrailingSpaces(childTokens);

  tokens.push(...trimmedChildTokens);

  if (trimmedChildTokens.some((token) => token.type === "word")) {
    tokens.push({ type: "space", value: " " });
  }

  tokens.push(createWordToken(`(${stripAnsi(node.url)})`, [...formatters, context.theme.accent]));
}

function isAutolink(node: Extract<MdNode, { type: "link" }>): boolean {
  if (node.children.length !== 1 || node.children[0]?.type !== "text") {
    return false;
  }

  const label = node.children[0].value;

  return (
    label === node.url ||
    (node.url.startsWith("http://") && label === node.url.slice("http://".length)) ||
    (node.url.startsWith("mailto:") && label === node.url.slice("mailto:".length))
  );
}

function formatImagePlaceholder(alt: string): string {
  return alt.length > 0 ? `[image: ${alt}]` : "[image]";
}

function createWordToken(value: string, formatters: readonly TextFormatter[]): WrapToken {
  return { type: "word", value, formatters };
}

function trimTrailingSpaces(tokens: readonly WrapToken[]): WrapToken[] {
  let end = tokens.length;

  while (end > 0 && tokens[end - 1]?.type === "space") {
    end -= 1;
  }

  return tokens.slice(0, end);
}

function tokenizeText(value: string, formatters: readonly TextFormatter[]): WrapToken[] {
  const lines = value.split("\n");
  return lines.flatMap((line, lineIndex): WrapToken[] => {
    const pieces = line
      .split(/([ \t]+)/)
      .filter((piece) => piece.length > 0)
      .map(
        (piece): WrapToken =>
          /^[ \t]+$/.test(piece)
            ? { type: "space", value: piece }
            : { type: "word", value: piece, formatters }
      );
    return lineIndex < lines.length - 1 ? [...pieces, { type: "break" }] : pieces;
  });
}

function wrapTokens(tokens: readonly WrapToken[], width: number): string[] {
  const lines: string[] = [];
  let currentLine = "";
  let currentWidth = 0;
  let pendingSpace = "";

  const flushLine = () => {
    lines.push(currentLine);
    currentLine = "";
    currentWidth = 0;
    pendingSpace = "";
  };

  for (const token of tokens) {
    if (token.type === "break") {
      flushLine();
      continue;
    }

    if (token.type === "space") {
      if (currentWidth > 0) {
        pendingSpace += token.value;
      }
      continue;
    }

    const chunks = splitWord(token.value, width);
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index]!;
      const gap = index === 0 ? pendingSpace : "";
      const chunkWidth = visibleWidth(chunk);
      const gapWidth = visibleWidth(gap);

      if (currentWidth > 0 && currentWidth + chunkWidth + gapWidth > width) {
        flushLine();
      }

      if (currentWidth > 0 && gapWidth > 0) {
        currentLine += gap;
        currentWidth += gapWidth;
      }

      currentLine += applyFormatters(chunk, token.formatters);
      currentWidth += chunkWidth;
      pendingSpace = "";

      if (index < chunks.length - 1) {
        flushLine();
      }
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines;
}

function splitWord(value: string, width: number): string[] {
  if (visibleWidth(value) <= width) {
    return [value];
  }

  const chunks: string[] = [];
  let chunk = "";
  let chunkWidth = 0;

  for (const grapheme of graphemes(value)) {
    const graphemeWidth = visibleWidth(grapheme);

    if (chunk.length > 0 && chunkWidth + graphemeWidth > width) {
      chunks.push(chunk);
      chunk = "";
      chunkWidth = 0;
    }

    chunk += grapheme;
    chunkWidth += graphemeWidth;

    if (chunkWidth >= width) {
      chunks.push(chunk);
      chunk = "";
      chunkWidth = 0;
    }
  }

  if (chunk.length > 0) {
    chunks.push(chunk);
  }

  return chunks;
}

function applyFormatters(value: string, formatters: readonly TextFormatter[]): string {
  return formatters.reduce((text, formatter) => formatter(text), value);
}

function wrapText(value: string, width: number): string[] {
  const tokens = tokenizeText(value, []);
  return wrapTokens(tokens, Math.max(1, width));
}

function createFootnoteState(children: readonly MdNode[]): FootnoteState {
  return {
    definitions: new Map(
      children.flatMap((child) =>
        child.type === "footnoteDefinition" ? ([[child.label, child]] as const) : []
      )
    ),
    labelsInOrder: [],
    numbers: new Map()
  };
}

function resolveFootnoteNumber(label: string, context: RenderContext): number | null {
  const footnotes = context.footnotes;
  if (footnotes === undefined || !footnotes.definitions.has(label)) {
    return null;
  }

  const existing = footnotes.numbers.get(label);
  if (existing !== undefined) {
    return existing;
  }

  const number = footnotes.numbers.size + 1;
  footnotes.numbers.set(label, number);
  footnotes.labelsInOrder.push(label);
  return number;
}

function formatAlertLabel(
  kind: Extract<MdNode, { type: "alert" }>["kind"],
  context: RenderContext
): string {
  switch (kind) {
    case "NOTE":
      return context.theme.info("Note");
    case "TIP":
      return context.theme.success("Tip");
    case "IMPORTANT":
      return context.theme.info("Important");
    case "WARNING":
      return context.theme.warning("Warning");
    case "CAUTION":
      return context.theme.error("Caution");
  }
}

function renderTableCell(
  node: Extract<MdNode, { type: "tableCell" }>,
  context: RenderContext
): string {
  return wrapTokens(tokenizeInline(node.children, context), Number.MAX_SAFE_INTEGER).join(" ");
}

function renderStackedTableField(
  headerCell: MdNode | undefined,
  cell: MdNode | undefined,
  columnIndex: number,
  context: RenderContext
): string {
  const tokens = [
    ...tokenizeText(getStackedTableLabel(headerCell, columnIndex, context), [typography.bold]),
    createWordToken(":", [typography.bold]),
    { type: "space", value: " " } as const,
    ...getStackedTableValueTokens(cell, context)
  ];

  return wrapTokens(tokens, context.width).join("\n");
}

function getStackedTableLabel(
  headerCell: MdNode | undefined,
  columnIndex: number,
  context: RenderContext
): string {
  if (headerCell?.type !== "tableCell") {
    return `Column ${columnIndex + 1}`;
  }

  const label = stripAnsi(renderTableCell(headerCell, context)).trim();
  return label.length > 0 ? label : `Column ${columnIndex + 1}`;
}

function getStackedTableValueTokens(cell: MdNode | undefined, context: RenderContext): WrapToken[] {
  if (cell?.type !== "tableCell") {
    return [createWordToken("—", [context.theme.muted])];
  }

  const tokens = trimTrailingSpaces(tokenizeInline(cell.children, context));
  return tokens.length > 0 ? tokens : [createWordToken("—", [context.theme.muted])];
}

function getRenderedTableWidth(columnWidths: readonly number[]): number {
  return columnWidths.reduce(
    (totalWidth, width) => totalWidth + width + spacing.sm * 2,
    columnWidths.length + 1
  );
}

function alignTableCell(
  value: string,
  width: number,
  align: Extract<MdNode, { type: "table" }>["align"][number]
): string {
  const extraSpace = Math.max(0, width - visibleWidth(value));

  if (align === "right") {
    return `${" ".repeat(extraSpace)}${value}`;
  }

  if (align === "center") {
    const leftPadding = Math.floor(extraSpace / 2);
    const rightPadding = extraSpace - leftPadding;
    return `${" ".repeat(leftPadding)}${value}${" ".repeat(rightPadding)}`;
  }

  return `${value}${" ".repeat(extraSpace)}`;
}

function stripHtmlTags(value: string): string {
  let output = "";
  let inTag = false;

  for (const char of value) {
    if (char === "<") {
      inTag = true;
      continue;
    }

    if (char === ">" && inTag) {
      inTag = false;
      continue;
    }

    if (!inTag) {
      output += char;
    }
  }

  return output;
}

function visibleWidth(value: string): number {
  return displayWidth(stripAnsi(value));
}
