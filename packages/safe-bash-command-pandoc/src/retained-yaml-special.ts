/*!
 * YAML explicit tag semantics adapted from yaml 2.9.0.
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
import type {BackedText, TextRange} from "./backed-text.js";
import {readJsonNumber} from "./json-number.js";
import {RetainedYamlSyntaxError} from "./retained-yaml-scalar.js";

/** The published Pandoc bundle uses YAML's browser entry, whose binary tag
 * follows atob (including padding and whitespace), even when run in Node. */
export async function decodeRetainedYamlBinary(text: BackedText, range: TextRange): Promise<TextRange> {
  async function* decoded(): AsyncGenerator<string> {
    let quartet = "", buffer = "", padding = false;
    for await (const chunk of text.chunks(range)) for (const char of chunk) {
      if ([" ", "\t", "\n", "\r", "\f"].includes(char)) continue;
      if (padding || !(char >= "A" && char <= "Z" || char >= "a" && char <= "z" || char >= "0" && char <= "9" || char === "+" || char === "/" || char === "=")) throw new RetainedYamlSyntaxError(0);
      quartet += char;
      if (quartet.length === 4) {
        try {buffer += atob(quartet);} catch {throw new RetainedYamlSyntaxError(0);}
        padding = quartet.includes("="); quartet = "";
        if (buffer.length >= 4096) {yield buffer; buffer = "";}
      }
    }
    if (quartet) {
      try {buffer += atob(quartet);} catch {throw new RetainedYamlSyntaxError(0);}
    }
    if (buffer) yield buffer;
  }
  return text.from(decoded());
}

/** YAML's explicit timestamp grammar, scanned without collecting a potentially
 * unbounded fractional second or whitespace run. Date normalization intentionally
 * matches the existing resolver, including its timezone arithmetic. */
export async function resolveRetainedYamlTimestamp(text: BackedText, range: TextRange): Promise<number> {
  const chunks = text.chunks(range); let chunk = "", index = 0, char = "";
  const next = async () => {
    if (index === chunk.length) {const part = await chunks.next(); chunk = part.done ? "" : part.value; index = 0;}
    char = chunk[index++] ?? ""; if (!char) index = 0;
  };
  const digit = () => char >= "0" && char <= "9";
  const number = async (min: number, max: number) => {
    let count = 0, value = 0;
    while (digit() && count < max) {value = value * 10 + Number(char); count++; await next();}
    if (count < min || digit()) throw new RetainedYamlSyntaxError(0);
    return value;
  };
  const take = async (expected: string) => {if (char !== expected) throw new RetainedYamlSyntaxError(0); await next();};
  try {
    await next();
    const year = await number(4, 4); await take("-");
    const month = await number(1, 2); await take("-");
    const day = await number(1, 2);
    if (!char) return Date.UTC(year, month - 1, day);
    if (["t", "T"].includes(char)) await next();
    else {if (char !== " " && char !== "\t") throw new RetainedYamlSyntaxError(0); do {await next();} while (char === " " || char === "\t");}
    const hour = await number(1, 2); await take(":");
    const minute = await number(1, 2); await take(":");
    let second = await number(1, 2), milliseconds = 0;
    if (char === ".") {
      await next(); if (!digit()) throw new RetainedYamlSyntaxError(0);
      async function* decimal(): AsyncGenerator<string> {
        yield String(second) + ".";
        let buffer = "", position = 0;
        while (digit()) {
          if (position < 3) milliseconds += Number(char) * 10 ** (2 - position);
          position++; buffer += char; await next();
          if (buffer.length >= 4096) {yield buffer; buffer = "";}
        }
        if (buffer) yield buffer;
      }
      second = await readJsonNumber(decimal(), async () => {}, false);
    }
    let offset = 0;
    if (char) {
      while (char === " " || char === "\t") await next();
      if (char === "Z") await next();
      else if (["+", "-"].includes(char)) {
        const sign = char === "-" ? -1 : 1; await next();
        const zoneHour = await number(1, 2); if (zoneHour > 29) throw new RetainedYamlSyntaxError(0);
        offset = zoneHour;
        if (char === ":") {await next(); offset = offset * 60 + await number(2, 2);}
        if (offset < 30) offset *= 60;
        offset *= sign;
      } else throw new RetainedYamlSyntaxError(0);
    }
    if (char) throw new RetainedYamlSyntaxError(0);
    return Date.UTC(year, month - 1, day, hour, minute, second, milliseconds) - 60000 * offset;
  } finally {await chunks.return(undefined);}
}
