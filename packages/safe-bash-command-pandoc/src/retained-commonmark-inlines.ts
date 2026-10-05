import type {PagedStorage} from "safe-bash-io-engine/storage";
import type {AdapterContext} from "safe-bash-markdown-engine/types";
import {asciiPunctuation, digit, entity, letter, normalizeLabel} from "./commonmark-syntax.js";
import {unicodePunctuation, unicodeWhitespace} from "./commonmark-characters.js";
import type {RetainedCommonMarkSyntax} from "./retained-commonmark-syntax.js";
import type {SourceRange} from "./retained-source-text.js";
import type {RetainedRtfAst, RtfValue} from "./retained-rtf-ast.js";

/** All variable-sized inline state lives on the parser tape. Each loaded record
 * has at most nine scalars; delimiter lower bounds have eighteen possible keys. */
export async function parseRetainedCommonMarkInlines(
  syntax: RetainedCommonMarkSyntax, tape: PagedStorage, ast: RetainedRtfAst, context: AdapterContext,
  extensions: Readonly<Record<string, boolean>> = {},
  definition?: (label: string) => Promise<{destination: SourceRange; title: SourceRange} | undefined>,
  counts: {lines: number; definitions: number} = {lines: 1, definitions: 0}
): Promise<RtfValue> {
  context.checkpoint(0);
  const size = syntax.range.end - syntax.range.start;
  context.bound("text", size);
  context.charge("retainedBytes", size * 4 + counts.lines * 16);
  context.bound("references", counts.definitions);
  context.charge("retainedBytes", counts.definitions * 48);
  const put = async (position: number, fields: readonly number[]) => {
    const bytes = new Uint8Array(fields.length * 8), view = new DataView(bytes.buffer);
    fields.forEach((value, index) => view.setFloat64(index * 8, value, true)); await tape.write(position, bytes);
  };
  const add = async (fields: readonly number[]) => {const position = tape.allocate(fields.length * 8); await put(position, fields); return position;};
  const get = async (position: number, count: number) => {
    const bytes = await tape.read(position, count * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    return Array.from({length: count}, (_, index) => view.getFloat64(index * 8, true));
  };
  const char = syntax.at.bind(syntax);
  const literal = async (range: SourceRange) => ast.string(await ast.text.from(syntax.source.chunks(range)));
  // Nodes: value, literal flag, first child, previous, next.
  const root = await add([0, 0, 0, 0, 0]); let tail = root, delimiter = 0, bracket = 0, bracketCount = 0, delimiterCount = 0, serial = 0;
  const append = async (value: RtfValue, text = false, children = 0) => {
    context.charge("nodes", 1); context.charge("retainedBytes", 128 + (text ? (await ast.range(value)).units * 2 : 0));
    const node = await add([value.position, Number(text), children, tail, 0]); await put(tail + 32, [node]); tail = node; return node;
  };
  const appendRange = async (start: number, end: number) => append(await literal({start, end}), true);
  const removeNode = async (node: number) => {
    const fields = await get(node, 5), previous = fields[3]!, next = fields[4]!;
    if (previous) await put(previous + 32, [next]);
    if (next) await put(next + 24, [previous]); else tail = previous || root;
  };
  // Delimiters: node, character code, length, original, opens, closes, serial, previous, next.
  const removeDelimiter = async (entry: number) => {
    const fields = await get(entry, 9), previous = fields[7]!, next = fields[8]!;
    if (previous) await put(previous + 64, [next]);
    if (next) await put(next + 56, [previous]); else delimiter = previous;
    delimiterCount--;
  };
  const repeat = async (unit: string, count: number) => ast.string(await ast.text.from((async function* () {for (let i = 0; i < count; i += 4096) yield unit.repeat(Math.min(4096, count - i));})()));
  const emphasis = async (bottom: number) => {
    const lower = bottom ? (await get(bottom, 7))[6]! : -1, bottoms = new Map<string, number>();
    let closer = bottom ? (await get(bottom, 9))[8]! : delimiter;
    if (!bottom) while (closer) {const previous = (await get(closer, 8))[7]!; if (!previous) break; closer = previous;}
    while (closer) {
      await context.cooperate(); const close = await get(closer, 9);
      if (!close[5]) {closer = close[8]!; continue;}
      const key = `${close[1]}:${close[4]}:${close[3]! % 3}`, floor = bottoms.get(key) ?? lower;
      let opener = close[7]!, open: number[] | undefined;
      while (opener) {
        await context.cooperate(); open = await get(opener, 9);
        if (open[6]! <= floor) break;
        if (open[1] === close[1] && open[4] && (close[1] === 126 ? open[3] === close[3] : !((close[4] || open[5]) && (open[3]! + close[3]!) % 3 === 0 && (open[3]! % 3 !== 0 || close[3]! % 3 !== 0)))) break;
        opener = open[7]!;
      }
      if (!opener || !open || open[6]! <= floor) {
        bottoms.set(key, close[7] ? (await get(close[7], 7))[6]! : lower);
        if (!close[4]) await removeDelimiter(closer); closer = close[8]!; continue;
      }
      const count = open[2]! >= 2 && close[2]! >= 2 ? 2 : 1;
      open[2] = open[2]! - count; close[2] = close[2]! - count;
      await put(opener + 16, [open[2]]); await put(closer + 16, [close[2]]);
      await put(open[0]!, [(await repeat(String.fromCharCode(open[1]!), open[2])).position]);
      await put(close[0]!, [(await repeat(String.fromCharCode(close[1]!), close[2])).position]);
      const first = (await get(open[0]!, 5))[4]!, last = (await get(close[0]!, 4))[3]!;
      context.charge("nodes", 1); context.charge("retainedBytes", 128);
      const value = await ast.tag(open[1] === 126 ? "Strikeout" : count === 2 ? "Strong" : "Emph", await ast.array());
      const wrap = await add([value.position, 0, first, open[0]!, close[0]!]);
      if (first) await put(first + 24, [0]); if (last) await put(last + 32, [0]);
      await put(open[0]! + 32, [wrap]); await put(close[0]! + 24, [wrap]);
      let between = open[8]!;
      while (between && between !== closer) {const next = (await get(between, 9))[8]!; await removeDelimiter(between); between = next;}
      if (!open[2]) {await removeNode(open[0]!); await removeDelimiter(opener);}
      if (!close[2]) {const next = close[8]!; await removeNode(close[0]!); await removeDelimiter(closer); closer = next;}
    }
    while (delimiter && (await get(delimiter, 7))[6]! > lower) await removeDelimiter(delimiter);
  };
  // Brackets: node, start, image, active, nested, delimiter, previous.
  const deactivateLinks = async () => {for (let entry = bracket; entry;) {await context.cooperate(); const fields = await get(entry, 7); if (!fields[2]) await put(entry + 24, [0]); entry = fields[6]!;}};
  const scalar = async (position: number) => {
    const high = await char(position); if (high === undefined) return;
    const low = await char(position + 1), code = high.charCodeAt(0), next = low?.charCodeAt(0) ?? 0;
    return code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff ? high + low : high;
  };
  // Backtick runs are indexed by length in a caller-backed hash table. Values
  // hold a forward cursor, so unsuccessful runs do not rescan source suffixes.
  const buckets = tape.allocate(256 * 8); await tape.write(buckets, new Uint8Array(256 * 8));
  const tickEntry = async (length: number, create: boolean) => {
    const bucket = buckets + length % 256 * 8; let entry = (await get(bucket, 1))[0]!;
    while (entry) {const fields = await get(entry, 4); if (fields[0] === length) return entry; entry = fields[3]!;}
    if (!create) return 0;
    entry = await add([length, 0, 0, (await get(bucket, 1))[0]!]); await put(bucket, [entry]); return entry;
  };
  for (let i = syntax.range.start; i < syntax.range.end;) {
    if (await char(i) !== "`") {i++; continue;}
    const begin = i; while (await char(i) === "`") {await context.cooperate(); i++;}
    context.charge("references", 1); context.charge("retainedBytes", 16);
    const entry = await tickEntry(i - begin, true), fields = await get(entry, 4), run = await add([begin, 0]);
    if (fields[2]) await put(fields[2]! + 8, [run]); else await put(entry + 8, [run]);
    await put(entry + 16, [run]);
  }
  for (let i = syntax.range.start; i < syntax.range.end;) {
    await context.cooperate(); const unit = (await char(i))!;
    if (unit === "\\") {
      if (await char(i + 1) === "\n") {await append(await ast.tag("LineBreak")); i = await syntax.spaces(i + 2);}
      else if (asciiPunctuation(await char(i + 1))) {await appendRange(i + 1, i + 2); i += 2;}
      else {await appendRange(i, i + 1); i++;} continue;
    }
    if (unit === "`") {
      let end = i; while (await char(end) === "`") {await context.cooperate(); end++;}
      const count = end - i, entry = await tickEntry(count, false); let run = entry ? (await get(entry, 2))[1]! : 0;
      while (run && (await get(run, 1))[0]! <= i) run = (await get(run, 2))[1]!;
      if (entry) await put(entry + 8, [run]);
      if (!run) {await appendRange(i, end); i = end; continue;}
      const close = (await get(run, 1))[0]!;
      context.charge("retainedBytes", (close - end) * 4);
      let start = end, stop = close;
      if ([" ", "\n"].includes(await char(start) ?? "") && [" ", "\n"].includes(await char(stop - 1) ?? "")) {
        let nonspace = false; for (let at = start; at < stop; at++) if (![" ", "\n"].includes(await char(at) ?? "")) {nonspace = true; break;}
        if (nonspace) {start++; stop--;}
      }
      const code = await ast.string(await ast.text.from((async function* () {for await (const text of syntax.source.chunks({start, end: stop})) yield text.replaceAll("\n", " ");})()));
      await append(await ast.tag("Code", await ast.value([["", [], []], code]))); i = close + count; continue;
    }
    if (unit === "*" || unit === "_" || unit === "~" && extensions.strikeout) {
      let end = i; while (await char(end) === unit) {await context.cooperate(); end++;}
      if (unit === "~" && end - i !== 2 && !(extensions.single_tilde && end - i === 1)) {await appendRange(i, end); i = end; continue;}
      const before = await char(i - 1), code = before?.charCodeAt(0) ?? 0;
      const previous = code >= 0xdc00 && code <= 0xdfff ? await scalar(i - 2) : before, next = await scalar(end);
      const left = !unicodeWhitespace(next) && (!unicodePunctuation(next) || unicodeWhitespace(previous) || unicodePunctuation(previous));
      const right = !unicodeWhitespace(previous) && (!unicodePunctuation(previous) || unicodeWhitespace(next) || unicodePunctuation(next));
      const node = await appendRange(i, end); context.bound("references", ++delimiterCount + bracketCount); context.charge("retainedBytes", 96);
      const entry = await add([node, unit.charCodeAt(0), end - i, end - i, Number(unit !== "_" ? left : left && (!right || unicodePunctuation(previous))), Number(unit !== "_" ? right : right && (!left || unicodePunctuation(next))), serial++, delimiter, 0]);
      if (delimiter) await put(delimiter + 64, [entry]); delimiter = entry; i = end; continue;
    }
    if (unit === "[" || unit === "!" && await char(i + 1) === "[") {
      const image = unit === "!", node = await appendRange(i, i + (image ? 2 : 1));
      context.bound("references", ++bracketCount + delimiterCount); context.charge("retainedBytes", 96);
      if (bracket) await put(bracket + 32, [1]);
      bracket = await add([node, i + (image ? 2 : 1), Number(image), 1, 0, delimiter, bracket]); i += image ? 2 : 1; continue;
    }
    if (unit === "]") {
      if (!bracket) {await appendRange(i, i + 1); i++; continue;}
      const opener = await get(bracket, 7); bracket = opener[6]!; bracketCount--;
      if (!opener[3]) {await appendRange(i, i + 1); i++; continue;}
      let target = await syntax.target(i + 1);
      if (!target && definition) {
        const explicit = await syntax.label(i + 1); let label: string | undefined, end = i + 1;
        if (explicit?.label) {label = explicit.label; end = explicit.end;}
        else if (!opener[4] && i - opener[1]! <= 1998) {
          const scanned = await syntax.label(opener[1]! - 1);
          if (scanned && scanned.end === i + 1) {label = scanned.label; end = explicit?.end ?? end;}
        }
        const found = label === undefined ? undefined : await definition(normalizeLabel(label, context));
        if (found) target = {url: found.destination, title: found.title, end};
      }
      if (!target) {await appendRange(i, i + 1); i++; continue;}
      await emphasis(opener[5]!);
      const first = (await get(opener[0]!, 5))[4]!;
      if (first) await put(first + 24, [0]); await put(opener[0]! + 32, [0]); tail = opener[0]!;
      const url = await ast.string(await ast.text.from(syntax.uri(syntax.decoded(target.url))));
      const title = await ast.string(await ast.text.from(syntax.decoded(target.title)));
      const value = await ast.tag(opener[2] ? "Image" : "Link", await ast.value([["", [], []], await ast.array(), [url, title]]));
      await append(value, false, first); await removeNode(opener[0]!); if (!opener[2]) await deactivateLinks(); i = target.end; continue;
    }
    if (unit === "<" || extensions.autolink_bare_uris && !bracket) {
      const auto = await syntax.autolink(i, unit !== "<");
      if (auto) {
        const label = await literal(auto.label), children = await ast.array(); await ast.push(children, await ast.tag("Str", label));
        const uri = syntax.uri((async function* () {if (auto.prefix) yield auto.prefix; yield* syntax.source.chunks(auto.label);})());
        const target = await ast.string(await ast.text.from(uri));
        await append(await ast.tag("Link", await ast.value([["", [], []], children, [target, ""]])));
        await deactivateLinks(); i = auto.end; continue;
      }
      if (unit === "<") {
        const end = await syntax.html(i);
        if (end !== undefined) {
          if (extensions.raw_html === false || Object.hasOwn(extensions, "raw_html") && await syntax.filteredHtml({start: i, end})) await appendRange(i, end);
          else await append(await ast.tag("RawInline", await ast.value(["html", await literal({start: i, end})])));
          i = end; continue;
        }
      }
    }
    if (unit === "&") {
      const window = await syntax.small({start: i, end: Math.min(syntax.range.end, i + 34)}, 34), decoded = entity(window, 0, context);
      if (decoded) {await append(await ast.value(decoded.value), true); i += decoded.end; continue;}
    }
    if (unit === " " || unit === "\t" || unit === "\n") {
      const begin = i; while (await char(i) === " " || await char(i) === "\t") {await context.cooperate(); i++;}
      if (await char(i) === "\n") {
        await append(await ast.tag(i - begin >= 2 && await char(i - 1) === " " && await char(i - 2) === " " ? "LineBreak" : "SoftBreak")); i = await syntax.spaces(i + 1);
      } else if (i < syntax.range.end) await appendRange(begin, i);
      continue;
    }
    const begin = i++;
    while (i < syntax.range.end && !"\\`*_~[]!<& \t\n".includes((await char(i))!)) {
      if (extensions.autolink_bare_uris && (await syntax.starts(i, "https://") || await syntax.starts(i, "http://") || await syntax.starts(i, "ftp://") || await syntax.starts(i, "www.") ||
        (letter(await char(i)) || digit(await char(i))) && !letter(await char(i - 1)) && !digit(await char(i - 1)) && !".-_+".includes(await char(i - 1) ?? ""))) break;
      await context.cooperate(); i++;
    }
    await appendRange(begin, i);
  }
  await emphasis(0);
  // Materialize directly into the backed AST. Traversal frames and the string
  // being coalesced use backing storage, including arbitrarily deep emphasis.
  const output = await ast.array(); let out = output, node = (await get(root, 5))[4]!, frame = 0, depth = 1, pending: RtfValue | undefined, fragments = 0, length = 0;
  const push = async (value: RtfValue) => {context.charge("nodes", 1); context.charge("retainedBytes", 64); await ast.push(out, value);};
  const flush = async () => {
    if (pending) {context.checkpoint(fragments); context.charge("retainedBytes", length * 2); await push(await ast.tag("Str", pending)); pending = undefined; fragments = length = 0;}
  };
  for (;;) {
    context.bound("depth", depth);
    if (!node) {
      await flush(); if (!frame) return output;
      const fields = await get(frame, 5); frame = fields[0]!; node = fields[1]!; out = {position: fields[2]!}; depth = fields[3]!;
      continue;
    }
    await context.cooperate(); const fields = await get(node, 5), value = {position: fields[0]!};
    if (fields[1]) {
      let fragmentLength = 0;
      const finishFragment = () => {
        context.checkpoint(fragmentLength + 1);
        if (fragmentLength) {context.charge("retainedBytes", fragmentLength * 2 + 16); fragments++; length += fragmentLength; fragmentLength = 0;}
      };
      for await (const chunk of ast.text.chunks(await ast.range(value))) {
        let start = 0;
        while (start < chunk.length) {
          const space = chunk.indexOf(" ", start), end = space < 0 ? chunk.length : space;
          if (end > start) {
            fragmentLength += end - start;
            const text = await ast.text.from([chunk.slice(start, end)]);
            if (pending) await ast.appendText(pending, text); else pending = await ast.string(text);
          }
          if (space >= 0) {finishFragment(); await flush(); await push(await ast.tag("Space"));}
          start = end + 1;
        }
      }
      if (fragmentLength) finishFragment();
      node = fields[4]!; continue;
    }
    await flush(); await push(value);
    if (!fields[2]) {node = fields[4]!; continue;}
    const children = await ast.array(), name = (await ast.name(value))!;
    if (name === "Link" || name === "Image") await ast.set((await ast.content(value))!, 1, children);
    else await ast.replaceTag(value, name, children);
    frame = await add([frame, fields[4]!, out.position, depth, value.position]); out = children; node = fields[2]!; depth++;
  }
}
