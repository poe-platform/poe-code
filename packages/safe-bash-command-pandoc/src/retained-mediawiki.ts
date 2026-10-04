import {RetainedOrigins} from "./retained-origins.js";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {RetainedSourceText, type SourceRange} from "./retained-source-text.js";
import {RetainedRtfAst, type RtfValue} from "./retained-rtf-ast.js";
import {BackedJson} from "./backed-json.js";
import {readRetainedJson} from "./retained-json.js";
import {retainInput} from "./retained-input.js";
import type {ExecutionContext} from "./execution.js";
import type {InputSource, WorkingStorageOptions} from "./types.js";

/** MediaWiki source, parser continuations and document nodes stay in caller storage. */
export async function readRetainedMediawiki(inputs: readonly InputSource[], context: ExecutionContext, working: WorkingStorageOptions, fileScope = false, onReaderStarted?: (index: number) => void) {
  const cache = working.cacheBytes ?? 1048576;
  if (!Number.isSafeInteger(cache) || cache < 16384 || cache % 16384) context.fail("E_OPTION", "Working storage cacheBytes must be a positive multiple of 16384");
  if (typeof working.directory !== "string" || !working.directory.startsWith("/")) context.fail("E_OPTION", "Working storage requires an absolute caller filesystem directory");
  const owner = {fs: working.fs, cwd: working.directory, env: {}, signal: context.signal ?? new AbortController().signal};
  const source = new PagedStorage(owner, cache / 16384), records = new PagedStorage(owner, cache / 16384), nodes = new PagedStorage(owner, cache / 16384), wire = new PagedStorage(owner, cache / 16384);
  const combined = new PagedStorage(owner, cache / 16384);
  const stores = [source, records, nodes, wire, combined];
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {let error: unknown; for (const store of stores) {try {await store.close();} catch (reason) {error ??= reason;}} release(); if (error) throw error;})();
  const release = context.onClose(close);
  try {
    const text = new RetainedSourceText(source, units => context.cooperate(units));
    const put = async (values: readonly number[]) => {
      const bytes = new Uint8Array(values.length * 8), view = new DataView(bytes.buffer);
      values.forEach((value, index) => view.setFloat64(index * 8, value, true));
      return records.append(bytes);
    };
    const get = async (position: number, count: number) => {
      const bytes = await records.read(position, count * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      return Array.from({length: count}, (_, index) => view.getFloat64(index * 8, true));
    };
    let first = -1, previous = -1;
    for (const input of inputs) {
      context.charge("references", 1);
      const start = text.length;
      await context.decodeUtf8To(retainInput("bytes" in input ? [input.bytes] : input.chunks, context, records, ["inputBytes"], true), async chunk => {await text.append([chunk]);}, [], false);
      context.charge("retainedBytes", (text.length - start) * 2);
      const position = await put([start, text.length, -1, 0]);
      if (previous >= 0) {
        const next = new Uint8Array(8); new DataView(next.buffer).setFloat64(0, position, true);
        await records.write(previous + 16, next);
      } else first = position;
      previous = position;
    }
    let sourceStart = 0;
    if (!fileScope) {
      sourceStart = text.length;
      for (let position = first; position >= 0;) {
        const [start, end, next] = await get(position, 3);
        if (position !== first) {context.charge("retainedBytes", 2); await text.append(["\n"]);}
        context.charge("retainedBytes", (end! - start!) * 2 + 2);
        await text.append(text.chunks({start: start!, end: end!}));
        if (end === start || await text.unit(end! - 1) !== "\n") await text.append(["\n"]);
        position = next!;
      }
      context.charge("retainedBytes", (text.length - sourceStart) * 2);
      context.charge("retainedBytes", (text.length - sourceStart) * 3);
    }
    const parse = async (sourceStart: number, sourceEnd: number) => {
    const lineStart = records.allocate(0); let lineCount = 0, start = sourceStart, cursor = sourceStart;
    for await (const chunk of text.chunks({start: sourceStart, end: sourceEnd})) for (const char of chunk.split("")) {
      if (char === "\n") {await put([start, cursor]); start = cursor + 1; lineCount++;} cursor++;
    }
    await put([start, sourceEnd]); lineCount++;
    const line = async (index: number): Promise<SourceRange> => {const [start, end] = await get(lineStart + index * 16, 2); return {start: start!, end: end!};};
    const ast = new RetainedRtfAst(nodes, units => context.cooperate(units)), blocks = await ast.array();
    const literal = async (range: SourceRange) => ast.string(await ast.text.from(text.chunks(range)));
    const attr = async () => ast.value(["", [], []]);
    const plain = async (range: SourceRange, out: RtfValue) => {
      let start = range.start;
      while (start < range.end) {
        const space = await text.unit(start) === " "; let end = start + 1;
        while (end < range.end && (await text.unit(end) === " ") === space) {end++; if (end % 256 === 0) await context.cooperate(256);}
        await ast.push(out, space ? await ast.tag("Space") : await ast.tag("Str", await literal({start, end}))); start = end;
      }
    };
    type Match = {end: number; kind: "Image" | "Link" | "Strong" | "Emph" | "Code" | "Strikeout"; content: SourceRange; target?: SourceRange};
    const match = async (start: number, end: number): Promise<Match | undefined> => {
      const range = {start, end};
      if (await text.starts(range, "[[")) {
        for (const file of await text.starts(range, "[[File:") ? [true, false] : [false]) {
        const begin = start + (file ? 7 : 2);
        let stop = begin;
        while (stop < end && !["|", "]"].includes(await text.unit(stop))) {stop++; if (stop % 256 === 0) await context.cooperate(256);}
        if (stop > begin) {
          const target = await text.trim({start: begin, end: stop}); let content = target;
          if (await text.unit(stop) === "|") {const close = await text.find({start: stop + 1, end}, "]"); if (close < 0) return; content = {start: stop + 1, end: close}; stop = close;}
          else if (file) content = {start: stop, end: stop};
          if (await text.starts({start: stop, end}, "]]")) {
            if (file) {for (let i = content.start; i < content.end; i++) if (await text.unit(i) === "|") content.start = i + 1;}
            return {end: stop + 2, kind: file ? "Image" : "Link", target, content: await text.trim(content)};
          }
        }
        }
      }
      if (await text.unit(start) === "[" && (await text.starts({start: start + 1, end}, "https://") || await text.starts({start: start + 1, end}, "http://") || await text.starts({start: start + 1, end}, "mailto:"))) {
        let stop = start + 1;
        while (stop < end && await text.unit(stop) !== "]" && (await text.unit(stop)).trim()) stop++;
        const target = {start: start + 1, end: stop}; let content = target;
        const prefix = await text.starts(target, "https://") ? 8 : 7;
        if (stop - start - 1 <= prefix) return;
        if (stop < end && await text.unit(stop) !== "]") {
          const whitespace = stop;
          while (stop < end && !(await text.unit(stop)).trim()) stop++;
          const close = await text.find({start: stop, end}, "]");
          if (close < stop || close === stop && stop - whitespace < 2) return;
          content = await text.trim({start: stop, end: close}); stop = close;
        }
        if (stop < end && await text.unit(stop) === "]") return {end: stop + 1, kind: "Link", target, content};
      }
      for (const [open, close, kind, empty] of [["'''", "'''", "Strong", false], ["''", "''", "Emph", false], ["<code>", "</code>", "Code", true], ["<s>", "</s>", "Strikeout", true]] as const) {
        if (!await text.starts(range, open)) continue;
        const begin = start + open.length, stop = await text.find({start: begin + (empty ? 0 : 1), end}, close);
        if (stop >= 0) return {end: stop + close.length, kind, content: {start: begin, end: stop}};
      }
      return undefined;
    };
    const inlines = async (range: SourceRange): Promise<RtfValue> => {
      const root = await ast.array(); let out = root, end = range.end, cursor = range.start, pending = cursor, parent = 0;
      for (;;) {
        if (cursor >= end) {
          await plain({start: pending, end}, out);
          if (!parent) return root;
          const frame = await get(parent, 5); [parent, cursor, end, pending] = frame as [number, number, number, number, number]; out = {position: frame[4]!}; continue;
        }
        const char = await text.unit(cursor);
        const token = char === "[" || char === "'" || char === "<" ? await match(cursor, end) : undefined;
        if (!token) {cursor++; if (cursor % 256 === 0) await context.cooperate(256); continue;}
        await plain({start: pending, end: cursor}, out);
        const child = await ast.array();
        let node: RtfValue;
        if (token.kind === "Link" || token.kind === "Image") node = await ast.tag(token.kind, await ast.value([await attr(), child, [await literal(token.target!), ""]]));
        else if (token.kind === "Code") node = await ast.tag("Code", await ast.value([await attr(), await literal(token.content)]));
        else node = await ast.tag(token.kind, child);
        await ast.push(out, node); cursor = pending = token.end;
        if (token.kind === "Image") await plain(token.content, child);
        else if (token.kind !== "Code") {
          parent = await put([parent, cursor, end, pending, out.position]); out = child; cursor = pending = token.content.start; end = token.content.end;
        }
      }
    };
    const heading = async (range: SourceRange) => {
      let prefix = 0, suffix = 0;
      while (await text.unit(range.start + prefix) === "=" && range.start + prefix < range.end) prefix++;
      while (await text.unit(range.end - suffix - 1) === "=" && range.end - suffix > range.start) suffix++;
      const count = Math.min(prefix, suffix, Math.floor((range.end - range.start - 1) / 2));
      if (!count) return undefined;
      let content = await text.trim({start: range.start + count, end: range.end - count});
      if (content.start === content.end) content = {start: range.end - count - 1, end: range.end - count};
      for (let i = content.start; i < content.end; i++) if (["\u2028", "\u2029"].includes(await text.unit(i))) return undefined;
      return {level: Math.min(6, count), content};
    };
    const rule = async (range: SourceRange) => {if (range.end - range.start < 4) return false; for (let i = range.start; i < range.end; i++) if (await text.unit(i) !== "-") return false; return true;};
    let index = 0;
    while (index < lineCount) {
      await context.cooperate(); const raw = await line(index), trimmed = await text.trim(raw);
      if (trimmed.start === trimmed.end) {index++; continue;}
      const title = await heading(trimmed);
      if (title) {
        const lowered = await ast.text.lower(await ast.text.from(text.chunks(title.content)));
        const slug = await ast.text.from((async function* () {let pending = false, any = false, buffer = ""; for await (const chunk of ast.text.chunks(lowered)) for (const char of chunk) {if (char >= "a" && char <= "z" || char >= "0" && char <= "9") {if (pending && any) buffer += "-"; buffer += char; pending = false; any = true;} else pending = true; if (buffer.length >= 4096) {yield buffer; buffer = "";}} if (buffer) yield buffer; if (!any) yield "section";})());
        await ast.push(blocks, await ast.tag("Header", await ast.value([title.level, [await ast.string(slug), [], []], await inlines(title.content)]))); index++; continue;
      }
      if (await rule(trimmed)) {await ast.push(blocks, await ast.tag("HorizontalRule")); index++; continue;}
      if (await text.starts(trimmed, "<pre") || await text.starts(trimmed, "<syntaxhighlight")) {
        let language: SourceRange = {start: 0, end: 0};
        let lang = await text.find(trimmed, "lang=");
        while (lang >= 0) {
        if ( ["'", '"'].includes(await text.unit(lang + 5))) {
          let end = lang + 6; while (end < trimmed.end && !["'", '"'].includes(await text.unit(end))) end++;
          if (end > lang + 6 && end < trimmed.end) {language = {start: lang + 6, end}; break;}
        }
        lang = await text.find({start: lang + 5, end: trimmed.end}, "lang=");
        }
        const first = ++index;
        while (index < lineCount) {const current = await text.trim(await line(index)); if (await text.starts(current, "</pre>") || await text.starts(current, "</syntaxhighlight>")) break; index++;}
        const code = first < index ? {start: (await line(first)).start, end: (await line(index - 1)).end} : {start: 0, end: 0};
        await ast.push(blocks, await ast.tag("CodeBlock", await ast.value([["", language.end > language.start ? [await literal(language)] : [], []], await literal(code)])));
        if (index < lineCount) index++; continue;
      }
      if (await text.starts(trimmed, "{|")) {
        const headers = await ast.array(), body = await ast.array(); let cells = await ast.array(), isHeader = false, width = 1;
        const flush = async () => {const count = await ast.count(cells); if (!count) return; width = Math.max(width, count); await ast.push(isHeader && !await ast.count(body) ? headers : body, await ast.value([await attr(), cells])); cells = await ast.array(); isHeader = false;};
        index++;
        while (index < lineCount) {
          const current = await text.trim(await line(index++));
          if (await text.starts(current, "|}")) {await flush(); break;}
          if (await text.starts(current, "|-")) {await flush(); continue;}
          if (await text.starts(current, "|+")) continue;
          const marker = await text.unit(current.start); if (marker !== "!" && marker !== "|") continue;
          if (marker === "!") isHeader = true;
          let start = current.start + 1;
          for (;;) {
            const stop = await text.find({start, end: current.end}, marker + marker), end = stop < 0 ? current.end : stop;
            const value = {start, end}; const pipe = await text.find(value, "|");
            if (pipe >= 0 && await text.find(value, "[[") < 0) value.start = pipe + 1;
            await ast.push(cells, await ast.value([await attr(), await ast.tag("AlignDefault"), 1, 1, [await ast.tag("Plain", await inlines(await text.trim(value)))]]));
            if (stop < 0) break; start = stop + 2;
          }
        }
        const specs = await ast.array(); for (let i = 0; i < width; i++) await ast.push(specs, await ast.value([await ast.tag("AlignDefault"), await ast.tag("ColWidthDefault")]));
        await ast.push(blocks, await ast.tag("Table", await ast.value([await attr(), [null, []], specs, [await attr(), headers], [[await attr(), 0, [], body]], [await attr(), []]]))); continue;
      }
      const marker = await text.unit(trimmed.start);
      if (marker === "*" || marker === "#") {
        const items = await ast.array();
        while (index < lineCount) {
          let current = await text.trim(await line(index)); if (await text.unit(current.start) !== marker) break;
          while (current.start < current.end && ["*", "#"].includes(await text.unit(current.start))) current.start++;
          current = await text.trim(current);
          await ast.push(items, await ast.value([await ast.tag("Plain", await inlines(current))])); index++;
        }
        await ast.push(blocks, marker === "*" ? await ast.tag("BulletList", items) : await ast.tag("OrderedList", await ast.value([[1, await ast.tag("Decimal"), await ast.tag("Period")], items]))); continue;
      }
      const begin = index;
      const paragraph = await text.append((async function* () {
        while (index < lineCount) {
          const current = await text.trim(await line(index)); const first = await text.unit(current.start);
          if (index !== begin && (current.start === current.end || first === "=" && await text.unit(current.end - 1) === "=" || await text.starts(current, "{|") || first === "*" || first === "#" || await rule(current))) break;
          if (index > begin) yield " "; yield* text.chunks(current); index++;
        }
      })());
      await ast.push(blocks, await ast.tag("Para", await inlines(paragraph)));
    }
    const tree = new BackedJson(wire, units => context.cooperate(units));
    await tree.begin("object"); await tree.key("pandoc-api-version"); await tree.value([1, 23, 1, 2]); await tree.key("meta"); await tree.value({}); await tree.key("blocks"); await ast.write(blocks, tree); await tree.end();
    const document = await readRetainedJson({chunks: tree.chunks()}, context, working, false);
    return document;
    };
    if (!fileScope || inputs.length === 1) {
      onReaderStarted?.(0);
      const document = await parse(sourceStart, text.length);
      await close(); return document;
    }
    const encoder = new TextEncoder();
    const begin = combined.allocate(0); let length = 0, count = 0, index = 0;
    const append = async (bytes: Uint8Array) => {await combined.append(bytes); length += bytes.length;};
    await append(encoder.encode('{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":['));
    for (let position = first; position >= 0;) {
      const [start, end, next] = await get(position, 3);
      onReaderStarted?.(index++);
      const document = await parse(start!, end!);
      onReaderStarted?.(-1);
      try {
        const blocks = (await document.tree.property(document.tree.rootPosition, "blocks"))!;
        const blockCount = (await document.tree.describe(blocks)).children;
        const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, blockCount, true); await records.write(position + 24, bytes);
        context.charge("references", blockCount);
        for await (const block of document.tree.children(blocks)) {
          if (count++) await append(encoder.encode(","));
          for await (const bytes of document.tree.chunks(block, document.order)) await append(bytes);
        }
      } finally {await document.close();}
      position = next!;
    }
    onReaderStarted?.(-1);
    await append(encoder.encode("]}"));
    const document = await readRetainedJson({chunks: (async function* () {
      for (let offset = 0; offset < length; offset += 16384) yield await combined.read(begin + offset, Math.min(16384, length - offset));
    })()}, context, working, false, false);
    const originStorage = new PagedStorage(owner, cache / 16384);
    const releaseOrigins = context.onClose(() => originStorage.close());
    const origins = new RetainedOrigins(originStorage, units => context.cooperate(units)); origins.clear();
    const blocks = (await document.tree.property(document.tree.rootPosition, "blocks"))!;
    let position = first, sourceIndex = 1, remaining = (await get(first + 24, 1))[0]!;
    for await (const block of document.tree.children(blocks)) {
      while (!remaining) {position = (await get(position + 16, 1))[0]!; sourceIndex++; remaining = (await get(position + 24, 1))[0]!;}
      remaining--;
      const end = (await document.tree.describe(block)).end;
      for (let node = block; node < end;) {
        const header = await document.tree.describe(node);
        if (header.kind === "object") {
          const tag = await document.tree.property(node, "t");
          if (tag !== undefined && await document.tree.smallText(tag, 5) === "Image") {
            let target = (await document.tree.property(node, "c"))! + 32;
            for (let i = 0; i < 2; i++) target = (await document.tree.describe(target)).end;
            await origins.seed(target + 32, sourceIndex);
          }
        }
        node = header.kind === "array" || header.kind === "object" ? node + 32 : header.end;
        await context.cooperate();
      }
    }
    await close();
    return {...document, referencesAggregated: true, origins, originFor: (source: number) => inputs[source - 1]!, async closeResources() {
      try {await originStorage.close();} finally {releaseOrigins();}
    }};
  } catch (error) {try {await close();} catch { /* Preserve the conversion failure. */ } throw error;}
}
