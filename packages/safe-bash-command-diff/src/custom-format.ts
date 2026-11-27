import { ToolError, type Budget } from "safe-bash-diff-engine/shared";
import { encodeBytes } from "safe-bash-io-engine/byte-encoding";
import type { DiffFlags } from "./diff-options.js";
import type { IndexedGroup } from "./indexed-output.js";

export type CustomFormats = Partial<Record<"old" | "new" | "unchanged" | "changed", string>>;
type Append = (bytes: Uint8Array) => Promise<void>;
type Line = (side: "old" | "new", position: number, omitNewline: boolean) => Promise<void>;

/** Render the same format language over buffered lines or bounded indexed reads. */
export async function customFormat(groups: AsyncIterable<IndexedGroup>, oldLength: number, newLength: number,
  options: DiffFlags, budget: Budget, append: Append, line: Line): Promise<void> {
  const formats = { old: options.groupFormats.changed ?? "%<", new: options.groupFormats.changed ?? "%>", unchanged: "%=", ...options.groupFormats };
  const changed = formats.changed ?? formats.old + formats.new;
  const text = async (value: string) => { await append(encodeBytes(value)); };
  const repeat = async (character: string, count: number) => {
    for (let offset = 0; offset < count; offset += 4096) {
      budget.step(Math.min(4096, count - offset));
      const checkpoint = budget.checkpoint(); if (checkpoint) await checkpoint;
      await text(character.repeat(Math.min(4096, count - offset)));
    }
  };
  const render = async (source: string, values: Readonly<Record<string, number>>, substitute: (code: string) => Promise<boolean>) => {
    const ranges = [{ start: 0, end: source.length }];
    while (ranges.length) {
      const range = ranges.pop()!;
      for (let index = range.start; index < range.end;) {
        budget.step();
        const checkpoint = budget.checkpoint(); if (checkpoint) await checkpoint;
        const start = index++;
        if (source[start] !== "%") {
          while (index < range.end && source[index] !== "%" && index - start < 4096) index++;
          budget.step(index - start);
          await text(source.slice(start, index));
          continue;
        }
        const code = source[index++];
        if (code === "%") { await text("%"); continue; }
        if (code !== undefined && await substitute(code)) continue;
        if (code === "c" && source[index] === "'") {
          const end = source.indexOf("'", index + 1);
          const character = source.slice(index + 1, end);
          if (end >= 0 && end < range.end) {
            if (character.length === 1) {
              await text(character); index = end + 1; continue;
            }
            if (character.startsWith("\\") && character.length > 1 && character.length <= 4
              && [...character.slice(1)].every(digit => digit >= "0" && digit <= "7")) {
              await append(new Uint8Array([Number.parseInt(character.slice(1), 8)])); index = end + 1; continue;
            }
          }
        }
        if (code === "(" && values.F !== undefined) {
          let cursor = index;
          const operand = () => {
            const letter = source[cursor]!;
            if (Object.hasOwn(values, letter)) { cursor++; return values[letter]; }
            const first = cursor;
            while (source[cursor] !== undefined && source[cursor]! >= "0" && source[cursor]! <= "9") cursor++;
            return cursor > first ? Number(source.slice(first, cursor)) : undefined;
          };
          const left = operand();
          const equal = source[cursor++];
          const right = operand();
          if (left !== undefined && right !== undefined && equal === "=" && source[cursor++] === "?") {
            const first = cursor;
            let separator = -1, depth = 0;
            for (; cursor < range.end; cursor++) {
              budget.step();
              const checkpoint = budget.checkpoint(); if (checkpoint) await checkpoint;
              if (source[cursor] === "%") {
                if (source[cursor + 1] === "(") { depth++; cursor++; }
                else if (source[cursor + 1] === "c" && source[cursor + 2] === "'") {
                  const end = source.indexOf("'", cursor + 3);
                  if (end >= 0) cursor = end;
                } else cursor++;
              } else if (source[cursor] === ")") {
                if (depth === 0) break;
                depth--;
              } else if (source[cursor] === ":" && depth === 0 && separator < 0) separator = cursor;
            }
            if (separator >= 0 && cursor < range.end) {
              ranges.push({ start: cursor + 1, end: range.end });
              ranges.push(left === right ? { start: first, end: separator } : { start: separator + 1, end: cursor });
              break;
            }
          }
        }
        let cursor = start + 1;
        const left = source[cursor] === "-";
        if (left) cursor++;
        const widthStart = cursor;
        while (source[cursor] !== undefined && source[cursor]! >= "0" && source[cursor]! <= "9") cursor++;
        const widthText = source.slice(widthStart, cursor);
        const width = Number(widthText);
        let precision: number | undefined;
        if (source[cursor] === ".") {
          const first = ++cursor;
          while (source[cursor] !== undefined && source[cursor]! >= "0" && source[cursor]! <= "9") cursor++;
          precision = Number(source.slice(first, cursor));
        }
        const conversion = source[cursor++];
        const value = values[source[cursor++]!];
        if (conversion !== undefined && "doxX".includes(conversion) && value !== undefined && cursor <= range.end) {
          if (!Number.isSafeInteger(width) || !Number.isSafeInteger(precision ?? 0)
            || Math.max(width, precision ?? 0) > budget.limits.maxOutputBytes) throw new ToolError("output byte limit exceeded");
          let digits = value.toString(conversion === "o" ? 8 : conversion === "d" ? 10 : 16);
          if (conversion === "X") digits = digits.toUpperCase();
          if (precision === 0 && value === 0) digits = "";
          const zeros = Math.max(0, (precision ?? 0) - digits.length);
          const padding = Math.max(0, width - zeros - digits.length);
          if (!left) await repeat(precision === undefined && widthText.startsWith("0") ? "0" : " ", padding);
          await repeat("0", zeros);
          await text(digits);
          if (left) await repeat(" ", padding);
          index = cursor;
          continue;
        }
        await text("%");
        index = start + 1;
      }
    }
  };
  const group = async (change: IndexedGroup, kind: keyof CustomFormats) => {
    const values = { f: change.oldStart + 1, l: change.oldStart + change.oldCount, n: change.oldCount,
      e: change.oldStart, m: change.oldStart + change.oldCount + 1,
      F: change.newStart + 1, L: change.newStart + change.newCount, N: change.newCount,
      E: change.newStart, M: change.newStart + change.newCount + 1 };
    await render(kind === "changed" ? changed : formats[kind], values, async code => {
      if (code !== "<" && code !== ">" && code !== "=") return false;
      const side = code === ">" ? "new" : "old";
      const lineFormat = options.lineFormats[code === "=" ? "unchanged" : side] ?? "%l\n";
      const start = side === "old" ? change.oldStart : change.newStart;
      const count = side === "old" ? change.oldCount : change.newCount;
      for (let position = start; position < start + count; position++) {
        budget.step();
        const checkpoint = budget.checkpoint(); if (checkpoint) await checkpoint;
        await render(lineFormat, { n: position + 1 }, async specifier => {
          if (specifier !== "L" && specifier !== "l") return false;
          await line(side, position, specifier === "l");
          return true;
        });
      }
      return true;
    });
  };
  let oldPosition = 0, newPosition = 0;
  for await (const change of groups) {
    budget.hunk();
    if (change.ignored) continue;
    if (change.oldStart > oldPosition || change.newStart > newPosition) {
      await group({ oldStart: oldPosition, newStart: newPosition, oldCount: change.oldStart - oldPosition, newCount: change.newStart - newPosition }, "unchanged");
    }
    await group(change, change.oldCount ? change.newCount ? "changed" : "old" : "new");
    oldPosition = change.oldStart + change.oldCount;
    newPosition = change.newStart + change.newCount;
  }
  if (oldPosition < oldLength || newPosition < newLength) {
    await group({ oldStart: oldPosition, newStart: newPosition, oldCount: oldLength - oldPosition, newCount: newLength - newPosition }, "unchanged");
  }
}
