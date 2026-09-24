import { getCommandArguments, type CommandDefinition } from "../../contracts/index.js";
import { integer, options, UsageError, value } from "../internal.js";
import { Pattern } from "../text-programs/regex.js";
import { Budget } from "../text-programs/shared.js";
import { command, records, type Session, type StreamFormatLimits } from "./shared.js";

type Style = "a" | "t" | "n" | Pattern;

class PatternBudget extends Budget {
  constructor(readonly session: Session) {
    super({ ...session.context, signal: session.signal }, { maxSteps: session.limits.maxSteps, maxBufferBytes: session.limits.maxRecordBytes });
  }
  override step(count = 1): void { this.session.charge(count); }
}

function style(text: string): Style {
  if (text === "a" || text === "t" || text === "n") return text;
  if (text.startsWith("p")) return new Pattern(Buffer.from(text.slice(1)).toString("latin1"), false);
  throw new UsageError(`invalid numbering style: '${text}'`);
}

function signed(text: string): bigint {
  if (!/^[+-]?\d+$/u.test(text.trim())) throw new UsageError(`invalid line number: '${text}'`);
  const number = BigInt(text);
  if (number < -(1n << 63n) || number >= 1n << 63n) throw new UsageError(`line number out of range: '${text}'`);
  return number;
}

export function createNlCommand(limits: StreamFormatLimits): CommandDefinition {
  return command("nl", limits, async session => {
    const arguments_ = getCommandArguments(session.context);
    let separator = Buffer.from("\t");
    const parsed = options(session.context.args, "h:b:f:v:i:pl:s:w:n:d:", {
      "header-numbering": "h", "body-numbering": "b", "footer-numbering": "f",
      "starting-line-number": "v", "line-increment": "i", "no-renumber": "p",
      "join-blank-lines": "l", "number-separator": "s", "number-width": "w",
      "number-format": "n", "section-delimiter": "d",
    }, false, undefined, (key, index, offset) => {
      if (key === "s") separator = Buffer.from(arguments_.bytes(index)!.subarray(offset));
    });
    const header = style(value(parsed, "h") ?? "n"), body = style(value(parsed, "b") ?? "t"), footer = style(value(parsed, "f") ?? "n");
    const start = signed(value(parsed, "v") ?? "1"), increment = signed(value(parsed, "i") ?? "1");
    const join = Math.max(1, integer(value(parsed, "l") ?? "1")), width = integer(value(parsed, "w") ?? "6", 1);
    const format = value(parsed, "n") ?? "rn";
    if (!["ln", "rn", "rz"].includes(format)) throw new UsageError(`invalid line numbering format: '${format}'`);
    session.check(width + separator.length, limits.maxRecordBytes, "number field");
    session.admitOutput(width + separator.length);
    let delimiter = Buffer.from("\\:");
    for (const argument of parsed.values.get("d") ?? []) {
      const next = Buffer.from(argument);
      delimiter = next.length === 1 ? Buffer.concat([next, delimiter.subarray(1)]) : next;
    }
    const delimiters = [1, 2, 3].map(count => Buffer.concat(Array.from({ length: count }, () => delimiter)));
    const budget = new PatternBudget(session);
    async function padding(size: number, byte = 32): Promise<void> {
      while (size > 0) {
        const count = Math.min(size, 16384, limits.maxChunkBytes);
        await session.output(Buffer.alloc(count, byte));
        size -= count;
      }
    }
    let current: Style = body, number = start, blanks = 0;
    await session.files(session.names(parsed.operands), async source => {
      for await (const { bytes: record } of records(source, session)) {
        const bytes = Buffer.from(record);
        const section = delimiter.length ? delimiters.findIndex(candidate => candidate.equals(bytes)) : -1;
        if (section >= 0) {
          current = section === 0 ? footer : section === 1 ? body : header;
          if (!parsed.flags.has("p")) number = start;
          await session.text("\n");
          continue;
        }
        let numbered: boolean;
        if (current === "a") {
          numbered = record.length > 0 || ++blanks === join || join === 1;
          if (numbered) blanks = 0;
        } else if (current === "t") numbered = record.length > 0;
        else if (current === "n") numbered = false;
        else numbered = (await current.find(bytes.toString("latin1"), budget)) !== undefined;
        if (numbered) {
          if (number < -(1n << 63n) || number >= 1n << 63n) throw new UsageError("line number overflow");
          const label = number.toString();
          const pad = Math.max(0, width - label.length);
          session.admitOutput(label.length + pad + separator.length + record.length + 1);
          if (format === "ln") {
            await session.text(label);
            await padding(pad);
          } else if (format === "rz" && number < 0n) {
            await session.text("-");
            await padding(pad, 48);
            await session.text(label.slice(1));
          } else {
            await padding(pad, format === "rz" ? 48 : 32);
            await session.text(label);
          }
          await session.output(separator);
          number += increment;
        } else {
          session.admitOutput(width + separator.length + record.length + 1);
          await padding(width + separator.length);
        }
        await session.output(record);
        await session.text("\n");
      }
    });
  });
}
