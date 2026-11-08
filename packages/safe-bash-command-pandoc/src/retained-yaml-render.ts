/*!
 * YAML flow collection presentation adapted from yaml 2.9.0.
 * Copyright Eemeli Aro <eemeli@gmail.com>
 *
 * Permission to use, copy, modify, and/or distribute this software for any purpose
 * with or without fee is hereby granted, provided that the above copyright notice
 * and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
 * REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
 * FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
 * INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
 * OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
 * TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
 * THIS SOFTWARE.
 */
import type {PagedStorage} from "safe-bash-io-engine/storage";
import {emptyText, type TextRange} from "./backed-text.js";
import type {RetainedSourceText, SourceRange} from "./retained-source-text.js";
import type {RetainedYamlValues, RetainedYamlValue, RetainedYamlPresentation} from "./retained-yaml-value.js";
import {RetainedYamlSyntaxError} from "./retained-yaml-scalar.js";
import {renderRetainedYamlFlowString} from "./retained-yaml-string.js";

const collection = (node: RetainedYamlValue) => ["map", "seq", "set", "omap"].includes(node.kind);

/** Render the original YAML collection used as an object key. Work frames,
 * intermediate strings and collection lines all use caller-authorized storage. */
export async function renderRetainedYamlKey(graph: RetainedYamlValues, source: RetainedSourceText, root: number,
  storage: PagedStorage, cooperate: (units?: number) => Promise<void>): Promise<TextRange> {
  const text = graph.text;
  const write = async (ref: number, values: number[]) => {
    const bytes = new Uint8Array(values.length * 8), view = new DataView(bytes.buffer);
    values.forEach((value, index) => view.setFloat64(index * 8, value, true)); await storage.write(ref, bytes); await cooperate();
  };
  const read = async (ref: number, count: number) => {
    const bytes = await storage.read(ref, count * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    await cooperate(); return Array.from({length: count}, (_, index) => view.getFloat64(index * 8, true));
  };
  const save = (ref: number, value: TextRange) => write(ref, [value.first, value.last, value.units]);
  const load = async (ref: number): Promise<TextRange> => {const [first, last, units] = await read(ref, 3); return {first: first!, last: last!, units: units!};};
  const concat = (...parts: (string | TextRange)[]) => text.from((async function* () {
    for (const part of parts) {if (typeof part === "string") yield part; else yield* text.chunks(part);}
  })());
  async function* indentation(count: number) {
    while (count > 0) {await cooperate(); const size = Math.min(count, 4096); yield " ".repeat(size); count -= size;}
  }
  const indent = (count: number) => text.from(indentation(count));
  const info = async (value: TextRange) => {
    let first = "", last = "", newline = false;
    for await (const chunk of text.chunks(value)) {if (!first) first = chunk[0] ?? ""; last = chunk.slice(-1); newline ||= chunk.includes("\n");}
    return {first, last, newline};
  };
  const trimStart = (value: TextRange) => text.from((async function* () {
    let start = true;
    for await (const chunk of text.chunks(value)) {
      const part = start ? chunk.trimStart() : chunk; if (part) {start = false; yield part;}
    }
  })());
  const comment = async (value: TextRange, padding: number) => {
    const range = await source.append(text.chunks(value));
    let onlyNewlines = range.start < range.end;
    for await (const chunk of source.chunks(range)) {for (const char of chunk) if (char !== "\n") {onlyNewlines = false; break;} if (!onlyNewlines) break;}
    if (onlyNewlines) return text.from(source.chunks({start: range.start + 1, end: range.end}));
    return text.from((async function* () {
      let cursor = range.start;
      while (cursor < range.end) {
        let end = cursor;
        while (end < range.end && !["\n", "\r", "\u2028", "\u2029"].includes(await source.unit(end))) {end++; if (end % 256 === 0) await cooperate(256);}
        if (end > cursor) {
          yield* indentation(padding); yield "#";
          if (end - cursor !== 1 || await source.unit(cursor) !== " ") yield* source.chunks({start: cursor, end});
        }
        if (end < range.end) yield await source.unit(end);
        cursor = end + 1;
      }
    })());
  };
  const lineComment = async (base: TextRange, value: TextRange, padding: number) => {
    if (!value.units) return base;
    const end = await info(base), comments = await info(value);
    return concat(base, end.last === "\n" ? "" : comments.newline ? "\n" : end.last === " " ? "" : " ", await comment(value, end.last === "\n" || comments.newline ? padding : 0));
  };
  const anchor = async (range: SourceRange) => {
    for await (const chunk of source.chunks(range)) for (const char of chunk) {
      if (char.charCodeAt(0) <= 0x19 || !char.trim() || ",[]{}".includes(char)) throw new RetainedYamlSyntaxError(range.start);
    }
    return text.from(source.chunks(range));
  };
  const tag = async (range: SourceRange, node: RetainedYamlValue) => {
    if (range.end - range.start === 1) return text.from([collection(node) ? node.kind === "seq" || node.kind === "omap" ? "!!seq" : "!!map" : "!"]);
    let name: SourceRange;
    if (await source.unit(range.start + 1) === "<") name = {start: range.start + 2, end: range.end - 1};
    else if (await source.unit(range.start + 1) === "!") {
      name = await source.append((async function* () {
        yield "tag:yaml.org,2002:";
        let cursor = range.start + 2;
        while (cursor < range.end) {
          if (await source.unit(cursor) !== "%") {
            const start = cursor;
            while (cursor < range.end && await source.unit(cursor) !== "%" && cursor - start < 4096) cursor++;
            yield* source.chunks({start, end: cursor}); continue;
          }
          const decoder = new TextDecoder("utf-8", {fatal: true, ignoreBOM: true}), bytes = new Uint8Array(512); let count = 0;
          while (cursor < range.end && await source.unit(cursor) === "%") {
            bytes[count++] = Number.parseInt((await source.unit(cursor + 1)) + await source.unit(cursor + 2), 16); cursor += 3;
            if (count === bytes.length) {yield decoder.decode(bytes, {stream: true}); count = 0; await cooperate(512);}
          }
          yield decoder.decode(bytes.subarray(0, count));
        }
      })());
    } else return text.from(source.chunks(range));
    if (name.start === name.end) return emptyText();
    if (await source.starts(name, "tag:yaml.org,2002:")) {
      const escapes: Record<string, string> = {"!": "%21", ",": "%2C", "[": "%5B", "]": "%5D", "{": "%7B", "}": "%7D"};
      return text.from((async function* () {
        yield "!!";
        for await (const chunk of source.chunks({start: name.start + 18, end: name.end})) {let result = ""; for (const char of chunk) result += escapes[char] ?? char; yield result;}
      })());
    }
    return text.from((async function* () {const local = await source.unit(name.start) === "!"; if (!local) yield "!<"; yield* source.chunks(name); if (!local) yield ">";})());
  };
  const scalar = async (node: RetainedYamlValue, presentation: RetainedYamlPresentation, padding: number, implicitKey: boolean, atStart: number) => {
    if (node.kind === "alias") {
      const name = await source.append(text.chunks(node.text!));
      return concat("*", await anchor(name), implicitKey ? " " : "");
    }
    if (node.kind === "date") {
      if (!Number.isFinite(node.value!)) throw new RetainedYamlSyntaxError(0);
      let value = new Date(node.value!).toISOString();
      if (value.endsWith(".000Z")) {value = value.slice(0, -5); if (value.endsWith("T00:00:00")) value = value.slice(0, -9);}
      return text.from([value]);
    }
    if (node.kind === "merge") return text.from(["<<"]);
    if (node.kind === "null" || node.kind === "undefined") return presentation.token ? text.from(text.chunks(node.text!)) : text.from(["null"]);
    if (node.kind === "boolean") return text.from(text.chunks(node.text!));
    if (node.kind === "number") {
      const number = node.value!;
      if (!Number.isFinite(number)) return text.from([Number.isNaN(number) ? ".nan" : number < 0 ? "-.inf" : ".inf"]);
      const original = await source.append(text.chunks(node.text!));
      const prefix = (await source.unit(original.start)) + await source.unit(original.start + 1);
      if ((prefix === "0x" || prefix === "0o") && Number.isInteger(number) && number >= 0) return text.from([prefix + number.toString(prefix === "0x" ? 16 : 8)]);
      let dot = -1, exponent = false, last = "";
      for await (const chunk of source.chunks(original)) for (const char of chunk) {if (char === ".") dot = 0; else if (dot >= 0) dot++; exponent ||= char === "e" || char === "E"; last = char;}
      if (exponent) return text.from([number.toExponential()]);
      let value = Object.is(number, -0) ? "-0" : JSON.stringify(number);
      const digits = last === "0" && dot > 0 && (node.tag === "implicit" || node.tag === "float") && !value.includes("e") ? dot : 0;
      return text.from((async function* () {
        const point = value.indexOf(".");
        let left = digits - (point < 0 ? 0 : value.length - point - 1);
        if (left > 0 && point < 0) value += ".";
        yield value;
        while (left > 0) {const size = Math.min(left, 4096); yield "0".repeat(size); left -= size; await cooperate();}
      })());
    }
    const style = presentation.token?.type === "single-quoted-scalar" ? "single" : presentation.token?.type === "double-quoted-scalar" ? "double" : presentation.token?.type === "block-scalar" ? "block" : "plain";
    let value = node.text!;
    if (node.kind === "binary") {
      const literal = style === "block" && await source.unit(presentation.token!.offset!) === "|", width = Math.max(80 - padding, 20);
      value = await text.from((async function* () {
        let pending = "", column = 0, buffer = "";
        const pieces = (encoded: string) => {
          for (const char of encoded) {
            if (style !== "double" && column === width) {buffer += literal ? "\n" : " "; column = 0;}
            buffer += char; column++;
          }
        };
        for await (const chunk of text.chunks(node.text!)) {
          const bytes = pending + chunk, end = bytes.length - bytes.length % 3;
          pieces(btoa(bytes.slice(0, end))); pending = bytes.slice(end);
          if (buffer) {yield buffer; buffer = "";}
        }
        if (pending) pieces(btoa(pending)); if (buffer) yield buffer;
      })());
    }
    const range = await source.append(text.chunks(value));
    return renderRetainedYamlFlowString(source, range, text, storage, {style, indent: padding, implicitKey, ...(atStart >= 0 ? {indentAtStart: atStart} : {})}, cooperate);
  };
  let top = 0;
  const push = async (op: number, ...args: number[]) => {
    const frame = storage.allocate(80); await write(frame, [top, op, ...args, ...Array<number>(8 - args.length).fill(0)]); top = frame;
  };
  const result = storage.allocate(24);
  await push(0, root, 0, 0, -1, result, 1);
  while (top) {
    const [next, op, a, b, c, d, e, f, g, h] = await read(top, 10); top = next!;
    switch (op) {
      case 0: { // node, indent, implicitKey, indentAtStart, output, root
        const ref = a!, padding = b!, node = await graph.get(ref), presentation = await graph.presentation(ref);
        let output = e!, atStart = d!;
        if (!f && !presentation.pair && node.kind !== "alias") {
          let props = emptyText();
          if (presentation.anchor) props = await concat("&", await anchor({start: presentation.anchor.start + 1, end: presentation.anchor.end}));
          if (presentation.tag) {const name = await tag(presentation.tag, node); if (name.units) props = await concat(props, props.units ? " " : "", name);}
          if (props.units) {
            atStart = Math.max(0, atStart) + props.units + 1;
            const slot = storage.allocate(24); await save(slot, props); output = storage.allocate(24);
            await push(1, e!, slot, output);
          }
        }
        if (presentation.pair) {
          const entry = (await graph.entries(node).next()).value!;
          await push(3, entry.key!, entry.value ?? 0, padding, 0, output);
        } else if (collection(node)) {
          let allNull = node.kind === "set" || node.kind === "map";
          if (node.kind === "map") for await (const entry of graph.entries(node)) if (entry.value) {allNull = false; break;}
          const sequence = node.kind === "seq" || node.kind === "omap", childIndent = padding + (sequence ? 4 : 2);
          let head = 0, tail = 0;
          const aggregate = storage.allocate(80); await write(aggregate, [top, 2, ref, padding, 0, output, 0, 0, 0, 0]); top = aggregate;
          for await (const entry of graph.entries(node)) {
            const slot = storage.allocate(24), item = storage.allocate(40);
            let pair = node.kind !== "seq", key = entry.key ?? 0, value = entry.value ?? 0;
            if (!pair && (await graph.presentation(value)).pair) {
              const child = (await graph.entries(await graph.get(value)).next()).value!;
              pair = true; key = child.key!; value = child.value ?? 0;
            }
            await write(item, [0, slot, key, value, Number(pair)]);
            if (tail) await write(tail, [item]); else head = item; tail = item;
            if (pair) await push(3, key, value, childIndent, Number(allNull), slot);
            else await push(0, value, childIndent, 0, -1, slot, 0);
          }
          await write(aggregate + 32, [head]);
        } else await save(output, await scalar(node, presentation, padding, !!c, atStart));
        break;
      }
      case 1: await save(a!, await concat(await load(b!), " ", await load(c!))); break;
      case 2: { // collection, indent, elements, output
        const node = await graph.get(a!), sequence = node.kind === "seq" || node.kind === "omap", itemIndent = b! + (sequence ? 4 : 2);
        let cursor = c!, lines = 0, tail = 0, count = 0, length = 2, newline = false;
        const add = async (value: TextRange) => {
          const line = storage.allocate(32); await write(line, [0, value.first, value.last, value.units]);
          if (tail) await write(tail, [line]); else lines = line; tail = line; count++; length += value.units + 2;
        };
        while (cursor) {
          const [next, slot, key, value, pair] = await read(cursor, 5);
          const child = await graph.presentation(pair ? key! : value!);
          if (child.spaceBefore) {await add(emptyText()); newline = true;}
          if (child.commentBefore.units) {await add(await trimStart(await comment(child.commentBefore, b!))); newline = true;}
          let trailing = child.comment;
          if (pair) {
            if (child.comment.units) newline = true;
            if (value) {const val = await graph.presentation(value); trailing = val.comment; if (val.commentBefore.units) newline = true;}
          }
          if (trailing.units) newline = true;
          let rendered = await load(slot!); newline ||= (await info(rendered)).newline;
          if (next) rendered = await concat(rendered, ",");
          if (trailing.units) rendered = await lineComment(rendered, trailing, itemIndent);
          await add(rendered); cursor = next!;
        }
        newline ||= length > 80;
        const open = sequence ? "[" : "{", close = sequence ? "]" : "}";
        await save(d!, await text.from((async function* () {
          yield open;
          let cursor = lines, index = 0;
          if (count && !newline) yield " ";
          while (cursor) {
            const [next, first, last, units] = await read(cursor, 4);
            if (newline) {yield "\n"; if (units) yield* indentation(b! + 2);}
            else if (index) yield " ";
            yield* text.chunks({first: first!, last: last!, units: units!}); cursor = next!; index++;
          }
          if (count) {if (newline) {yield "\n"; yield* indentation(b!);} else yield " ";}
          yield close;
        })())); break;
      }
      case 3: { // pair key, value, indent, allNull, output
        const key = await graph.get(a!), presentation = await graph.presentation(a!);
        const explicit = collection(key) || key.kind === "alias" || presentation.token?.type === "block-scalar";
        const keySlot = storage.allocate(24);
        await push(4, a!, b!, c!, d!, e!, keySlot, Number(explicit));
        await push(0, a!, c! + 2, Number(!explicit && !d), -1, keySlot, 0); break;
      }
      case 4: { // pair after key: key, value, indent, allNull, output, keySlot, explicit
        const rendered = await load(f!), key = await graph.presentation(a!);
        if (d || !b) {await save(e!, !rendered.units ? await text.from(["?"]) : g ? await concat("? ", rendered) : rendered); break;}
        let prefix = rendered;
        if (g) {if (key.comment.units) prefix = await lineComment(prefix, key.comment, c! + 2); prefix = await concat("? ", prefix, "\n", await indent(c!), ":");}
        else {prefix = await concat(prefix, ":"); if (key.comment.units) prefix = await lineComment(prefix, key.comment, c! + 2);}
        const prefixSlot = storage.allocate(24), valueSlot = storage.allocate(24); await save(prefixSlot, prefix);
        const value = await graph.get(b!);
        await push(5, a!, b!, c!, e!, prefixSlot, valueSlot, g!, Number(!!key.comment.units));
        const start = !g && !key.comment.units && !collection(value) && value.kind !== "alias" ? prefix.units + 1 : -1;
        await push(0, b!, c! + 2, 0, start, valueSlot, 0); break;
      }
      case 5: { // pair after value: key, value, indent, output, prefixSlot, valueSlot, explicit, keyComment
        const value = await load(f!), prefix = await load(e!), presentation = await graph.presentation(b!), node = await graph.get(b!), details = await info(value);
        let space = await text.from([" "]);
        if (h || presentation.spaceBefore || presentation.commentBefore.units) {
          space = await text.from([presentation.spaceBefore ? "\n" : ""]);
          if (presentation.commentBefore.units) space = await concat(space, "\n", await comment(presentation.commentBefore, c! + 2));
          space = await concat(space, "\n", await indent(c! + 2));
        } else if (!g && collection(node) && details.newline) {
          let propertiesLine = false;
          if (details.first === "&" || details.first === "!") {
            const span = await source.append(text.chunks(value)), newline = await source.find(span, "\n");
            let firstSpace = await source.find(span, " ");
            if (details.first === "&" && firstSpace >= 0 && firstSpace < newline && await source.unit(firstSpace + 1) === "!") firstSpace = await source.find({start: firstSpace + 1, end: span.end}, " ");
            propertiesLine = firstSpace < 0 || newline < firstSpace;
          }
          if (!propertiesLine) space = await concat("\n", await indent(c! + 2));
        } else if (!value.units || details.first === "\n") space = emptyText();
        await save(d!, await concat(prefix, space, value)); break;
      }
    }
  }
  return load(result);
}
