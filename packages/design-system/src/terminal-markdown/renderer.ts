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

interface RenderContext {
  width: number;
  showFrontmatter: boolean;
  theme: ReturnType<typeof getTheme>;
}

const lineChar = "─";

export function render(ast: MdNode, options: RenderOptions = {}): string {
  const width = Math.max(1, options.width ?? process.stdout.columns ?? widths.maxLine);

  return renderNode(ast, {
    width,
    showFrontmatter: options.showFrontmatter ?? false,
    theme: getTheme()
  });
}

function renderNode(node: MdNode, context: RenderContext): string {
  switch (node.type) {
    case "root":
      return renderChildren(node.children, context);
    case "heading":
      return renderHeading(node, context);
    case "paragraph":
      return renderParagraph(node, context);
    case "text":
    case "strong":
    case "emphasis":
    case "strikethrough":
    case "inlineCode":
    case "break":
      return renderInline([node], context).join("\n");
    case "thematicBreak":
      return `${context.theme.divider(lineChar.repeat(context.width))}\n\n`;
    case "frontmatter":
      return context.showFrontmatter ? renderFrontmatter(node.data, context) : "";
    default:
      return "children" in node ? renderChildren(node.children, context) : "";
  }
}

function renderChildren(children: MdNode[], context: RenderContext): string {
  let output = "";

  for (const child of children) {
    output += renderNode(child, context);
  }

  return output;
}

function renderParagraph(node: Extract<MdNode, { type: "paragraph" }>, context: RenderContext): string {
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
    const underlineWidth = Math.max(...lines.map((line) => stripAnsi(line).length));
    return `${styledLines.join("\n")}\n${context.theme.header(lineChar.repeat(underlineWidth))}\n\n`;
  }

  return `${styledLines.join("\n")}\n\n`;
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

  const indent = " ".repeat(spacing.sm);
  const lines = entries.flatMap(([key, value]) =>
    wrapText(`${key}: ${formatFrontmatterValue(value)}`, context.width - spacing.sm).map((line) =>
      context.theme.muted(typography.dim(`${indent}${line}`))
    )
  );

  return `${context.theme.muted(typography.dim("Frontmatter"))}\n${lines.join("\n")}\n\n`;
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

  return JSON.stringify(value);
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
      tokens.push(...tokenizeText(node.value, formatters));
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
      tokens.push(...tokenizeText(node.value, [...formatters, context.theme.accent]));
      return;
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

function tokenizeText(value: string, formatters: readonly TextFormatter[]): WrapToken[] {
  const tokens: WrapToken[] = [];
  const lines = value.split("\n");

  lines.forEach((line, lineIndex) => {
    for (const piece of line.split(/([ \t]+)/)) {
      if (piece.length === 0) {
        continue;
      }

      if (/^[ \t]+$/.test(piece)) {
        tokens.push({ type: "space", value: piece });
        continue;
      }

      tokens.push({ type: "word", value: piece, formatters });
    }

    if (lineIndex < lines.length - 1) {
      tokens.push({ type: "break" });
    }
  });

  return tokens;
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
    chunks.forEach((chunk, index) => {
      const gap = index === 0 ? pendingSpace : "";
      const gapWidth = gap.length;
      const nextWidth = chunk.length + (currentWidth === 0 ? 0 : gapWidth);

      if (currentWidth > 0 && currentWidth + nextWidth > width) {
        flushLine();
      }

      if (currentWidth > 0 && gapWidth > 0) {
        currentLine += gap;
        currentWidth += gapWidth;
      }

      currentLine += applyFormatters(chunk, token.formatters);
      currentWidth += chunk.length;
      pendingSpace = "";

      if (index < chunks.length - 1) {
        flushLine();
      }
    });
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines;
}

function splitWord(value: string, width: number): string[] {
  if (value.length <= width) {
    return [value];
  }

  const chunks: string[] = [];

  for (let index = 0; index < value.length; index += width) {
    chunks.push(value.slice(index, index + width));
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
