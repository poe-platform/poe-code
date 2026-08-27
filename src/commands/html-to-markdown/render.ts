import { Builder, type Budget } from "./budget.js";
import { destination, escapeText } from "./entities.js";
import { blockTags, type HtmlNode } from "./parser.js";

const trim = (text: string): string => text.replace(/^[ \t\r\n\f]+|[ \t\r\n\f]+$/gu, "");
const space = (text: string): string => text.replace(/[ \t\r\n\f]+/gu, " ");

export class Renderer {
  constructor(readonly budget: Budget) {}

  private async raw(node: HtmlNode, maximum: number): Promise<string> {
    const result = new Builder(this.budget, maximum);
    for (const child of node.children) {
      this.budget.work(1); await this.budget.checkpoint();
      if (child.tag === "text") result.append(child.text!);
      else if (child.tag === "br") result.append("\n");
      else result.append(await this.raw(child, maximum));
    }
    return result.finish();
  }

  private async fence(text: string, minimum: number): Promise<string> {
    let longest = 0, current = 0;
    for (let offset = 0; offset < text.length; offset++) {
      this.budget.work(1);
      current = text[offset] === "`" ? current + 1 : 0;
      longest = Math.max(longest, current);
      if (offset % 4096 === 0) await this.budget.checkpoint();
    }
    const size = Math.max(minimum, longest + 1);
    this.budget.check(size, this.budget.limits.maxOutputBytes - this.budget.output, "code fence");
    this.budget.work(size);
    return "`".repeat(size);
  }

  async children(node: HtmlNode, maximum = this.budget.limits.maxOutputBytes - this.budget.output): Promise<string> {
    const result = new Builder(this.budget, maximum);
    for (const child of node.children) {
      this.budget.work(1); await this.budget.checkpoint();
      const block = blockTags.has(child.tag);
      if (block) result.separate();
      let rendered = await this.node(child, maximum);
      if (child.tag === "text" && result.blockBoundary && (!result.empty || node.tag === "root" || blockTags.has(node.tag))) rendered = rendered.replace(/^ +/u, "");
      if (child.tag !== "br" && result.trailingSpace && rendered.startsWith(" ")) rendered = rendered.slice(1);
      result.append(rendered);
      if (block) result.separate();
    }
    return result.finish();
  }

  private async list(node: HtmlNode, maximum: number): Promise<string> {
    const result = new Builder(this.budget, maximum);
    const start = node.attributes.get("start") ?? "1";
    let ordinal = /^\d{1,9}$/u.test(start) ? Math.max(1, Number(start)) : 1;
    for (const child of node.children) {
      this.budget.work(1); await this.budget.checkpoint();
      if (child.tag !== "li") {
        const extra = trim(await this.node(child, maximum));
        if (extra) { result.append(extra); result.append("\n"); }
        continue;
      }
      const content = trim(await this.children(child, maximum));
      const marker = node.tag === "ol" ? `${ordinal++}. ` : "- ";
      this.budget.check(marker.length, maximum, "list indentation");
      const parts = content.split("\n");
      result.append(marker); result.append(parts[0] ?? "");
      for (const part of parts.slice(1)) {
        result.append("\n");
        if (part) { result.append(" ".repeat(marker.length)); result.append(part); }
      }
      result.append("\n");
    }
    return result.finish().replace(/\n$/u, "");
  }

  private async table(node: HtmlNode, maximum: number): Promise<string> {
    const rows: HtmlNode[][] = [];
    const extra = new Builder(this.budget, maximum);
    const visit = async (entry: HtmlNode): Promise<void> => {
      this.budget.work(1); await this.budget.checkpoint();
      if (entry.tag === "tr") {
        const cells: HtmlNode[] = [];
        for (const child of entry.children) {
          if (child.tag === "td" || child.tag === "th") { this.budget.add("cells"); cells.push(child); }
          else {
            const text = trim(await this.node(child, maximum));
            if (text) { extra.append(text); extra.append(" "); }
          }
        }
        if (cells.length) rows.push(cells);
      } else if (entry.tag === "text") extra.append(escapeText(space(entry.text!), this.budget, maximum));
      else for (const child of entry.children) await visit(child);
    };
    await visit(node);
    const result = new Builder(this.budget, maximum);
    const loose = trim(extra.finish());
    if (loose) { result.append(loose); result.separate(); }
    if (!rows.length) return result.finish();
    const width = rows.reduce((largest, row) => Math.max(largest, row.length), 0);
    const header = rows[0]!.some(cell => cell.tag === "th");
    const renderRow = async (row: readonly HtmlNode[]): Promise<void> => {
      this.budget.add("cells", width - row.length);
      result.append("| ");
      for (let index = 0; index < width; index++) {
        if (index) result.append(" | ");
        const cell = row[index];
        if (!cell) continue;
        const content = trim(space(await this.children(cell, Math.min(maximum, this.budget.limits.maxTableCellBytes))));
        const escaped = new Builder(this.budget, this.budget.limits.maxTableCellBytes);
        let backslashes = 0;
        for (const character of content) {
          this.budget.work(1);
          escaped.append(character === "|" && backslashes % 2 === 0 ? "\\|" : character);
          backslashes = character === "\\" ? backslashes + 1 : 0;
        }
        result.append(escaped.finish());
      }
      result.append(" |\n");
    };
    if (header) await renderRow(rows[0]!); else await renderRow([]);
    result.append("|");
    for (let index = 0; index < width; index++) { this.budget.work(1); result.append(" --- |"); }
    result.append("\n");
    for (const row of rows.slice(header ? 1 : 0)) await renderRow(row);
    return result.finish().replace(/\n$/u, "");
  }

  private async node(node: HtmlNode, maximum: number): Promise<string> {
    if (node.tag === "text") return escapeText(space(node.text!), this.budget, maximum);
    if (node.tag === "br") return "  \n";
    if (node.tag === "hr") return "---";
    if (node.tag === "pre" || node.tag === "code") {
      const raw = (await this.raw(node, maximum)).replace(/\r\n?/gu, "\n");
      const result = new Builder(this.budget, maximum);
      if (node.tag === "pre") {
        const fence = await this.fence(raw, 3);
        const code = node.children.find(child => child.tag === "code");
        const language = /(?:^|\s)language-([A-Za-z0-9_+-]{1,32})(?:\s|$)/u.exec(code?.attributes.get("class") ?? "")?.[1] ?? "";
        result.append(fence); result.append(language); result.append("\n"); result.append(raw);
        if (!raw.endsWith("\n")) result.append("\n");
        result.append(fence);
      } else {
        const inline = raw.replaceAll("\n", " ");
        if (!inline) return "";
        const fence = await this.fence(inline, 1);
        const pad = inline.startsWith("`") || inline.endsWith("`") || /^ .* $/su.test(inline) && /[^ ]/u.test(inline);
        result.append(fence); if (pad) result.append(" "); result.append(inline); if (pad) result.append(" "); result.append(fence);
      }
      return result.finish();
    }
    if (node.tag === "ul" || node.tag === "ol") return this.list(node, maximum);
    if (node.tag === "table") return this.table(node, maximum);
    const content = await this.children(node, maximum);
    const result = new Builder(this.budget, maximum);
    if (/^h[1-6]$/u.test(node.tag)) {
      result.append("#".repeat(Number(node.tag[1]))); result.append(" "); result.append(trim(space(content)));
    } else if (node.tag === "em" || node.tag === "i" || node.tag === "strong" || node.tag === "b" || node.tag === "del" || node.tag === "s") {
      const marker = node.tag === "em" || node.tag === "i" ? "*" : node.tag === "del" || node.tag === "s" ? "~~" : "**";
      const trimmed = trim(content);
      if (!trimmed || content.includes("\n\n")) return content;
      if (/^[ \t\r\n]/u.test(content)) result.append(" ");
      result.append(marker); result.append(trimmed); result.append(marker);
      if (/[ \t\r\n]$/u.test(content)) result.append(" ");
    } else if (node.tag === "a" || node.tag === "img") {
      const image = node.tag === "img";
      const label = image ? escapeText(space(node.attributes.get("alt") ?? ""), this.budget, maximum) : trim(content);
      const url = destination(node.attributes.get(image ? "src" : "href"), image, this.budget);
      if (!url) return image ? label : content;
      if (!image && /^[ \t\r\n]/u.test(content)) result.append(" ");
      result.append(image ? "![" : "["); result.append(label); result.append("](<"); result.append(url); result.append(">)");
      if (!image && /[ \t\r\n]$/u.test(content)) result.append(" ");
    } else if (node.tag === "blockquote") {
      const parts = trim(content).split("\n");
      for (let index = 0; index < parts.length; index++) {
        if (index) result.append("\n");
        result.append(parts[index] ? "> " : ">"); result.append(parts[index]!);
      }
    } else result.append(content);
    return result.finish();
  }

  async document(root: HtmlNode): Promise<string> {
    const output = trim(await this.children(root));
    if (!output) return "";
    const result = new Builder(this.budget);
    result.append(output); result.append("\n");
    return result.finish();
  }
}
