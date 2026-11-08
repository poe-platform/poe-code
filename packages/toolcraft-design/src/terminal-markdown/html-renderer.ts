import type { MdNode } from "./ast.js";
import { highlightCodeBlock } from "./parser/code-highlight.js";

export interface HtmlRenderOptions {
  showFrontmatter?: boolean;
  allowRawHtml?: boolean;
  syntaxHighlight?: boolean;
}

interface FootnoteState {
  definitions: ReadonlyMap<string, Extract<MdNode, { type: "footnoteDefinition" }>>;
  labelsInOrder: string[];
  numbers: Map<string, number>;
}

interface RenderContext {
  showFrontmatter: boolean;
  allowRawHtml: boolean;
  syntaxHighlight: boolean;
  footnotes?: FootnoteState;
}

type TableAlignment = Extract<MdNode, { type: "table" }>["align"][number];

export function renderHtml(ast: MdNode, options: HtmlRenderOptions = {}): string {
  const context: RenderContext = {
    showFrontmatter: options.showFrontmatter ?? false,
    allowRawHtml: options.allowRawHtml ?? false,
    syntaxHighlight: options.syntaxHighlight ?? false,
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
      return context.allowRawHtml ? node.value : escapeHtml(node.value);
    case "thematicBreak":
      return "<hr>";
    case "frontmatter":
      return context.showFrontmatter ? renderFrontmatter(node.data) : "";
    case "footnoteDefinition":
      return "";
    case "text":
    case "strong":
    case "emphasis":
    case "strikethrough":
    case "inlineCode":
    case "link":
    case "image":
    case "break":
    case "footnoteReference":
      return renderInline(node, context);
    default:
      return "children" in node ? renderChildren(node.children, context) : "";
  }
}

function renderRoot(node: Extract<MdNode, { type: "root" }>, context: RenderContext): string {
  const blocks = node.children
    .filter((child) => child.type !== "footnoteDefinition")
    .map((child) => renderNode(child, context))
    .filter((value) => value.length > 0);
  const footnotes = renderReferencedFootnotes(context);

  if (footnotes.length > 0) {
    blocks.push(footnotes);
  }

  return blocks.join("\n");
}

function renderChildren(children: readonly MdNode[], context: RenderContext): string {
  return children
    .map((child) => renderNode(child, context))
    .filter((value) => value.length > 0)
    .join("\n");
}

function renderHeading(node: Extract<MdNode, { type: "heading" }>, context: RenderContext): string {
  const content = renderInlineChildren(node.children, context);
  return content.length === 0 ? "" : `<h${node.depth}>${content}</h${node.depth}>`;
}

function renderParagraph(
  node: Extract<MdNode, { type: "paragraph" }>,
  context: RenderContext
): string {
  const content = renderInlineChildren(node.children, context);
  return content.length === 0 ? "" : `<p>${content}</p>`;
}

function renderBlockquote(
  node: Extract<MdNode, { type: "blockquote" }>,
  context: RenderContext
): string {
  const content = renderChildren(node.children, context);
  return `<blockquote>${content}</blockquote>`;
}

function renderAlert(node: Extract<MdNode, { type: "alert" }>, context: RenderContext): string {
  const content = renderChildren(node.children, context);
  return `<blockquote data-alert="${escapeAttribute(node.kind)}">${content}</blockquote>`;
}

function renderCodeBlock(
  node: Extract<MdNode, { type: "code" }>,
  context: RenderContext
): string {
  const classAttribute =
    node.lang === undefined || node.lang.length === 0
      ? ""
      : ` class="language-${escapeAttribute(node.lang)}"`;
  const tokens = context.syntaxHighlight ? highlightCodeBlock(node) : undefined;
  const content =
    tokens === undefined
      ? escapeHtml(node.value)
      : tokens
          .map((token) =>
            token.kind === "plain"
              ? escapeHtml(token.value)
              : `<span class="tc-token-${escapeAttribute(token.kind)}">${escapeHtml(token.value)}</span>`
          )
          .join("");

  return `<pre><code${classAttribute}>${content}</code></pre>`;
}

function renderList(node: Extract<MdNode, { type: "list" }>, context: RenderContext): string {
  const tag = node.ordered ? "ol" : "ul";
  const startAttribute =
    node.ordered && node.start !== undefined && node.start !== 1
      ? ` start="${escapeAttribute(String(node.start))}"`
      : "";
  const items = node.children
    .map((child) => (child.type === "listItem" ? renderListItem(child, context) : renderNode(child, context)))
    .filter((value) => value.length > 0)
    .join("");

  return items.length === 0 ? "" : `<${tag}${startAttribute}>${items}</${tag}>`;
}

function renderListItem(
  node: Extract<MdNode, { type: "listItem" }>,
  context: RenderContext
): string {
  const renderedChildren = node.children
    .map((child, index) => {
      if (index === 0 && child.type === "paragraph") {
        return renderInlineChildren(child.children, context);
      }

      return renderNode(child, context);
    })
    .filter((value) => value.length > 0);

  const checkbox = renderTaskCheckbox(node);
  return `<li>${checkbox}${renderedChildren.join("")}</li>`;
}

function renderTaskCheckbox(node: Extract<MdNode, { type: "listItem" }>): string {
  if (node.checked === true) {
    return '<input type="checkbox" disabled checked> ';
  }

  if (node.checked === false) {
    return '<input type="checkbox" disabled> ';
  }

  return "";
}

function renderTable(node: Extract<MdNode, { type: "table" }>, context: RenderContext): string {
  const rows = node.children.filter(
    (child): child is Extract<MdNode, { type: "tableRow" }> => child.type === "tableRow"
  );
  const headerRow = rows[0];

  if (headerRow === undefined) {
    return "";
  }

  const header = `<thead>${renderTableRow(headerRow, node.align, "th", context)}</thead>`;
  const bodyRows = rows
    .slice(1)
    .map((row) => renderTableRow(row, node.align, "td", context))
    .join("");
  const body = `<tbody>${bodyRows}</tbody>`;

  return ["<table>", header, body, "</table>"].join("\n");
}

function renderTableRow(
  node: Extract<MdNode, { type: "tableRow" }>,
  alignments: readonly TableAlignment[],
  cellTag: "td" | "th",
  context: RenderContext
): string {
  const cells = node.children
    .map((cell, index) => {
      if (cell.type !== "tableCell") {
        return "";
      }

      const style = renderTableAlignment(alignments[index] ?? null);
      return `<${cellTag}${style}>${renderInlineChildren(cell.children, context)}</${cellTag}>`;
    })
    .join("");

  return `<tr>${cells}</tr>`;
}

function renderTableAlignment(alignment: TableAlignment): string {
  if (alignment === null) {
    return "";
  }

  return ` style="text-align: ${alignment}"`;
}

function renderFrontmatter(data: Record<string, unknown>): string {
  const lines = Object.entries(data).map(([key, value]) => `${key}: ${formatFrontmatterValue(value)}`);

  if (lines.length === 0) {
    return "";
  }

  return `<pre><code class="language-yaml">${escapeHtml(lines.join("\n"))}</code></pre>`;
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

function renderInlineChildren(children: readonly MdNode[], context: RenderContext): string {
  return children.map((child) => renderInline(child, context)).join("");
}

function renderInline(node: MdNode, context: RenderContext): string {
  switch (node.type) {
    case "text":
      return escapeHtml(node.value);
    case "strong":
      return `<strong>${renderInlineChildren(node.children, context)}</strong>`;
    case "emphasis":
      return `<em>${renderInlineChildren(node.children, context)}</em>`;
    case "strikethrough":
      return `<del>${renderInlineChildren(node.children, context)}</del>`;
    case "inlineCode":
      return `<code>${escapeHtml(node.value)}</code>`;
    case "link":
      return renderLink(node, context);
    case "image":
      return renderImage(node);
    case "break":
      return "<br>";
    case "footnoteReference":
      return renderFootnoteReference(node, context);
    case "html":
      return context.allowRawHtml ? node.value : escapeHtml(node.value);
    default:
      return "children" in node ? renderInlineChildren(node.children, context) : renderNode(node, context);
  }
}

function renderLink(node: Extract<MdNode, { type: "link" }>, context: RenderContext): string {
  const href = sanitizeUrl(node.url);
  const attributes = [
    href === null ? "" : ` href="${escapeAttribute(href)}"`,
    node.title === undefined ? "" : ` title="${escapeAttribute(node.title)}"`
  ].join("");

  return `<a${attributes}>${renderInlineChildren(node.children, context)}</a>`;
}

function renderImage(node: Extract<MdNode, { type: "image" }>): string {
  const src = sanitizeUrl(node.url);
  const attributes = [
    src === null ? "" : ` src="${escapeAttribute(src)}"`,
    ` alt="${escapeAttribute(node.alt)}"`,
    node.title === undefined ? "" : ` title="${escapeAttribute(node.title)}"`
  ].join("");

  return `<img${attributes}>`;
}

function renderFootnoteReference(
  node: Extract<MdNode, { type: "footnoteReference" }>,
  context: RenderContext
): string {
  const footnotes = context.footnotes;
  if (footnotes === undefined || !footnotes.definitions.has(node.label)) {
    return "";
  }

  let number = footnotes.numbers.get(node.label);
  if (number === undefined) {
    footnotes.labelsInOrder.push(node.label);
    number = footnotes.labelsInOrder.length;
    footnotes.numbers.set(node.label, number);
  }

  const id = escapeAttribute(createFootnoteId(node.label));
  return `<sup id="fnref-${id}"><a href="#fn-${id}">${number}</a></sup>`;
}

function renderReferencedFootnotes(context: RenderContext): string {
  const footnotes = context.footnotes;
  if (footnotes === undefined || footnotes.labelsInOrder.length === 0) {
    return "";
  }

  const items = footnotes.labelsInOrder
    .map((label) => {
      const definition = footnotes.definitions.get(label);
      if (definition === undefined) {
        return "";
      }

      const id = escapeAttribute(createFootnoteId(label));
      const content = renderChildren(definition.children, context);
      return `<li id="fn-${id}">${content} <a href="#fnref-${id}" aria-label="Back to content">Back</a></li>`;
    })
    .filter((value) => value.length > 0)
    .join("");

  return items.length === 0 ? "" : `<section class="footnotes"><ol>${items}</ol></section>`;
}

function createFootnoteState(children: readonly MdNode[]): FootnoteState {
  const definitions = new Map<string, Extract<MdNode, { type: "footnoteDefinition" }>>();

  for (const child of children) {
    collectFootnoteDefinitions(child, definitions);
  }

  return {
    definitions,
    labelsInOrder: [],
    numbers: new Map()
  };
}

function collectFootnoteDefinitions(
  node: MdNode,
  definitions: Map<string, Extract<MdNode, { type: "footnoteDefinition" }>>
): void {
  if (node.type === "footnoteDefinition") {
    definitions.set(node.label, node);
    return;
  }

  if ("children" in node) {
    for (const child of node.children) {
      collectFootnoteDefinitions(child, definitions);
    }
  }
}

function createFootnoteId(label: string): string {
  return encodeURIComponent(label);
}

function sanitizeUrl(url: string): string | null {
  const trimmed = url.trim();

  if (trimmed.startsWith("//")) {
    return null;
  }

  const scheme = readScheme(trimmed);
  if (scheme === null) {
    return trimmed;
  }

  switch (scheme.toLowerCase()) {
    case "http":
    case "https":
    case "mailto":
    case "tel":
      return trimmed;
    default:
      return null;
  }
}

function readScheme(url: string): string | null {
  let value = "";

  for (let index = 0; index < url.length; index += 1) {
    const char = url[index]!;

    if (char === "/" || char === "?" || char === "#") {
      return null;
    }

    if (char === ":") {
      return value.length === 0 ? null : value;
    }

    if (!isSchemeChar(char, index)) {
      return null;
    }

    value += char;
  }

  return null;
}

function isSchemeChar(char: string, index: number): boolean {
  const code = char.charCodeAt(0);
  const isAlpha = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);

  if (index === 0) {
    return isAlpha;
  }

  return isAlpha || (code >= 48 && code <= 57) || char === "+" || char === "-" || char === ".";
}

function escapeHtml(value: string): string {
  let output = "";

  for (const char of value) {
    switch (char) {
      case "&":
        output += "&amp;";
        break;
      case "<":
        output += "&lt;";
        break;
      case ">":
        output += "&gt;";
        break;
      case '"':
        output += "&quot;";
        break;
      default:
        output += char;
    }
  }

  return output;
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
