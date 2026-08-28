import { define, options, output, UsageError } from "../../internal.js";
import { addOffset, numeric, range, rows, sources, validatedOption } from "./shared.js";
function formats(text) {
    const result = [];
    for (let offset = 0; offset < text.length;) {
        const match = /^(c|[doux](?:1|2|4|8))/u.exec(text.slice(offset));
        if (!match)
            throw new UsageError(`unsupported type '${text}': use c or d/o/u/x with size 1, 2, 4, or 8`);
        result.push({ kind: match[0][0], size: match[0] === "c" ? 1 : Number(match[0][1]) });
        offset += match[0].length;
        if (result.length > 16)
            throw new UsageError("at most 16 output types are supported");
    }
    if (!result.length)
        throw new UsageError("empty output type");
    return result;
}
function formatRow(row, format, bigEndian) {
    let text = "";
    const escapes = { 0: "\\0", 7: "\\a", 8: "\\b", 9: "\\t", 10: "\\n", 11: "\\v", 12: "\\f", 13: "\\r" };
    for (let offset = 0; offset < row.length; offset += format.size) {
        if (format.kind === "c") {
            const byte = row[offset];
            const character = escapes[byte] ?? (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : byte.toString(8).padStart(3, "0"));
            text += ` ${character.padStart(3)}`;
            continue;
        }
        let number = 0n;
        for (let index = 0; index < format.size; index++) {
            const byte = row[offset + index] ?? 0;
            const shift = bigEndian ? format.size - index - 1 : index;
            number |= BigInt(byte) << BigInt(shift * 8);
        }
        const bits = format.size * 8;
        if (format.kind === "d" && number >= 1n << BigInt(bits - 1))
            number -= 1n << BigInt(bits);
        const base = format.kind === "o" ? 8 : format.kind === "x" ? 16 : 10;
        const width = format.kind === "o" ? Math.ceil(bits / 3) : format.kind === "x" ? bits / 4
            : format.kind === "d" ? (1n << BigInt(bits - 1)).toString().length + 1 : ((1n << BigInt(bits)) - 1n).toString().length;
        text += ` ${number.toString(base).padStart(width, base === 10 ? " " : "0")}`;
    }
    return text;
}
export function createOdCommand() {
    return define("od", async (context) => {
        const aliases = { b: "o1", c: "c", d: "u2", o: "o2", s: "d2", x: "x2" };
        const rewritten = [];
        let ended = false;
        for (let index = 0; index < context.args.length; index++) {
            const argument = context.args[index];
            if (ended || argument === "-" || !argument.startsWith("-")) {
                rewritten.push(argument);
                continue;
            }
            if (argument === "--") {
                ended = true;
                rewritten.push(argument);
                continue;
            }
            if (argument.startsWith("--")) {
                rewritten.push(argument);
                if (!argument.includes("=") && ["--address-radix", "--skip-bytes", "--read-bytes", "--format", "--type", "--width", "--endian"].includes(argument)) {
                    const parameter = context.args[++index];
                    if (parameter === undefined)
                        throw new UsageError(`option '${argument}' requires an argument`);
                    rewritten.push(parameter);
                }
                continue;
            }
            for (let offset = 1; offset < argument.length; offset++) {
                const flag = argument[offset];
                if (flag === "e")
                    throw new UsageError("use --endian=little or --endian=big; -e is unsupported");
                if (aliases[flag])
                    rewritten.push(`-t${aliases[flag]}`);
                else if ("AjNtw".includes(flag)) {
                    const parameter = argument.slice(offset + 1) || context.args[++index];
                    if (parameter === undefined)
                        throw new UsageError(`option '-${flag}' requires an argument`);
                    rewritten.push(`-${flag}`, parameter);
                    break;
                }
                else
                    rewritten.push(`-${flag}`);
            }
        }
        const parsed = options(rewritten, "vA:j:N:t:w:e:", { "address-radix": "A", "skip-bytes": "j", "read-bytes": "N", format: "t", type: "t", width: "w", endian: "e", "output-duplicates": "v" });
        const radix = validatedOption(parsed, "A", text => {
            if (!["d", "o", "x", "n"].includes(text))
                throw new UsageError("address radix must be d, o, x, or n");
            return text;
        }, "o");
        const endian = validatedOption(parsed, "e", text => {
            if (text !== "little" && text !== "big")
                throw new UsageError("endian must be little or big");
            return text;
        }, "little");
        const selected = (parsed.values.get("t") ?? ["o2"]).flatMap(formats);
        if (selected.length > 16)
            throw new UsageError("at most 16 output types are supported");
        const width = validatedOption(parsed, "w", text => {
            const number = numeric(text);
            if (number < 1 || number > 4096 || selected.some(format => number % format.size !== 0))
                throw new UsageError("width must be 1..4096 and a multiple of each output type size");
            return number;
        }, 16);
        const skip = validatedOption(parsed, "j", text => numeric(text, true), 0);
        const count = validatedOption(parsed, "N", text => numeric(text, true), Infinity);
        let offset = skip;
        let previous;
        let suppressed = false;
        const address = () => radix === "n" ? "" : offset.toString(radix === "o" ? 8 : radix === "x" ? 16 : 10).padStart(7, "0");
        for await (const row of rows(range(sources(context, parsed.operands), skip, count), width)) {
            const same = previous?.length === row.length && row.every((byte, index) => previous[index] === byte);
            if (!parsed.flags.has("v") && same) {
                if (!suppressed)
                    await output(context, "*\n");
                suppressed = true;
            }
            else {
                for (let index = 0; index < selected.length; index++) {
                    const prefix = index === 0 ? address() : " ".repeat(address().length);
                    await output(context, `${prefix}${formatRow(row, selected[index], endian === "big")}\n`);
                }
                previous = row;
                suppressed = false;
            }
            offset = addOffset(offset, row.length);
        }
        if (radix !== "n")
            await output(context, `${address()}\n`);
        return { exitCode: 0 };
    });
}
//# sourceMappingURL=od.js.map