import type { CommandDefinition } from "../../contracts/index.js";
import { integer, options, UsageError } from "../internal.js";
import { ByteOutput, command, type StreamInspectionLimits } from "./shared.js";

function tabs(specifications: readonly string[]): (column: number) => number {
  const stops: number[] = [];
  let repeat = 0, relative = false;
  for (const specification of specifications) {
    const entries = specification.split(/[, \t]+/u);
    for (const entry of entries) {
      if (!entry) continue;
      if (repeat) throw new UsageError("repeating tab stop must be last");
      const extended = entry.startsWith("+") || entry.startsWith("/");
      const stop = integer(extended ? entry.slice(1) : entry, 1);
      if (extended) { repeat = stop; relative = entry.startsWith("+"); }
      else {
        if (stop <= (stops.at(-1) ?? 0)) throw new UsageError("tab stops must be ascending");
        stops.push(stop);
      }
    }
  }
  if (!stops.length && !repeat) repeat = 8;
  if (stops.length === 1 && !repeat) repeat = stops.pop()!;
  return column => {
    let lower = 0, upper = stops.length;
    while (lower < upper) {
      const middle = Math.floor((lower + upper) / 2);
      if (stops[middle]! <= column) lower = middle + 1; else upper = middle;
    }
    if (lower < stops.length) return stops[lower]!;
    if (!repeat) return column + 1;
    const origin = relative ? stops.at(-1) ?? 0 : 0;
    return column + repeat - (column - origin) % repeat;
  };
}

export function createExpandCommand(limits: StreamInspectionLimits): CommandDefinition {
  return command("expand", limits, async session => {
    const parsed = options(session.context.args, "it:", { initial: "i", tabs: "t" });
    const nextTab = tabs(parsed.values.get("t") ?? []);
    const output = new ByteOutput(session);
    let column = 0, initial = true;
    await session.files(session.names(parsed.operands), async source => {
      for await (const chunk of source) {
        for (const byte of chunk) {
          await session.step();
          if (byte === 9 && (initial || !parsed.flags.has("i"))) {
            const stop = nextTab(column);
            session.check(stop - column, limits.maxOutputBytes, "output");
            while (column < stop) { await session.step(); await output.byte(32); column++; }
          } else {
            await output.byte(byte);
            if (byte === 10) { column = 0; initial = true; }
            else { column = byte === 8 ? Math.max(0, column - 1) : column + 1; if (byte !== 32 && byte !== 9) initial = false; }
          }
        }
        await output.flush();
      }
    });
    await output.flush();
  });
}
