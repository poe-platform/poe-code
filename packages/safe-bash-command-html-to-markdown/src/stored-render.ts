import { destination } from "./entities.js";
import type { Budget } from "./budget.js";
import { blockTags } from "./parser.js";
import { htmlSpace } from "./text.js";
import { StoredBuilder } from "./stored-builder.js";
import type { StoredTree, StoredNode } from "./stored-tree.js";

const format = (tag: string): string | undefined => tag === "em" || tag === "i" ? "em" : tag === "strong" || tag === "b" ? "strong" : tag === "del" || tag === "s" ? "del" : undefined;
const atoms = new Set(["a", "img", "code", "br"]);

export class StoredRenderer {
  private readonly text;
  constructor(private readonly tree: StoredTree, private readonly budget: Budget) { this.text = tree.text; }
  private builder(maximum?: number): StoredBuilder { return new StoredBuilder(this.text, this.budget, maximum); }
  private async work(): Promise<void> { this.budget.work(1); await this.budget.checkpoint(); }

  // URL validation still uses the existing URL policy while its streaming
  // attribute validator is migrated. Body text never passes through this path.
  private async attribute(root: number): Promise<string> {
    let result = "";
    for await (const chunk of this.text.chunks(root)) result += chunk;
    return result;
  }

  private async url(node: StoredNode): Promise<number> {
    if (node.destination !== -1) return node.destination;
    const value = node.tag === "img" ? node.src : node.href;
    const url = value ? await destination(await this.attribute(value), node.tag === "img", this.budget) : undefined;
    const root = url ? await this.text.from(url) : 0;
    await this.tree.patch(node.id, { destination: root });
    return root;
  }

  private async onlyWhitespace(parent: number): Promise<boolean> {
    for await (const child of this.tree.children(parent)) {
      const node = await this.tree.read(child);
      if (node.tag !== "text") return false;
      for await (const character of this.text.characters(node.text)) if (!htmlSpace(character)) return false;
    }
    return true;
  }

  private async hasRawContent(parent: number): Promise<boolean> {
    for await (const child of this.tree.children(parent)) {
      await this.work();
      const node = await this.tree.read(child);
      if (node.tag === "text" ? Boolean(node.text) : node.tag === "br" || await this.hasRawContent(child)) return true;
    }
    return false;
  }

  private async normalized(id: number): Promise<number> {
    const node = await this.tree.read(id);
    if (node.normalized) return node.normalized;
    const result = await this.tree.create(node.tag, { ...node, first: 0, last: 0, normalized: 0 });
    const append = async (target: number, child: number): Promise<void> => {
      await this.work();
      const entry = await this.tree.read(child), style = format(entry.tag);
      const last = (await this.tree.children(target, true).next()).value as number | undefined;
      if (style && last && format((await this.tree.read(last)).tag) === style) {
        for await (const nested of this.tree.children(child)) await append(last, nested);
      } else await this.tree.append(target, style ? await this.tree.copy(entry) : child);
    };
    const visit = async (id: number): Promise<void> => {
      await this.work();
      const child = await this.tree.read(id);
      if (child.tag === "text" && !child.text) return;
      if (child.tag === "code" && !await this.hasRawContent(id)) return;
      if (child.tag === "a" || child.tag === "img") {
        if (!await this.url(child)) {
          if (child.tag === "a") for await (const nested of this.tree.children(id)) await visit(nested);
          else if (child.alt) await append(result, await this.tree.create("text", { text: child.alt }));
          return;
        }
      }
      const style = format(child.tag);
      if (child.tag !== "text" && !blockTags.has(child.tag) && !atoms.has(child.tag)) {
        if (!style || style === format(node.tag)) {
          for await (const nested of this.tree.children(id)) await visit(nested);
          return;
        }
        const children = await this.normalized(id);
        if (!(await this.tree.read(children)).first) return;
        if (await this.onlyWhitespace(children)) {
          for await (const nested of this.tree.children(children)) await append(result, nested);
        } else {
          const copy = await this.tree.copy(await this.tree.read(children));
          await this.tree.patch(copy, { normalized: copy });
          await append(result, copy);
        }
      } else await append(result, id);
    };
    for await (const child of this.tree.children(id)) await visit(child);
    await this.tree.patch(id, { normalized: result });
    return result;
  }

  private async punctuationBoundary(id: number | undefined, ending: boolean): Promise<boolean> {
    if (!id || !format((await this.tree.read(id)).tag)) return false;
    const edge = async (parent: number): Promise<string | undefined> => {
      for await (const child of this.tree.children(parent, ending)) {
        await this.work();
        const node = await this.tree.read(child);
        if (node.tag === "text") {
          if (node.text) {
            const length = (await this.text.info(node.text)).length;
            const root = await this.text.slice(node.text, ending ? Math.max(0, length - 2) : 0, ending ? length : 2);
            let text = "";
            for await (const chunk of this.text.chunks(root)) text += chunk;
            return ending ? Array.from(text).at(-1) : String.fromCodePoint(text.codePointAt(0)!);
          }
        } else if (node.tag === "br" || blockTags.has(node.tag)) return " ";
        else if (format(node.tag) || atoms.has(node.tag)) return "*";
        else { const nested = await edge(child); if (nested !== undefined) return nested; }
      }
      return undefined;
    };
    const character = await edge(id);
    return character !== undefined && /[\p{P}\p{S}]/u.test(character);
  }

  private async escape(root: number, maximum: number, edges: readonly [boolean, boolean] = [false, false], digit = false): Promise<number> {
    const output = this.builder(maximum), length = (await this.text.info(root)).length;
    let offset = 0, pending = "";
    for await (const chunk of this.text.chunks(root)) {
      for (const character of chunk) {
        this.budget.work(1);
        const scalar = character.codePointAt(0)!;
        if (scalar < 32 && character !== "\n" && character !== "\t" && character !== "\r" || scalar >= 0x7f && scalar <= 0x9f) pending += "\ufffd";
        else if ((edges[0] && offset === 0 || edges[1] && offset + character.length === length) && !htmlSpace(character)) pending += `&#${scalar};`;
        else pending += "\\`*_{}[]<>!|#+-&~=".includes(character) || ".)".includes(character) && digit ? "\\" + character : character;
        digit = character >= "0" && character <= "9";
        offset += character.length;
        if (pending.length >= 2048) { await output.write(pending); pending = ""; }
      }
      const checkpoint = this.budget.checkpoint(); if (checkpoint) await checkpoint;
    }
    await output.write(pending);
    return output.finish();
  }

  async children(id: number, maximum = this.budget.limits.maxOutputBytes - this.budget.output): Promise<number> {
    const node = await this.tree.read(id), normalized = await this.normalized(id), result = this.builder(maximum);
    const iterator = this.tree.children(normalized)[Symbol.asyncIterator]();
    let beforePrevious: StoredNode | undefined, previous: StoredNode | undefined;
    const window: StoredNode[] = [];
    for (let index = 0; index < 3; index++) {
      const next = await iterator.next();
      if (!next.done) window.push(await this.tree.read(next.value));
    }
    while (window.length) {
      const child = window[0]!, following = window[1];
      await this.work();
      const alternate = format(node.tag) === "em" || format(previous?.tag ?? "") === "em" || format(following?.tag ?? "") === "em";
      const preceding = previous?.tag === "text" ? await this.text.at(previous.text, -1) : undefined;
      const previousAlternate = format(node.tag) === "em" || format(child.tag) === "em" || format(beforePrevious?.tag ?? "") === "em";
      const nextAlternate = format(node.tag) === "em" || format(child.tag) === "em" || format(window[2]?.tag ?? "") === "em";
      const edges: readonly [boolean, boolean] = [
        format(previous?.tag ?? "") === "strong" && previousAlternate || await this.punctuationBoundary(previous?.id, true),
        format(following?.tag ?? "") === "strong" && nextAlternate || await this.punctuationBoundary(following?.id, false),
      ];
      const block = blockTags.has(child.tag);
      if (block) await result.separate();
      let rendered = await this.node(child, maximum, edges, alternate, preceding !== undefined && preceding >= "0" && preceding <= "9");
      if (child.tag === "text" && result.blockBoundary && (!result.empty || node.tag === "root" || blockTags.has(node.tag)) && await this.text.at(rendered, 0) === " ") rendered = await this.text.slice(rendered, 1);
      if (child.tag !== "br" && result.trailingSpace && await this.text.at(rendered, 0) === " ") rendered = await this.text.slice(rendered, 1);
      await result.append(rendered);
      if (block) await result.separate();
      beforePrevious = previous; previous = child; window.shift();
      const next = await iterator.next();
      if (!next.done) window.push(await this.tree.read(next.value));
    }
    return result.finish();
  }

  private async raw(id: number, maximum: number): Promise<number> {
    const result = this.builder(maximum);
    for await (const child of this.tree.children(id)) {
      await this.work();
      const node = await this.tree.read(child);
      if (node.tag === "text") await result.append(node.text);
      else if (node.tag === "br") await result.write("\n");
      else await result.append(await this.raw(child, maximum));
    }
    return result.finish();
  }

  private async fence(root: number, minimum: number): Promise<number> {
    let longest = 0, current = 0;
    for await (const character of this.text.characters(root)) { await this.work(); current = character === "`" ? current + 1 : 0; longest = Math.max(longest, current); }
    const size = Math.max(minimum, longest + 1);
    this.budget.check(size, this.budget.limits.maxOutputBytes - this.budget.output, "code fence");
    return this.text.repeat(await this.text.from("`"), size);
  }

  private async language(root: number): Promise<string> {
    let token = "";
    for await (const character of this.text.characters(await this.text.concat(root, await this.text.from(" ")))) {
      if (/\s/u.test(character)) {
        const match = /^language-([A-Za-z0-9_+-]{1,32})$/u.exec(token);
        if (match) return match[1]!;
        token = "";
      } else if (token.length < 42) token += character;
    }
    return "";
  }

  private async indented(root: number, prefix: string, firstPrefix: string, maximum: number): Promise<number> {
    const result = this.builder(maximum);
    await result.write(firstPrefix);
    let lineStart = false;
    for await (const character of this.text.characters(root)) {
      if (lineStart && character !== "\n") await result.write(prefix);
      if (lineStart && character === "\n" && prefix === "> ") await result.write(">");
      await result.write(character);
      lineStart = character === "\n";
    }
    return result.finish();
  }

  private async list(node: StoredNode, maximum: number): Promise<number> {
    const result = this.builder(maximum), start = (await this.text.info(node.start)).length <= 9 ? await this.attribute(node.start) : "";
    let ordinal = /^\d{1,9}$/u.test(start) ? Math.max(1, Number(start)) : 1;
    for await (const id of this.tree.children(node.id)) {
      await this.work();
      const child = await this.tree.read(id);
      if (child.tag !== "li") {
        const extra = await this.text.trim(await this.node(child, maximum));
        if (extra) { await result.append(extra); await result.write("\n"); }
      } else {
        const content = await this.text.trim(await this.children(id, maximum)), marker = node.tag === "ol" ? `${ordinal++}. ` : "- ";
        this.budget.check(marker.length, maximum, "list indentation");
        await result.append(await this.indented(content, " ".repeat(marker.length), marker, maximum));
        await result.write("\n");
      }
    }
    const root = await result.finish();
    return await this.text.at(root, -1) === "\n" ? this.text.slice(root, 0, (await this.text.info(root)).length - 1) : root;
  }

  private async *rows(id: number): AsyncGenerator<number> {
    const node = await this.tree.read(id);
    if (node.tag === "tr" || node.tag === "text") yield id;
    else for await (const child of this.tree.children(id)) yield* this.rows(child);
  }

  private async table(node: StoredNode, maximum: number): Promise<number> {
    const extra = this.builder(maximum), result = this.builder(maximum);
    let width = 0, first = 0, header = false;
    for await (const id of this.rows(node.id)) {
      await this.work();
      const row = await this.tree.read(id);
      if (row.tag === "text") { await extra.append(await this.escape(await this.text.normalize(row.text, "space"), maximum)); continue; }
      let cells = 0, heading = false;
      for await (const child of this.tree.children(id)) {
        const entry = await this.tree.read(child);
        if (entry.tag === "td" || entry.tag === "th") { cells++; this.budget.add("cells"); heading ||= entry.tag === "th"; }
        else { const text = await this.text.trim(await this.node(entry, maximum)); if (text) { await extra.append(text); await extra.write(" "); } }
      }
      if (cells && !first) { first = id; header = heading; }
      width = Math.max(width, cells);
    }
    const loose = await this.text.trim(await extra.finish());
    if (loose) { await result.append(loose); await result.separate(); }
    if (!first) return result.finish();
    const renderRow = async (row: number): Promise<void> => {
      await result.write("| ");
      let index = 0;
      if (row) for await (const child of this.tree.children(row)) {
        const cell = await this.tree.read(child);
        if (cell.tag !== "td" && cell.tag !== "th") continue;
        if (index++) await result.write(" | ");
        const content = await this.text.trim(await this.text.normalize(await this.children(child, Math.min(maximum, this.budget.limits.maxTableCellBytes)), "space"));
        const escaped = this.builder(this.budget.limits.maxTableCellBytes);
        let backslashes = 0;
        for await (const character of this.text.characters(content)) {
          await escaped.write(character === "|" && backslashes % 2 === 0 ? "\\|" : character);
          backslashes = character === "\\" ? backslashes + 1 : 0;
        }
        await result.append(await escaped.finish());
      }
      this.budget.add("cells", width - index);
      for (; index < width; index++) if (index) await result.write(" | ");
      await result.write(" |\n");
    };
    await renderRow(header ? first : 0);
    await result.write("|");
    for (let index = 0; index < width; index++) { await this.work(); await result.write(" --- |"); }
    await result.write("\n");
    for await (const id of this.rows(node.id)) {
      if (id === first && header) continue;
      const row = await this.tree.read(id);
      if (row.tag !== "tr") continue;
      let cells = false;
      for await (const child of this.tree.children(id)) { const tag = (await this.tree.read(child)).tag; if (tag === "td" || tag === "th") { cells = true; break; } }
      if (cells) await renderRow(id);
    }
    const root = await result.finish();
    return this.text.slice(root, 0, (await this.text.info(root)).length - 1);
  }

  private async node(node: StoredNode, maximum: number, edges: readonly [boolean, boolean] = [false, false], alternateStrong = false, precedingDigit = false): Promise<number> {
    if (node.tag === "text") return this.escape(await this.text.normalize(node.text, "space"), maximum, edges, precedingDigit);
    if (node.tag === "br") return this.text.from("  \n");
    if (node.tag === "hr") return this.text.from("---");
    const result = this.builder(maximum);
    if (node.tag === "pre" || node.tag === "code") {
      const raw = await this.text.normalize(await this.raw(node.id, maximum), "lines");
      if (node.tag === "pre") {
        const fence = await this.fence(raw, 3);
        let language = "";
        for await (const child of this.tree.children(node.id)) { const code = await this.tree.read(child); if (code.tag === "code") { language = await this.language(code.className); break; } }
        await result.append(fence); await result.write(language); await result.write("\n"); await result.append(raw);
        if (await this.text.at(raw, -1) !== "\n") await result.write("\n");
        await result.append(fence);
      } else {
        const inline = await this.text.normalize(raw, "inline");
        if (!inline) return 0;
        const fence = await this.fence(inline, 1), first = await this.text.at(inline, 0), last = await this.text.at(inline, -1);
        let nonSpace = false;
        for await (const character of this.text.characters(inline)) if (character !== " ") { nonSpace = true; break; }
        const pad = first === "`" || last === "`" || first === " " && last === " " && nonSpace;
        await result.append(fence); if (pad) await result.write(" "); await result.append(inline); if (pad) await result.write(" "); await result.append(fence);
      }
      return result.finish();
    }
    if (node.tag === "ul" || node.tag === "ol") return this.list(node, maximum);
    if (node.tag === "table") return this.table(node, maximum);
    const content = await this.children(node.id, maximum);
    if (/^h[1-6]$/u.test(node.tag)) {
      await result.write("#".repeat(Number(node.tag[1])) + " "); await result.append(await this.text.trim(await this.text.normalize(content, "space")));
    } else if (format(node.tag)) {
      const trimmed = await this.text.trim(content);
      const marker = format(node.tag) === "em" ? "*" : format(node.tag) === "del" ? "~~" : alternateStrong && trimmed === content ? "__" : "**";
      if (!trimmed || await this.text.includes(content, "\n\n")) return content;
      if (htmlSpace(await this.text.at(content, 0))) await result.write(" ");
      await result.write(marker); await result.append(trimmed); await result.write(marker);
      if (htmlSpace(await this.text.at(content, -1))) await result.write(" ");
    } else if (node.tag === "a" || node.tag === "img") {
      const image = node.tag === "img", label = image ? await this.escape(await this.text.normalize(node.alt, "space"), maximum) : await this.text.trim(content), url = await this.url(node);
      if (!url) return image ? label : content;
      if (!image && htmlSpace(await this.text.at(content, 0))) await result.write(" ");
      await result.write(image ? "![" : "["); await result.append(label); await result.write("](<"); await result.append(url); await result.write(">)");
      if (!image && htmlSpace(await this.text.at(content, -1))) await result.write(" ");
    } else if (node.tag === "blockquote") {
      const trimmed = await this.text.trim(content);
      return this.indented(trimmed, "> ", trimmed ? "> " : ">", maximum);
    } else await result.append(content);
    return result.finish();
  }

  async document(root: number): Promise<number> {
    const output = await this.text.trim(await this.children(root));
    if (!output) return 0;
    const result = this.builder(); await result.append(output); await result.write("\n");
    return result.finish();
  }
}
