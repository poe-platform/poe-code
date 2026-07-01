import type { MdNode } from "./ast.js";

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

export function renderPlaintext(ast: MdNode, options?: PlaintextRenderOptions): string {
  void ast;
  void options;

  return "";
}

export function renderMarkdownPlaintext(
  markdown: string,
  options?: PlaintextRenderOptions
): string {
  void markdown;
  void options;

  return "";
}
