import { command, CommandFailure, emit } from "./shared.js";
function duration(arguments_) {
    if (!arguments_.length)
        throw new CommandFailure("missing operand");
    const base = 1000000000n;
    const maximum = BigInt(Number.MAX_SAFE_INTEGER);
    const columns = new Map();
    for (const value of arguments_) {
        const match = /^\+?((?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)([smhd]?)$/.exec(value);
        if (!match)
            throw new CommandFailure(`invalid time interval: ${value}`);
        const parts = /^(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(match[1]);
        const fraction = parts[2] ?? "";
        const digits = `${parts[1]}${fraction}`.replace(/^0+/, "");
        if (!digits)
            continue;
        const scale = BigInt(parts[3] ?? "0") - BigInt(fraction.length) + 3n;
        const multiplier = match[2] === "d" ? 86400n : match[2] === "h" ? 3600n : match[2] === "m" ? 60n : 1n;
        const coefficient = (BigInt(digits) * multiplier).toString();
        if (BigInt(coefficient.length) + scale > 16n)
            throw new CommandFailure("time interval exceeds supported finite range");
        const shift = (scale % 9n + 9n) % 9n;
        let position = (scale - shift) / 9n;
        const aligned = coefficient + "0".repeat(Number(shift));
        for (let end = aligned.length; end > 0; end -= 9, position++) {
            const column = BigInt(aligned.slice(Math.max(0, end - 9), end));
            if (column)
                columns.set(position, (columns.get(position) ?? 0n) + column);
        }
    }
    let whole = 0n, fractional = false, carry = 0n, carryPosition = 0n;
    const collect = (value, position) => {
        if (position < 0n)
            fractional ||= value !== 0n;
        else if (value) {
            if (position > 1n)
                throw new CommandFailure("time interval exceeds supported finite range");
            whole += value * base ** position;
            if (whole > maximum)
                throw new CommandFailure("time interval exceeds supported finite range");
        }
    };
    const ordered = [...columns].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    for (const [position, value] of ordered) {
        while (carry && carryPosition < position) {
            collect(carry % base, carryPosition++);
            carry /= base;
        }
        const combined = value + carry;
        collect(combined % base, position);
        carry = combined / base;
        carryPosition = position + 1n;
    }
    while (carry) {
        collect(carry % base, carryPosition++);
        carry /= base;
    }
    const rounded = whole + BigInt(fractional);
    if (rounded > maximum)
        throw new CommandFailure("time interval exceeds supported finite range");
    return Number(rounded);
}
function delay(milliseconds, signal, configuration) {
    signal.throwIfAborted();
    if (milliseconds === 0)
        return Promise.resolve();
    const scheduler = configuration.scheduler;
    return new Promise((resolve, reject) => {
        let handle;
        let armed = false;
        let settled = false;
        let started;
        let previous;
        const finish = (failed, reason) => {
            if (settled)
                return;
            settled = true;
            signal.removeEventListener("abort", aborted);
            try {
                if (armed) {
                    armed = false;
                    scheduler.clearTimeout(handle);
                }
            }
            catch (error) {
                reject(error);
                return;
            }
            if (failed)
                reject(reason);
            else
                resolve();
        };
        const aborted = () => finish(true, signal.reason);
        const schedule = () => {
            if (settled)
                return;
            try {
                signal.throwIfAborted();
                const now = scheduler.now();
                if (!Number.isFinite(now) || Math.abs(now) > Number.MAX_SAFE_INTEGER || (previous !== undefined && now < previous)) {
                    throw new RangeError("sleep scheduler must supply finite monotonic milliseconds");
                }
                started ??= now;
                previous = now;
                const remaining = milliseconds - (now - started);
                if (remaining <= 0) {
                    finish(false);
                    return;
                }
                const timer = scheduler.setTimeout(() => { armed = false; schedule(); }, Math.min(configuration.maxTimerMilliseconds, Math.max(1, Math.ceil(remaining))));
                if (settled)
                    scheduler.clearTimeout(timer);
                else {
                    handle = timer;
                    armed = true;
                }
            }
            catch (error) {
                finish(true, error);
            }
        };
        signal.addEventListener("abort", aborted, { once: true });
        schedule();
    });
}
export function createSleepCommand(configuration) {
    return command("sleep", configuration, async (context) => {
        let informational;
        for (const argument of context.args) {
            if (argument === "--")
                break;
            if (argument === "--help" || argument === "--version") {
                informational = argument;
                break;
            }
            if (argument.startsWith("-") && argument !== "-")
                throw new CommandFailure(`invalid option: ${argument}`);
        }
        if (informational) {
            await emit(context, informational === "--help"
                ? "Usage: sleep NUMBER[smhd] ...\nSum finite nonnegative decimal durations; cancellation clears pending timers.\n"
                : "sleep (safe-bash virtual command)\n", configuration.limits);
            return 0;
        }
        await delay(duration(context.args), context.signal, configuration);
        return 0;
    });
}
//# sourceMappingURL=sleep.js.map