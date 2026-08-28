import { createOutputOperation, FsError } from "../contracts/index.js";
import { bufferLimit, concatenate, define, diagnostic, encoder, escapeBytes, input, integer, lines, options, output, pathOf, UsageError, value, } from "./internal.js";
async function* combinedInput(context, names, state) {
    for (const name of names.length ? names : ["-"]) {
        try {
            yield* input(context, name);
        }
        catch (error) {
            await diagnostic(context, error);
            state.exitCode = 1;
        }
    }
}
async function prefix(context, source, count, bytes, skip) {
    let remaining = count;
    if (!remaining && !skip)
        return;
    for await (const chunk of source) {
        context.signal.throwIfAborted();
        let offset = 0;
        if (remaining) {
            if (bytes) {
                offset = Math.min(chunk.length, remaining);
                remaining -= offset;
            }
            else {
                for (; offset < chunk.length && remaining; offset++)
                    if (chunk[offset] === 10)
                        remaining--;
            }
        }
        if (skip) {
            if (!remaining && offset < chunk.length)
                await output(context, chunk.subarray(offset));
        }
        else {
            if (offset)
                await output(context, chunk.subarray(0, offset));
            if (!remaining)
                return;
        }
    }
}
async function suffix(context, source, count, bytes, omit) {
    let pending = [];
    let start = 0;
    let size = 0;
    const records = bytes ? source : (async function* () {
        for await (const line of lines(source))
            yield line.terminated ? concatenate([line.bytes, Uint8Array.of(10)]) : line.bytes;
    })();
    for await (const chunk of records) {
        context.signal.throwIfAborted();
        if (bytes && !chunk.length)
            continue;
        pending.push(new Uint8Array(chunk));
        size += chunk.length;
        if (bytes) {
            let excess = Math.max(0, size - count);
            while (excess && start < pending.length) {
                const first = pending[start];
                const consume = Math.min(excess, first.length);
                if (omit)
                    await output(context, first.subarray(0, consume));
                if (consume === first.length)
                    delete pending[start++];
                else {
                    const remaining = first.subarray(consume);
                    pending[start] = remaining.length * 2 <= first.buffer.byteLength ? new Uint8Array(remaining) : remaining;
                }
                size -= consume;
                excess -= consume;
            }
        }
        else
            while (pending.length - start > count) {
                const first = pending[start++];
                size -= first.length;
                if (omit)
                    await output(context, first);
            }
        if (size > bufferLimit)
            throw new FsError("EFBIG", { message: "tail buffer limit exceeded" });
        if (start > 1024) {
            pending = pending.slice(start);
            start = 0;
        }
    }
    if (!omit)
        for (const chunk of pending.slice(start))
            await output(context, chunk);
}
function wcUtf8(consume) {
    let remaining = 0;
    let lead = 0;
    let point = 0;
    let first = false;
    return {
        write(bytes) {
            for (const byte of bytes) {
                if (remaining) {
                    const continuation = byte >= 0x80 && byte <= 0xbf
                        && (!first || (lead !== 0xe0 || byte >= 0xa0) && (lead !== 0xed || byte <= 0x9f)
                            && (lead !== 0xf0 || byte >= 0x90) && (lead !== 0xf4 || byte <= 0x8f));
                    if (continuation) {
                        point = point * 64 + (byte & 0x3f);
                        first = false;
                        if (--remaining === 0)
                            consume(point);
                        continue;
                    }
                    consume(undefined);
                    remaining = 0;
                }
                if (byte < 0x80)
                    consume(byte);
                else if (byte >= 0xc2 && byte <= 0xf4) {
                    lead = byte;
                    remaining = byte < 0xe0 ? 1 : byte < 0xf0 ? 2 : 3;
                    point = byte & (remaining === 1 ? 0x1f : remaining === 2 ? 0x0f : 0x07);
                    first = true;
                }
                else
                    consume(undefined);
            }
        },
        finish() { if (remaining)
            consume(undefined); remaining = 0; },
    };
}
function wcSpace(point, posix) {
    return point === 32 || point >= 9 && point <= 13 || point === 0xa0 || point === 0x1680
        || point >= 0x2000 && point <= 0x200a || point === 0x2028 || point === 0x2029
        || point === 0x202f || point === 0x205f || point === 0x3000 || !posix && point === 0x2060;
}
function headTail(name) {
    return define(name, async (context) => {
        const args = context.args[0] && /^-[0-9]+$/u.test(context.args[0]) ? ["-n", context.args[0].slice(1), ...context.args.slice(1)] : context.args;
        const parsed = options(args, "n:c:qv", { lines: "n", bytes: "c", quiet: "q", silent: "q", verbose: "v" });
        if (parsed.flags.has("n") && parsed.flags.has("c"))
            throw new UsageError("cannot combine line and byte counts");
        const bytes = parsed.flags.has("c");
        const amount = value(parsed, bytes ? "c" : "n") ?? "10";
        const positive = amount.startsWith("+");
        const negative = amount.startsWith("-");
        const count = integer(amount.replace(/^[+-]/u, ""));
        const names = parsed.operands.length ? parsed.operands : ["-"];
        let exitCode = 0;
        let headerWritten = false;
        for (const file of names) {
            try {
                if (file !== "-") {
                    const path = pathOf(context, file);
                    if ((await context.fs.stat(path, { signal: context.signal })).type === "directory")
                        throw new FsError("EISDIR", { path });
                    await context.fs.access(path, 4, { signal: context.signal });
                }
                if (parsed.flags.has("v") || names.length > 1 && !parsed.flags.has("q")) {
                    await output(context, `${headerWritten ? "\n" : ""}==> ${file === "-" ? "standard input" : file} <==\n`);
                    headerWritten = true;
                }
                if (name === "head" && !negative)
                    await prefix(context, input(context, file), count, bytes, false);
                else if (name === "tail" && positive)
                    await prefix(context, input(context, file), Math.max(0, count - 1), bytes, true);
                else
                    await suffix(context, input(context, file), count, bytes, name === "head");
            }
            catch (error) {
                await diagnostic(context, error);
                exitCode = 1;
            }
        }
        return { exitCode };
    });
}
function characterSet(specification) {
    const classes = {
        lower: Array.from({ length: 26 }, (_, offset) => 97 + offset),
        upper: Array.from({ length: 26 }, (_, offset) => 65 + offset),
        digit: Array.from({ length: 10 }, (_, offset) => 48 + offset),
        space: [9, 10, 11, 12, 13, 32], blank: [9, 32],
        cntrl: [...Array.from({ length: 32 }, (_, offset) => offset), 127],
        graph: Array.from({ length: 94 }, (_, offset) => 33 + offset),
        print: Array.from({ length: 95 }, (_, offset) => 32 + offset),
    };
    classes.alpha = [...classes.upper, ...classes.lower];
    classes.alnum = [...classes.digit, ...classes.alpha];
    classes.xdigit = [...classes.digit, ...classes.upper.slice(0, 6), ...classes.lower.slice(0, 6)];
    classes.punct = classes.graph.filter(byte => !classes.alnum.includes(byte));
    const tokens = [];
    for (let offset = 0; offset < specification.length;) {
        const classMatch = /^\[:([a-z]+):\]/u.exec(specification.slice(offset));
        if (classMatch) {
            const bytes = classes[classMatch[1]];
            if (!bytes)
                throw new UsageError(`unknown character class '${classMatch[1]}'`);
            tokens.push({ bytes, literal: false });
            offset += classMatch[0].length;
            continue;
        }
        if (specification.startsWith("[:", offset))
            throw new UsageError("unterminated character class");
        if (specification[offset] === "\\") {
            const escape = /^\\(?:[0-7]{1,3}|x[0-9a-fA-F]{1,2}|.)/su.exec(specification.slice(offset));
            if (!escape)
                throw new UsageError("trailing backslash in character set");
            const decoded = escapeBytes(escape[0]);
            tokens.push({ bytes: [...decoded.bytes], literal: false });
            offset += escape[0].length;
            continue;
        }
        const character = String.fromCodePoint(specification.codePointAt(offset));
        tokens.push({ bytes: [...encoder.encode(character)], literal: character === "-" });
        offset += character.length;
    }
    const result = [];
    for (let index = 0; index < tokens.length; index++) {
        const current = tokens[index];
        if (current.bytes.length === 1 && tokens[index + 1]?.literal && tokens[index + 2]?.bytes.length === 1) {
            const first = current.bytes[0];
            const last = tokens[index + 2].bytes[0];
            if (last < first)
                throw new UsageError("range endpoints are in reverse order");
            for (let byte = first; byte <= last; byte++)
                result.push(byte);
            index += 2;
        }
        else
            result.push(...current.bytes);
    }
    return result;
}
export function streamCommands() {
    return [
        define("cat", async (context) => {
            const parsed = options(context.args, "nbsvETAute", { number: "n", "number-nonblank": "b", "squeeze-blank": "s", "show-ends": "E", "show-tabs": "T", "show-nonprinting": "v", "show-all": "A" });
            if (parsed.flags.has("A"))
                for (const flag of ["v", "E", "T"])
                    parsed.flags.add(flag);
            if (parsed.flags.has("e")) {
                parsed.flags.add("v");
                parsed.flags.add("E");
            }
            if (parsed.flags.has("t")) {
                parsed.flags.add("v");
                parsed.flags.add("T");
            }
            const caller = context;
            const operation = parsed.operands.length && !parsed.operands.includes("-") ? createOutputOperation(context, context.stdout) : undefined;
            if (operation)
                context = { ...context, signal: operation.signal, stdout: operation.output };
            try {
                const state = { exitCode: 0 };
                const source = combinedInput(context, parsed.operands, state);
                operation?.registerCleanup(async () => { await source[Symbol.asyncIterator]().return?.(); });
                if (![...parsed.flags].some(flag => flag !== "u")) {
                    for await (const chunk of source)
                        await output(context, chunk);
                    return state;
                }
                let lineStart = true;
                let blankCount = 0;
                let number = 1;
                for await (const chunk of source) {
                    const transformed = [];
                    const append = (text) => { for (const byte of encoder.encode(text))
                        transformed.push(byte); };
                    for (const byte of chunk) {
                        if (lineStart && byte === 10 && parsed.flags.has("s") && blankCount > 0)
                            continue;
                        if (lineStart && (parsed.flags.has("b") ? byte !== 10 : parsed.flags.has("n")))
                            append(`${String(number++).padStart(6)}\t`);
                        if (byte === 10) {
                            if (parsed.flags.has("E"))
                                transformed.push(36);
                            transformed.push(10);
                            blankCount = lineStart ? blankCount + 1 : 0;
                            lineStart = true;
                        }
                        else {
                            lineStart = false;
                            blankCount = 0;
                            if (byte === 9)
                                parsed.flags.has("T") ? append("^I") : transformed.push(byte);
                            else if (parsed.flags.has("v")) {
                                let visible = byte;
                                if (visible >= 128) {
                                    append("M-");
                                    visible -= 128;
                                }
                                if (visible < 32)
                                    append(`^${String.fromCharCode(visible + 64)}`);
                                else if (visible === 127)
                                    append("^?");
                                else
                                    transformed.push(visible);
                            }
                            else
                                transformed.push(byte);
                        }
                        if (transformed.length >= 8192) {
                            await output(context, Uint8Array.from(transformed));
                            transformed.length = 0;
                        }
                    }
                    if (transformed.length)
                        await output(context, Uint8Array.from(transformed));
                }
                return state;
            }
            catch (error) {
                caller.signal.throwIfAborted();
                if (operation?.signal.aborted && operation.signal.reason instanceof FsError && operation.signal.reason.code === "EPIPE")
                    return { exitCode: 141 };
                throw error;
            }
            finally {
                await operation?.close();
            }
        }),
        headTail("head"), headTail("tail"),
        define("wc", async (context) => {
            const parsed = options(context.args, "lwcm", { lines: "l", words: "w", bytes: "c", chars: "m" });
            if (!parsed.flags.size)
                for (const flag of ["l", "w", "c"])
                    parsed.flags.add(flag);
            const selected = ["l", "w", "m", "c"].filter(flag => parsed.flags.has(flag));
            const names = parsed.operands.length ? parsed.operands : ["-"];
            const totals = { l: 0, w: 0, m: 0, c: 0 };
            const locale = context.env.LC_ALL || context.env.LC_CTYPE || context.env.LANG || "C.UTF-8";
            const singleByte = locale === "C" || locale === "POSIX";
            const posix = Object.hasOwn(context.env, "POSIXLY_CORRECT");
            let width = 1;
            if (names.length > 1 || selected.length > 1) {
                let totalSize = 0n;
                for (const name of names) {
                    if (name === "-") {
                        width = Math.max(width, 7);
                        continue;
                    }
                    try {
                        const stat = await context.fs.stat(pathOf(context, name), { signal: context.signal });
                        if (stat.type !== "file")
                            width = Math.max(width, 7);
                        else if (Number.isSafeInteger(stat.size) && stat.size >= 0)
                            totalSize += BigInt(stat.size);
                    }
                    catch {
                        context.signal.throwIfAborted();
                    }
                }
                width = Math.max(width, totalSize.toString().length);
            }
            let exitCode = 0;
            const print = async (counts, name) => output(context, selected.map(flag => String(counts[flag]).padStart(width)).join(" ") + (name === undefined ? "" : ` ${name}`) + "\n");
            for (const name of names) {
                const counts = { l: 0, w: 0, m: 0, c: 0 };
                let inWord = false;
                const word = (whitespace) => {
                    if (!whitespace && !inWord)
                        counts.w++;
                    inWord = !whitespace;
                };
                const utf8 = wcUtf8(point => {
                    if (point !== undefined)
                        counts.m++;
                    word(point !== undefined && wcSpace(point, posix));
                });
                try {
                    for await (const chunk of input(context, name)) {
                        context.signal.throwIfAborted();
                        counts.c += chunk.length;
                        for (const byte of chunk) {
                            if (byte === 10)
                                counts.l++;
                            if (singleByte)
                                word(byte === 32 || byte >= 9 && byte <= 13 || !posix && byte === 0xa0);
                        }
                        if (singleByte)
                            counts.m += chunk.length;
                        else
                            utf8.write(chunk);
                    }
                    if (!singleByte)
                        utf8.finish();
                    for (const field of Object.keys(totals))
                        totals[field] += counts[field];
                    await print(counts, parsed.operands.length ? name : undefined);
                }
                catch (error) {
                    await diagnostic(context, error);
                    exitCode = 1;
                }
            }
            if (names.length > 1)
                await print(totals, "total");
            return { exitCode };
        }),
        define("tee", async (context) => {
            const parsed = options(context.args, "a", { append: "a" });
            const targets = [];
            let exitCode = 0;
            for (const operand of parsed.operands) {
                try {
                    const path = pathOf(context, operand);
                    await context.fs.writeFile(path, new Uint8Array(), { flag: parsed.flags.has("a") ? "a" : "w", signal: context.signal });
                    targets.push(path);
                }
                catch (error) {
                    await diagnostic(context, error);
                    exitCode = 1;
                }
            }
            for await (const chunk of input(context)) {
                await output(context, chunk);
                for (let index = 0; index < targets.length;) {
                    try {
                        await context.fs.appendFile(targets[index], chunk, { signal: context.signal });
                        index++;
                    }
                    catch (error) {
                        await diagnostic(context, error);
                        targets.splice(index, 1);
                        exitCode = 1;
                    }
                }
            }
            return { exitCode };
        }),
        define("tr", async (context) => {
            const parsed = options(context.args, "dscC", { delete: "d", "squeeze-repeats": "s", complement: "c" });
            const deleting = parsed.flags.has("d");
            const squeezing = parsed.flags.has("s");
            const translating = !deleting && parsed.operands.length === 2;
            if (parsed.operands.length < 1 || parsed.operands.length > 2 || !deleting && !squeezing && parsed.operands.length !== 2
                || deleting && !squeezing && parsed.operands.length !== 1 || deleting && squeezing && parsed.operands.length !== 2)
                throw new UsageError("invalid number of character sets");
            let first = characterSet(parsed.operands[0]);
            if (parsed.flags.has("c") || parsed.flags.has("C")) {
                const selected = new Set(first);
                first = Array.from({ length: 256 }, (_, offset) => offset).filter(byte => !selected.has(byte));
            }
            const second = parsed.operands[1] === undefined ? [] : characterSet(parsed.operands[1]);
            if (translating && !second.length)
                throw new UsageError("second character set must not be empty");
            const mapping = Array.from({ length: 256 }, (_, offset) => offset);
            if (translating)
                first.forEach((byte, index) => { mapping[byte] = second[Math.min(index, second.length - 1)]; });
            const removed = new Set(deleting ? first : []);
            const squeezed = new Set(squeezing ? parsed.operands.length === 2 ? second : first : []);
            let previous = -1;
            for await (const chunk of input(context)) {
                context.signal.throwIfAborted();
                const transformed = new Uint8Array(chunk.length);
                let count = 0;
                for (const byte of chunk) {
                    if (removed.has(byte))
                        continue;
                    const translated = mapping[byte];
                    if (translated === previous && squeezed.has(translated))
                        continue;
                    transformed[count++] = translated;
                    previous = translated;
                }
                if (count)
                    await output(context, transformed.subarray(0, count));
            }
            return { exitCode: 0 };
        }),
    ];
}
//# sourceMappingURL=streams.js.map