export function settings(options) {
    const limits = {
        maxInputBytes: 256 * 1024 * 1024, maxOutputBytes: 256 * 1024 * 1024,
        maxFiles: 4096, maxBufferBytes: 8 * 1024 * 1024, maxChunkBytes: 64 * 1024,
        maxArgumentBytes: 65536, maxSuffixLength: 128, maxSteps: 512 * 1024 * 1024,
        ...options.limits,
    };
    for (const [name, value] of Object.entries(limits)) {
        if (!Number.isSafeInteger(value) || value < 1)
            throw new RangeError(`Invalid split limit: ${name}`);
    }
    return limits;
}
function number(text, label, units = false, zero = false) {
    const match = /^[\t\n\v\f\r ]*\+?([0-9]*)([a-zA-Z]*)$/u.exec(text);
    if (!match || (!match[1] && (!units || !match[2] || text !== match[2])))
        throw new Error(`invalid ${label}: '${text}'`);
    const suffix = match[2];
    let multiplier = 1;
    if (suffix) {
        if (!units)
            throw new Error(`invalid ${label}: '${text}'`);
        if (suffix === "b")
            multiplier = 512;
        else {
            const unit = /^([kKmMGTPEZYRQ])(?:(i?B))?$/u.exec(suffix);
            if (!unit)
                throw new Error(`invalid ${label}: '${text}'`);
            const exponent = "KMGTPEZYRQ".indexOf(unit[1].toUpperCase()) + 1;
            multiplier = (unit[2] === "B" ? 1000 : 1024) ** exponent;
        }
    }
    const value = Number(match[1] || "1") * multiplier;
    if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1))
        throw new Error(`invalid ${label}: '${text}'`);
    return value;
}
export function parseArguments(args, limits) {
    if (args.reduce((total, argument) => total + Buffer.byteLength(argument), 0) > limits.maxArgumentBytes) {
        throw new Error("split argument limit exceeded");
    }
    let mode;
    let size = 1000;
    let suffixLength = 0;
    let numeric = false;
    let numericStart;
    let additionalSuffix = "";
    const operands = [];
    let ended = false;
    const apply = (option, value) => {
        if (option === "d") {
            numeric = true;
            if (value !== undefined) {
                if (!/^[0-9]*$/u.test(value))
                    throw new Error(`invalid start value for numerical suffix: '${value}'`);
                numericStart = value.replace(/^0+(?=\d)/u, "") || "0";
            }
        }
        else if (option === "a")
            suffixLength = number(value, "suffix length", false, true);
        else if (option === "additional-suffix") {
            if (value.includes("/") || value.includes("\0"))
                throw new Error("invalid additional suffix: contains directory separator or NUL");
            additionalSuffix = value;
        }
        else {
            if (mode)
                throw new Error("cannot split in more than one way");
            mode = option === "l" ? "lines" : option === "b" ? "bytes" : "line-bytes";
            size = number(value, option === "l" ? "number of lines" : "number of bytes", option !== "l");
        }
    };
    const long = {
        lines: "l", bytes: "b", "line-bytes": "C", "suffix-length": "a",
        "numeric-suffixes": "d", "additional-suffix": "additional-suffix",
    };
    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        if (ended || argument === "-" || !argument.startsWith("-")) {
            operands.push(argument);
            continue;
        }
        if (argument === "--") {
            ended = true;
            continue;
        }
        if (argument.startsWith("--")) {
            const equals = argument.indexOf("=");
            const name = argument.slice(2, equals < 0 ? undefined : equals);
            const option = long[name];
            if (!option)
                throw new Error(`unrecognized option '${argument}'`);
            const value = equals < 0 ? (option === "d" ? undefined : args[++index]) : argument.slice(equals + 1);
            if (option !== "d" && value === undefined)
                throw new Error(`option '--${name}' requires an argument`);
            apply(option, value);
        }
        else {
            for (let offset = 1; offset < argument.length; offset++) {
                const option = argument[offset];
                if (!"lbaCd".includes(option))
                    throw new Error(`invalid option -- '${option}'`);
                if (option === "d")
                    apply(option);
                else {
                    const value = argument.slice(offset + 1) || args[++index];
                    if (value === undefined)
                        throw new Error(`option requires an argument -- '${option}'`);
                    apply(option, value);
                    break;
                }
            }
        }
    }
    if (operands.length > 2)
        throw new Error(`extra operand '${operands[2]}'`);
    if ((suffixLength || 2) > limits.maxSuffixLength)
        throw new Error("split suffix length limit exceeded");
    if (numericStart !== undefined && numericStart.length > (suffixLength || 2))
        throw new Error("numerical suffix start value is too large for the suffix length");
    if (mode === "line-bytes" && size > limits.maxBufferBytes)
        throw new Error("split line-bytes window exceeds buffer limit");
    return {
        mode: mode ?? "lines", size, input: operands[0] ?? "-", prefix: operands[1] ?? "x",
        alphabet: numeric ? "0123456789" : "abcdefghijklmnopqrstuvwxyz",
        suffixLength: suffixLength || 2, automatic: suffixLength === 0 && numericStart === undefined,
        numericStart: numericStart ?? "0", additionalSuffix,
    };
}
//# sourceMappingURL=options.js.map