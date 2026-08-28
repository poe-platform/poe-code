import { setImmediate } from "node:timers/promises";
import { FsError, readBytes } from "../../../contracts/index.js";
import { pathOf, UsageError } from "../../internal.js";
export const blockSize = 8192;
export function validatedOption(parsed, key, parse, fallback) {
    let result = fallback;
    for (const text of parsed.values.get(key) ?? [])
        result = parse(text);
    return result;
}
export async function* sources(context, operands) {
    let usedStdin = false;
    let emptyChunks = 0;
    for (const operand of operands.length ? operands : ["-"]) {
        context.signal.throwIfAborted();
        let source;
        if (operand === "-") {
            if (usedStdin)
                continue;
            usedStdin = true;
            source = context.stdin;
        }
        else {
            const path = pathOf(context, operand);
            if (!context.fs.readStream)
                throw new FsError("ENOTSUP", { path, syscall: "readStream", message: "encoding commands require a streaming-read filesystem" });
            source = context.fs.readStream(path, { signal: context.signal, chunkSize: blockSize });
        }
        for await (const chunk of readBytes(source, context.signal)) {
            if (chunk.length === 0 && ++emptyChunks % 64 === 0) {
                await setImmediate();
                context.signal.throwIfAborted();
            }
            for (let offset = 0; offset < chunk.length; offset += blockSize) {
                await setImmediate();
                context.signal.throwIfAborted();
                yield chunk.subarray(offset, offset + blockSize);
            }
        }
    }
}
export async function* range(source, skip, count) {
    if (!skip && !count)
        return;
    for await (const chunk of source) {
        const skipped = Math.min(skip, chunk.length);
        skip -= skipped;
        const length = Math.min(count, chunk.length - skipped);
        if (length) {
            yield chunk.subarray(skipped, skipped + length);
            count -= length;
        }
        if (!skip && !count)
            return;
    }
    if (skip)
        throw new Error("cannot skip past end of input");
}
export async function* rows(source, width) {
    const row = new Uint8Array(width);
    let used = 0;
    for await (const chunk of source) {
        for (let offset = 0; offset < chunk.length;) {
            const length = Math.min(width - used, chunk.length - offset);
            row.set(chunk.subarray(offset, offset + length), used);
            offset += length;
            used += length;
            if (used === width) {
                yield row.slice();
                used = 0;
            }
        }
    }
    if (used)
        yield row.slice(0, used);
}
export function numeric(text, suffixes = false) {
    let numberText = text;
    let multiplier = 1;
    if (suffixes && !/^0[xX][0-9a-fA-F]+$/u.test(text)) {
        const match = /^(.*?)(KiB|MiB|GiB|KB|MB|GB|[bkmKMG])$/u.exec(text);
        if (match) {
            numberText = match[1] || "1";
            multiplier = { b: 512, k: 1024, K: 1024, KiB: 1024, m: 1048576, M: 1048576, MiB: 1048576, G: 1073741824, GiB: 1073741824, KB: 1000, MB: 1000000, GB: 1000000000 }[match[2]];
        }
    }
    let parsed;
    if (/^0[xX][0-9a-fA-F]+$/u.test(numberText))
        parsed = Number.parseInt(numberText.slice(2), 16);
    else if (/^0[0-7]*$/u.test(numberText))
        parsed = Number.parseInt(numberText, 8);
    else if (/^[1-9][0-9]*$/u.test(numberText))
        parsed = Number(numberText);
    else
        throw new UsageError(`invalid number '${text}'`);
    parsed *= multiplier;
    if (!Number.isSafeInteger(parsed))
        throw new UsageError(`number out of range '${text}'`);
    return parsed;
}
export function addOffset(offset, length) {
    const result = offset + length;
    if (!Number.isSafeInteger(result))
        throw new Error("input address exceeds safe integer range");
    return result;
}
//# sourceMappingURL=shared.js.map