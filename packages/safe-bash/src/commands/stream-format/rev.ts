import { PublicDiagnostic } from "../../diagnostics.js";
import type { CommandDefinition } from "../../contracts/index.js";
import { diagnostic, options, UsageError } from "../internal.js";
import { command, records, type Session, type StreamFormatLimits } from "./shared.js";

async function validPrefix(bytes: Uint8Array, session: Session): Promise<number> {
  for (let offset = 0; offset < bytes.length;) {
    const s = session.step();
    if (s) await s;
    const first = bytes[offset]!;
    if (first < 128) { offset++; continue; }
    const width = first >= 194 && first <= 223 ? 2 : first >= 224 && first <= 239 ? 3 : first >= 240 && first <= 244 ? 4 : 0;
    if (!width || offset + width > bytes.length) return offset;
    for (let position = 1; position < width; position++) {
      const next = bytes[offset + position]!;
      if (next < 128 || next > 191) return offset;
    }
    const second = bytes[offset + 1]!;
    if (first === 224 && second < 160 || first === 237 && second >= 160 || first === 240 && second < 144 || first === 244 && second > 143) return offset;
    offset += width;
  }
  return bytes.length;
}

async function reversed(bytes: Uint8Array, utf8: boolean, session: Session, appendNewline = false): Promise<Uint8Array> {
  const result = new Uint8Array(bytes.length + (appendNewline ? 1 : 0));
  if (!utf8) {
    const s = session.step(bytes.length);
    if (s) await s;
    for (let i = 0, j = bytes.length - 1; i < bytes.length; i++, j--) result[i] = bytes[j]!;
    if (appendNewline) result[bytes.length] = 10;
    return result;
  }
  let destination = 0;
  for (let end = bytes.length; end > 0;) {
    const s = session.step();
    if (s) await s;
    let start = end - 1;
    while (start > 0 && (bytes[start]! & 192) === 128) start--;
    const width = end - start;
    if (width === 1) {
      result[destination++] = bytes[start]!;
    } else {
      result.set(bytes.subarray(start, end), destination);
      destination += width;
    }
    end = start;
  }
  if (appendNewline) result[destination] = 10;
  return result;
}

export function createRevCommand(limits: StreamFormatLimits): CommandDefinition {
  return command("rev", limits, async session => {
    const parsed = options(session.context.args, "", {}, true);
    const locale = session.context.env.LC_ALL || session.context.env.LC_CTYPE || session.context.env.LANG || "C";
    const utf8 = /(?:^|[._-])utf-?8(?:@.*)?$/iu.test(locale);
    if (!utf8 && locale !== "C" && locale !== "POSIX") throw new UsageError(`unsupported character encoding locale: '${locale}'`);
    await session.files(session.names(parsed.operands), async (source, name) => {
      const canBatch = limits.maxOutputBytes === Infinity && limits.maxChunkBytes >= 16384;
      const outBuf = new Uint8Array(16384);
      let outLen = 0;
      let flushedFirst = false;
      const flushOut = async (): Promise<void> => {
        if (outLen > 0) {
          flushedFirst = true;
          const slice = outBuf.subarray(0, outLen);
          outLen = 0;
          await session.output(slice);
        }
      };
      for await (const { bytes: record, terminated } of records(source, session, flushOut)) {
        const length = utf8 ? await validPrefix(record, session) : record.length;
        if (length || length === record.length) {
          const hasNl = terminated || length !== record.length;
          const revBytes = await reversed(record.subarray(0, length), utf8, session, hasNl);
          if (canBatch && revBytes.length <= 8192) {
            if (outLen + revBytes.length > 16384) await flushOut();
            outBuf.set(revBytes, outLen);
            outLen += revBytes.length;
            if (!flushedFirst || outLen >= 8192) await flushOut();
          } else {
            await flushOut();
            await session.output(revBytes);
          }
        }
        if (length !== record.length) {
          await flushOut();
          await diagnostic(session.context, new PublicDiagnostic(`${name === "-" && !parsed.operands.length ? "stdin" : name}: Illegal byte sequence`));
          session.failed = true;
          break;
        }
      }
      await flushOut();
    }, parsed.operands.length > 0);
  });
}
