import { decodeFoldUnit, portableWidth, type FoldUnit } from "safe-bash-command-fold";
import type { ByteSource, CommandDefinition } from "../../contracts/index.js";
import { integer } from "../internal.js";
import { numericOptions } from "./numeric-options.js";
import { command, RecordBuffer, type Session, type StreamInspectionLimits } from "./shared.js";

async function* units(source: ByteSource, session: Session, utf8: boolean): AsyncGenerator<{ unit: FoldUnit; bytes: readonly number[] }> {
  const pending: number[] = [];
  const drain = function* (eof: boolean) {
    while (pending.length) {
      const unit = utf8 ? decodeFoldUnit(pending, 0, pending.length, eof)
        : { cp: pending[0]!, length: 1, valid: true };
      if (!unit) return;
      yield { unit, bytes: pending.splice(0, unit.length) };
    }
  };
  for await (const chunk of source) {
    for (const byte of chunk) {
      await session.step();
      pending.push(byte);
      yield* drain(false);
    }
  }
  yield* drain(true);
}

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
      for await (const { unit, bytes } of units(source, session, utf8)) {
        if (unit.cp === 10) {
          await session.output(record.view()); await session.output(Uint8Array.of(10));
          record.clear(); column = 0; lastBlank = -1; continue;
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
            await session.step(glyph.length);
            column = adjust(column, glyph);
            offset += glyph.length;
            if (glyph.cp === 32 || glyph.cp === 9) lastBlank = offset - 1;
          }
        }
        column = adjust(column, unit);
        for (const byte of bytes) record.push(byte);
        if (unit.cp === 32 || unit.cp === 9) lastBlank = record.size - 1;
      }
      await session.output(record.view());
    });
  });
}
