/*!
 * YAML flow line folding adapted from yaml 2.9.0.
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
import {IntegerTable, type PagedStorage} from "safe-bash-io-engine/storage";
import type {BackedText, TextRange} from "./backed-text.js";
import type {RetainedSourceText, SourceRange} from "./retained-source-text.js";

export interface YamlFoldOptions {
  mode: "flow" | "quoted";
  indent: number;
  indentAtStart?: number;
  lineWidth?: number;
  minContentWidth?: number;
}
/** Match YAML's flow/quoted folding, retaining both fold positions and escaped
 * fold membership in caller storage. Indentation is a count, emitted in bounded
 * windows even for deeply nested collection keys. */
export async function foldRetainedYamlFlow(source: RetainedSourceText, range: SourceRange, output: BackedText,
  scratch: PagedStorage, options: YamlFoldOptions, cooperate: (units?: number) => Promise<void>): Promise<{text: TextRange; folded: boolean; overflow: boolean}> {
  const length = range.end - range.start, width = options.lineWidth ?? 80, indent = options.indent;
  let minimum = options.minContentWidth ?? 20;
  const original = async () => ({text: await output.from(source.chunks(range)), folded: false, overflow: false});
  if (!width || width < 0) return original();
  if (width < minimum) minimum = 0;
  const step = Math.max(1 + minimum, 1 + width - indent);
  if (length <= step) return original();
  const char = (index: number) => index >= 0 && index < length ? source.unit(range.start + index) : Promise.resolve("");
  const escaped = new IntegerTable(scratch, 64);
  let first = 0, last = 0, restart = 0;
  const write = async (ref: number, values: number[]) => {
    const bytes = new Uint8Array(values.length * 8), view = new DataView(bytes.buffer);
    values.forEach((value, index) => view.setFloat64(index * 8, value, true)); await scratch.write(ref, bytes);
  };
  const read = async (ref: number) => {
    const bytes = await scratch.read(ref, 16), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    return {position: view.getFloat64(0, true), next: view.getFloat64(8, true)};
  };
  const fold = async (position: number) => {
    const ref = scratch.allocate(16); await write(ref, [position, 0]);
    if (last) await write(last + 8, [ref]); else first = ref;
    last = ref;
    // A zero fold resets the native formatter's accumulated output.
    if (position === 0) restart = ref;
  };
  let end = width - indent;
  if (options.indentAtStart !== undefined) {
    if (options.indentAtStart > width - Math.max(2, minimum)) await fold(0);
    else end = width - options.indentAtStart;
  }
  let split: number | undefined, previous = "", overflow = false, index = -1, escapeStart = -1, escapeEnd = -1;
  for (;;) {
    let current = await char(++index); if (!current) break;
    if (index % 256 === 0) await cooperate(256);
    if (options.mode === "quoted" && current === "\\") {
      escapeStart = index;
      switch (await char(index + 1)) {
        case "x": index += 3; break;
        case "u": index += 5; break;
        case "U": index += 9; break;
        default: index++;
      }
      escapeEnd = index;
    }
    if (current === "\n") {end = index + indent + step; split = undefined;}
    else {
      if (current === " " && previous && previous !== " " && previous !== "\n" && previous !== "\t") {
        const next = await char(index + 1);
        if (next && next !== " " && next !== "\n" && next !== "\t") split = index;
      }
      if (index >= end) {
        if (split) {await fold(split); end = split + step; split = undefined;}
        else if (options.mode === "quoted") {
          while (previous === " " || previous === "\t") {
            previous = current; current = await char(++index); overflow = true;
            if (index % 256 === 0) await cooperate(256);
          }
          const position = index > escapeEnd + 1 ? index - 2 : escapeStart - 1;
          if (await escaped.get(BigInt(position + 2))) return original();
          await fold(position); await escaped.set(BigInt(position + 2), 1n);
          end = position + step; split = undefined;
        } else overflow = true;
      }
    }
    previous = current;
  }
  if (!first) return {text: await output.from(source.chunks(range)), folded: false, overflow};
  const slice = (start: number, end: number) => {
    const normalize = (index: number) => index < 0 ? Math.max(0, length + index) : Math.min(length, index);
    return source.chunks({start: range.start + normalize(start), end: range.start + normalize(end)});
  };
  async function* indentation(): AsyncGenerator<string> {
    for (let remaining = indent; remaining > 0; remaining -= 4096) {await cooperate(); yield " ".repeat(Math.min(4096, remaining));}
  }
  async function* rendered(): AsyncGenerator<string> {
    let ref = restart || first, current = await read(ref);
    yield* slice(0, current.position);
    while (ref) {
      await cooperate();
      const next = current.next ? await read(current.next) : undefined, end = next?.position || length;
      if (current.position === 0) {yield "\n"; yield* indentation(); yield* slice(0, end);}
      else {
        if (options.mode === "quoted" && await escaped.get(BigInt(current.position + 2))) yield (current.position < 0 || current.position >= length ? "undefined" : await char(current.position)) + "\\";
        yield "\n"; yield* indentation(); yield* slice(current.position + 1, end);
      }
      ref = current.next; if (next) current = next;
    }
  }
  return {text: await output.from(rendered()), folded: true, overflow};
}
