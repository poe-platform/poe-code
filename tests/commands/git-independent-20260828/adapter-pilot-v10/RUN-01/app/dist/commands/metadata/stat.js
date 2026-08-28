import { FsError } from "../../contracts/index.js";
import { codeOf, diagnostic, pathOf, requireOperands, UsageError } from "../internal.js";
import { MetadataBudget, metadataCommand, permissionString, settings } from "./internal.js";
function parse(args) {
    let follow = false;
    let format;
    let printf = false;
    let literal = false;
    const paths = [];
    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        if (literal || argument === "-" || !argument.startsWith("-"))
            paths.push(argument);
        else if (argument === "--")
            literal = true;
        else if (argument === "--dereference")
            follow = true;
        else if (argument === "--format" || argument.startsWith("--format=") || argument === "--printf" || argument.startsWith("--printf=")) {
            printf = argument.startsWith("--printf");
            format = argument.includes("=") ? argument.slice(argument.indexOf("=") + 1) : args[++index];
            if (format === undefined)
                throw new UsageError(`missing format for '${argument}'`);
        }
        else if (!argument.startsWith("--")) {
            for (let offset = 1; offset < argument.length; offset++) {
                if (argument[offset] === "L")
                    follow = true;
                else if (argument[offset] === "c") {
                    format = argument.slice(offset + 1) || args[++index];
                    if (format === undefined)
                        throw new UsageError("missing format for '-c'");
                    printf = false;
                    break;
                }
                else
                    throw new UsageError(`unrecognized option '${argument}'`);
            }
        }
        else
            throw new UsageError(`unrecognized option '${argument}'`);
    }
    requireOperands(paths);
    return { follow, format, printf, paths };
}
function quoted(text, style) {
    if (style === "literal")
        return text;
    if (style && !["shell-escape-always", "shell-always"].includes(style))
        throw new FsError("ENOTSUP", { message: `unsupported QUOTING_STYLE: ${style}` });
    if (style !== "shell-always" && /[\x00-\x1f\x7f]/u.test(text)) {
        return "$'" + text.replace(/[\\'\x00-\x1f\x7f]/gu, character => {
            if (character === "\\" || character === "'")
                return `\\${character}`;
            if (character === "\n")
                return "\\n";
            if (character === "\r")
                return "\\r";
            if (character === "\t")
                return "\\t";
            return `\\${character.charCodeAt(0).toString(8).padStart(3, "0")}`;
        }) + "'";
    }
    return `'${text.replace(/'/gu, "'\\''")}'`;
}
function available(value, field) {
    if (value === undefined)
        throw new FsError("ENOTSUP", { syscall: "stat", message: `filesystem does not expose ${field}` });
    if (!Number.isFinite(value))
        throw new FsError("EIO", { syscall: "stat", message: `invalid ${field}` });
    return value;
}
function timestamp(milliseconds) {
    const value = available(milliseconds, "timestamp");
    if (Math.abs(value) > 8_640_000_000_000_000)
        throw new FsError("EIO", { message: "invalid filesystem timestamp" });
    const [coefficient = "0", exponent = "0"] = Math.abs(value).toString().split("e");
    const [integer = "0", fraction = ""] = coefficient.split(".");
    const digits = BigInt(integer + fraction);
    const power = Number(exponent) - fraction.length + 6;
    const divisor = power < 0 ? 10n ** BigInt(-power) : 1n;
    const magnitude = power < 0 ? (digits + divisor / 2n) / divisor : digits * 10n ** BigInt(power);
    const nanoseconds = value < 0 ? -magnitude : magnitude;
    const remainder = ((nanoseconds % 1000000000n) + 1000000000n) % 1000000000n;
    const seconds = (nanoseconds - remainder) / 1000000000n;
    const date = new Date(Number(seconds * 1000n));
    if (Number.isNaN(date.getTime()))
        throw new FsError("EIO", { message: "invalid filesystem timestamp" });
    return `${date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/u, `.${remainder.toString().padStart(9, "0")}`)} +0000`;
}
function epoch(milliseconds, precision) {
    if (precision > 3)
        throw new FsError("ENOTSUP", { message: "stat timestamps support at most millisecond precision" });
    const value = available(milliseconds, "timestamp");
    const scale = 10 ** precision;
    const absolute = Math.floor(Math.abs(value) / (1000 / scale));
    const fraction = absolute % scale;
    const seconds = value < 0 && fraction === 0 ? -Math.floor(value / 1000) : Math.floor(absolute / scale);
    return `${value < 0 ? "-" : ""}${seconds}${precision ? "." + fraction.toString().padStart(precision, "0") : ""}`;
}
function formatField(text, code, flags, width, precision, numeric, epoch) {
    if (numeric) {
        const nonzero = !/^0+$/u.test(text);
        if (!epoch && precision !== undefined)
            text = precision === 0 && !nonzero ? "" : text.padStart(precision, "0");
        if (flags.includes("#"))
            text = code === "a" ? (text.startsWith("0") ? text : `0${text}`) : (code === "f" || code === "D") && nonzero ? `0x${text}` : text;
        if (epoch && !text.startsWith("-") && (flags.includes("+") || flags.includes(" ")))
            text = `${flags.includes("+") ? "+" : " "}${text}`;
    }
    if (epoch && precision) {
        const decimal = text.indexOf(".");
        const integerWidth = width > precision + 2 && !flags.includes("-") ? width - precision - 1 : 0;
        const integer = formatField(text.slice(0, decimal), code, flags, integerWidth, undefined, true, false);
        const trailingWidth = integer.length < width && 1 < width - integer.length
            ? Math.abs(width - integer.length - 1 - precision) : 0;
        return Buffer.concat([integer, Buffer.from(text.slice(decimal)), Buffer.alloc(trailingWidth, 32)]);
    }
    const encoded = Buffer.from(text);
    const bytes = !numeric && precision !== undefined ? encoded.subarray(0, precision) : encoded;
    const padding = Math.max(0, width - bytes.length);
    if (flags.includes("-"))
        return Buffer.concat([bytes, Buffer.alloc(padding, 32)]);
    if (numeric && flags.includes("0") && (epoch || precision === undefined) && padding) {
        const prefix = /^[+ -]|^0x/u.exec(text)?.[0] ?? "";
        return Buffer.from(prefix + "0".repeat(padding) + text.slice(prefix.length));
    }
    return Buffer.concat([Buffer.alloc(padding, 32), bytes]);
}
async function render(context, path, name, stat, format, escapes, limit) {
    const chunks = [];
    let bytes = 0;
    const append = (text) => {
        const chunk = typeof text === "string" ? new TextEncoder().encode(text) : text;
        bytes += chunk.byteLength;
        if (bytes > limit)
            throw new FsError("EFBIG", { message: "stat format output limit exceeded" });
        chunks.push(chunk);
    };
    for (let index = 0; index < format.length;) {
        context.signal.throwIfAborted();
        if (escapes && format[index] === "\\") {
            const escape = /^\\(?:([abefnrtv\\])|x([0-9a-fA-F]{1,2})|([0-7]{1,3}))/u.exec(format.slice(index));
            if (!escape) {
                append(format[index++]);
                continue;
            }
            const named = { a: "\x07", b: "\b", e: "\x1b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\" };
            append(escape[1] ? named[escape[1]] : Uint8Array.of(Number.parseInt(escape[2] ?? escape[3], escape[2] ? 16 : 8)));
            index += escape[0].length;
            continue;
        }
        if (format[index] !== "%") {
            const point = String.fromCodePoint(format.codePointAt(index));
            append(point);
            index += point.length;
            continue;
        }
        const match = /^%([-+ #0]*)(\d*)(?:\.(\d*))?([a-zA-Z%])/u.exec(format.slice(index));
        if (!match)
            throw new UsageError("invalid stat format directive");
        index += match[0].length;
        const flags = match[1];
        const width = Number(match[2] || 0);
        if (!Number.isSafeInteger(width) || width > limit)
            throw new FsError("EFBIG", { message: "stat format width limit exceeded" });
        const code = match[4];
        const epochCode = ["X", "Y", "Z", "W"].includes(code);
        const precision = match[3] === undefined ? undefined : Number(match[3] || (epochCode ? 9 : 0));
        if (precision !== undefined && (!Number.isSafeInteger(precision) || precision > limit))
            throw new FsError("EFBIG", { message: "stat format precision limit exceeded" });
        if (code === "%" && match[0] !== "%%")
            throw new UsageError("invalid stat format directive");
        let text;
        let linkText;
        let numeric = false;
        if (["a", "A", "f"].includes(code))
            available(stat.mode, "mode");
        const times = { X: stat.atimeMs, Y: stat.mtimeMs, Z: stat.ctimeMs, W: stat.birthtimeMs };
        if (Object.hasOwn(times, code)) {
            text = epoch(available(times[code], code), precision ?? 0);
            numeric = true;
        }
        else if (code === "n")
            text = name;
        else if (code === "N") {
            text = quoted(name, context.env.QUOTING_STYLE);
            if (stat.type === "symlink") {
                if (!context.fs.readlink)
                    throw new FsError("ENOTSUP", { syscall: "readlink", path });
                linkText = quoted(await context.fs.readlink(path, { signal: context.signal }), context.env.QUOTING_STYLE);
            }
        }
        else if (code === "%")
            text = "%";
        else if (code === "A")
            text = permissionString(stat.mode, stat.type);
        else if (code === "F")
            text = stat.type === "directory" ? "directory" : stat.type === "symlink" ? "symbolic link" : stat.size === 0 ? "regular empty file" : "regular file";
        else if (["x", "y", "z", "w"].includes(code)) {
            const value = times[code.toUpperCase()];
            text = code === "w" && value === undefined ? "-" : timestamp(available(value, code));
        }
        else {
            const fields = { s: stat.size, a: stat.mode & 0o7777, f: stat.mode, i: stat.ino, h: stat.nlink, u: stat.uid, g: stat.gid, d: stat.dev, D: stat.dev };
            if (!Object.hasOwn(fields, code))
                throw new FsError("ENOTSUP", { message: `unsupported stat format: %${code}` });
            const value = available(fields[code], code);
            text = value.toString(code === "a" ? 8 : code === "f" || code === "D" ? 16 : 10);
            numeric = true;
        }
        append(formatField(text, code, flags, width, precision, numeric, epochCode));
        if (linkText !== undefined) {
            append(" -> ");
            append(formatField(linkText, code, flags, width, precision, false, false));
        }
    }
    return Buffer.concat(chunks);
}
export function createStatCommand(configuration = {}) {
    const configured = settings(configuration);
    return metadataCommand("stat", async (context) => {
        const budget = new MetadataBudget(context, configured.limits);
        const parsed = parse(context.args);
        let exitCode = 0;
        for (const name of parsed.paths) {
            await budget.step();
            try {
                const path = pathOf(context, name);
                const stat = await context.fs[parsed.follow ? "stat" : "lstat"](path, { signal: context.signal });
                const format = parsed.format ?? "  File: %N\n  Size: %s\tType: %F\n  Mode: %a (%A)\nAccess: %x\nModify: %y\nChange: %z\n Birth: %w";
                const text = await render(context, path, name, stat, format, parsed.printf, configured.limits.maxOutputBytes);
                await budget.output(parsed.printf ? text : Buffer.concat([text, Uint8Array.of(10)]));
            }
            catch (error) {
                context.signal.throwIfAborted();
                if (codeOf(error) === "EFBIG")
                    throw error;
                await diagnostic(context, error);
                exitCode = 1;
            }
        }
        return { exitCode };
    });
}
//# sourceMappingURL=stat.js.map