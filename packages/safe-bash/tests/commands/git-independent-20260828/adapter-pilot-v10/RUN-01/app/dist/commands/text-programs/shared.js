import { setImmediate } from "node:timers/promises";
import { FsError, readBytes, writeBytes } from "../../contracts/index.js";
export class ProgramError extends Error {
}
export class Budget {
    context;
    maxBufferBytes;
    remaining;
    checkpoints = 0;
    constructor(context, options) {
        this.context = context;
        this.remaining = options.maxSteps ?? 5_000_000;
        this.maxBufferBytes = options.maxBufferBytes ?? 32 * 1024 * 1024;
        for (const value of [this.remaining, this.maxBufferBytes]) {
            if (!Number.isSafeInteger(value) || value < 1)
                throw new ProgramError("limits must be positive safe integers");
        }
    }
    step(count = 1) {
        this.context.signal.throwIfAborted();
        this.remaining -= count;
        if (this.remaining < 0)
            throw new ProgramError("execution step limit exceeded");
    }
    check(text) {
        if (text.length > this.maxBufferBytes)
            throw new ProgramError("text buffer limit exceeded");
        return text;
    }
    async checkpoint() {
        if (++this.checkpoints % 256 === 0)
            await setImmediate(undefined, { signal: this.context.signal });
        this.context.signal.throwIfAborted();
    }
}
export function byteString(text) { return Buffer.from(text, "utf8").toString("latin1"); }
export function bytes(text) { return Buffer.from(text, "latin1"); }
export function virtualPath(context, path) {
    if (!path)
        throw new FsError("ENOENT", { path });
    if (path.includes("\0"))
        throw new FsError("EINVAL", { path });
    return path.startsWith("/") ? path : `${context.cwd.replace(/\/$/u, "")}/${path}`;
}
export async function write(context, text) {
    context.signal.throwIfAborted();
    await writeBytes(context.stdout, bytes(text), context.signal);
}
export async function* input(context, file = "-") {
    context.signal.throwIfAborted();
    if (file === "-")
        yield* readBytes(context.stdin, context.signal);
    else {
        const path = virtualPath(context, file);
        if (context.fs.readStream)
            yield* readBytes(context.fs.readStream(path, { signal: context.signal }), context.signal);
        else
            yield await context.fs.readFile(path, { signal: context.signal, maxBytes: 32 * 1024 * 1024 });
    }
}
export async function readProgram(context, file) {
    const contents = await context.fs.readFile(virtualPath(context, file), { signal: context.signal, maxBytes: 1024 * 1024 });
    return Buffer.from(contents).toString("latin1");
}
export async function* lineRecords(context, files, budget) {
    const names = files.length ? files : ["-"];
    for (let fileIndex = 0; fileIndex < names.length; fileIndex++) {
        const file = names[fileIndex];
        let pending = "";
        for await (const chunk of input(context, file)) {
            budget.step();
            const text = Buffer.from(chunk).toString("latin1");
            let start = 0;
            let end;
            while ((end = text.indexOf("\n", start)) >= 0) {
                yield { text: budget.check(pending + text.slice(start, end)), terminated: true, file, fileIndex };
                pending = "";
                start = end + 1;
            }
            pending = budget.check(pending + text.slice(start));
        }
        if (pending)
            yield { text: pending, terminated: false, file, fileIndex };
    }
}
export function command(name, run) {
    return {
        name,
        async execute(context) {
            context.signal.throwIfAborted();
            try {
                return { exitCode: await run(context) };
            }
            catch (error) {
                context.signal.throwIfAborted();
                await writeBytes(context.stderr, new TextEncoder().encode(`${name}: ${error instanceof Error ? error.message : String(error)}\n`), context.signal);
                return { exitCode: error instanceof ProgramError ? 2 : 1 };
            }
        },
    };
}
//# sourceMappingURL=shared.js.map