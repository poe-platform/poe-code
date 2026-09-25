import type { MdqBudget } from "./budget.js";
import { MdqWriter } from "./writer.js";
import { shellValueByteLength } from "safe-bash-contracts/value";
import type { Arguments } from "./options.js";
import { plain, type Node, type Inline, type Document, type Link } from "./document.js";

function numeric(text: string): boolean { return text.length > 0 && [...text].every(c => c >= "0" && c <= "9"); }
function compare(a: string, b: string): number { return numeric(a) && numeric(b) ? Number(a) - Number(b) : a < b ? -1 : a > b ? 1 : 0; }
export async function render(doc: Document, nodes: Node[], options: Arguments, budget: MdqBudget): Promise<string> {
  const links = new Map<string, Link>(), notes = new Map<string, string>(), numberedLinks = new Map<string, string>();
  const linkIds = new WeakMap<Inline, string>(), emittedLinks = new Set<string>(), emittedNotes = new Set<string>();
  let nextLink = 1;
  // Reserve concatenations, padding and escaped JSON before allocating them.
  function join(parts: readonly string[], separator = ""): string {
    const gaps = Math.max(0, parts.length - 1);
    let units = gaps * separator.length, bytes = gaps * shellValueByteLength(separator);
    for (const part of parts) { units += part.length; bytes += shellValueByteLength(part); }
    budget.bound("outputBytes", bytes);
    budget.charge("retainedBytes", units * 2 + parts.length * 8);
    budget.checkpoint(units + parts.length);
    return parts.join(separator);
  }
  function repeat(value: string, count: number): string {
    budget.bound("outputBytes", shellValueByteLength(value) * count);
    budget.charge("retainedBytes", value.length * count * 2);
    budget.checkpoint(value.length * count);
    return value.repeat(count);
  }
  function target(link: Link): string {
    if (!link.title) return link.url;
    const quote = link.title.includes('"') ? "'" : '"';
    return join([link.url, " ", quote, link.title, quote]);
  }
  const noteId = (label: string): string => {
    let id = notes.get(label);
    if (id === undefined) {
      budget.charge("references", 1);
      id = options.renumberFootnotes ? String(notes.size + 1) : label;
      notes.set(label, id);
      const stack: (Node | Inline)[] = [];
      const append = (items: readonly (Node | Inline)[]): void => {
        budget.charge("retainedBytes", items.length * 8);
        for (let i = items.length - 1; i >= 0; i--) stack.push(items[i]!);
      };
      append(doc.footnotes.get(label) ?? []);
      while (stack.length) {
        budget.checkpoint();
        const item = stack.pop()!;
        if (item.kind === "footnote") {
          if (!notes.has(item.text)) {
            budget.charge("references", 1);
            notes.set(item.text, options.renumberFootnotes ? String(notes.size + 1) : item.text);
            append(doc.footnotes.get(item.text) ?? []);
          }
        } else if (item.kind === "link") {
          if (item.link?.reference !== undefined) reference(item);
        } else if (item.kind !== "image") {
          append(item.children);
          if ("inline" in item) append(item.inline);
          if ("rows" in item) for (const row of item.rows ?? []) for (const cell of row) append(cell);
        }
      }
    }
    return id;
  };
  function reference(i: Inline): string | undefined {
    const link = i.link!;
    if (options.linkFormat === "inline" || options.linkFormat === "keep" && link.reference === undefined) return;
    let id = linkIds.get(i);
    if (id !== undefined) return id;
    id = link.reference;
    if (options.linkFormat === "never-inline" && !link.style && (id === undefined || numeric(id))) {
      const original = id;
      id = original === undefined ? undefined : numberedLinks.get(original);
      if (id === undefined) { id = String(nextLink++); if (original !== undefined) numberedLinks.set(original, id); }
    }
    id ??= String(nextLink++);
    linkIds.set(i, id); links.set(id, link); return id;
  }
  async function inlines(items: readonly Inline[]): Promise<string> {
    const parts: string[] = [];
    budget.charge("retainedBytes", items.length * 8);
    for (const i of items) {
      await budget.cooperate();
      const child = i.children.length ? await inlines(i.children) : i.text;
      if (i.kind === "text" || i.kind === "html") parts.push(child);
      else if (i.kind === "emph" || i.kind === "strong" || i.kind === "strike") {
        const marker = i.kind === "emph" ? "_" : i.kind === "strong" ? "**" : "~~";
        if (child) parts.push(join([marker, child, marker]));
      } else if (i.kind === "code") {
        let ticks = "`"; while (child.includes(ticks)) { await budget.cooperate(child.length); ticks = join([ticks, "`"]); }
        const pad = child.startsWith("`") || child.endsWith("`") || child.startsWith(" ") && child.endsWith(" ") && child.trim() ? " " : "";
        parts.push(join([ticks, pad, child, pad, ticks]));
      } else if (i.kind === "footnote") parts.push(join(["[^", noteId(i.text), "]"]));
      else if (i.link?.autolink) parts.push(i.link.autolink === "bracketed" ? join(["<", i.link.url, ">"]) : i.link.url);
      else {
        const id = reference(i), prefix = i.kind === "image" ? "!" : "";
        parts.push(join([prefix, "[", child, "]"]));
        if (id === undefined) parts.push(join(["(", target(i.link!), ")"]));
        else if (i.link!.style === "collapsed") parts.push("[]");
        else if (i.link!.style !== "shortcut") parts.push(join(["[", id, "]"]));
      }
    }
    return join(parts);
  }
  async function table(n: Node): Promise<string> {
    const rows: string[][] = [], widths: number[] = n.alignments!.map(a => a === "center" ? 3 : a === "left" || a === "right" ? 2 : 1);
    for (const row of n.rows!) {
      await budget.cooperate();
      budget.charge("retainedBytes", row.length * 8 + 24);
      const cells: string[] = [];
      for (let i = 0; i < row.length; i++) {
        const cell = await inlines(row[i]!);
        cells.push(cell); widths[i] = Math.max(widths[i] ?? 0, cell ? shellValueByteLength(cell) + 2 : 1);
      }
      rows.push(cells);
    }
    const line = async (row: string[]): Promise<string> => {
      const cells = ["|"];
      for (let i = 0; i < row.length; i++) {
        await budget.cooperate();
        const cell = row[i]!, gap = widths[i]! - (cell ? 2 : 1) - shellValueByteLength(cell), align = n.alignments![i] ?? "none";
        const left = align === "right" ? gap : align === "center" ? Math.floor(gap / 2) : 0;
        cells.push(join([cell ? " " : "", repeat(" ", left), cell, repeat(" ", gap - left), " |"]));
      }
      return join(cells);
    };
    const head = rows[0] ?? [];
    let planned = 1 + n.alignments!.reduce((sum, _, i) => sum + widths[i]! + 1, 0);
    for (const row of rows) {
      await budget.cooperate();
      planned += 2;
      for (let i = 0; i < row.length; i++) planned += widths[i]! + 1;
    }
    budget.bound("outputBytes", planned);
    const divider = join(["|", ...n.alignments!.map((_, i) => {
      const align = n.alignments![i] ?? "none", left = align === "left" || align === "center", right = align === "right" || align === "center";
      return join([left ? ":" : "", repeat("-", widths[i]! - Number(left) - Number(right)), right ? ":" : "", "|"]);
    })]);
    const lines = [await line(head), divider];
    for (const row of rows.slice(1)) lines.push(await line(row));
    return join([join(lines, "\n"), rows.length === 1 ? "\n" : ""]);
  }
  const writer = new MdqWriter(budget, options.wrapWidth);
  let previousBreak = false;
  async function writeInlines(items: readonly Inline[]): Promise<void> {
    for (const item of items) {
      await budget.cooperate();
      if (item.kind === "emph" || item.kind === "strong" || item.kind === "strike") {
        const marker = item.kind === "emph" ? "_" : item.kind === "strong" ? "**" : "~~";
        if (item.children.length) {
          await writer.write(marker); await writeInlines(item.children); await writer.write(marker);
        }
      } else {
        const value = await inlines([item]);
        if ((item.kind === "link" && !item.link?.autolink) || item.kind === "image") await writer.withoutWrapping(out => out.write(value));
        else await writer.write(value);
      }
    }
  }
  async function definitions(linkPosition: boolean, notePosition: boolean, separator = false): Promise<void> {
    const pendingLinks = linkPosition ? [...links.keys()].filter(id => !emittedLinks.has(id)).sort(compare) : [];
    if (!pendingLinks.length && !(notePosition && [...notes.values()].some(id => !emittedNotes.has(id)))) return;
    if (separator) await printSeparator();
    await writer.block("plain", async out => {
      let remaining = pendingLinks.length + (notePosition ? [...notes.values()].filter(id => !emittedNotes.has(id)).length : 0);
      for (const id of pendingLinks) {
        emittedLinks.add(id);
        await out.write(join(["[", id]));
        await out.withoutWrapping(out => out.write(join(["]: ", target(links.get(id)!)])));
        if (--remaining > 0) await out.write("\n");
      }
      if (notePosition) for (const [label, id] of [...notes].sort((a, b) => a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)) {
        if (emittedNotes.has(id)) continue;
        emittedNotes.add(id);
        await out.write(join(["[^", id, "]: "]));
        await out.block({ indent: 2 }, async () => {
          for (const child of doc.footnotes.get(label) ?? []) await markdown(child);
        });
      }
    });
  }
  async function printSeparator(): Promise<void> {
    if (options.breaks) await markdown({ kind: "break", children: [], inline: [], text: "" });
    else await writer.write("\n");
  }
  async function markdown(n: Node): Promise<void> {
    await budget.cooperate();
    const wasBreak = previousBreak;
    previousBreak = false;
    switch (n.kind) {
      case "document":
        for (const child of n.children) await markdown(child);
        return;
      case "section":
        await writer.block("plain", out => out.withoutWrapping(async out => {
          await out.write(repeat("#", n.level!));
          if (n.inline.length) { await out.write(" "); await writeInlines(n.inline); }
        }));
        for (const child of n.children) await markdown(child);
        await definitions(options.linkPos === "section", options.footnotePos === "section");
        return;
      case "paragraph": await writer.block("plain", () => writeInlines(n.inline)); return;
      case "inline":
        if (n.inline[0]?.kind === "html") await writer.block("plain", () => writeInlines(n.inline));
        else await writeInlines(n.inline);
        return;
      case "quote":
        await writer.block("quote", async () => { for (const child of n.children) await markdown(child); });
        return;
      case "list":
        await writer.block("plain", async () => { for (const child of n.children) await markdown(child); });
        return;
      case "item": {
        const marker = (n.index === undefined ? "- " : `${n.index}. `) + (n.checked === undefined ? "" : n.checked ? "[x] " : "[ ] ");
        await writer.write(marker);
        await writer.block({ indent: marker.length }, async () => { for (const child of n.children) await markdown(child); });
        return;
      }
      case "code": {
        let longest = 0, current = 0, atStart = true;
        for (const char of n.text) {
          budget.checkpoint();
          if (atStart && char === "`") { current++; longest = Math.max(longest, current); }
          else if (char === "\n") { atStart = true; current = 0; }
          else atStart = false;
        }
        const fence = repeat("`", Math.max(3, longest + 1));
        await writer.pre(out => out.write(join([fence, n.language ?? "", n.metadata ? join([" ", n.metadata]) : "", "\n", n.text, "\n", fence])));
        return;
      }
      case "html": await writer.block("plain", out => out.write(n.text)); return;
      case "frontmatter": {
        const marker = n.variant === "yaml" ? "---" : "+++";
        await writer.pre(out => out.write(join([marker, n.text, marker], "\n")));
        return;
      }
      case "break":
        if (!wasBreak) await writer.block("plain", out => out.withoutWrapping(out => out.write("   -----")));
        previousBreak = true;
        return;
      case "table": await writer.write(await table(n)); return;
    }
  }
  async function jsonChildren(children: Node[]): Promise<unknown[]> {
    budget.charge("retainedBytes", children.length * 64);
    const items: unknown[] = [];
    for (const child of children) items.push(await json(child));
    return items;
  }
  async function json(n: Node): Promise<unknown> {
    await budget.cooperate();
    switch (n.kind) {
      case "document": return { document: await jsonChildren(n.children) };
      case "section": return { section: { depth: n.level, title: await inlines(n.inline), body: await jsonChildren(n.children) } };
      case "paragraph": return { paragraph: await inlines(n.inline) };
      case "quote": return { block_quote: await jsonChildren(n.children) };
      case "code": return { code_block: { code: n.text, type: "code", ...(n.language === undefined ? {} : { language: n.language }), ...(n.metadata === undefined ? {} : { metadata: n.metadata }) } };
      case "html": return { html: { value: n.text } };
      case "break": return { thematic_break: null };
      case "frontmatter": return { front_matter: { body: n.text, variant: n.variant } };
      case "list": {
        const list: unknown[] = [];
        for (const item of n.children) list.push({ item: await jsonChildren(item.children), ...(item.index === undefined ? {} : { index: item.index }), ...(item.checked === undefined ? {} : { checked: item.checked }) });
        return { list };
      }
      case "table": {
        const rows: string[][] = [];
        for (const row of n.rows!) {
          const cells: string[] = [];
          for (const cell of row) cells.push(await inlines(cell));
          rows.push(cells);
        }
        return { table: { alignments: n.alignments, rows } };
      }
      case "inline": {
        const i = n.inline[0]!;
        if (i.kind === "html") return { html: { value: i.text } };
        if (i.kind !== "link" && i.kind !== "image") return { paragraph: await inlines(n.inline) };
        // Selected links expose their original reference metadata in JSON.
        return { [i.kind]: { [i.kind === "link" ? "display" : "alt"]: await inlines(i.children), url: i.link!.url,
          ...(i.link!.title === undefined ? {} : { title: i.link!.title }),
          ...(i.link!.style ? { reference_style: i.link!.style } : i.link!.reference === undefined ? {} : { reference: i.link!.reference }) } };
      }
      case "item": return { list: [{ item: await jsonChildren(n.children) }] };
    }
  }
  async function stringify(value: unknown): Promise<string> {
    await budget.cooperate();
    if (typeof value === "string") {
      let bytes = 2, units = 2;
      for (const char of value) {
        const code = char.codePointAt(0)!;
        const escape = char === '"' || char === "\\" || "\b\f\n\r\t".includes(char) ? 2 : code < 32 || code >= 0xd800 && code <= 0xdfff ? 6 : 0;
        units += escape || char.length;
        bytes += escape || shellValueByteLength(char);
      }
      budget.bound("outputBytes", bytes);
      budget.charge("retainedBytes", units * 2);
      budget.checkpoint(value.length);
      return JSON.stringify(value);
    }
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    const parts: string[] = [];
    if (Array.isArray(value)) {
      for (const item of value) parts.push(await stringify(item));
      return join(["[", join(parts, ","), "]"]);
    }
    for (const [key, item] of Object.entries(value)) parts.push(join([await stringify(key), ":", await stringify(item)]));
    return join(["{", join(parts, ","), "}"]);
  }
  if (options.output === "json") {
    const items = await jsonChildren(nodes), footnotes: Record<string, unknown> = Object.create(null);
    const linkMap = Object.fromEntries([...links].map(([key, link]) => [key, { url: link.url, ...(link.title ? { title: link.title } : {}) }]));
    for (const [label, id] of notes) footnotes[id] = await jsonChildren(doc.footnotes.get(label) ?? []);
    return stringify({ items, ...(Object.keys(linkMap).length ? { links: linkMap } : {}), ...(notes.size ? { footnotes } : {}) });
  }
  if (options.output === "plain") {
    const pieces: string[] = [];
    const walk = async (n: Node): Promise<void> => {
      await budget.cooperate();
      const value = plain(n.inline) || n.text;
      if (value) pieces.push(value);
      for (const row of n.rows ?? []) pieces.push(join(row.map(plain).filter(Boolean), " "));
      for (const child of n.children) await walk(child);
    };
    for (const n of nodes) await walk(n);
    const raw = join(pieces, "\n\n"), parts: string[] = [];
    budget.charge("retainedBytes", raw.length * 2);
    let pending = 0;
    for (const line of raw.split("\n")) {
      await budget.cooperate();
      if (!line) { pending++; continue; }
      if (parts.length) parts.push(repeat("\n", Math.min(pending + 1, options.breaks ? 2 : 1)));
      parts.push(line); pending = 0;
    }
    return parts.length ? join([join(parts), "\n"]) : pieces.length ? "\n" : "";
  }
  for (let i = 0; i < nodes.length; i++) {
    await markdown(nodes[i]!);
    await definitions(options.linkPos === "section", options.footnotePos === "section");
    if (i + 1 < nodes.length) await printSeparator();
  }
  await definitions(true, true, nodes.length > 1);
  return writer.finish();
}
