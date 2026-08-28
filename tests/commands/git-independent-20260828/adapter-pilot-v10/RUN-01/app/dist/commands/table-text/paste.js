import { diagnostic } from "../internal.js";
import { argument, Budget, command, empty, encode, fail, Inputs, settings } from "./internal.js";
function delimiters(text) {
    const bytes = encode(text), result = [];
    const escapes = { 98: 8, 102: 12, 110: 10, 114: 13, 116: 9, 118: 11 };
    for (let offset = 0; offset < bytes.length; offset++) {
        let byte = bytes[offset];
        if (byte === 92) {
            byte = bytes[++offset];
            if (byte === undefined)
                fail("delimiter list ends in an unescaped backslash");
            if (byte === 48) {
                result.push(empty);
                continue;
            }
            byte = escapes[byte] ?? byte;
        }
        result.push(Uint8Array.of(byte));
    }
    return result.length ? result : [empty];
}
export function createPasteCommand(options = {}) {
    const limits = settings(options);
    return command("paste", async (context) => {
        const budget = new Budget(context, limits), files = [];
        let serial = false, separator = 10, list = [Uint8Array.of(9)], literal = false;
        for (let index = 0; index < context.args.length; index++) {
            const token = context.args[index];
            if (literal || token === "-" || !token.startsWith("-")) {
                files.push(token);
                continue;
            }
            if (token === "--") {
                literal = true;
                continue;
            }
            if (token === "--serial") {
                serial = true;
                continue;
            }
            if (token === "--zero-terminated") {
                separator = 0;
                continue;
            }
            if (token === "--delimiters" || token.startsWith("--delimiters=")) {
                let value;
                [value, index] = argument(context.args, index, token.includes("=") ? token.slice(13) : undefined, token);
                list = delimiters(value);
                continue;
            }
            if (token.startsWith("--"))
                fail(`unsupported option ${token}`);
            for (let offset = 1; offset < token.length; offset++) {
                const flag = token[offset];
                if (flag === "s")
                    serial = true;
                else if (flag === "z")
                    separator = 0;
                else if (flag === "d") {
                    let value;
                    [value, index] = argument(context.args, index, token.slice(offset + 1) || undefined, "-d");
                    list = delimiters(value);
                    break;
                }
                else
                    fail(`unsupported option -${flag}`);
            }
        }
        if (!files.length)
            files.push("-");
        budget.check(files.length, limits.maxFiles, "file");
        const inputs = new Inputs(context, budget, separator), terminator = Uint8Array.of(separator);
        try {
            if (serial) {
                let status = 0;
                for (const file of files) {
                    let reader;
                    try {
                        reader = await inputs.open(file);
                    }
                    catch (error) {
                        context.signal.throwIfAborted();
                        await diagnostic(context, error);
                        status = 1;
                        continue;
                    }
                    let record = await reader.next(), count = 0;
                    while (record !== undefined) {
                        if (count)
                            await budget.output([list[(count - 1) % list.length], record]);
                        else
                            await budget.output([record]);
                        count++;
                        record = await reader.next();
                    }
                    await budget.output([terminator]);
                }
                return { exitCode: status };
            }
            const readers = [];
            for (const file of files)
                readers.push(await inputs.open(file));
            while (true) {
                const row = [];
                let present = false;
                for (let index = 0; index < readers.length; index++) {
                    const record = await readers[index].next();
                    present ||= record !== undefined;
                    if (index)
                        row.push(list[(index - 1) % list.length]);
                    row.push(record ?? empty);
                }
                if (!present)
                    break;
                row.push(terminator);
                await budget.output(row);
            }
            return { exitCode: 0 };
        }
        finally {
            await inputs.close();
        }
    });
}
//# sourceMappingURL=paste.js.map