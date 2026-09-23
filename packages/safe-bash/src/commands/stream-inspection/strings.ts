import type { CommandDefinition } from "../../contracts/index.js";
import { integer, UsageError, value } from "../internal.js";
import { dataMode, stringRegions } from "./strings-object.js";
import { numericOptions } from "./numeric-options.js";
import { command, RecordBuffer, type StreamInspectionLimits } from "./shared.js";

export function createStringsCommand(limits: StreamInspectionLimits): CommandDefinition {
  return command("strings", limits, async session => {
    let radix: string | undefined;
    const parsed = numericOptions(session.context.args, "adfon:s:t:we:U:T:", {
      all: "a", "print-file-name": "f", bytes: "n", "output-separator": "s", radix: "t", "include-all-whitespace": "w",
      encoding: "e", unicode: "U", data: "d", target: "T",
    }, undefined, (key, specification) => {
      if (key === "o") radix = "o";
      if (key === "t") {
        if (specification === undefined || !["d", "o", "x"].includes(specification)) throw new UsageError(`invalid radix '${specification}'`);
        radix = specification;
      }
    });
    const target = value(parsed, "T");
    if (target !== undefined && !["elf64-x86-64", "elf32-i386"].includes(target)) throw new UsageError(`unsupported target '${target}'`);
    const data = dataMode(session.context.args);
    let encoding = value(parsed, "e") ?? "s";
    if (!["s", "S", "l", "b", "L", "B"].includes(encoding)) throw new UsageError(`invalid encoding '${encoding}'`);
    const modes: Readonly<Record<string, string>> = { d: "default", i: "invalid", l: "locale", x: "hex", e: "escape", h: "highlight" };
    const selection = value(parsed, "U") ?? "default";
    const unicode = modes[selection] ?? selection;
    if (!["default", "invalid", "locale", "hex", "escape", "highlight"].includes(unicode)) throw new UsageError(`invalid Unicode option '${selection}'`);
    if (unicode !== "default") encoding = "S";
    const width = encoding === "l" || encoding === "b" ? 2 : encoding === "L" || encoding === "B" ? 4 : 1;
    const separator = new TextEncoder().encode(value(parsed, "s") ?? "\n");
    let minimum = 4;
    for (const specification of parsed.values.get("n") ?? []) minimum = integer(specification, 1);
    if (parsed.legacyValue !== undefined) {
      const specification = parsed.legacyValue;
      if (!/^(?:0[0-7]*|[1-9][0-9]*)$/u.test(specification)) throw new UsageError(`invalid number '${specification}'`);
      minimum = Number.parseInt(specification, specification.startsWith("0") ? 8 : 10);
      if (minimum < 1 || minimum >= 4294967295) throw new UsageError(`invalid number '${specification}'`);
    }
    const files = parsed.operands.filter(name => name !== "-");
    if (parsed.operands.length && !files.length) throw new UsageError("missing file operand after '-' (use no operands for stdin)");
    await session.files(session.names(files), async (source, name) => {
      const regions = data && name !== "-" ? await stringRegions(source, session, target) : [{ source, offset: 0 }];
      for (const region of regions) {
        const record = new RecordBuffer(session);
        let offset = 0, start = 0, characters = 0;
        const unit: number[] = [];
        const utf8: number[] = [];
        let utf8Width = 0;
        const flush = async () => {
          if (characters >= minimum) {
            const label = parsed.flags.has("f") ? `${name === "-" ? "{standard input}" : name}: ` : "";
            const location = radix === undefined ? "" : `${start.toString(radix === "x" ? 16 : radix === "o" ? 8 : 10).padStart(7, " ")} `;
            await session.output(new TextEncoder().encode(label + location));
            await session.output(record.view());
            await session.output(separator);
          }
          record.clear();
          characters = 0;
        };
        const append = (bytes: readonly number[], position: number) => {
          if (!characters) start = region.offset + position;
          for (const byte of bytes) record.push(byte);
          characters++;
        };
        const single = async (byte: number, position: number) => {
          if (unicode !== "default" && byte >= 128) {
            if (!utf8.length) {
              utf8Width = byte >= 0xc0 && byte < 0xe0 ? 2 : byte >= 0xe0 && byte < 0xf0 ? 3 : byte >= 0xf0 && byte < 0xf8 ? 4 : 0;
              if (!utf8Width) { await flush(); return; }
            } else if (byte < 0x80 || byte >= 0xc0) {
              utf8.length = 0;
              await flush();
              await single(byte, position);
              return;
            }
            utf8.push(byte);
            if (utf8.length < utf8Width) return;
            if (unicode === "invalid") await flush();
            else if (unicode === "locale") append(utf8, position - utf8.length + 1);
            else {
              let text: string;
              if (unicode === "hex") text = `<0x${utf8.map(value => value.toString(16).padStart(2, "0")).join("")}>`;
              else {
                // GNU strings 2.44 retains its historical four-byte escape calculation.
                let code = utf8[0]! & (utf8Width === 2 ? 31 : 15);
                for (const continuation of utf8.slice(1)) code = code * 64 + (continuation & 63);
                if (utf8Width === 4) code = ((utf8[0]! & 7) << 18) | ((utf8[1]! & 63) << 14) | ((utf8[2]! & 63) << 6) | (utf8[3]! & 63);
                text = `\\u${code.toString(16).padStart(utf8Width === 4 ? 6 : 4, "0")}`;
              }
              append([...new TextEncoder().encode(text)], position - utf8.length + 1);
            }
            utf8.length = 0;
            return;
          }
          if (utf8.length) { utf8.length = 0; await flush(); }
          if (byte === 9 || byte >= 32 && (byte <= 126 || encoding === "S" && byte >= 128) || parsed.flags.has("w") && byte >= 10 && byte <= 13) append([byte], position);
          else await flush();
        };
        for await (const chunk of region.source) {
          for (const byte of chunk) {
            await session.step();
            if (width === 1) await single(byte, offset);
            else {
              unit.push(byte);
              if (unit.length === width) {
                const little = encoding === "l" || encoding === "L";
                let code = 0;
                for (let index = 0; index < width; index++) code = code * 256 + unit[little ? width - index - 1 : index]!;
                if (code === 9 || code >= 32 && code <= 126 || parsed.flags.has("w") && code >= 10 && code <= 13) append([code], offset - width + 1);
                else await flush();
                unit.length = 0;
              }
            }
            offset++;
          }
        }
        await flush();
      }
    });
  });
}
