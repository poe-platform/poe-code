import type { Block, Inline, Row, ColSpec } from "./ast-types.js";
import type { AdapterContext, ReaderCapability } from "./types.js";
import { rstInlines } from "./rst-inlines.js";
import { adornment, dedent, field, identifier, indent, listMarker, nameOf, rstAttr, rstError, rstLines, simpleColumns, sliceLine, trimLines } from "./rst-syntax.js";
import type { RstLine } from "./rst-syntax.js";
interface Target {readonly value: string; readonly indirect: boolean; readonly at: RstLine}
interface Substitution {readonly text?: string; readonly image?: Inline; readonly at: RstLine}
const admonitions = ["attention", "caution", "danger", "error", "hint", "important", "note", "tip", "warning", "admonition"];
class RstReader {
  readonly targets = new Map<string, Target>();
  readonly anonymous: Target[] = [];
  readonly substitutions = new Map<string, Substitution>();
  readonly notes = new Map<string, readonly Block[]>();
  readonly autoNotes: string[] = [];
  readonly symbolNotes: string[] = [];
  readonly levels = new Map<string, number>();
  readonly jobs = new Map<Inline[], {text: string; at: RstLine}>();
  readonly filled = new Set<Inline[]>();
  readonly activeIncludes = new Set<string>();
  readonly links: {target: [string, string]; definition: Target | undefined; name: string | undefined; at: RstLine}[] = [];
  anonymousIndex = 0;
  autoIndex = 0;
  symbolIndex = 0;
  constructor(readonly context: AdapterContext) {}
  inline(text: string, at: RstLine): Inline[] {
    this.context.charge("references", 1);
    const slot: Inline[] = [];
    this.jobs.set(slot, {text, at});
    return slot;
  }
  raw(source: string, at: RstLine): Extract<Inline, {t: "RawInline"}> {
    if (!this.context.lossy && this.context.rawContent !== "retain" && this.context.rawContent !== "escape") rstError(this.context, at, "Unsupported RST directive or role", "E_CAPABILITY");
    this.context.report({code: "W_RAW_CONTENT", operation: this.context.operation ?? "read", format: "rst", location: `${at.source ? `${at.source}:` : ""}${at.line}:${at.column}`, message: "Preserved unsupported RST source"});
    return {t: "RawInline", c: ["rst", source]};
  }
  addTarget(name: string, value: string, indirect: boolean, at: RstLine, implicit = false): void {
    const key = nameOf(name);
    if (!key) rstError(this.context, at, "Empty target name");
    if (this.targets.has(key)) {if (implicit) return; rstError(this.context, at, `Duplicate target: ${key}`);}
    this.context.charge("references", 1);
    this.targets.set(key, {value, indirect, at});
  }
  target(target: Target, stack: readonly string[] = []): string {
    this.context.bound("depth", stack.length);
    this.context.checkpoint();
    if (!target.indirect) return target.value;
    const name = nameOf(target.value);
    if (stack.includes(name)) rstError(this.context, target.at, "Cyclic hyperlink targets");
    const next = this.targets.get(name);
    if (!next) rstError(this.context, target.at, `Unknown target: ${name}`);
    return this.target(next, [...stack, name]);
  }
  link(name: string | undefined, label: readonly Inline[], at: RstLine): Inline {
    this.context.charge("references", 1);
    const target = name === undefined ? this.anonymous[this.anonymousIndex++] : this.targets.get(name);
    const destination: [string, string] = ["", ""];
    this.links.push({target: destination, definition: target, name, at});
    return {t: "Link", c: [rstAttr(), label, destination]};
  }
  embeddedTarget(name: string, label: readonly Inline[], at: RstLine): Inline {
    const id = identifier(name);
    this.addTarget(name, `#${id}`, false, at);
    return {t: "Span", c: [[id, [], []], label]};
  }
  async substitution(name: string, at: RstLine, stack: readonly string[], depth: number): Promise<readonly Inline[]> {
    const key = `sub:${name}`;
    this.context.bound("depth", depth);
    this.context.charge("macros", 1);
    if (stack.includes(key)) rstError(this.context, at, "Recursive substitution", "E_LIMIT");
    const sub = this.substitutions.get(name);
    if (!sub) rstError(this.context, at, `Undefined substitution: ${name}`);
    if (sub.image) {await this.resolve(sub.image, [...stack, key], depth + 1); return [sub.image];}
    this.context.charge("expandedBytes", sub.text!.length * 2);
    return rstInlines(sub.text!, sub.at, this, [...stack, key], depth + 1);
  }
  async note(name: string, at: RstLine, stack: readonly string[], depth: number): Promise<Inline> {
    this.context.bound("depth", depth);
    const key = name === "#" ? this.autoNotes[this.autoIndex++] : name === "*" ? this.symbolNotes[this.symbolIndex++] : name;
    if (!key || !this.notes.has(key)) rstError(this.context, at, `Unknown note: ${name}`);
    if (stack.includes(`note:${key}`)) rstError(this.context, at, "Recursive note", "E_LIMIT");
    const blocks = this.notes.get(key)!;
    await this.resolve(blocks, [...stack, `note:${key}`], depth + 1);
    this.context.charge("references", 1);
    return {t: "Note", c: blocks};
  }
  async resolve(value: unknown, stack: readonly string[] = [], depth = 0): Promise<void> {
    this.context.bound("depth", depth);
    await this.context.cooperate();
    if (!value || typeof value !== "object") return;
    const job = this.jobs.get(value as Inline[]);
    if (job) {
      const slot = value as Inline[];
      if (this.filled.has(slot)) return;
      const nodes = await rstInlines(job.text, job.at, this, stack, depth + 1);
      for (const node of nodes) { slot.push(node); await this.context.cooperate(); }
      this.filled.add(slot);
      return;
    }
    for (const v of Object.values(value)) await this.resolve(v, stack, depth + 1);
  }
  indented(lines: readonly RstLine[], start: number): number {
    let i = start;
    while (i < lines.length && (!lines[i]!.text.trim() || indent(lines[i]!.text) > 0)) {this.context.checkpoint(); i++;}
    return i;
  }
  async directive(lines: readonly RstLine[], i: number, depth: number): Promise<{blocks: Block[]; end: number}> {
    const at = lines[i]!;
    const end = this.indented(lines, i + 1);
    const raw = trimLines(lines.slice(i, end)).map(l => l.original ?? l.text).join("\n");
    let declaration = at.text.slice(3), subName: string | undefined;
    if (declaration.startsWith("|")) {
      const stop = declaration.indexOf("|", 1);
      if (stop < 2) rstError(this.context, at, "Malformed substitution definition");
      subName = declaration.slice(1, stop); declaration = declaration.slice(stop + 1).trimStart();
    }
    const separator = declaration.indexOf("::");
    if (separator < 1) {
      // Ordinary comments are explicitly non-rendering syntax.
      return {blocks: [], end};
    }
    this.context.charge("directives", 1);
    const name = declaration.slice(0, separator).trim().toLowerCase();
    const argument = declaration.slice(separator + 2).trim();
    // A blank line ends the directive header; subsequent fields are body data.
    let body = dedent(lines.slice(i + 1, end));
    const options = new Map<string, string>();
    while (body.length && field(body[0]!.text)) {
      const option = field(body[0]!.text)!;
      if (options.has(option.name)) rstError(this.context, body[0]!, `Duplicate directive option: ${option.name}`);
      options.set(option.name, body[0]!.text.slice(option.width));
      body = body.slice(1);
    }
    body = trimLines(body);
    const unsupported = () => {
      const preserved = this.raw(raw, at);
      return {blocks: [{t: "RawBlock", c: preserved.c} as Block], end};
    };
    const allow = (names: readonly string[]) => [...options.keys()].every(k => names.includes(k));
    if (name === "raw" && (options.has("file") || options.has("url"))) rstError(this.context, at, "Raw resource access is prohibited", "E_CAPABILITY");
    if (name === "include") {
      if (subName) return unsupported();
      if (!argument || argument.startsWith("/") || argument.startsWith("~") || argument.includes(":") || argument.includes("\\") || argument.includes("\0") || argument.split("/").includes("..") || [...argument].some(c => c.charCodeAt(0) < 32)) rstError(this.context, at, "Unsafe include resource name", "E_CAPABILITY");
      if (options.size || body.length) return unsupported();
      if (!this.context.resources) rstError(this.context, at, "Include requires an explicit resource capability", "E_CAPABILITY");
      this.context.charge("includes", 1);
      const id = argument.split("/").filter(p => p && p !== ".").join("/");
      if (!id) rstError(this.context, at, "Empty include resource name", "E_CAPABILITY");
      const key = `${at.base ?? ""}/${id}`;
      if (this.activeIncludes.has(key)) rstError(this.context, at, "Include cycle", "E_LIMIT");
      this.activeIncludes.add(key);
      try {
        const bytes = await this.context.resources.resolve(id, at.base, this.context.signal);
        const text = (await this.context.decodeUtf8([bytes])).split("\r\n").join("\n").split("\r").join("\n");
        const slash = id.lastIndexOf("/");
        const base = slash < 0 ? at.base : `${at.base ?? ""}/${id.slice(0, slash)}`;
        return {blocks: await this.blocks(rstLines(text, base, key, this.context), depth + 1), end};
      } finally {this.activeIncludes.delete(key);}
    }
    if (name === "replace" && subName) {
      if (options.size || body.some(l => !l.text.trim()) || argument && lines[i + 1]?.text.trim() === "" && body.length || body.some(l => listMarker(l.text) || field(l.text) || indent(l.text))) return unsupported();
      if (this.substitutions.has(subName)) rstError(this.context, at, `Duplicate substitution: ${subName}`);
      const text = [argument, ...body.map(l => l.text)].filter(Boolean).join("\n");
      if (!text) rstError(this.context, at, "Empty replacement");
      this.substitutions.set(subName, {text, at}); return {blocks: [], end};
    }
    if (name === "image" || name === "figure") {
      if (!allow(["alt", "height", "width", "scale", "align", "target", "class", "name"]) || name === "image" && body.length || name === "figure" && subName) return unsupported();
      if (!argument) rstError(this.context, at, "Image requires a URI");
      const attr = rstAttr();
      attr[0] = options.get("name") ?? "";
      attr[1].push(...(options.get("class") ?? "").split(" ").filter(Boolean));
      for (const k of ["height", "width", "scale", "align"]) if (options.has(k)) attr[2].push([k, options.get(k)!]);
      const target: [string, string] = [argument, ""];
      this.context.resourceTarget?.(target, at.line, at.source === undefined ? undefined : {...(at.base === undefined ? {} : {base: at.base}), source: at.source});
      let image: Inline = {t: "Image", c: [attr, this.inline(options.get("alt") ?? "", at), target]};
      if (options.has("target")) image = {t: "Link", c: [rstAttr(), [image], [options.get("target")!, ""]]};
      if (subName) {
        if (this.substitutions.has(subName)) rstError(this.context, at, `Duplicate substitution: ${subName}`);
        this.substitutions.set(subName, {image, at}); return {blocks: [], end};
      }
      if (name === "figure") {
        const content = await this.blocks(body, depth + 1);
        const caption = content[0]?.t === "Para" ? [content.shift()!] : [];
        return {blocks: [{t: "Figure", c: [rstAttr(), [null, caption], [{t: "Para", c: [image]}, ...content]]}], end};
      }
      return {blocks: [{t: "Para", c: [image]}], end};
    }
    if (subName) return unsupported();
    if (["code", "code-block", "sourcecode", "parsed-literal"].includes(name)) {
      if (!allow(["number-lines", "class", "name"]) || name === "parsed-literal") return unsupported();
      const attr = rstAttr();
      attr[0] = options.get("name") ?? "";
      if (argument) attr[1].push(argument);
      attr[1].push(...(options.get("class") ?? "").split(" ").filter(Boolean));
      if (options.has("number-lines")) {
        const number = options.get("number-lines") || "1";
        if (![...number].every(c => c >= "0" && c <= "9")) rstError(this.context, at, "Invalid number-lines value");
        attr[1].push("numberLines"); attr[2].push(["startFrom", number]);
      }
      if (!body.length) rstError(this.context, at, "Code directive requires a body");
      return {blocks: [{t: "CodeBlock", c: [attr, body.map(l => l.text).join("\n")]}], end};
    }
    if (name === "raw") {
      if (options.size || !argument || argument.split(" ").length !== 1) return unsupported();
      this.raw(raw, at);
      return {blocks: [{t: "RawBlock", c: [argument, body.map(l => l.text).join("\n")]}], end};
    }
    if (admonitions.includes(name) || name === "container" || name === "compound" || name === "rubric" || name === "epigraph" || name === "pull-quote") {
      if (!allow(name === "epigraph" || name === "pull-quote" ? [] : ["class", "name"])) return unsupported();
      const content = argument && name !== "container" ? [{...at, text: argument}, ...(body.length ? [{...at, text: ""}, ...body] : [])] : body;
      const blocks = await this.blocks(content, depth + 1);
      if (name === "rubric") return {blocks: [{t: "Div", c: [[options.get("name") ?? "", ["rubric", ...(options.get("class") ?? "").split(" ").filter(Boolean)], []], blocks]}], end};
      if (name === "epigraph" || name === "pull-quote") return {blocks: [{t: "BlockQuote", c: blocks}], end};
      const classes = name === "container" ? argument.split(" ").filter(Boolean) : [name];
      return {blocks: [{t: "Div", c: [[options.get("name") ?? "", [...classes, ...(options.get("class") ?? "").split(" ").filter(Boolean)], []], blocks]}], end};
    }
    return unsupported();
  }
  async table(lines: readonly RstLine[], i: number, depth: number): Promise<{block: Block; end: number}> {
    const at = lines[i]!;
    const grid = at.text.startsWith("+");
    let columns: readonly (readonly [number, number])[];
    if (grid) {
      const positions: number[] = [];
      for (let n = 0; n < at.text.length; n++) if (at.text[n] === "+") positions.push(n);
      if (positions.length < 2 || positions[0] !== 0 || positions.at(-1) !== at.text.length - 1 || [...at.text].some(c => c !== "+" && c !== "-")) rstError(this.context, at, "Malformed grid table border");
      columns = positions.slice(0, -1).map((p, j) => [p + 1, positions[j + 1]!] as const);
    } else columns = simpleColumns(at.text)!;
    this.context.bound("tableColumns", columns.length);
    const rows: Row[] = [];
    let head = 0, cursor = i + 1;
    let pending: RstLine[][] = columns.map(() => []);
    const flush = async () => {
      if (!pending.some(c => c.some(l => l.text.trim()))) return;
      this.context.charge("tableRows", 1);
      this.context.charge("tableCells", columns.length);
      const cells = [];
      for (const cell of pending) {
        const content = dedent(trimLines(cell));
        this.context.bound("tableFieldText", content.reduce((n, l) => n + l.text.length, 0));
        cells.push([rstAttr(), "AlignDefault", 1, 1, await this.blocks(content, depth + 1)] as const);
      }
      rows.push([rstAttr(), cells]); pending = columns.map(() => []);
    };
    let closed = false;
    while (cursor < lines.length) {
      await this.context.cooperate();
      const line = lines[cursor]!, text = line.text;
      if (grid && text.startsWith("+")) {
        if (text.length !== at.text.length || [...text].some(c => c !== "+" && c !== "-" && c !== "=") || columns.some(([a, b]) => text[a - 1] !== "+" || text[b] !== "+")) rstError(this.context, line, "Unsupported grid table span or malformed separator", "E_PARSE");
        const equal = text.includes("=");
        if (equal && text.includes("-")) rstError(this.context, line, "Conflicting grid table separator");
        await flush();
        if (equal) {if (head || !rows.length) rstError(this.context, line, "Invalid table header separator"); head = rows.length;}
        cursor++;
        if (!lines[cursor]?.text.startsWith("|")) {closed = true; break;}
        continue;
      }
      if (!grid && simpleColumns(text)) {
        if (text.trimEnd() !== at.text.trimEnd()) rstError(this.context, line, "Simple table column boundaries changed");
        await flush(); cursor++;
        if (!lines[cursor]?.text.trim() || cursor === lines.length || !lines.slice(cursor).some(l => l.text.trimEnd() === at.text.trimEnd())) {closed = true; break;}
        if (head || !rows.length) rstError(this.context, line, "Invalid simple table header separator");
        head = rows.length; continue;
      }
      if (grid && (!text.startsWith("|") || text.length !== at.text.length || columns.some(([a, b]) => text[a - 1] !== "|" || text[b] !== "|"))) rstError(this.context, line, "Malformed grid table cell or unsupported span");
      if (!grid && !text.trim()) {for (const cell of pending) cell.push({...line, text: ""}); cursor++; continue;}
      if (!grid && text.slice(columns[0]![0], columns[0]![1]).trim()) await flush();
      if (!grid) {
        for (let c = 0; c < columns.length - 1; c++) if (text.slice(columns[c]![1], columns[c + 1]![0]).trim()) rstError(this.context, line, "Text crosses simple table column boundary");
      }
      for (const [c, [a, b]] of columns.entries()) pending[c]!.push({...sliceLine(line, a), text: text.slice(a, !grid && c === columns.length - 1 ? undefined : b).trimEnd()});
      cursor++;
    }
    if (!closed) rstError(this.context, at, "Unclosed table");
    const specs: ColSpec[] = columns.map(() => ["AlignDefault", {t: "ColWidthDefault"}]);
    return {block: {t: "Table", c: [rstAttr(), [null, []], specs, [rstAttr(), rows.slice(0, head)], [[rstAttr(), 0, [], rows.slice(head)]], [rstAttr(), []]]}, end: cursor};
  }
  async blocks(lines: readonly RstLine[], depth = 0): Promise<Block[]> {
    this.context.bound("depth", depth);
    const out: Block[] = [];
    let i = 0;
    while (i < lines.length) {
      await this.context.cooperate();
      const at = lines[i]!, text = at.text;
      if (!text.trim()) {i++; continue;}
      if (indent(text)) {
        const end = this.indented(lines, i);
        out.push({t: "BlockQuote", c: await this.blocks(dedent(trimLines(lines.slice(i, end))), depth + 1)}); i = end; continue;
      }
      if (simpleColumns(text) || text.startsWith("+-") && text.endsWith("+")) {
        const table = await this.table(lines, i, depth); out.push(table.block); i = table.end; continue;
      }
      const over = adornment(text), under = adornment(lines[i + 1]?.text ?? "");
      if (over && lines[i + 1]?.text.trim() && adornment(lines[i + 2]?.text ?? "")) {
        const bottom = lines[i + 2]!;
        if (adornment(bottom.text) !== over || bottom.text.trimEnd().length !== text.trimEnd().length || text.length < lines[i + 1]!.text.trim().length) rstError(this.context, at, "Conflicting heading adornments");
        const title = lines[i + 1]!.text.trim(), key = `over:${over}`;
        if (!this.levels.has(key)) this.levels.set(key, this.levels.size + 1);
        const id = identifier(title);
        this.addTarget(title, `#${id}`, false, at, true);
        out.push({t: "Header", c: [this.levels.get(key)!, [id, [], []], this.inline(title, lines[i + 1]!)]}); i += 3; continue;
      }
      if (!over && under) {
        if (lines[i + 1]!.text.trimEnd().length < text.length) rstError(this.context, lines[i + 1]!, "Heading underline is too short");
        const key = `under:${under}`, id = identifier(text);
        if (!this.levels.has(key)) this.levels.set(key, this.levels.size + 1);
        this.addTarget(text, `#${id}`, false, at, true);
        out.push({t: "Header", c: [this.levels.get(key)!, [id, [], []], this.inline(text, at)]}); i += 2; continue;
      }
      if (over && text.trimEnd().length >= 4) {
        if (i > 0 && lines[i - 1]!.text.trim() || lines[i + 1]?.text.trim()) rstError(this.context, at, "Transition requires surrounding blank lines");
        out.push({t: "HorizontalRule"}); i++; continue;
      }
      if (text.startsWith(".. _") || text.startsWith("__ ")) {
        const anonymous = text.startsWith("__ ") || text.startsWith(".. __:");
        let name = "", value: string;
        if (text.startsWith("__ ")) value = text.slice(3).trim();
        else {
          const declaration = text.slice(4);
          let end: number;
          if (declaration.startsWith("`")) {end = declaration.indexOf("`:", 1); if (end < 1) rstError(this.context, at, "Malformed quoted target"); name = declaration.slice(1, end); end++;}
          else {end = declaration.indexOf(":"); if (end < 1) rstError(this.context, at, "Malformed hyperlink target"); name = declaration.slice(0, end);}
          value = declaration.slice(end + 1).trim();
        }
        const end = this.indented(lines, i + 1);
        value += trimLines(lines.slice(i + 1, end)).map(l => l.text.trim()).join("");
        const indirect = value.endsWith("_") && !value.includes("://");
        if (anonymous) {this.context.charge("references", 1); this.anonymous.push({value: indirect ? value.slice(0, -1) : value, indirect, at});}
        else {
          this.addTarget(name, value ? indirect ? value.slice(0, -1) : value : `#${identifier(name)}`, indirect, at);
          if (!value) out.push({t: "Div", c: [[identifier(name), [], []], []]});
        }
        i = end; continue;
      }
      if (text.startsWith(".. [")) {
        const stop = text.indexOf("]", 4);
        if (stop < 4 || text[stop + 1] !== " ") rstError(this.context, at, "Malformed note definition");
        let name = text.slice(4, stop);
        const end = this.indented(lines, i + 1);
        const body = dedent(lines.slice(i + 1, end));
        if (name === "#") {name = `#auto-${this.autoNotes.length}`; this.autoNotes.push(name);}
        if (name === "*") {name = `*symbol-${this.symbolNotes.length}`; this.symbolNotes.push(name);}
        if (this.notes.has(name)) rstError(this.context, at, `Duplicate note: ${name}`);
        const first = sliceLine(at, stop + 2);
        this.notes.set(name, await this.blocks([first, ...body], depth + 1)); i = end; continue;
      }
      if (text === ".." || text.startsWith(".. ")) {const d = await this.directive(lines, i, depth); out.push(...d.blocks); i = d.end; continue;}
      if (text === "|" || text.startsWith("| ")) {
        const content: Inline[][] = [];
        while (i < lines.length && (lines[i]!.text === "|" || lines[i]!.text.startsWith("| "))) {
          const first = lines[i]!, parts = [first.text.slice(2)]; i++;
          while (i < lines.length && indent(lines[i]!.text) > 0) {parts.push(lines[i]!.text.trimStart()); i++;}
          content.push(this.inline(parts.join("\n"), sliceLine(first, 2)));
        }
        out.push({t: "LineBlock", c: content}); continue;
      }
      const marker = listMarker(text);
      if (marker) {
        const items: Block[][] = [];
        let expected = marker.start;
        while (i < lines.length) {
          const first = lines[i]!, m = listMarker(first.text);
          if (!m || m.bullet !== marker.bullet || !m.bullet && (m.style !== marker.style && m.style !== "DefaultStyle" || m.delim !== marker.delim || m.style !== "DefaultStyle" && m.start !== expected)) break;
          expected++;
          const end = this.indented(lines, i + 1);
          const continuation = lines.slice(i + 1, end);
          if (continuation.some(l => l.text.trim() && indent(l.text) < m.width)) rstError(this.context, first, "List continuation indentation is too small");
          items.push(await this.blocks([sliceLine(first, m.width), ...continuation.map(l => sliceLine(l, Math.min(m.width, l.text.length)))], depth + 1)); i = end;
        }
        out.push(marker.bullet ? {t: "BulletList", c: items} : {t: "OrderedList", c: [[marker.start, marker.style, marker.delim], items]}); continue;
      }
      const f = field(text);
      if (f) {
        const entries: [Inline[], Block[][]][] = [];
        while (i < lines.length && field(lines[i]!.text)) {
          const first = lines[i]!, entry = field(first.text)!, end = this.indented(lines, i + 1);
          const body = dedent(lines.slice(i + 1, end));
          const value = first.text.slice(entry.width);
          entries.push([this.inline(entry.name, sliceLine(first, 1)), [await this.blocks(value ? [{...sliceLine(first, entry.width), text: value}, ...body] : body, depth + 1)]]); i = end;
        }
        out.push({t: "DefinitionList", c: entries}); continue;
      }
      if (lines[i + 1]?.text.trim() && indent(lines[i + 1]!.text)) {
        const entries: [Inline[], Block[][]][] = [];
        while (i < lines.length && lines[i + 1]?.text.trim() && indent(lines[i + 1]!.text)) {
          const first = lines[i]!, end = this.indented(lines, i + 1);
          entries.push([this.inline(first.text, first), [await this.blocks(dedent(trimLines(lines.slice(i + 1, end))), depth + 1)]]); i = end;
        }
        out.push({t: "DefinitionList", c: entries}); continue;
      }
      const parts: RstLine[] = [];
      while (i < lines.length && lines[i]!.text.trim()) {
        const line = lines[i]!;
        if (indent(line.text)) rstError(this.context, line, "Unexpected paragraph indentation");
        parts.push(line); i++;
      }
      let value = parts.map(l => l.text).join("\n");
      if (value.endsWith("::") && !lines[i]?.text.trim()) {
        let next = i; while (next < lines.length && !lines[next]!.text.trim()) next++;
        const literal = lines[next];
        if (literal && (indent(literal.text) || ">!\"#$%&'()+,-./:;<?@[\\]^_`{~".includes(literal.text[0]!))) {
          if (value === "::") value = ""; else if (value.endsWith(" ::")) value = value.slice(0, -3); else value = value.slice(0, -1);
          if (value) out.push({t: "Para", c: this.inline(value, at)});
          let end: number, code: RstLine[];
          if (indent(literal.text)) {end = this.indented(lines, next); code = dedent(trimLines(lines.slice(next, end)));}
          else {end = next; while (end < lines.length && lines[end]!.text.startsWith(literal.text[0]!)) end++; code = lines.slice(next, end);}
          out.push({t: "CodeBlock", c: [rstAttr(), code.map(l => l.text).join("\n")]}); i = end; continue;
        }
      }
      out.push({t: "Para", c: this.inline(value, at)});
    }
    return out;
  }
}
export const rstReader: ReaderCapability = {
  format: "rst",
  async read(input, context) {
    const text = input.text ?? await context.decodeUtf8([input.bytes]);
    context.charge("retainedBytes", text.length * 2);
    context.charge("references", text.split("\n").length);
    const reader = new RstReader(context);
    const blocks = await reader.blocks(rstLines(text, input.base, undefined, context));
    await reader.resolve(blocks);
    for (const target of reader.targets.values()) reader.target(target);
    for (const link of reader.links) {
      const target = link.definition ?? (link.name === undefined ? undefined : reader.targets.get(link.name));
      if (!target) rstError(context, link.at, `Unknown target: ${link.name ?? "anonymous"}`);
      link.target[0] = reader.target(target);
    }
    if (reader.anonymousIndex !== reader.anonymous.length) rstError(context, rstLines("")[0]!, "Anonymous link/target count mismatch");
    return {blocks, metadata: {}, resources: []};
  }
};
