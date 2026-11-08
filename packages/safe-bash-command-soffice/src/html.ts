import { parse, type DefaultTreeAdapterMap } from "parse5";

type Node = DefaultTreeAdapterMap["node"];

export interface DocBlock {
  kind: "heading" | "paragraph" | "table" | "image";
  text?: string;
  preformatted?: boolean;
  rows?: string[][];
  imageBytes?: Uint8Array;
  width?: number;
  height?: number;
}

const hidden = new Set(["head", "script", "style", "template"]);
const boundaries = new Set(["p", "div", "section", "article", "header", "footer", "main", "aside", "blockquote", "li", "ul", "ol", "pre", "dl", "dt", "dd", "h1", "h2", "h3", "h4", "h5", "h6"]);
const headings = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/** HTML5 parsing repairs optional closing tags and decodes named/numeric entities. */
export function parseHtmlBlocks(source: string): DocBlock[] {
  const blocks: DocBlock[] = [];
  let text = "";
  let kind: "heading" | "paragraph" = "paragraph";
  const lists: { next: number | undefined }[] = [];
  let marker = "";
  let preformatted = false;
  const tables: { rows: string[][]; row: string[]; cell: string | undefined }[] = [];
  const flush = () => {
    const value = preformatted ? text : text.split("\n").map(line => line.replace(/[\t\r\f ]+/g, " ").trim()).join("\n");
    if (value) {
      blocks.push(preformatted ? { kind, text: marker + value, preformatted: true } : { kind, text: marker + value });
      marker = "";
    }
    text = "";
  };
  const append = (value: string) => {
    const table = tables.at(-1);
    if (table) {
      if (table.cell !== undefined) table.cell += value;
    } else text += value;
  };
  const stack: { node: Node; exit?: boolean }[] = [{ node: parse(source) }];
  while (stack.length) {
    const { node, exit } = stack.pop()!;
    if ("value" in node && node.nodeName === "#text") {
      append(preformatted ? node.value : node.value.replace(/[\t\n\r\f ]+/g, " "));
      continue;
    }
    const tag = "tagName" in node ? node.tagName : "";
    if (hidden.has(tag)) continue;
    if (tag === "table") {
      if (exit) {
        const table = tables.pop()!;
        if (tables.length) append(table.rows.map(row => row.join(" ")).join(" "));
        else blocks.push({ kind: "table", rows: table.rows });
      } else {
        if (!tables.length) flush();
        tables.push({ rows: [], row: [], cell: undefined });
      }
    } else if (tables.length) {
      const table = tables.at(-1)!;
      if (tag === "tr") {
        if (exit) table.rows.push(table.row);
        else table.row = [];
      } else if (tag === "td" || tag === "th") {
        if (exit) {
          table.row.push((table.cell ?? "").replace(/[\t\n\r\f ]+/g, " ").trim());
          table.cell = undefined;
        } else table.cell = "";
      } else if (boundaries.has(tag) || tag === "br") append(" ");
    } else if (tag === "pre") {
      flush();
      preformatted = !exit;
      kind = "paragraph";
    } else if (preformatted) {
      if (tag === "br" && !exit) append("\n");
    } else if (boundaries.has(tag)) {
      flush();
      kind = !exit && headings.has(tag) ? "heading" : "paragraph";
      if (tag === "ul" || tag === "ol") {
        if (exit) lists.pop();
        else lists.push({ next: tag === "ol" ? 1 : undefined });
      } else if (tag === "li") {
        const list = lists.at(-1);
        marker = exit || !list ? "" : list.next === undefined ? "• " : `${list.next++}. `;
      }
    } else if (tag === "br" && !exit) append("\n");
    if (!exit && "childNodes" in node) {
      stack.push({ node, exit: true });
      for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push({ node: node.childNodes[i]! });
    }
  }
  flush();
  return blocks;
}

export function escapeHtmlText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
