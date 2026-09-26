import { decodeFoldUnit, portableWidth, type FoldUnit } from "safe-bash-command-fold";
import type { ByteSource, CommandDefinition } from "../../contracts/index.js";
import { integer } from "../internal.js";
import { numericOptions } from "./numeric-options.js";
import { command, RecordBuffer, type Session, type StreamInspectionLimits } from "./shared.js";

export function createFoldCommand(limits: StreamInspectionLimits): CommandDefinition {
  return command("fold", limits, async session => {
    let mode: "columns" | "bytes" | "characters" = "columns";
    const characters = "characters";
    const parsed = numericOptions(session.context.args, "bcsw:", {
      bytes: "b", spaces: "s", width: "w",
      ...Object.fromEntries(Array.from(characters, (_, index) => [characters.slice(0, index + 1), "c"])),
    }, "w", key => {
      if (key === "b" || key === "c") mode = key === "b" ? "bytes" : "characters";
    });
    let width = 80;
    for (const specification of parsed.values.get("w") ?? []) width = integer(specification, 1);
    const locale = (session.context.env.LC_ALL || session.context.env.LC_CTYPE || session.context.env.LANG || "C").toUpperCase().split("@")[0]!;
    const utf8 = locale.endsWith("UTF-8") || locale.endsWith("UTF8");
    const adjust = (column: number, unit: FoldUnit): number => {
      if (mode === "bytes") return column + unit.length;
      const byte = unit.cp;
      if (byte === 8) return Math.max(0, column - 1);
      if (byte === 13) return 0;
      const cells = mode === "characters" ? 1 : utf8 && unit.valid ? portableWidth(byte) : 1;
      return column + (byte === 9 ? 8 - column % 8 : cells < 0 ? 1 : cells);
    };
    await session.files(session.names(parsed.operands), async source => {
      const record = new RecordBuffer(session);
      let column = 0, lastBlank = -1;
      const processUnit = async (unit: FoldUnit, bytes: readonly number[], byteOffset = 0, byteLen = bytes.length): Promise<void> => {
        if (unit.cp === 10) {
          await session.output(record.view()); await session.output(Uint8Array.of(10));
          record.clear(); column = 0; lastBlank = -1; return;
        }
        while (adjust(column, unit) > width && record.size) {
          const boundary = parsed.flags.has("s") && lastBlank >= 0 ? lastBlank + 1 : record.size;
          await session.output(record.view().subarray(0, boundary));
          await session.output(Uint8Array.of(10));
          record.drop(boundary); column = 0; lastBlank = -1;
          const retained = record.view();
          for (let offset = 0; offset < retained.length;) {
            const glyph = utf8 ? decodeFoldUnit(retained, offset, retained.length - offset, true)!
              : { cp: retained[offset]!, length: 1, valid: true };
            const s = session.step(glyph.length);
            if (s) await s;
            column = adjust(column, glyph);
            offset += glyph.length;
            if (glyph.cp === 32 || glyph.cp === 9) lastBlank = offset - 1;
          }
        }
        column = adjust(column, unit);
        for (let i = 0; i < byteLen; i++) record.push(bytes[byteOffset + i]!);
        if (unit.cp === 32 || unit.cp === 9) lastBlank = record.size - 1;
      };
      const pending: number[] = [];
      const drain = async (eof: boolean): Promise<void> => {
        while (pending.length) {
          const unit = utf8 ? decodeFoldUnit(pending, 0, pending.length, eof)
            : { cp: pending[0]!, length: 1, valid: true };
          if (!unit) return;
          const unitBytes = pending.splice(0, unit.length);
          await processUnit(unit, unitBytes, 0, unitBytes.length);
        }
      };
      for await (const chunk of source) {
        for (let i = 0; i < chunk.length; i++) {
          const byte = chunk[i]!;
          const s = session.step();
          if (s) await s;
          if (!utf8 || (pending.length === 0 && byte < 128)) {
            if (byte !== 10) {
              const nextCol = mode === "bytes" ? column + 1 : byte === 8 ? Math.max(0, column - 1) : byte === 13 ? 0 : column + (byte === 9 ? 8 - column % 8 : 1);
              if (nextCol <= width || !record.size) {
                column = nextCol;
                record.push(byte);
                if (byte === 32 || byte === 9) lastBlank = record.size - 1;
                continue;
              }
            }
            await processUnit({ cp: byte, length: 1, valid: true }, chunk as unknown as readonly number[], i, 1);
          } else {
            pending.push(byte);
            await drain(false);
          }
        }
      }
      await drain(true);
      await session.output(record.view());
    });
  });
}
