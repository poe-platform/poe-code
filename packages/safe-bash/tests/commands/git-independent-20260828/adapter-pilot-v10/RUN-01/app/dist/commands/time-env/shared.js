import { FsError, writeBytes } from "../../contracts/index.js";
export function settings(options) {
    const limits = { maxArguments: 4096, maxArgumentBytes: 65536, maxOutputBytes: 1024 * 1024,
        maxEnvironmentEntries: 10000, maxFormatWidth: 4096, ...options.limits };
    for (const [name, value] of Object.entries(limits)) {
        if (!Number.isSafeInteger(value) || value < 1)
            throw new RangeError(`Invalid time-env limit: ${name}`);
    }
    const maxTimerMilliseconds = options.maxTimerMilliseconds ?? 2147483647;
    if (!Number.isInteger(maxTimerMilliseconds) || maxTimerMilliseconds < 1 || maxTimerMilliseconds > 2147483647) {
        throw new RangeError("maxTimerMilliseconds must be between1 and2147483647");
    }
    const scheduler = options.scheduler ?? {
        now: () => performance.now(),
        setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
        clearTimeout: handle => clearTimeout(handle),
    };
    if (typeof scheduler.now !== "function" || typeof scheduler.setTimeout !== "function" || typeof scheduler.clearTimeout !== "function") {
        throw new TypeError("Invalid sleep scheduler");
    }
    if (options.clock !== undefined && typeof options.clock !== "function")
        throw new TypeError("Invalid date clock");
    return { clock: options.clock ?? Date.now, defaultTimeZone: options.defaultTimeZone ?? "UTC",
        scheduler, maxTimerMilliseconds, limits };
}
export class CommandFailure extends Error {
    exitCode;
    constructor(message, exitCode = 1) {
        super(message);
        this.exitCode = exitCode;
    }
}
export function checkSize(size, maximum, label) {
    if (size > maximum)
        throw new FsError("EFBIG", { message: `time-env ${label} limit exceeded` });
}
export async function emit(context, value, limits) {
    checkSize(Buffer.byteLength(value), limits.maxOutputBytes, "output");
    const bytes = new TextEncoder().encode(value);
    for (let offset = 0; offset < bytes.length; offset += 16384) {
        await writeBytes(context.stdout, bytes.slice(offset, offset + 16384), context.signal);
    }
}
export function command(name, configuration, execute) {
    return { name, async execute(context) {
            context.signal.throwIfAborted();
            checkSize(context.args.length, configuration.limits.maxArguments, "argument count");
            let size = 0;
            for (const argument of context.args) {
                size += Buffer.byteLength(argument);
                checkSize(size, configuration.limits.maxArgumentBytes, "argument");
            }
            try {
                return { exitCode: await execute(context) };
            }
            catch (error) {
                context.signal.throwIfAborted();
                if (!(error instanceof CommandFailure))
                    throw error;
                await writeBytes(context.stderr, new TextEncoder().encode(`${name}: ${error.message}\n`), context.signal);
                return { exitCode: error.exitCode };
            }
        } };
}
export function ownEnvironment(context, name) {
    return Object.hasOwn(context.env, name) ? context.env[name] : undefined;
}
//# sourceMappingURL=shared.js.map