import type { CommandDefinition } from "../../contracts/index.js";
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
    const parsed = options(session.context.args, "h:b:f:v:i:pl:s:w:n:d:", {
      "header-numbering": "h", "body-numbering": "b", "footer-numbering": "f",
      "starting-line-number": "v", "line-increment": "i", "no-renumber": "p",
      "join-blank-lines": "l", "number-separator": "s", "number-width": "w",
      "number-format": "n", "section-delimiter": "d",
    });
    const header = style(value(parsed, "h") ?? "n"), body = style(value(parsed, "b") ?? "t"), footer = style(value(parsed, "f") ?? "n");
    const start = signed(value(parsed, "v") ?? "1"), increment = signed(value(parsed, "i") ?? "1");
    const join = Math.max(1, integer(value(parsed, "l") ?? "1")), width = integer(value(parsed, "w") ?? "6", 1);
    const separator = value(parsed, "s") ?? "\t", format = value(parsed, "n") ?? "rn";
    if (!["ln", "rn", "rz"].includes(format)) throw new UsageError(`invalid line numbering format: '${format}'`);
    session.check(width + Buffer.byteLength(separator), limits.maxRecordBytes, "number field");
    let delimiter = Buffer.from("\\:");
    for (const argument of parsed.values.get("d") ?? []) {
      const next = Buffer.from(argument);
      delimiter = next.length === 1 ? Buffer.concat([next, delimiter.subarray(1)]) : next;
    }
    const delimiters = [1, 2, 3].map(count => Buffer.concat(Array.from({ length: count }, () => delimiter)));
    const budget = new PatternBudget(session);
    const unnumbered = " ".repeat(width + Buffer.byteLength(separator));
    let current: Style = body, number = start, blanks = 0;
    await session.files(session.names(parsed.operands), async source => {
      for await (const record of records(source, session)) {
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
        else numbered = current.find(bytes.toString("latin1"), budget) !== undefined;
        if (numbered) {
          if (number < -(1n << 63n) || number >= 1n << 63n) throw new UsageError("line number overflow");
          let label = number.toString();
          if (format === "ln") label = label.padEnd(width, " ");
          else if (format === "rz" && number < 0n) label = "-" + label.slice(1).padStart(width - 1, "0");
          else label = label.padStart(width, format === "rz" ? "0" : " ");
          await session.text(label + separator);
          number += increment;
        } else await session.text(unnumbered);
        await session.output(record);
        await session.text("\n");
      }
    });
  });
}
