import type { CommandDefinition } from "../../contracts/index.js";
import { diagnostic, options, UsageError } from "../internal.js";
import { command, records, type Session, type StreamFormatLimits } from "./shared.js";

async function validPrefix(bytes: Uint8Array, session: Session): Promise<number> {
  for (let offset = 0; offset < bytes.length;) {
    await session.step();
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

async function reversed(bytes: Uint8Array, utf8: boolean, session: Session): Promise<Uint8Array> {
  const result = new Uint8Array(bytes.length);
  let destination = 0;
  for (let end = bytes.length; end > 0;) {
    await session.step();
    let start = end - 1;
    if (utf8) while (start > 0 && (bytes[start]! & 192) === 128) start--;
    result.set(bytes.subarray(start, end), destination);
    destination += end - start;
    end = start;
  }
  return result;
}

export function createRevCommand(limits: StreamFormatLimits): CommandDefinition {
  return command("rev", limits, async session => {
    const parsed = options(session.context.args, "", {}, true);
    const locale = session.context.env.LC_ALL || session.context.env.LC_CTYPE || session.context.env.LANG || "C";
    const utf8 = /(?:^|[._-])utf-?8(?:@.*)?$/iu.test(locale);
    if (!utf8 && locale !== "C" && locale !== "POSIX") throw new UsageError(`unsupported character encoding locale: '${locale}'`);
    const names = parsed.operands.length ? parsed.operands.map(name => name === "-" ? "./-" : name) : [];
    await session.files(session.names(names), async (source, name) => {
      for await (const record of records(source, session)) {
        const length = utf8 ? await validPrefix(record, session) : record.length;
        if (length || length === record.length) {
          await session.output(await reversed(record.subarray(0, length), utf8, session));
          await session.text("\n");
        }
        if (length !== record.length) {
          await diagnostic(session.context, new Error(`${name === "-" ? "stdin" : name}: Illegal byte sequence`));
          session.failed = true;
          break;
        }
      }
    });
  });
}
