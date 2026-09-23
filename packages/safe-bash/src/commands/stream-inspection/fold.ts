import type { CommandDefinition } from "../../contracts/index.js";
import { integer } from "../internal.js";
import { numericOptions } from "./numeric-options.js";
import { command, RecordBuffer, type StreamInspectionLimits } from "./shared.js";

export function createFoldCommand(limits: StreamInspectionLimits): CommandDefinition {
  return command("fold", limits, async session => {
    // The default command uses the C byte profile: character mode counts one
    // per byte, retaining TAB/CR/BS column controls. The last counting flag wins.
    let bytes = false;
    const characters = "characters";
    const parsed = numericOptions(session.context.args, "bcsw:", {
      bytes: "b", spaces: "s", width: "w",
      ...Object.fromEntries(Array.from(characters, (_, index) => [characters.slice(0, index + 1), "c"])),
    }, "w", key => {
      if (key === "b" || key === "c") bytes = key === "b";
    });
    let width = 80;
    for (const specification of parsed.values.get("w") ?? []) width = integer(specification, 1);
    const adjust = (column: number, byte: number): number => {
      if (bytes) return column + 1;
      if (byte === 8) return Math.max(0, column - 1);
      if (byte === 13) return 0;
      return column + (byte === 9 ? 8 - column % 8 : 1);
    };
    await session.files(session.names(parsed.operands), async source => {
      const record = new RecordBuffer(session);
      let column = 0, lastBlank = -1;
      for await (const chunk of source) {
        for (const byte of chunk) {
          await session.step();
          if (byte === 10) {
            await session.output(record.view()); await session.output(Uint8Array.of(10));
            record.clear(); column = 0; lastBlank = -1; continue;
          }
          while (adjust(column, byte) > width && record.size) {
            const boundary = parsed.flags.has("s") && lastBlank >= 0 ? lastBlank + 1 : record.size;
            await session.output(record.view().subarray(0, boundary));
            await session.output(Uint8Array.of(10));
            record.drop(boundary); column = 0; lastBlank = -1;
            for (const retained of record.view()) { await session.step(); column = adjust(column, retained); }
          }
          column = adjust(column, byte);
          record.push(byte);
          if (byte === 32 || byte === 9) lastBlank = record.size - 1;
        }
      }
      await session.output(record.view());
    });
  });
}
