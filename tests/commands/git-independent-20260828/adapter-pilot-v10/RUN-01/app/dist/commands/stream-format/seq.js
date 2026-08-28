import { UsageError } from "../internal.js";
import { command } from "./shared.js";
function decimal(text, session) {
    const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/u.exec(text.trim());
    if (!match)
        throw new UsageError(`invalid decimal argument: '${text}'`);
    const fraction = match[3] ?? match[4] ?? "";
    const digits = (match[2] ?? "0") + fraction;
    const exponent = Number(match[5] ?? 0);
    session.check(digits.length, session.limits.maxNumericDigits, "numeric digit");
    session.check(Math.abs(exponent), session.limits.maxNumericDigits, "numeric exponent");
    const scale = fraction.length - exponent;
    session.check(Math.max(digits.length, digits.length - scale, scale), session.limits.maxNumericDigits, "numeric digit");
    const coefficient = BigInt((match[1] === "-" ? "-" : "") + digits);
    return { coefficient, scale, precision: Math.max(0, scale), negativeZero: coefficient === 0n && match[1] === "-" };
}
function rounded(coefficient, scale, precision) {
    if (precision >= scale)
        return coefficient * 10n ** BigInt(precision - scale);
    const divisor = 10n ** BigInt(scale - precision);
    const quotient = coefficient / divisor;
    const remainder = coefficient % divisor;
    const twice = (remainder < 0n ? -remainder : remainder) * 2n;
    return quotient + (twice > divisor || twice === divisor && quotient % 2n !== 0n ? coefficient < 0n ? -1n : 1n : 0n);
}
function fixed(coefficient, scale, precision) {
    const value = rounded(coefficient, scale, precision);
    const negative = coefficient < 0n;
    const digits = (value < 0n ? -value : value).toString().padStart(precision + 1, "0");
    return (negative ? "-" : "") + (precision ? `${digits.slice(0, -precision)}.${digits.slice(-precision)}` : digits);
}
function exponentOf(coefficient, scale) {
    return coefficient === 0n ? 0 : (coefficient < 0n ? -coefficient : coefficient).toString().length - scale - 1;
}
function formatted(coefficient, scale, format, negativeZero = false) {
    const kind = format.kind.toLowerCase();
    let precision = format.precision;
    let exponent = exponentOf(coefficient, scale);
    let text;
    if (kind === "f")
        text = fixed(coefficient, scale, precision);
    else {
        if (kind === "g")
            precision = Math.max(1, precision);
        const significant = kind === "g" ? precision : precision + 1;
        const significantScale = significant - exponent - 1;
        const value = rounded(coefficient, scale, significantScale);
        exponent = exponentOf(value, significantScale);
        if (kind === "e" || exponent < -4 || exponent >= precision) {
            text = fixed(value, significantScale + exponent, significant - 1);
            if (kind === "g" && !format.flags.includes("#") && text.includes("."))
                text = text.replace(/\.?0+$/u, "");
            if (format.flags.includes("#") && !text.includes("."))
                text += ".";
            text += `e${exponent < 0 ? "-" : "+"}${Math.abs(exponent).toString().padStart(2, "0")}`;
        }
        else {
            text = fixed(value, significantScale, Math.max(0, precision - exponent - 1));
            if (!format.flags.includes("#") && text.includes("."))
                text = text.replace(/\.?0+$/u, "");
        }
    }
    if (format.flags.includes("#") && !text.includes(".") && !text.includes("e"))
        text += ".";
    if ((coefficient < 0n || negativeZero) && !text.startsWith("-"))
        text = "-" + text;
    if (coefficient >= 0n && !negativeZero)
        text = (format.flags.includes("+") ? "+" : format.flags.includes(" ") ? " " : "") + text;
    if (format.kind === format.kind.toUpperCase())
        text = text.toUpperCase();
    if (format.flags.includes("-"))
        text = text.padEnd(format.width, " ");
    else if (format.flags.includes("0")) {
        const sign = /^[+ -]/u.test(text) ? text[0] : "";
        text = sign + text.slice(sign.length).padStart(Math.max(0, format.width - sign.length), "0");
    }
    else
        text = text.padStart(format.width, " ");
    return format.prefix + text + format.suffix;
}
function binaryDecimal(value) {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value);
    const bits = view.getBigUint64(0);
    const exponent = Number(bits >> 52n & 2047n);
    let coefficient = bits & ((1n << 52n) - 1n);
    if (exponent)
        coefficient += 1n << 52n;
    const power = exponent ? exponent - 1075 : -1074;
    if (bits >> 63n)
        coefficient = -coefficient;
    return power >= 0 ? { coefficient: coefficient << BigInt(power), scale: 0 }
        : { coefficient: coefficient * 5n ** BigInt(-power), scale: -power };
}
async function floatingSequence(first, increment, last, format, separator, session) {
    if (![first, increment, last].every(Number.isFinite) || increment === 0)
        throw new UsageError("formatted operands must fit finite binary64 with a nonzero increment");
    if (increment > 0 ? first > last : first < last)
        return;
    const render = (number) => {
        const decimal = binaryDecimal(number);
        const text = formatted(decimal.coefficient, decimal.scale, format, Object.is(number, -0));
        session.check(Buffer.byteLength(text), session.limits.maxRecordBytes, "record");
        return text;
    };
    const firstDecimal = binaryDecimal(first), incrementDecimal = binaryDecimal(increment);
    const scale = Math.max(firstDecimal.scale, incrementDecimal.scale);
    const firstCoefficient = firstDecimal.coefficient * 10n ** BigInt(scale - firstDecimal.scale);
    const incrementCoefficient = incrementDecimal.coefficient * 10n ** BigInt(scale - incrementDecimal.scale);
    let previous = "";
    for (let index = 0;; index++) {
        await session.step();
        const current = index ? Number(fixed(firstCoefficient + BigInt(index) * incrementCoefficient, scale, scale)) : first;
        if (!Number.isFinite(current))
            break;
        const outside = increment > 0 ? current > last : current < last;
        const text = render(current);
        if (outside) {
            const numeric = text.slice(format.prefix.length, text.length - format.suffix.length);
            if (Number(numeric) !== last || text === previous)
                break;
        }
        await session.text((index ? separator : "") + text);
        previous = text;
        if (outside)
            break;
    }
    await session.text("\n");
}
function parseFormat(text, session) {
    let literal = "", result;
    for (let offset = 0; offset < text.length; offset++) {
        if (text[offset] !== "%") {
            literal += text[offset];
            continue;
        }
        if (text[offset + 1] === "%") {
            literal += "%";
            offset++;
            continue;
        }
        if (result)
            throw new UsageError(`format '${text}' has too many % directives`);
        const match = /^%([-+ #0]*)(\d*)(?:\.(\d*))?L?([fFeEgG])/u.exec(text.slice(offset));
        if (!match)
            throw new UsageError("format requires one f, e or g conversion");
        const width = Number(match[2] || 0), precision = match[3] === undefined ? 6 : Number(match[3]);
        session.check(width, session.limits.maxRecordBytes, "format width");
        session.check(precision, session.limits.maxNumericDigits, "format precision");
        result = { prefix: literal, suffix: "", flags: match[1], width, precision, kind: match[4] };
        literal = "";
        offset += match[0].length - 1;
    }
    if (!result)
        throw new UsageError("format must contain exactly one conversion");
    return { ...result, suffix: literal };
}
export function createSeqCommand(limits) {
    return command("seq", limits, async (session) => {
        const operands = [];
        let separator = "\n", equalWidth = false, formatText, ended = false;
        const args = session.context.args;
        for (let index = 0; index < args.length; index++) {
            const argument = args[index];
            if (ended || !argument.startsWith("-") || /^-[\d.]/u.test(argument)) {
                operands.push(argument);
                continue;
            }
            if (argument === "--") {
                ended = true;
                continue;
            }
            if (argument.startsWith("--")) {
                const equals = argument.indexOf("=");
                const key = argument.slice(2, equals < 0 ? undefined : equals);
                if (key === "equal-width" && equals < 0)
                    equalWidth = true;
                else if (key === "separator" || key === "format") {
                    const value = equals < 0 ? args[++index] : argument.slice(equals + 1);
                    if (value === undefined)
                        throw new UsageError(`option '--${key}' requires an argument`);
                    if (key === "separator")
                        separator = value;
                    else
                        formatText = value;
                }
                else
                    throw new UsageError(`unrecognized option '${argument}'`);
            }
            else {
                for (let offset = 1; offset < argument.length; offset++) {
                    const key = argument[offset];
                    if (key === "w")
                        equalWidth = true;
                    else if (key === "s" || key === "f") {
                        const value = argument.slice(offset + 1) || args[++index];
                        if (value === undefined)
                            throw new UsageError(`option '-${key}' requires an argument`);
                        if (key === "s")
                            separator = value;
                        else
                            formatText = value;
                        break;
                    }
                    else
                        throw new UsageError(`invalid option -- '${key}'`);
                }
            }
        }
        if (!operands.length || operands.length > 3)
            throw new UsageError("expected one to three numeric operands");
        if (equalWidth && formatText !== undefined)
            throw new UsageError("format string may not be specified when printing equal width strings");
        const first = decimal(operands.length === 1 ? "1" : operands[0], session);
        const increment = decimal(operands.length === 3 ? operands[1] : "1", session);
        const last = decimal(operands.at(-1), session);
        if (increment.coefficient === 0n)
            throw new UsageError("invalid Zero increment value");
        const scale = Math.max(0, first.scale, increment.scale, last.scale);
        const align = (value) => {
            session.check(value.coefficient.toString().length + scale - value.scale, limits.maxNumericDigits + 1, "numeric digit");
            return value.coefficient * 10n ** BigInt(scale - value.scale);
        };
        let current = align(first);
        const step = align(increment), finish = align(last);
        const precision = Math.max(first.precision, increment.precision);
        const format = formatText === undefined ? undefined : parseFormat(formatText, session);
        if (format) {
            await floatingSequence(Number(operands.length === 1 ? "1" : operands[0]), Number(operands.length === 3 ? operands[1] : "1"), Number(operands.at(-1)), format, separator, session);
            return;
        }
        const firstText = (first.negativeZero ? "-" : "") + fixed(current, scale, precision);
        const width = equalWidth ? Math.max(firstText.length, fixed(finish, scale, precision).length) : 0;
        let written = false;
        while (step > 0n ? current <= finish : current >= finish) {
            await session.step();
            let text = (!written && first.negativeZero ? "-" : "") + fixed(current, scale, precision);
            if (equalWidth)
                text = text.startsWith("-") ? "-" + text.slice(1).padStart(width - 1, "0") : text.padStart(width, "0");
            session.check(Buffer.byteLength(text), limits.maxRecordBytes, "record");
            await session.text((written ? separator : "") + text);
            written = true;
            current += step;
        }
        if (written)
            await session.text("\n");
    });
}
//# sourceMappingURL=seq.js.map