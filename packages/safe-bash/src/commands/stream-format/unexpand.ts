import type { CommandDefinition } from "../../contracts/index.js";
import { integer, UsageError } from "../internal.js";
import { numericOptions } from "../stream-inspection/numeric-options.js";
import { ByteOutput, command, type Session, type StreamFormatLimits } from "./shared.js";

function tabStops(specifications: readonly string[], session: Session): (column: number) => number | undefined {
  const stops: number[] = [];
  let absoluteRepeat = 0, relativeRepeat = 0;
  for (const specification of specifications) {
    const entries = specification.split(/[, \t]+/u);
    let marker = "";
    for (const entry of entries) {
      if (!entry) continue;
      const prefix = entry.match(/^[+/]+/u)?.[0] ?? "";
      if (prefix) marker = prefix.at(-1)!;
      const number = entry.slice(prefix.length);
      if (!number) continue;
      const stop = integer(number, marker ? 0 : 1);
      if (marker === "+") {
        if (relativeRepeat) throw new UsageError("repeating tab stop must be last");
        relativeRepeat = stop;
      } else if (marker === "/") {
        if (absoluteRepeat) throw new UsageError("repeating tab stop must be last");
        absoluteRepeat = stop;
      } else {
        if (stop <= (stops.at(-1) ?? 0)) throw new UsageError("tab stops must be ascending");
        stops.push(stop);
      }
    }
  }
  if (absoluteRepeat && relativeRepeat) throw new UsageError("'/' specifier is mutually exclusive with '+'");
  let repeat = absoluteRepeat || relativeRepeat;
  const relative = relativeRepeat !== 0;
  if (!stops.length && !repeat) repeat = 8;
  if (stops.length === 1 && !repeat) repeat = stops.pop()!;
  return column => {
    let lower = 0, upper = stops.length;
    while (lower < upper) {
      session.charge();
      const middle = Math.floor((lower + upper) / 2);
      if (stops[middle]! <= column) lower = middle + 1; else upper = middle;
    }
    if (lower < stops.length) return stops[lower]!;
    if (!repeat) return undefined;
    const origin = relative ? stops.at(-1) ?? 0 : 0;
    const next = column + repeat - (column - origin) % repeat;
    session.check(next, Number.MAX_SAFE_INTEGER, "column");
    return next;
  };
}

export function createUnexpandCommand(limits: StreamFormatLimits): CommandDefinition {
  return command("unexpand", limits, async session => {
    const parsed = numericOptions(session.context.args, "at:", { all: "a", tabs: "t", "first-only": false }, "t", undefined, true);
    const nextTab = tabStops(parsed.values.get("t") ?? [], session);
    const all = !parsed.flags.has("first-only") && (parsed.flags.has("a") || parsed.flags.has("t"));
    const output = new ByteOutput(session);
    let column = 0, initial = true, active = true;
    let pendingStart = 0, pendingCount = 0, pendingTab = false;
    const flushBlanks = async (): Promise<void> => {
      if (!pendingCount) return;
      let position = pendingStart;
      const convertSingle = initial || pendingCount > 1 || pendingTab;
      while (position < column) {
        const s = session.step();
        if (s) await s;
        const stop = nextTab(position);
        if (stop !== undefined && stop <= column && (stop - position > 1 || convertSingle)) {
          const b = output.byte(9);
          if (b) await b;
          position = stop;
        } else {
          const b = output.byte(32);
          if (b) await b;
          position++;
        }
      }
      pendingCount = 0; pendingTab = false;
    };
    await session.files(session.names(parsed.operands), async source => {
      for await (const chunk of source) {
        for (const byte of chunk) {
          const s = session.step();
          if (s) await s;
          if (active && (byte === 32 || byte === 9)) {
            const stop = nextTab(column);
            if (stop !== undefined) {
              if (!pendingCount) pendingStart = column;
              pendingCount++;
              pendingTab ||= byte === 9;
              column = byte === 9 ? stop : column + 1;
              session.check(column, Number.MAX_SAFE_INTEGER, "column");
              continue;
            }
            await flushBlanks(); active = false;
          } else if (pendingCount) await flushBlanks();
          const b = output.byte(byte);
          if (b) await b;
          if (byte === 10) { column = 0; initial = true; active = true; }
          else if (active) {
            column = byte === 8 ? Math.max(0, column - 1) : column + 1;
            session.check(column, Number.MAX_SAFE_INTEGER, "column");
            initial = false;
            if (!all) active = false;
          }
        }
        await output.flush();
      }
    });
    await flushBlanks();
    await output.flush();
  });
}
