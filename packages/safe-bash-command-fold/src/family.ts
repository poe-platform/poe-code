import { decodeFoldUnit, portableWidth, type FoldUnit } from "./index.js";
import type { CommandDefinition } from "safe-bash-contracts";
import { integer } from "safe-bash-io-engine/internal";
import { numericOptions } from "safe-bash-text-stream-engine/stream-inspection/numeric-options";
import { command, RecordBuffer, type StreamInspectionLimits } from "safe-bash-text-stream-engine/stream-inspection/shared";

export function createFoldCommand(limits: StreamInspectionLimits): CommandDefinition {
  return command("fold", limits, async session => {
    let mode: "columns" | "bytes" | "characters" = "columns";
    const parsed = numericOptions(session.context.args, "bcsw:", Object.fromEntries(
      ["bytes", "characters", "spaces", "width"].flatMap(name =>
        Array.from(name, (_, index) => [name.slice(0, index + 1), name[0]!])),
    ), "w", key => {
      if (key === "b" || key === "c") mode = key === "b" ? "bytes" : "characters";
    });
    let width = 80;
    for (const specification of parsed.values.get("w") ?? []) width = integer(specification, 1);
    const locale = (session.context.env.LC_ALL || session.context.env.LC_CTYPE || session.context.env.LANG || "C.UTF-8").toUpperCase().split("@")[0]!;
    const utf8 = locale.endsWith("UTF-8") || locale.endsWith("UTF8");
    let lastWidth = 0;
    const adjust = (column: number, cp: number, length: number, valid: boolean): number => {
      if (mode === "bytes") return column + length;
      if (cp === 8) return Math.max(0, column - lastWidth);
      if (cp === 13) return 0;
      if (cp === 9) return column + 8 - column % 8;
      const cells = mode === "characters" || (cp >= 32 && cp < 127) ? 1 : utf8 && valid ? portableWidth(cp) : 1;
      lastWidth = cells < 0 ? 1 : cells;
      return column + lastWidth;
    };
    await session.files(session.names(parsed.operands), async source => {
      const record = new RecordBuffer(session);
      const outMax = Math.min(16384, limits.maxChunkBytes);
      const outBuf = new Uint8Array(outMax);
      let outLen = 0;
      const flushOut = async (): Promise<void> => {
        if (outLen > 0) {
          const slice = outBuf.subarray(0, outLen);
          outLen = 0;
          await session.output(slice);
        }
      };
      const emitLine = async (line: Uint8Array): Promise<void> => {
        const needed = line.length + 1;
        if (needed >= outMax) {
          await flushOut();
          await session.output(line);
          await session.output(Uint8Array.of(10));
          return;
        }
        if (outLen + needed > outMax) await flushOut();
        outBuf.set(line, outLen);
        outLen += line.length;
        outBuf[outLen++] = 10;
      };
      let column = 0, lastBlank = -1;
      const hasSpaces = parsed.flags.has("s");
      const processUnit = async (unit: FoldUnit, bytes: readonly number[], byteOffset = 0, byteLen = bytes.length): Promise<void> => {
        if (unit.cp === 10) {
          await emitLine(record.view());
          record.clear(); column = 0; lastBlank = -1; return;
        }
        while (adjust(column, unit.cp, unit.length, unit.valid) > width && record.size) {
          const boundary = hasSpaces && lastBlank >= 0 ? lastBlank + 1 : record.size;
          await emitLine(record.view().subarray(0, boundary));
          record.drop(boundary); column = 0; lastBlank = -1;
          const retained = record.view();
          for (let offset = 0; offset < retained.length;) {
            const first = retained[offset]!;
            if (!utf8 || first < 128) {
              const s = session.step(1);
              if (s) await s;
              column = adjust(column, first, 1, true);
              offset++;
              if (first === 32 || first === 9) lastBlank = offset - 1;
              continue;
            }
            const glyph = decodeFoldUnit(retained, offset, retained.length - offset, true)!;
            const s = session.step(glyph.length);
            if (s) await s;
            column = adjust(column, glyph.cp, glyph.length, glyph.valid);
            offset += glyph.length;
            if (glyph.cp === 32 || glyph.cp === 9) lastBlank = offset - 1;
          }
        }
        column = adjust(column, unit.cp, unit.length, unit.valid);
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
              const nextCol = adjust(column, byte, 1, true);
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
        await flushOut();
      }
      await drain(true);
      await flushOut();
      await session.output(record.view());
    });
  });
}
