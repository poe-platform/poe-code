import { basename, dirname, writeBytes } from "../contracts/index.js";
import { define, encoder, escapeBytes, options, output, requireOperands, UsageError, value } from "./internal.js";
export function basicCommands() {
    return [
        define("true", () => ({ exitCode: 0 })),
        define("false", () => ({ exitCode: 1 })),
        define("echo", async (context) => {
            let newline = true;
            let escapes = false;
            let offset = 0;
            while (/^-[neE]+$/u.test(context.args[offset] ?? "")) {
                for (const flag of context.args[offset].slice(1)) {
                    if (flag === "n")
                        newline = false;
                    else
                        escapes = flag === "e";
                }
                offset++;
            }
            const text = context.args.slice(offset).join(" ");
            if (escapes) {
                const escaped = escapeBytes(text, true);
                await output(context, escaped.bytes);
                if (escaped.stop)
                    newline = false;
            }
            else
                await output(context, text);
            if (newline)
                await output(context, "\n");
            return { exitCode: 0 };
        }),
        define("pwd", async (context) => {
            const parsed = options(context.args, "LP");
            requireOperands(parsed.operands, 0, 0);
            await output(context, `${parsed.flags.has("P") ? await context.fs.realpath(context.cwd, { signal: context.signal }) : context.cwd}\n`);
            return { exitCode: 0 };
        }),
        define("basename", async (context) => {
            const parsed = options(context.args, "as:z", { multiple: "a", suffix: "s", zero: "z" });
            const multiple = parsed.flags.has("a") || parsed.flags.has("s");
            requireOperands(parsed.operands, 1, multiple ? Infinity : 2);
            const suffix = value(parsed, "s") ?? (multiple ? undefined : parsed.operands[1]);
            for (const operand of multiple ? parsed.operands : parsed.operands.slice(0, 1)) {
                let result = /^\/+$/u.test(operand) ? "/" : basename(operand);
                if (suffix && result !== suffix && result.endsWith(suffix))
                    result = result.slice(0, -suffix.length);
                await output(context, result + (parsed.flags.has("z") ? "\0" : "\n"));
            }
            return { exitCode: 0 };
        }),
        define("dirname", async (context) => {
            const parsed = options(context.args, "z", { zero: "z" });
            requireOperands(parsed.operands);
            for (const operand of parsed.operands)
                await output(context, dirname(operand.replace(/\/+$/u, "") || (operand.startsWith("/") ? "/" : ".")) + (parsed.flags.has("z") ? "\0" : "\n"));
            return { exitCode: 0 };
        }),
        define("printf", async (context) => {
            const args = context.args[0] === "--" ? context.args.slice(1) : context.args;
            requireOperands(args);
            const format = args[0];
            if (format.startsWith("-") && context.args[0] !== "--")
                throw new UsageError(`invalid option '${format}'`);
            let argument = 1;
            let exitCode = 0;
            let stopped = false;
            do {
                const before = argument;
                for (let offset = 0; offset < format.length && !stopped;) {
                    if (format[offset] !== "%") {
                        const end = format.indexOf("%", offset);
                        const literal = format.slice(offset, end < 0 ? format.length : end);
                        const escaped = escapeBytes(literal);
                        await output(context, escaped.bytes);
                        stopped = escaped.stop;
                        offset += literal.length;
                        continue;
                    }
                    if (format[offset + 1] === "%") {
                        await output(context, "%");
                        offset += 2;
                        continue;
                    }
                    const match = /^%([-+ #0]*)(\d+)?(?:\.(\d+))?([sbqcdiouxXfFeEgG])/u.exec(format.slice(offset));
                    if (!match)
                        throw new UsageError(`invalid format near '${format.slice(offset)}'`);
                    offset += match[0].length;
                    const flags = match[1];
                    const width = Number(match[2] ?? 0);
                    const precision = match[3] === undefined ? undefined : Number(match[3]);
                    if (width > 1_000_000 || (precision ?? 0) > 1000)
                        throw new UsageError("format width or precision is too large");
                    const specifier = match[4];
                    if (/[fFeEgG]/u.test(specifier) && (precision ?? 0) > 100)
                        throw new UsageError("floating-point precision is too large");
                    const supplied = args[argument++] ?? "";
                    let text;
                    if (specifier === "b" || specifier === "s") {
                        const escaped = specifier === "b" ? escapeBytes(supplied, true) : { bytes: encoder.encode(supplied), stop: false };
                        const bytes = escaped.bytes.subarray(0, precision);
                        const padding = " ".repeat(Math.max(0, width - bytes.length));
                        if (!flags.includes("-"))
                            await output(context, padding);
                        await output(context, bytes);
                        if (flags.includes("-"))
                            await output(context, padding);
                        stopped = escaped.stop;
                        continue;
                    }
                    if (specifier === "q")
                        text = supplied === "" ? "''" : supplied.replace(/[^a-zA-Z0-9_./-]/gu, character => character === "\n" ? "$'\\n'" : `\\${character}`);
                    else if (specifier === "c")
                        text = supplied ? String.fromCodePoint(supplied.codePointAt(0)) : "\0";
                    else {
                        let number = supplied === "" ? 0 : /^["']/u.test(supplied) ? supplied.codePointAt(1) ?? 0 : Number(supplied);
                        if (/^[+-]0[xX][0-9a-fA-F]+$/u.test(supplied.trim())) {
                            number = Number(supplied.trim().slice(1)) * (supplied.trim().startsWith("-") ? -1 : 1);
                        }
                        if (/^[+-]?0[0-9]+$/u.test(supplied) && !/[fFeEgG]/u.test(specifier)) {
                            if (/[89]/u.test(supplied))
                                number = NaN;
                            else
                                number = parseInt(supplied.replace(/^[+-]?0/u, ""), 8) * (supplied.startsWith("-") ? -1 : 1);
                        }
                        if (!Number.isFinite(number)) {
                            await writeBytes(context.stderr, encoder.encode(`printf: '${supplied}': invalid number\n`), context.signal);
                            exitCode = 1;
                            number = 0;
                        }
                        if (/[fF]/u.test(specifier))
                            text = number.toFixed(precision ?? 6);
                        else if (/[eE]/u.test(specifier))
                            text = number.toExponential(precision ?? 6).replace(/e([+-])(\d)$/u, "e$10$2");
                        else if (/[gG]/u.test(specifier))
                            text = Number(number.toPrecision(Math.max(1, precision ?? 6))).toString();
                        else {
                            const radix = /[xX]/u.test(specifier) ? 16 : specifier === "o" ? 8 : 10;
                            const unsigned = /[uoxX]/u.test(specifier);
                            let integral;
                            try {
                                const token = supplied.trim();
                                if (!token || /^["']/u.test(token))
                                    integral = BigInt(Math.trunc(number));
                                else {
                                    const magnitude = token.replace(/^[+-]/u, "");
                                    if (!/^(?:0[xX][0-9a-fA-F]+|0[0-7]*|[1-9][0-9]*)$/u.test(magnitude))
                                        throw new Error("invalid integer");
                                    integral = BigInt(/^0[0-7]+$/u.test(magnitude) ? `0o${magnitude.slice(1)}` : magnitude) * (token.startsWith("-") ? -1n : 1n);
                                }
                            }
                            catch {
                                integral = 0n;
                                if (exitCode === 0)
                                    await writeBytes(context.stderr, encoder.encode(`printf: '${supplied}': invalid integer\n`), context.signal);
                                exitCode = 1;
                            }
                            text = (unsigned ? BigInt.asUintN(64, integral) : integral).toString(radix);
                            if (precision === 0 && integral === 0n)
                                text = "";
                            if (precision !== undefined)
                                text = text.startsWith("-") ? `-${text.slice(1).padStart(precision, "0")}` : text.padStart(precision, "0");
                            if (flags.includes("#")) {
                                if (radix === 16 && integral !== 0n)
                                    text = "0x" + text;
                                else if (radix === 8 && !text.startsWith("0"))
                                    text = "0" + text;
                            }
                        }
                        if (/[XFEG]/u.test(specifier))
                            text = text.toUpperCase();
                        if (number >= 0 && /[difFeEgG]/u.test(specifier))
                            text = (flags.includes("+") ? "+" : flags.includes(" ") ? " " : "") + text;
                    }
                    if (flags.includes("-"))
                        text = text.padEnd(width, " ");
                    else if (flags.includes("0") && /[diouxXfFeEgG]/u.test(specifier)
                        && (precision === undefined || /[fFeEgG]/u.test(specifier))) {
                        const prefix = /^[+ -]|^0[xX]/u.exec(text)?.[0] ?? "";
                        text = prefix + text.slice(prefix.length).padStart(Math.max(0, width - prefix.length), "0");
                    }
                    else
                        text = text.padStart(width, " ");
                    await output(context, text);
                }
                if (argument === before)
                    break;
            } while (argument < args.length && !stopped);
            return { exitCode };
        }),
    ];
}
//# sourceMappingURL=basic.js.map