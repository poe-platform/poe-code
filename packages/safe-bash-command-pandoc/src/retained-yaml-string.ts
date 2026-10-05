/*!
 * YAML flow string presentation adapted from yaml 2.9.0.
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
import type {BackedText, TextRange} from "./backed-text.js";
import type {RetainedSourceText, SourceRange} from "./retained-source-text.js";
import {resolveRetainedYamlScalar} from "./retained-yaml-scalar.js";
import {foldRetainedYamlFlow} from "./retained-yaml-fold.js";

export interface YamlFlowStringOptions {
  style: "plain" | "single" | "double" | "block";
  indent: number;
  implicitKey?: boolean;
  indentAtStart?: number;
}
/** Render strings inside flow collections. Intermediate JSON escaping and YAML
 * folding stay in caller-backed source spans. Only fixed output windows and
 * scalar scan state remain resident. Collection children have positive indent. */
export async function renderRetainedYamlFlowString(source: RetainedSourceText, range: SourceRange, output: BackedText,
  scratch: PagedStorage, options: YamlFlowStringOptions, cooperate: (units?: number) => Promise<void>): Promise<TextRange> {
  if (!Number.isSafeInteger(options.indent) || options.indent < 1) throw new RangeError("Flow string indentation must be positive");
  const length = range.end - range.start;
  const char = (index: number) => index >= 0 && index < length ? source.unit(range.start + index) : Promise.resolve("");
  let double = false, single = false, newline = false, surroundingSpace = false, forceDouble = false, unsafePlain = false, marker = false;
  let previous = "";
  for (let i = 0; i < length; i++) {
    const current = await char(i), code = current.charCodeAt(0);
    if (i % 256 === 0) await cooperate(256);
    if (current === '"') double = true;
    if (current === "'") single = true;
    if (current === "\n") newline = true;
    const space = current === " " || current === "\t", priorSpace = previous === " " || previous === "\t";
    if (current === "\n" && priorSpace || previous === "\n" && space) surroundingSpace = true;
    if (["[", "]", "{", "}", ","].includes(current) || (previous === "\n" || previous === ":") && space || priorSpace && current === "\n" || ["\n", "\t", " "].includes(previous) && current === "#") unsafePlain = true;
    if (!i && ["\n", "\t", " ", ",", "[", "]", "{", "}", "#", "&", "*", "!", "|", ">", "'", '"', "%", "@", "`"].includes(current)) unsafePlain = true;
    if (!i && (current === "?" || current === "-") && (length === 1 || [" ", "\t"].includes(await char(1)))) unsafePlain = true;
    if (i === length - 1 && ["\n", "\t", " ", ":"].includes(current)) unsafePlain = true;
    if (!i || ["\n", "\r", "\u2028", "\u2029"].includes(previous)) {
      const remaining = {start: range.start + i, end: range.end};
      if (current === "%" || await source.starts(remaining, "---") || await source.starts(remaining, "...")) marker = true;
    }
    if (code <= 8 || code >= 11 && code <= 31 || code >= 127 && code <= 159) forceDouble = true;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = (await char(i + 1)).charCodeAt(0);
      if (next >= 0xdc00 && next <= 0xdfff) i++; else forceDouble = true;
    } else if (code >= 0xdc00 && code <= 0xdfff) forceDouble = true;
    previous = current;
  }
  let style = options.style;
  const quoted = () => double && !single ? "single" as const : "double" as const;
  if (forceDouble) style = "double";
  else if (style === "block") style = quoted();
  else if (style === "plain") {
    if (unsafePlain || options.implicitKey && newline || marker && options.implicitKey && options.indent === 2) style = quoted();
    else {
      const value = await output.from(source.chunks(range));
      if ((await resolveRetainedYamlScalar(output, value, cooperate)).kind !== "string") style = quoted();
    }
  }
  if (style === "single" && (options.implicitKey && newline || surroundingSpace)) style = "double";
  async function* indent(): AsyncGenerator<string> {
    for (let left = options.indent; left > 0; left -= 4096) {await cooperate(); yield " ".repeat(Math.min(left, 4096));}
  }
  let rendered: SourceRange;
  if (style === "double") {
    async function* json(): AsyncGenerator<string> {
      let buffer = '"';
      for (let i = 0; i < length; i++) {
        const current = await char(i), code = current.charCodeAt(0), next = await char(i + 1), low = next.charCodeAt(0);
        if (code >= 0xd800 && code <= 0xdbff && low >= 0xdc00 && low <= 0xdfff) {buffer += current + next; i++;}
        else buffer += JSON.stringify(current).slice(1, -1);
        if (buffer.length >= 4096) {yield buffer; buffer = "";}
      }
      yield buffer + '"';
    }
    const encoded = await source.append(json()), jsonLength = encoded.end - encoded.start;
    const unit = (index: number) => index >= 0 && index < jsonLength ? source.unit(encoded.start + index) : Promise.resolve("");
    const slice = (start: number, end = jsonLength) => source.chunks({start: encoded.start + start, end: encoded.start + end});
    async function* yaml(): AsyncGenerator<string> {
      let start = 0;
      for (let i = 0; i < jsonLength; i++) {
        let current = await unit(i);
        if (i % 256 === 0) await cooperate(256);
        if (current === " " && await unit(i + 1) === "\\" && await unit(i + 2) === "n") {
          yield* slice(start, i); yield "\\ "; i++; start = i; current = "\\";
        }
        if (current !== "\\") continue;
        switch (await unit(i + 1)) {
          case "u": {
            yield* slice(start, i); let code = "";
            for (let offset = 2; offset < 6; offset++) code += await unit(i + offset);
            const escape: Record<string, string> = {"0000": "0", "0007": "a", "000b": "v", "001b": "e", "0085": "N", "00a0": "_", "2028": "L", "2029": "P"};
            if (escape[code]) yield "\\" + escape[code];
            else if (code.startsWith("00")) yield "\\x" + code.slice(2);
            else yield* slice(i, i + 6);
            i += 5; start = i + 1; break;
          }
          case "n":
            if (options.implicitKey || await unit(i + 2) === '"' || jsonLength < 40) i++;
            else {
              yield* slice(start, i); yield "\n\n";
              while (await unit(i + 2) === "\\" && await unit(i + 3) === "n" && await unit(i + 4) !== '"') {yield "\n"; i += 2;}
              yield* indent(); if (await unit(i + 2) === " ") yield "\\";
              i++; start = i + 1;
            }
            break;
          default: i++;
        }
      }
      yield* slice(start);
    }
    rendered = await source.append(yaml());
  } else {
    const quoted = style === "single";
    async function* expanded(): AsyncGenerator<string> {
      let buffer = quoted ? "'" : "";
      for (let i = 0; i < length; i++) {
        const current = await char(i);
        buffer += quoted && current === "'" ? "''" : current;
        if (current === "\n" && await char(i + 1) !== "\n") {
          yield buffer + "\n"; buffer = ""; yield* indent();
        } else if (buffer.length >= 4096) {yield buffer; buffer = "";}
      }
      yield buffer + (quoted ? "'" : "");
    }
    rendered = await source.append(expanded());
  }
  if (options.implicitKey) return output.from(source.chunks(rendered));
  return (await foldRetainedYamlFlow(source, rendered, output, scratch, {
    mode: style === "double" ? "quoted" : "flow", indent: options.indent,
    ...(options.indentAtStart === undefined ? {} : {indentAtStart: options.indentAtStart})
  }, cooperate)).text;
}
