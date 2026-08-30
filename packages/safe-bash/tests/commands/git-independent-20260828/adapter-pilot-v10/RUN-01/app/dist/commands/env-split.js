import { UsageError } from "./internal.js";
export class EnvSplitError extends Error {
}
class SplitWork {
    signal;
    bytes = 0;
    arguments = 0;
    expansions = 0;
    work = 0;
    nextYield = 4096;
    constructor(signal) {
        this.signal = signal;
    }
    account(text) {
        this.signal.throwIfAborted();
        if (text.length > 131072 - this.bytes)
            throw new EnvSplitError("split-string byte limit exceeded (131072)");
        this.bytes += Buffer.byteLength(text);
        if (this.bytes > 131072)
            throw new EnvSplitError("split-string byte limit exceeded (131072)");
        if (text.includes("\0"))
            throw new EnvSplitError("NUL is not supported in -S strings");
    }
    argument() {
        if (++this.arguments > 10000)
            throw new EnvSplitError("split-string argument limit exceeded (10000)");
    }
    expansion() {
        this.signal.throwIfAborted();
        if (++this.expansions > 32)
            throw new EnvSplitError("split-string expansion limit exceeded (32)");
        if (this.work > 1048576)
            throw new EnvSplitError("split-string work limit exceeded (1048576)");
    }
    tick(amount = 1) {
        this.signal.throwIfAborted();
        this.work += amount;
        if (this.expansions && this.work > 1048576)
            throw new EnvSplitError("split-string work limit exceeded (1048576)");
        return this.work >= this.nextYield;
    }
    async pause() {
        await new Promise(resolve => setImmediate(resolve));
        this.signal.throwIfAborted();
        this.nextYield = this.work + 4096;
    }
}
async function splitString(source, environment, work) {
    work.expansion();
    work.account(source);
    const result = [];
    let parts = [];
    let active = false;
    let quote = "";
    const start = () => {
        if (!active) {
            work.argument();
            active = true;
        }
    };
    const append = (text) => {
        work.account(text);
        start();
        parts.push(text);
    };
    const finish = () => {
        if (active)
            result.push(parts.join(""));
        parts = [];
        active = false;
    };
    for (let index = 0; index < source.length;) {
        if (work.tick())
            await work.pause();
        const character = String.fromCodePoint(source.codePointAt(index));
        if ((character === "'" || character === '"') && (!quote || character === quote)) {
            start();
            quote = quote ? "" : character;
            index++;
            continue;
        }
        if (!quote && /[ \t\n\r\v\f]/u.test(character)) {
            finish();
            index++;
            continue;
        }
        if (character === "#" && !active)
            break;
        if (character === "\\" && (quote !== "'" || source[index + 1] === "\\" || source[index + 1] === "'")) {
            const escaped = source[index + 1];
            if (escaped === undefined)
                throw new EnvSplitError("invalid backslash at end of string in -S");
            index += 2;
            if (escaped === "c") {
                if (quote === '"')
                    throw new EnvSplitError("'\\c' must not appear in double-quoted -S string");
                break;
            }
            if (escaped === "_") {
                if (quote === '"')
                    append(" ");
                else
                    finish();
                continue;
            }
            const controls = { f: "\f", n: "\n", r: "\r", t: "\t", v: "\v" };
            if (Object.hasOwn(controls, escaped))
                append(controls[escaped]);
            else if ('"#$\'\\'.includes(escaped))
                append(escaped);
            else
                throw new EnvSplitError(`invalid sequence '\\${escaped}' in -S`);
            continue;
        }
        if (character === "$" && quote !== "'") {
            let end = index + 2;
            if (source[index + 1] !== "{" || !/^[A-Za-z_]$/u.test(source[end] ?? "")) {
                throw new EnvSplitError(`only \${VARNAME} expansion is supported, error at: ${source.slice(index)}`);
            }
            while (/^[A-Za-z_0-9]$/u.test(source[end] ?? "")) {
                if (work.tick())
                    await work.pause();
                end++;
            }
            if (source[end] !== "}")
                throw new EnvSplitError(`only \${VARNAME} expansion is supported, error at: ${source.slice(index)}`);
            const name = source.slice(index + 2, end);
            if (Object.hasOwn(environment, name)) {
                const text = environment[name];
                append(text);
                if (work.tick(text.length))
                    await work.pause();
            }
            index = end + 1;
            continue;
        }
        append(character);
        index += character.length;
    }
    if (quote)
        throw new EnvSplitError("no terminating quote in -S string");
    finish();
    return result;
}
export async function parseEnvOptions(args, environment, signal) {
    const work = new SplitWork(signal);
    const frames = [{ args, offset: 0 }];
    const next = () => {
        while (frames.length) {
            const frame = frames.at(-1);
            if (frame.offset < frame.args.length)
                return frame.args[frame.offset++];
            frames.pop();
        }
        return undefined;
    };
    const flags = new Set();
    const values = new Map();
    const operands = [];
    const longOptions = new Map([
        ["ignore-environment", "i"], ["unset", "u"], ["null", "0"], ["chdir", "C"], ["split-string", "S"],
    ]);
    const accept = async (key, content) => {
        if (key === "S") {
            const expanded = await splitString(content, environment, work);
            frames.push({ args: expanded, offset: 0 });
        }
        else {
            flags.add(key);
            if (content !== undefined) {
                const entries = values.get(key) ?? [];
                entries.push(content);
                values.set(key, entries);
            }
        }
    };
    for (;;) {
        const argument = next();
        if (argument === undefined)
            break;
        if (work.tick(argument.length + 1))
            await work.pause();
        if (argument === "--")
            break;
        if (argument === "-" || !argument.startsWith("-")) {
            operands.push(argument);
            break;
        }
        if (argument.startsWith("--")) {
            const equals = argument.indexOf("=");
            const name = argument.slice(2, equals < 0 ? undefined : equals);
            const key = longOptions.get(name);
            if (!key)
                throw new UsageError(`unrecognized option '${argument}'`);
            const required = key === "u" || key === "C" || key === "S";
            if (!required && equals >= 0)
                throw new UsageError(`option '--${name}' does not take an argument`);
            const content = required ? equals < 0 ? next() : argument.slice(equals + 1) : undefined;
            if (required && content === undefined)
                throw new UsageError(`option '--${name}' requires an argument`);
            await accept(key, content);
            continue;
        }
        for (let index = 1; index < argument.length; index++) {
            if (work.tick())
                await work.pause();
            const key = argument[index];
            if (key !== "i" && key !== "u" && key !== "0" && key !== "C" && key !== "S")
                throw new UsageError(`invalid option -- '${key}'`);
            const required = key === "u" || key === "C" || key === "S";
            const content = required ? argument.slice(index + 1) || next() : undefined;
            if (required && content === undefined)
                throw new UsageError(`option requires an argument -- '${key}'`);
            await accept(key, content);
            if (required)
                break;
        }
    }
    for (;;) {
        const argument = next();
        if (argument === undefined)
            break;
        if (work.tick())
            await work.pause();
        operands.push(argument);
    }
    if (operands[0] === "-") {
        flags.add("i");
        operands.shift();
    }
    signal.throwIfAborted();
    return { flags, values, operands };
}
//# sourceMappingURL=env-split.js.map