export class GetoptsError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "GetoptsError";
    }
}
function record(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function integer(value, minimum, name) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
        throw new GetoptsError("INVALID_INPUT", `${name} must be a safe integer >= ${minimum}`);
    }
}
export function createGetoptsState() {
    return { index: 0 };
}
export function cloneGetoptsState(state) {
    if (!record(state))
        throw new GetoptsError("INVALID_INPUT", "Invalid getopts state");
    integer(state.index, 0, "index");
    if (state.active === undefined)
        return { index: state.index };
    if (!record(state.active))
        throw new GetoptsError("INVALID_INPUT", "Invalid getopts active cursor");
    integer(state.active.argument, 0, "active.argument");
    integer(state.active.offset, 1, "active.offset");
    return { index: state.index, active: { argument: state.active.argument, offset: state.active.offset } };
}
export function withGetoptsIndex(state, index) {
    const copy = cloneGetoptsState(state);
    integer(index, Number.MIN_SAFE_INTEGER, "index");
    return index <= 1 ? createGetoptsState() : { ...copy, index };
}
class ScanWork {
    steps = 0;
    pending = 0;
    bytes = 0;
    maxArguments;
    maxBytes;
    maxSteps;
    yieldEvery;
    signal;
    checkpoint;
    constructor(work) {
        if (!record(work))
            throw new GetoptsError("INVALID_INPUT", "Explicit getopts work controls are required");
        integer(work.maxArguments, 0, "maxArguments");
        integer(work.maxBytes, 0, "maxBytes");
        integer(work.maxSteps, 0, "maxSteps");
        integer(work.yieldEvery, 1, "yieldEvery");
        if (typeof work.checkpoint !== "function")
            throw new GetoptsError("INVALID_INPUT", "A getopts checkpoint is required");
        if (work.signal !== undefined && (!record(work.signal) || typeof work.signal.throwIfAborted !== "function" || typeof work.signal.addEventListener !== "function" || typeof work.signal.removeEventListener !== "function")) {
            throw new GetoptsError("INVALID_INPUT", "Invalid getopts signal");
        }
        this.maxArguments = work.maxArguments;
        this.maxBytes = work.maxBytes;
        this.maxSteps = work.maxSteps;
        this.yieldEvery = work.yieldEvery;
        this.signal = work.signal;
        this.checkpoint = work.checkpoint;
        this.check();
    }
    check() {
        this.signal?.throwIfAborted();
    }
    step() {
        this.check();
        if (this.steps === this.maxSteps)
            throw new GetoptsError("STEP_LIMIT", "Getopts work step limit exceeded");
        this.steps++;
        this.pending++;
        return this.pending === this.yieldEvery ? this.flush() : undefined;
    }
    addBytes(count) {
        if (count > this.maxBytes - this.bytes)
            throw new GetoptsError("BYTE_LIMIT", "Getopts input byte limit exceeded");
        this.bytes += count;
    }
    async flush() {
        this.check();
        if (this.pending) {
            const steps = this.pending;
            this.pending = 0;
            const pending = Promise.resolve(this.checkpoint(steps));
            const signal = this.signal;
            if (!signal)
                await pending;
            else
                await new Promise((resolve, reject) => {
                    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
                    pending.then(() => { signal.removeEventListener("abort", abort); resolve(); }, error => { signal.removeEventListener("abort", abort); reject(error); });
                    if (signal.aborted)
                        abort();
                    else
                        signal.addEventListener("abort", abort, { once: true });
                });
        }
        this.check();
    }
}
async function validateString(value, work, optstring = false) {
    if (typeof value !== "string")
        throw new GetoptsError("INVALID_INPUT", "Getopts requires string inputs");
    for (let position = 0; position < value.length; position++) {
        const waiting = work.step();
        if (waiting)
            await waiting;
        const code = value.charCodeAt(position);
        if (code === 0)
            throw new GetoptsError("INVALID_INPUT", "Getopts inputs must not contain NUL");
        if (optstring && code > 127)
            throw new GetoptsError("NON_ASCII_OPTION", "Non-ASCII getopts option specifications are unsupported");
        if (code < 128)
            work.addBytes(1);
        else if (code < 2048)
            work.addBytes(2);
        else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(position + 1) >= 0xdc00 && value.charCodeAt(position + 1) <= 0xdfff)
            work.addBytes(4);
        else if (code >= 0xdc00 && code <= 0xdfff && value.charCodeAt(position - 1) >= 0xd800 && value.charCodeAt(position - 1) <= 0xdbff)
            work.addBytes(0);
        else
            work.addBytes(3);
    }
}
export async function scanGetopts(state, optstring, args, options) {
    if (!record(options) || typeof options.reportErrors !== "boolean")
        throw new GetoptsError("INVALID_INPUT", "Getopts requires explicit diagnostic policy and work controls");
    const work = new ScanWork(options.work);
    const original = cloneGetoptsState(state);
    if (!Array.isArray(args))
        throw new GetoptsError("INVALID_INPUT", "Getopts requires an argument array");
    if (args.length > work.maxArguments)
        throw new GetoptsError("ARGUMENT_LIMIT", "Getopts argument limit exceeded");
    const starting = work.step();
    if (starting)
        await starting;
    await validateString(optstring, work, true);
    for (let argument = 0; argument < args.length; argument++) {
        const waiting = work.step();
        if (waiting)
            await waiting;
        await validateString(args[argument], work);
    }
    const silent = optstring.startsWith(":");
    const specification = new Int8Array(128).fill(-1);
    for (let position = silent ? 1 : 0; position < optstring.length; position++) {
        const waiting = work.step();
        if (waiting)
            await waiting;
        const code = optstring.charCodeAt(position);
        if (code !== 58 && code !== 63 && specification[code] === -1)
            specification[code] = Number(optstring[position + 1] === ":");
    }
    let index = original.index || 1;
    let active = original.index === 0 ? undefined : original.active;
    const finish = async (kind, option, argument, diagnostic) => {
        const waiting = work.step();
        if (waiting)
            await waiting;
        await work.flush();
        return { state: active === undefined ? { index } : { index, active: { ...active } }, kind, status: kind === "end" ? 1 : 0, option, optind: index, argument, diagnostic };
    };
    const end = () => {
        active = undefined;
        return finish("end", "?", { kind: "unset" }, null);
    };
    if (index > args.length) {
        index = args.length + 1;
        return end();
    }
    if (active && (args[active.argument] === undefined || active.offset >= args[active.argument].length))
        active = undefined;
    if (!active) {
        const token = args[index - 1];
        if (token.length < 2 || token[0] !== "-")
            return end();
        if (token === "--") {
            index++;
            return end();
        }
        active = { argument: index - 1, offset: 1 };
    }
    const token = args[active.argument];
    const option = token[active.offset];
    const code = option.charCodeAt(0);
    if (code > 127)
        throw new GetoptsError("NON_ASCII_OPTION", "Non-ASCII getopts option characters are unsupported");
    const offset = active.offset + 1;
    const attached = offset < token.length;
    active = attached ? { argument: active.argument, offset } : undefined;
    if (!attached)
        index++;
    if (specification[code] === -1) {
        return finish("unknown-option", "?", silent ? { kind: "set", value: option } : { kind: "unset" }, !silent && options.reportErrors ? { kind: "unknown-option", option } : null);
    }
    if (specification[code] === 1) {
        if (attached) {
            active = undefined;
            index++;
            return finish("option", option, { kind: "set", value: token.slice(offset) }, null);
        }
        if (index <= args.length) {
            const value = args[index - 1];
            index++;
            return finish("option", option, { kind: "set", value }, null);
        }
        return finish("missing-argument", silent ? ":" : "?", silent ? { kind: "set", value: option } : { kind: "unset" }, !silent && options.reportErrors ? { kind: "missing-argument", option } : null);
    }
    return finish("option", option, { kind: "unset" }, null);
}
//# sourceMappingURL=getopts.js.map