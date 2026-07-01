import type { MdNode } from "./ast.js";
import { parse } from "./parser.js";

export interface PlaintextRenderOptions {
  announceHeadings?: boolean;
  announceCode?: boolean;
  announceAlerts?: boolean;
  showLinks?: boolean;
  expandLinks?: boolean;
  includeFrontmatter?: boolean;
}

interface PlaintextContext {
  announceHeadings: boolean;
  announceCode: boolean;
  announceAlerts: boolean;
  showLinks: boolean;
  expandLinks: boolean;
  includeFrontmatter: boolean;
  footnoteDefinitions: Map<string, string>;
  footnoteOrder: string[];
}

function renderInline(node: MdNode, ctx: PlaintextContext): string {
  switch (node.type) {
    case "text":
      return node.value;
    case "emphasis":
    case "strong":
      return renderChildren(node.children, ctx);
    case "strikethrough":
      return "";
    case "inlineCode":
      return node.value;
    case "break":
      return " ";
    case "html":
      return "";
    case "link": {
      const childText = renderChildren(node.children, ctx) || node.url;

      if (ctx.expandLinks) {
        return `${childText} ${node.url}`;
      }

      if (ctx.showLinks) {
        return `${childText} (link)`;
      }

      return childText;
    }
    case "image":
      return node.alt;
    default:
      return "";
  }
}

function renderChildren(nodes: MdNode[], ctx: PlaintextContext): string {
  return nodes.map((node) => renderInline(node, ctx)).join("");
}

function renderBlock(node: MdNode, ctx: PlaintextContext): string {
  switch (node.type) {
    case "root":
      return renderBlockChildren(node.children, ctx).trim();
    case "paragraph":
      return `${renderChildren(node.children, ctx).trim()}\n\n`;
    case "thematicBreak":
      return "";
    case "heading": {
      const prefix =
        ctx.announceHeadings && node.depth === 1
          ? "Section: "
          : ctx.announceHeadings && node.depth === 2
            ? "Subsection: "
            : ctx.announceHeadings
              ? "Topic: "
              : "";

      return `${prefix}${renderChildren(node.children, ctx).trim()}\n\n`;
    }
    case "blockquote":
      return `Quote: ${renderBlockChildren(node.children, ctx).trim()}\n\n`;
    case "alert": {
      const prefix = ctx.announceAlerts ? `${node.kind}: ` : "";

      return `${prefix}${renderBlockChildren(node.children, ctx).trim()}\n\n`;
    }
    case "code": {
      const prefix = ctx.announceCode ? "Code: " : "";

      return `${prefix}${node.value}\n\n`;
    }
    case "frontmatter": {
      if (!ctx.includeFrontmatter) {
        return "";
      }

      return `${Object.entries(node.data)
        .map(([key, value]) => `${capitalize(key)}: ${String(value)}.`)
        .join(" ")}\n\n`;
    }
    default:
      return "";
  }
}

function renderBlockChildren(nodes: MdNode[], ctx: PlaintextContext): string {
  return nodes.map((node) => (isBlockNode(node) ? renderBlock(node, ctx) : renderInline(node, ctx))).join("");
}

function isBlockNode(node: MdNode): boolean {
  switch (node.type) {
    case "root":
    case "paragraph":
    case "thematicBreak":
    case "heading":
    case "blockquote":
    case "alert":
    case "code":
    case "frontmatter":
      return true;
    default:
      return false;
  }
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase()}${value.slice(1)}`;
}

export function renderPlaintext(ast: MdNode, options?: PlaintextRenderOptions): string {
  return renderBlock(ast, {
    announceHeadings: options?.announceHeadings ?? false,
    announceCode: options?.announceCode ?? false,
    announceAlerts: options?.announceAlerts ?? false,
    showLinks: options?.showLinks ?? false,
    expandLinks: options?.expandLinks ?? false,
    includeFrontmatter: options?.includeFrontmatter ?? false,
    footnoteDefinitions: new Map(),
    footnoteOrder: []
  });
}

export function renderMarkdownPlaintext(
  markdown: string,
  options?: PlaintextRenderOptions
): string {
  const { ast } = parse(markdown);

  return renderPlaintext(ast, options);
}
