/*!
 * YAML tag-name resolution adapted from yaml 2.9.0.
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
import type {RetainedSourceText, SourceRange} from "./retained-source-text.js";
import {RetainedYamlSyntaxError} from "./retained-yaml-scalar.js";

const tags = ["str", "int", "float", "bool", "null", "map", "seq", "binary", "timestamp", "merge", "omap", "pairs", "set"] as const;
export type RetainedYamlTag = typeof tags[number] | "unknown" | "implicit";

/** Frontmatter has no %TAG directive envelope. Recognize default handles and
 * validate standard-tag URI decoding with fixed windows; unknown names need no
 * retained decoded string because metadata discards tag presentation. */
export async function resolveRetainedYamlTag(source: RetainedSourceText, range: SourceRange,
  cooperate: (units?: number) => Promise<void>): Promise<RetainedYamlTag> {
  if (await source.unit(range.start) !== "!") throw new RetainedYamlSyntaxError(range.start);
  if (range.end - range.start === 1) return "str";
  if (await source.unit(range.start + 1) === "<") {
    if (await source.unit(range.end - 1) !== ">") throw new RetainedYamlSyntaxError(range.end);
    const verbatim = {start: range.start + 2, end: range.end - 1};
    if (verbatim.start === verbatim.end) return "implicit";
    if (verbatim.end - verbatim.start <= 2 && await source.unit(verbatim.start) === "!" && (verbatim.end - verbatim.start === 1 || await source.unit(verbatim.start + 1) === "!")) throw new RetainedYamlSyntaxError(range.start);
    for (const tag of tags) {
      const name = `tag:yaml.org,2002:${tag}`;
      if (verbatim.end - verbatim.start === name.length && await source.starts(verbatim, name)) return tag;
    }
    return "unknown";
  }
  let bang = range.start;
  for (let index = range.start + 1; index < range.end; index++) {
    if (await source.unit(index) === "!") bang = index;
    if ((index - range.start) % 256 === 0) await cooperate(256);
  }
  if (bang === range.end - 1) throw new RetainedYamlSyntaxError(bang);
  if (bang === range.start) return "unknown"; // Local tags do not URI-decode.
  if (bang !== range.start + 1) throw new RetainedYamlSyntaxError(range.start);
  const maxTagLength = Math.max(...tags.map(tag => tag.length));
  let name = "", unknown = false;
  const accept = (chunk: string) => {
    if (!unknown) {if (name.length + chunk.length > maxTagLength) {unknown = true; name = "";} else name += chunk;}
  };
  const hex = (char: string) => {
    const lower = char.toLowerCase();
    return char >= "0" && char <= "9" ? char.charCodeAt(0) - 48 : lower >= "a" && lower <= "f" ? lower.charCodeAt(0) - 87 : -1;
  };
  let cursor = bang + 1;
  while (cursor < range.end) {
    await cooperate();
    const char = await source.unit(cursor);
    if (char !== "%") {accept(char); cursor++; continue;}
    const decoder = new TextDecoder("utf-8", {fatal: true, ignoreBOM: true}), bytes = new Uint8Array(512);
    const decode = (length: number, stream: boolean) => {
      try {accept(decoder.decode(bytes.subarray(0, length), {stream}));}
      catch {throw new RetainedYamlSyntaxError(cursor);}
    };
    let count = 0;
    while (cursor < range.end && await source.unit(cursor) === "%") {
      if (cursor + 2 >= range.end) throw new RetainedYamlSyntaxError(cursor);
      const high = hex(await source.unit(cursor + 1)), low = hex(await source.unit(cursor + 2));
      if (high < 0 || low < 0) throw new RetainedYamlSyntaxError(cursor);
      bytes[count++] = high * 16 + low; cursor += 3;
      if (count === bytes.length) {decode(count, true); count = 0; await cooperate(bytes.length);}
    }
    decode(count, false);
  }
  return !unknown && tags.includes(name as typeof tags[number]) ? name as typeof tags[number] : "unknown";
}
