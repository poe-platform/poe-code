import {BackedTextSet} from "./backed-text-set.js";
import {retainedHeadingIdentifier} from "./retained-heading-identifier.js";
import {headingAttributes} from "./heading-attributes.js";
import {translate} from "./json.js";
import {nativeDivBlocks} from "./html.js";
import type {PagedStorage} from "safe-bash-io-engine/storage";
import type {AdapterContext} from "./types.js";
import {fencedDivAttributes, letter} from "./commonmark-syntax.js";
import type {RetainedCommonMarkBlocks} from "./retained-commonmark-blocks.js";
import {parseRetainedCommonMarkInlines} from "./retained-commonmark-inlines.js";
import {RetainedCommonMarkSyntax} from "./retained-commonmark-syntax.js";
import type {RetainedRtfAst, RtfValue} from "./retained-rtf-ast.js";
import type {SourceRange} from "./retained-source-text.js";

/** Assemble pending blocks without a resident document. List-item and block
 * continuations use caller-owned tape; nested note calls obey the depth limit. */
export async function assembleRetainedCommonMark(
  parser: RetainedCommonMarkBlocks, ast: RetainedRtfAst, tape: PagedStorage, context: AdapterContext,
  extensions: Readonly<Record<string, boolean>>,
  imageTarget?: (target: RtfValue, line: number) => Promise<void>,
  noteRoot = parser.root, active: readonly number[] = [], initialDepth = 1, citationsState = {note: 0},
  identifiers = new BackedTextSet(tape, ast.text)
): Promise<RtfValue> {
  const source = parser.source, definitions = parser.lookup.bind(parser);
  const literal = async (range: SourceRange) => ast.string(await ast.text.from(source.chunks(range)));
  const inline = async (range: SourceRange, lines = 1, position?: number, sourceLine = 1) => {
    // Line starts use fixed records on caller storage. Binary lookup also handles
    // nested images, whose closing order is different from their source order.
    let index = 0, count = 0;
    if (imageTarget && position !== undefined) {
      index = tape.allocate(lines * 16); let offset = 0, original = 0;
      for await (const line of parser.lines(position)) original += line.range.end - line.range.start + 1;
      const removed = (await parser.node(position)).kind === "heading" ? 0 : original - 1 - (range.end - range.start);
      for await (const line of parser.lines(position)) {
        const bytes = new Uint8Array(16), view = new DataView(bytes.buffer);
        view.setFloat64(0, offset, true); view.setFloat64(8, line.line, true);
        await tape.write(index + count * 16, bytes);
        offset += line.range.end - line.range.start + 1 - (count ? 0 : removed); count++;
      }
    }
    return parseRetainedCommonMarkInlines(
      new RetainedCommonMarkSyntax(source, range, context), tape, ast, context, extensions, definitions,
      {lines, definitions: parser.definitionCount}, imageTarget && (async (target, offset) => {
        let low = 0, high = count;
        while (low < high) {
          const middle = Math.floor((low + high) / 2), bytes = await tape.read(index + middle * 16, 16);
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
          if (view.getFloat64(0, true) <= offset) {sourceLine = view.getFloat64(8, true); low = middle + 1;} else high = middle;
        }
        await imageTarget(target, sourceLine);
      }), extensions.footnotes ? async label => {
        let position = (await parser.node(parser.root)).first;
        while (position) {
          await context.cooperate();
          const block = await parser.node(position);
          if (block.kind === "footnote" && block.info.end - block.info.start === label.length && await source.starts(block.info, label)) {
            if (active.includes(position)) return undefined;
            context.bound("depth", depth + 1);
            context.charge("retainedBytes", (active.length + 1) * 8);
            return ast.tag("Note", await assembleRetainedCommonMark(parser, ast, tape, context, extensions, imageTarget, position, [...active, position], depth + 1, citationsState, identifiers));
          }
          if (block.first) {position = block.first; continue;}
          while (position && !(await parser.node(position)).next) position = (await parser.node(position)).parent;
          if (position) position = (await parser.node(position)).next;
        }
        return undefined;
      } : undefined, citationsState
    );
  };
  const attrs = () => ast.value(["", [], []]);
  const table = async (position: number, caption?: RtfValue) => {
    const block = await parser.node(position), header = block.first, columns = await ast.array();
    for await (const cell of parser.lines(header)) {
      const name = (["AlignDefault", "AlignLeft", "AlignRight", "AlignCenter"] as const)[cell.alignment]!;
      await ast.push(columns, await ast.value([await ast.tag(name), await ast.tag("ColWidthDefault")]));
    }
    const count = (await parser.node(header)).lineCount;
    const row = async (position: number) => {
      const cells = await ast.array(), iterator = parser.lines(position)[Symbol.asyncIterator]();
      try {
        for (let i = 0; i < count; i++) {
          const cell = await iterator.next(), content = await ast.array();
          if (!cell.done && cell.value.range.end > cell.value.range.start) {
            const inlines = await inline(cell.value.range, 1, undefined, block.startLine); if (await ast.count(inlines)) await ast.push(content, await ast.tag("Plain", inlines));
          }
          await ast.push(cells, await ast.value([await attrs(), await ast.tag("AlignDefault"), 1, 1, content]));
        }
      } finally {await iterator.return?.(undefined);}
      return ast.value([await attrs(), cells]);
    };
    const rows = await ast.array(); let first = true;
    for await (const child of parser.children(position)) {if (first) {first = false; continue;} await ast.push(rows, await row(child));}
    return ast.tag("Table", await ast.value([
      await attrs(), [null, caption ?? await ast.array()], columns, [await attrs(), [await row(header)]], [[await attrs(), 0, [], rows]], [await attrs(), []]
    ]));
  };
  const rawHtml = async (range: SourceRange) => {
    let length = 0;
    const value = await ast.text.from((async function* () {
      let buffer = "";
      for (let i = range.start; i < range.end; i++) {
        context.checkpoint(); const char = await source.unit(i);
        let replacement = char;
        if (char === "<") {
          let at = i + 1; if (await source.unit(at) === "/") at++;
          const begin = at; while (at < range.end && letter(await source.unit(at))) {context.checkpoint(); at++;}
          if (at < range.end && at - begin <= 9 && [">", "/", " ", "\t", "\n", "\r"].includes(await source.unit(at))) {
            let name = ""; for (let j = begin; j < at; j++) name += await source.unit(j);
            if (["title", "textarea", "style", "xmp", "iframe", "noembed", "noframes", "script", "plaintext"].includes(name.toLowerCase())) replacement = "&lt;";
          }
        }
        buffer += replacement; length += replacement.length;
        if (buffer.length >= 4096) {yield buffer; buffer = "";}
      }
      if (buffer) yield buffer;
    })());
    context.charge("retainedBytes", length * 2); return ast.string(value);
  };
  const root = await ast.array();
  let position = (await parser.node(noteRoot)).first, out = root, depth = initialDepth, tight = false, mode = 0, taskNode = 0, checked = false, frame = 0;
  const push = async () => {
    const bytes = new Uint8Array(64), view = new DataView(bytes.buffer);
    [frame, position, out.position, depth, Number(tight), mode, taskNode, Number(checked)].forEach((value, index) => view.setFloat64(index * 8, value, true));
    frame = await tape.append(bytes);
  };
  for (;;) {
    context.bound("depth", depth);
    if (!position) {
      if (!frame) {return root;}
      const bytes = await tape.read(frame, 64), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      frame = view.getFloat64(0, true); position = view.getFloat64(8, true); out = {position: view.getFloat64(16, true)};
      depth = view.getFloat64(24, true); tight = !!view.getFloat64(32, true); mode = view.getFloat64(40, true); taskNode = view.getFloat64(48, true); checked = !!view.getFloat64(56, true); continue;
    }
    const current = position, block = await parser.node(position); position = block.next;
    if (mode === 2) {
      const term = await inline(await parser.joined(current), block.lineCount, current), definitions = await ast.array();
      await ast.push(out, await ast.value([term, definitions]));
      await push(); out = definitions; position = block.first; mode = 3; depth++; continue;
    }
    if (mode === 3) {
      const children = await ast.array(); await ast.push(out, children);
      await push(); out = children; position = block.first; mode = 0; tight = !!block.tight; depth++; continue;
    }
    if (mode === 1) {
      const children = await ast.array(); await ast.push(out, children); await push(); out = children; position = block.first; mode = 0; taskNode = 0;
      if (extensions.task_lists && position) {
        const first = await parser.node(position);
        if (first.kind === "paragraph") {
          const line = await parser.lines(position).next();
          if (!line.done) {
            const range = line.value.range, syntax = new RetainedCommonMarkSyntax(source, range, context), start = range.start;
            if (await syntax.at(start) === "[" && await syntax.at(start + 2) === "]" && [" ", "\t", "x", "X"].includes(await syntax.at(start + 1) ?? "") &&
              (range.end - start === 3 || await syntax.at(start + 3) === " " || await syntax.at(start + 3) === "\t")) {
              taskNode = position; checked = ["x", "X"].includes((await syntax.at(start + 1))!);
            }
          }
        }
      }
      continue;
    }
    await context.cooperate();
    if (block.kind === "paragraph" && extensions.line_blocks) {
      const lines = parser.lines(current);
      let next = await lines.next();
      const first = next.value;
      const marked = async (range: SourceRange) => await source.unit(range.start) === "|" &&
        (range.end === range.start + 1 || [" ", "\t"].includes(await source.unit(range.start + 1)));
      if (first && await marked(first.range)) {
        const content = await ast.array();
        while (!next.done && await marked(next.value.range)) {
          const line = next.value;
          let start = Math.min(line.range.end, line.range.start + 2);
          const begin = start;
          while (start < line.range.end && [" ", "\t"].includes(await source.unit(start))) start++;
          const range = await source.append((async function* () {
            for (let i = begin; i < start; i++) yield "\u00a0";
            yield* source.chunks({start, end: line.range.end});
            next = await lines.next();
            while (!next.done && next.value.column > first.column) {
              yield " "; yield* source.chunks(await source.trim(next.value.range));
              next = await lines.next();
            }
          })());
          await ast.push(content, await inline(range, 1, undefined, line.line));
        }
        await ast.push(out, await ast.tag("LineBlock", content));
        if (!next.done) {
          const range = await source.append((async function* () {
            if (!next.done) yield* source.chunks(next.value.range);
            for await (const line of lines) {yield "\n"; yield* source.chunks(line.range);}
          })());
          await ast.push(out, await ast.tag(tight ? "Plain" : "Para", await inline(range)));
        }
        continue;
      }
    }
    if (block.kind === "paragraph" || block.kind === "heading") {
      let range: SourceRange;
      if (current === taskNode) {
        range = await source.append((async function* () {
          let first = true;
          for await (const line of parser.lines(current)) {
            if (!first) yield "\n";
            let start = line.range.start;
            if (first) {start = Math.min(line.range.end, start + 4); while (start < line.range.end && !(await source.unit(start)).trim()) start++;}
            first = false; yield* source.chunks({start, end: line.range.end});
          }
        })());
      } else range = await parser.joined(current);
      if (block.kind === "paragraph" && extensions.table_captions && position &&
        (await parser.node(position)).kind === "table" && await source.starts(range, "Table:") &&
        [" ", "\t"].includes(await source.unit(range.start + 6))) {
        let start = range.start + 6;
        while (start < range.end && [" ", "\t"].includes(await source.unit(start))) {context.checkpoint(); start++;}
        const caption = await ast.value([await ast.tag("Plain", await inline({start, end: range.end}, block.lineCount, current))]);
        await ast.push(out, await table(position, caption));
        position = (await parser.node(position)).next;
        continue;
      }
      let heading;
      if (block.kind === "heading" && extensions.header_attributes && range.end > range.start && await source.unit(range.end - 1) === "}") {
        let start = range.end;
        while (start > range.start && await source.unit(start - 1) !== "\n") {context.checkpoint(); start--;}
        context.bound("text", range.end - start); context.charge("retainedBytes", (range.end - start) * 2);
        let text = ""; for await (const chunk of source.chunks({start, end: range.end})) text += chunk;
        heading = headingAttributes(text, context);
        if (heading) range = {start: range.start, end: start + heading.end};
      }
      let inlines = await inline(range, block.lineCount, current);
      if (current === taskNode) {
        const content = await ast.array();
        await ast.push(content, await ast.tag("Str", await ast.value(checked ? "☒" : "☐")));
        if (await ast.count(inlines)) await ast.push(content, await ast.tag("Space"));
        for await (const child of ast.children(inlines)) await ast.push(content, child); inlines = content;
      }
      if (block.kind === "paragraph" && extensions.implicit_figures && await ast.count(inlines) === 1) {
        const image = (await ast.edge(inlines))!;
        if (await ast.name(image) === "Image") {
          const caption = (await ast.at((await ast.content(image))!, 1))!;
          if (await ast.count(caption)) {
            await ast.push(out, await ast.tag("Figure", await ast.value([
              await attrs(), [null, [await ast.tag("Plain", caption)]], [await ast.tag("Plain", inlines)]
            ])));
            continue;
          }
        }
      }
      if (block.kind === "heading") {
        const attributes = await ast.value(heading?.attributes ?? ["", [], []]);
        let id = await ast.range((await ast.at(attributes, 0))!);
        if (!id.units && extensions.auto_identifiers) {
          const base = await retainedHeadingIdentifier(ast, inlines);
          id = base;
          for (let suffix = 1; await identifiers.has(id); suffix++) {
            id = await ast.text.from(ast.text.chunks(base));
            await ast.text.append(id, await ast.text.from([`-${suffix}`]));
          }
          await ast.set(attributes, 0, await ast.string(id));
        }
        if (id.units) await identifiers.add(id);
        await ast.push(out, await ast.tag("Header", await ast.value([block.number, attributes, inlines])));
      } else await ast.push(out, await ast.tag(tight ? "Plain" : "Para", inlines));
    } else if (block.kind === "thematicBreak") await ast.push(out, await ast.tag("HorizontalRule"));
    else if (block.kind === "html") {
      const range = await parser.joined(current, "");
      if (extensions.native_divs) {
        const opening = {start: range.start, end: Math.min(range.end, range.start + 8)};
        let prefix = ""; for await (const chunk of source.chunks(opening)) prefix += chunk;
        if (prefix.trimStart().toLowerCase().startsWith("<div")) {
          context.bound("text", range.end - range.start); context.charge("retainedBytes", (range.end - range.start) * 2);
          let text = ""; for await (const chunk of source.chunks(range)) text += chunk;
          const divs = await nativeDivBlocks(text, context);
          if (divs) {
            const retain = async (value: unknown): Promise<RtfValue> => {
              await context.cooperate();
              if (value === null || typeof value === "string" || typeof value === "number") return ast.value(value);
              if (Array.isArray(value)) {
                const array = await ast.array();
                for (const child of value) await ast.push(array, await retain(child));
                return array;
              }
              const object = await ast.object();
              for (const [key, child] of Object.entries(value as object)) await ast.push(object, await ast.value([key, await retain(child)]));
              return object;
            };
            for (const div of divs) await ast.push(out, await retain(await translate(div, "write", context, "$")));
            continue;
          }
        }
      }
      await ast.push(out, await ast.tag("RawBlock", await ast.value(["html", Object.hasOwn(extensions, "raw_html") ? await rawHtml(range) : await literal(range)])));
    } else if (block.kind === "code") {
      const syntax = new RetainedCommonMarkSyntax(source, block.info, context), decoded = await source.append(syntax.decoded(block.info)), info = await source.trim(decoded);
      const space = await source.find(info, " "), name = {start: info.start, end: space < 0 ? info.end : space}, classes = await ast.array();
      if (name.end > name.start) await ast.push(classes, await literal(name));
      let attributes;
      if (extensions.fenced_code_attributes && info.end > info.start && await source.unit(info.start) === "{" && await source.unit(info.end - 1) === "}") {
        context.bound("text", info.end - info.start); context.charge("retainedBytes", (info.end - info.start) * 2);
        let text = ""; for await (const chunk of source.chunks(info)) text += chunk;
        attributes = fencedDivAttributes(text, context);
      }
      const range = await parser.joined(current, "");
      if (range.end > range.start && await source.unit(range.end - 1) === "\n") range.end--;
      await ast.push(out, await ast.tag("CodeBlock", await ast.value([attributes ?? ["", classes, []], await literal(range)])));
    } else if (block.kind === "table") await ast.push(out, await table(current));
    else if (block.kind === "definitionList") {
      const children = await ast.array(); await ast.push(out, await ast.tag("DefinitionList", children));
      await push(); position = block.first; out = children; mode = 2; depth++; taskNode = 0;
    }
    else if (block.kind === "div" || block.kind === "quote" || block.kind === "list") {
      const children = await ast.array();
      let attributes;
      if (block.kind === "div") {
        context.bound("text", block.info.end - block.info.start); context.charge("retainedBytes", (block.info.end - block.info.start) * 2);
        let text = ""; for await (const chunk of source.chunks(block.info)) text += chunk;
        attributes = fencedDivAttributes(text, context);
      }
      await ast.push(out, block.kind === "div" ? await ast.tag("Div", await ast.value([attributes!, children])) : block.kind === "quote" ? await ast.tag("BlockQuote", children) : Number.isNaN(block.number) ? await ast.tag("BulletList", children) :
        await ast.tag("OrderedList", await ast.value([[block.number, await ast.tag(block.style === 1 ? "LowerRoman" : block.style === 2 ? "UpperRoman" : "Decimal"), await ast.tag(block.marker === 41 ? "OneParen" : "Period")], children])));
      await push(); position = block.first; out = children; depth++; tight = block.kind === "list" && !!block.tight; mode = block.kind === "list" ? 1 : 0; taskNode = 0;
    }
  }
}
