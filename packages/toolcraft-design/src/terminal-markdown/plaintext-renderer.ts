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
    case "footnoteReference": {
      if (!ctx.footnoteOrder.includes(node.label)) {
        ctx.footnoteOrder.push(node.label);
      }

      const index = ctx.footnoteOrder.indexOf(node.label) + 1;
      return `[${index}]`;
    }
    default:
      return "";
  }
}

function renderChildren(nodes: MdNode[], ctx: PlaintextContext): string {
  return nodes.map((node) => renderInline(node, ctx)).join("");
}

function renderBlock(node: MdNode, ctx: PlaintextContext): string {
  switch (node.type) {
    case "root": {
      collectFootnoteDefinitions(node.children, ctx);

      const text = renderBlockChildren(node.children, ctx).trim();
      const footnotes = renderReferencedFootnotes(ctx);

      return footnotes.length === 0 ? text : `${text}\n\n${footnotes}`.trim();
    }
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
    case "list": {
      const items = node.children
        .filter(
          (child): child is Extract<MdNode, { type: "listItem" }> => child.type === "listItem"
        )
        .map((child, index) => {
          const text = renderBlock(child, ctx).trim();

          return node.ordered ? `${getOrderedListPrefix(index)}${text}` : text;
        });

      return `${items.join(node.ordered ? " " : getUnorderedListSeparator(items.length))}\n\n`;
    }
    case "listItem": {
      const text = renderBlockChildren(node.children, ctx).trim();

      if (node.checked === true) {
        return `done: ${text}`;
      }

      if (node.checked === false) {
        return `to do: ${text}`;
      }

      return text;
    }
    case "table": {
      const [headerRow, ...bodyRows] = node.children.filter(
        (child): child is Extract<MdNode, { type: "tableRow" }> => child.type === "tableRow"
      );

      if (!headerRow) {
        return "\n\n";
      }

      const headers = headerRow.children.map((cell) =>
        cell.type === "tableCell" ? renderChildren(cell.children, ctx).trim() : ""
      );

      const sentences = bodyRows.flatMap((row) =>
        row.children.flatMap((cell, index) => {
          if (cell.type !== "tableCell") {
            return [];
          }

          const header = headers[index]?.trim() ?? "";
          const value = renderChildren(cell.children, ctx).trim();

          return value === "" ? [] : `${header} is ${value}.`;
        })
      );

      return `${sentences.join(" ")}\n\n`;
    }
    case "tableRow":
    case "tableCell":
      return "";
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
    case "footnoteDefinition":
      return "";
    default:
      return "";
  }
}

function renderBlockChildren(nodes: MdNode[], ctx: PlaintextContext): string {
  return nodes
    .map((node) => (isBlockNode(node) ? renderBlock(node, ctx) : renderInline(node, ctx)))
    .join("");
}

function isBlockNode(node: MdNode): boolean {
  switch (node.type) {
    case "root":
    case "paragraph":
    case "thematicBreak":
    case "heading":
    case "blockquote":
    case "alert":
    case "list":
    case "listItem":
    case "table":
    case "tableRow":
    case "tableCell":
    case "code":
    case "frontmatter":
    case "footnoteDefinition":
      return true;
    default:
      return false;
  }
}

function collectFootnoteDefinitions(nodes: MdNode[], ctx: PlaintextContext): void {
  for (const node of nodes) {
    if (node.type === "footnoteDefinition") {
      ctx.footnoteDefinitions.set(
        node.label,
        renderBlockChildren(node.children, createFootnoteDefinitionContext(ctx)).trim()
      );
      continue;
    }

    if ("children" in node) {
      collectFootnoteDefinitions(node.children, ctx);
    }
  }
}

function createFootnoteDefinitionContext(ctx: PlaintextContext): PlaintextContext {
  return {
    announceHeadings: ctx.announceHeadings,
    announceCode: ctx.announceCode,
    announceAlerts: ctx.announceAlerts,
    showLinks: ctx.showLinks,
    expandLinks: ctx.expandLinks,
    includeFrontmatter: ctx.includeFrontmatter,
    footnoteDefinitions: new Map(),
    footnoteOrder: []
  };
}

function renderReferencedFootnotes(ctx: PlaintextContext): string {
  return ctx.footnoteOrder
    .map((label, index) => {
      const definitionText = ctx.footnoteDefinitions.get(label);

      return definitionText === undefined ? "" : `Note ${index + 1}: ${definitionText}.`;
    })
    .filter((value) => value.length > 0)
    .join(" ");
}

function getOrderedListPrefix(index: number): string {
  switch (index) {
    case 0:
      return "First, ";
    case 1:
      return "Second, ";
    case 2:
      return "Third, ";
    default:
      return "Next, ";
  }
}

function getUnorderedListSeparator(itemCount: number): string {
  return itemCount <= 3 ? ", " : "; ";
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
