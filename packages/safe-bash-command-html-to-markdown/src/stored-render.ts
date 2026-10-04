import { destination } from "./entities.js";
import type { Budget } from "./budget.js";
import { blockTags } from "./parser.js";
import { htmlSpace } from "./text.js";
import { StoredBuilder } from "./stored-builder.js";
import type { StoredTree, StoredNode } from "./stored-tree.js";

const format = (tag: string): string | undefined => tag === "em" || tag === "i" ? "em" : tag === "strong" || tag === "b" ? "strong" : tag === "del" || tag === "s" ? "del" : undefined;
const atoms = new Set(["a", "img", "code", "br"]);

enum RenderTask { children, childNext, childDone, node, formatted, listNext, listDone, tableRowScan, tableCellScan, tableExtra, tableOutput, tableCell, tableCellDone }
const frameFields = ["kind", "id", "maximum", "entry", "result", "rows", "rowCursor", "width", "cells", "first", "header", "flags", "ordinal", "phase"] as const;
type RenderFrame = Record<typeof frameFields[number], number>;

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
    for await (const node of this.tree.walk(parent, node => node.tag !== "text" && node.tag !== "br")) {
      await this.work();
      if (node.tag === "text" ? Boolean(node.text) : node.tag === "br") return true;
    }
    return false;
  }

  private async normalized(id: number): Promise<number> {
    // Normalize, finalize, visit, append and resume-style jobs replace recursive
    // calls. Each job contains only node offsets; pending jobs use caller storage.
    const pending = this.tree.stack(4);
    const normalize = 0, finalize = 1, visit = 2, append = 3, styleReady = 4;
    const children = async (kind: number, parent: number, target: number, owner: number): Promise<void> => {
      for await (const child of this.tree.children(parent, true)) { await this.work(); await pending.push(kind, child, target, owner); }
    };
    await pending.push(normalize, id, 0, 0);
    for (let job = await pending.pop(); job; job = await pending.pop()) {
      await this.work();
      const [kind, source, target, owner] = job as [number, number, number, number];
      const node = await this.tree.read(source);
      if (kind === normalize) {
        if (node.normalized) continue;
        const result = await this.tree.create(node.tag, { ...node, first: 0, last: 0, normalized: 0 });
        await pending.push(finalize, source, result, 0);
        await children(visit, source, result, source);
      } else if (kind === finalize) await this.tree.patch(source, { normalized: target });
      else if (kind === append) {
        const style = format(node.tag);
        let last: number | undefined;
        for await (const child of this.tree.children(target, true)) { last = child; break; }
        if (style && last && format((await this.tree.read(last)).tag) === style) await children(append, source, last, 0);
        else await this.tree.append(target, style ? await this.tree.copy(node) : source);
      } else if (kind === styleReady) {
        const normalized = node.normalized;
        if (!(await this.tree.read(normalized)).first) continue;
        if (await this.onlyWhitespace(normalized)) await children(append, normalized, target, 0);
        else {
          const copy = await this.tree.copy(await this.tree.read(normalized));
          await this.tree.patch(copy, { normalized: copy });
          await pending.push(append, copy, target, 0);
        }
      } else {
        if (node.tag === "text" && !node.text) continue;
        if (node.tag === "code" && !await this.hasRawContent(source)) continue;
        if (node.tag === "a" || node.tag === "img") {
          if (!await this.url(node)) {
            if (node.tag === "a") await children(visit, source, target, owner);
            else if (node.alt) await pending.push(append, await this.tree.create("text", { text: node.alt }), target, 0);
            continue;
          }
        }
        const style = format(node.tag);
        if (node.tag !== "text" && !blockTags.has(node.tag) && !atoms.has(node.tag)) {
          if (!style || style === format((await this.tree.read(owner)).tag)) await children(visit, source, target, owner);
          else {
            await pending.push(styleReady, source, target, 0);
            await pending.push(normalize, source, 0, 0);
          }
        } else await pending.push(append, source, target, 0);
      }
    }
    return (await this.tree.read(id)).normalized;
  }

  private async punctuationBoundary(id: number | undefined, ending: boolean): Promise<boolean> {
    if (!id || !format((await this.tree.read(id)).tag)) return false;
    for await (const node of this.tree.walk(id, node => node.tag !== "text" && node.tag !== "br" && !blockTags.has(node.tag) && !format(node.tag) && !atoms.has(node.tag), ending)) {
      await this.work();
      if (node.tag === "text") {
        if (!node.text) continue;
        const length = (await this.text.info(node.text)).length;
        const root = await this.text.slice(node.text, ending ? Math.max(0, length - 2) : 0, ending ? length : 2);
        let text = "";
        for await (const chunk of this.text.chunks(root)) text += chunk;
        const character = ending ? Array.from(text).at(-1)! : String.fromCodePoint(text.codePointAt(0)!);
        return /[\p{P}\p{S}]/u.test(character);
      }
      if (node.tag === "br" || blockTags.has(node.tag)) return false;
      if (format(node.tag) || atoms.has(node.tag)) return true;
    }
    return false;
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
    const pending = this.tree.stack(frameFields.length);
    const push = (frame: Partial<RenderFrame>): Promise<void> => pending.push(...frameFields.map(key => frame[key] ?? 0));
    const resume = async (frame: RenderFrame): Promise<StoredBuilder> => {
      const result = this.builder(frame.maximum); await result.restore(frame.result); return result;
    };
    const sibling = async (entry: number): Promise<StoredNode | undefined> => entry ? this.tree.read((await this.tree.entry(entry)).child) : undefined;
    let value = 0;
    await push({ kind: RenderTask.children, id, maximum });
    for (let record = await pending.pop(); record; record = await pending.pop()) {
      await this.work();
      const frame = Object.fromEntries(frameFields.map((key, index) => [key, record![index]!])) as RenderFrame;
      const { kind, maximum } = frame;
      if (kind === RenderTask.children) {
        const normalized = await this.normalized(frame.id);
        await push({ ...frame, kind: RenderTask.childNext, entry: (await this.tree.read(normalized)).first });
      } else if (kind === RenderTask.childNext) {
        const result = await resume(frame);
        if (!frame.entry) { value = await result.finish(); continue; }
        const entry = await this.tree.entry(frame.entry), child = await this.tree.read(entry.child), owner = await this.tree.read(frame.id);
        const previous = await sibling(entry.previous), following = await sibling(entry.next);
        const beforePrevious = entry.previous ? await sibling((await this.tree.entry(entry.previous)).previous) : undefined;
        const afterFollowing = entry.next ? await sibling((await this.tree.entry(entry.next)).next) : undefined;
        const alternate = format(owner.tag) === "em" || format(previous?.tag ?? "") === "em" || format(following?.tag ?? "") === "em";
        const preceding = previous?.tag === "text" ? await this.text.at(previous.text, -1) : undefined;
        const previousAlternate = format(owner.tag) === "em" || format(child.tag) === "em" || format(beforePrevious?.tag ?? "") === "em";
        const nextAlternate = format(owner.tag) === "em" || format(child.tag) === "em" || format(afterFollowing?.tag ?? "") === "em";
        const left = format(previous?.tag ?? "") === "strong" && previousAlternate || await this.punctuationBoundary(previous?.id, true);
        const right = format(following?.tag ?? "") === "strong" && nextAlternate || await this.punctuationBoundary(following?.id, false);
        if (blockTags.has(child.tag)) await result.separate();
        await push({ ...frame, kind: RenderTask.childDone, result: await result.snapshot() });
        await push({ kind: RenderTask.node, id: child.id, maximum, flags: Number(left) + 2 * Number(right) + 4 * Number(alternate) + 8 * Number(preceding !== undefined && preceding >= "0" && preceding <= "9") });
      } else if (kind === RenderTask.childDone) {
        const result = await resume(frame), entry = await this.tree.entry(frame.entry), child = await this.tree.read(entry.child), owner = await this.tree.read(frame.id);
        if (child.tag === "text" && result.blockBoundary && (!result.empty || owner.tag === "root" || blockTags.has(owner.tag)) && await this.text.at(value, 0) === " ") value = await this.text.slice(value, 1);
        if (child.tag !== "br" && result.trailingSpace && await this.text.at(value, 0) === " ") value = await this.text.slice(value, 1);
        await result.append(value);
        if (blockTags.has(child.tag)) await result.separate();
        await push({ ...frame, kind: RenderTask.childNext, entry: entry.next, result: await result.snapshot() });
      } else if (kind === RenderTask.node) {
        const node = await this.tree.read(frame.id);
        if (["text", "br", "hr", "pre", "code"].includes(node.tag)) value = await this.formatted(node, maximum, 0, frame.flags);
        else if (node.tag === "ul" || node.tag === "ol") {
          const start = (await this.text.info(node.start)).length <= 9 ? await this.attribute(node.start) : "";
          await push({ ...frame, kind: RenderTask.listNext, entry: node.first, ordinal: /^\d{1,9}$/u.test(start) ? Math.max(1, Number(start)) : 1 });
        } else if (node.tag === "table") {
          const rows = await this.tree.create("root");
          for await (const row of this.rows(node.id)) await this.tree.append(rows, row);
          await push({ ...frame, kind: RenderTask.tableRowScan, rows, rowCursor: (await this.tree.read(rows)).first });
        } else {
          await push({ ...frame, kind: RenderTask.formatted });
          await push({ kind: RenderTask.children, id: frame.id, maximum });
        }
      } else if (kind === RenderTask.formatted) value = await this.formatted(await this.tree.read(frame.id), maximum, value, frame.flags);
      else if (kind === RenderTask.listNext) {
        const result = await resume(frame);
        if (!frame.entry) {
          const root = await result.finish();
          value = await this.text.at(root, -1) === "\n" ? await this.text.slice(root, 0, (await this.text.info(root)).length - 1) : root;
          continue;
        }
        const child = await sibling(frame.entry);
        await push({ ...frame, kind: RenderTask.listDone });
        await push({ kind: child!.tag === "li" ? RenderTask.children : RenderTask.node, id: child!.id, maximum });
      } else if (kind === RenderTask.listDone) {
        const result = await resume(frame), entry = await this.tree.entry(frame.entry), child = await this.tree.read(entry.child);
        const content = await this.text.trim(value);
        if (child.tag === "li") {
          const marker = (await this.tree.read(frame.id)).tag === "ol" ? `${frame.ordinal++}. ` : "- ";
          this.budget.check(marker.length, maximum, "list indentation");
          await result.append(await this.indented(content, " ".repeat(marker.length), marker, maximum));
          await result.write("\n");
        } else if (content) { await result.append(content); await result.write("\n"); }
        await push({ ...frame, kind: RenderTask.listNext, entry: entry.next, result: await result.snapshot() });
      } else if (kind === RenderTask.tableRowScan) {
        if (!frame.rowCursor) {
          const extra = await resume(frame), loose = await this.text.trim(await extra.finish()), result = this.builder(maximum);
          if (loose) { await result.append(loose); await result.separate(); }
          if (!frame.first) { value = await result.finish(); continue; }
          await push({ ...frame, kind: RenderTask.tableOutput, result: await result.snapshot(), rowCursor: (await this.tree.read(frame.rows)).first, phase: 0 });
          continue;
        }
        const entry = await this.tree.entry(frame.rowCursor), row = await this.tree.read(entry.child);
        if (row.tag === "text") {
          const extra = await resume(frame); await extra.append(await this.escape(await this.text.normalize(row.text, "space"), maximum));
          await push({ ...frame, rowCursor: entry.next, result: await extra.snapshot() });
        } else await push({ ...frame, kind: RenderTask.tableCellScan, entry: row.first, cells: 0, flags: 0 });
      } else if (kind === RenderTask.tableCellScan) {
        if (!frame.entry) {
          const row = await this.tree.entry(frame.rowCursor);
          await push({ ...frame, kind: RenderTask.tableRowScan, rowCursor: row.next, width: Math.max(frame.width, frame.cells), first: frame.first || (frame.cells ? row.child : 0), header: frame.first ? frame.header : frame.cells ? frame.flags : 0 });
          continue;
        }
        const entry = await this.tree.entry(frame.entry), cell = await this.tree.read(entry.child);
        if (cell.tag === "td" || cell.tag === "th") {
          this.budget.add("cells");
          await push({ ...frame, entry: entry.next, cells: frame.cells + 1, flags: frame.flags || Number(cell.tag === "th") });
        } else {
          await push({ ...frame, kind: RenderTask.tableExtra, entry: entry.next });
          await push({ kind: RenderTask.node, id: cell.id, maximum });
        }
      } else if (kind === RenderTask.tableExtra) {
        const extra = await resume(frame), content = await this.text.trim(value);
        if (content) { await extra.append(content); await extra.write(" "); }
        await push({ ...frame, kind: RenderTask.tableCellScan, result: await extra.snapshot() });
      } else if (kind === RenderTask.tableOutput) {
        const result = this.builder(maximum); await result.restore(frame.phase ? value : frame.result);
        if (frame.phase === 1) {
          await result.write("|");
          for (let index = 0; index < frame.width; index++) { await this.work(); await result.write(" --- |"); }
          await result.write("\n");
        }
        let row = frame.phase === 0 && frame.header ? frame.first : 0;
        if (frame.phase) {
          while (frame.rowCursor) {
            const entry = await this.tree.entry(frame.rowCursor); frame.rowCursor = entry.next;
            if (entry.child === frame.first && frame.header) continue;
            const candidate = await this.tree.read(entry.child);
            if (candidate.tag !== "tr") continue;
            for await (const child of this.tree.children(candidate.id)) {
              const tag = (await this.tree.read(child)).tag;
              if (tag === "td" || tag === "th") { row = candidate.id; break; }
            }
            if (row) break;
          }
          if (!row) {
            const root = await result.finish(); value = await this.text.slice(root, 0, (await this.text.info(root)).length - 1); continue;
          }
        }
        await push({ ...frame, phase: frame.phase ? 2 : 1 });
        await result.write("| ");
        await push({ ...frame, kind: RenderTask.tableCell, entry: row ? (await this.tree.read(row)).first : 0, cells: 0, result: await result.snapshot() });
      } else if (kind === RenderTask.tableCell) {
        const result = await resume(frame);
        if (!frame.entry) {
          this.budget.add("cells", frame.width - frame.cells);
          for (let index = frame.cells; index < frame.width; index++) if (index) await result.write(" | ");
          await result.write(" |\n"); value = await result.snapshot(); continue;
        }
        const entry = await this.tree.entry(frame.entry), cell = await this.tree.read(entry.child);
        if (cell.tag !== "td" && cell.tag !== "th") { await push({ ...frame, entry: entry.next }); continue; }
        if (frame.cells) await result.write(" | ");
        await push({ ...frame, kind: RenderTask.tableCellDone, entry: entry.next, cells: frame.cells + 1, result: await result.snapshot() });
        await push({ kind: RenderTask.children, id: cell.id, maximum: Math.min(maximum, this.budget.limits.maxTableCellBytes) });
      } else if (kind === RenderTask.tableCellDone) {
        const result = await resume(frame), content = await this.text.trim(await this.text.normalize(value, "space")), escaped = this.builder(this.budget.limits.maxTableCellBytes);
        let backslashes = 0;
        for await (const character of this.text.characters(content)) {
          await escaped.write(character === "|" && backslashes % 2 === 0 ? "\\|" : character);
          backslashes = character === "\\" ? backslashes + 1 : 0;
        }
        await result.append(await escaped.finish());
        await push({ ...frame, kind: RenderTask.tableCell, result: await result.snapshot() });
      }
    }
    return value;
  }

  private async raw(id: number, maximum: number): Promise<number> {
    const result = this.builder(maximum);
    for await (const node of this.tree.walk(id, node => node.tag !== "text" && node.tag !== "br")) {
      await this.work();
      if (node.tag === "text") await result.append(node.text);
      else if (node.tag === "br") await result.write("\n");
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

  private async *rows(id: number): AsyncGenerator<number> {
    const node = await this.tree.read(id);
    if (node.tag === "tr" || node.tag === "text") { yield id; return; }
    for await (const child of this.tree.walk(id, node => node.tag !== "tr" && node.tag !== "text")) {
      await this.work();
      if (child.tag === "tr" || child.tag === "text") yield child.id;
    }
  }

  private async formatted(node: StoredNode, maximum: number, content: number, flags: number): Promise<number> {
    const edges: readonly [boolean, boolean] = [Boolean(flags & 1), Boolean(flags & 2)], alternateStrong = Boolean(flags & 4), precedingDigit = Boolean(flags & 8);
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
