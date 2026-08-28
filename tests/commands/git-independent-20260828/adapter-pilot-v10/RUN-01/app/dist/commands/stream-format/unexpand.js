import { integer, options, UsageError } from "../internal.js";
import { ByteOutput, command } from "./shared.js";
function tabStops(specifications, session) {
    const stops = [];
    let repeat = 0, relative = false;
    for (const specification of specifications) {
        for (const entry of specification.split(/[, \t]+/u).filter(Boolean)) {
            if (repeat)
                throw new UsageError("repeating tab stop must be last");
            const marker = entry[0] === "+" || entry[0] === "/" ? entry[0] : "";
            const number = integer(entry.slice(marker.length), 1);
            if (marker) {
                repeat = number;
                relative = marker === "+";
            }
            else {
                if (number <= (stops.at(-1) ?? 0))
                    throw new UsageError("tab stops must be ascending");
                stops.push(number);
            }
        }
    }
    if (!stops.length && !repeat)
        repeat = 8;
    if (stops.length === 1 && !repeat)
        repeat = stops.pop();
    return column => {
        let lower = 0, upper = stops.length;
        while (lower < upper) {
            session.charge();
            const middle = Math.floor((lower + upper) / 2);
            if (stops[middle] <= column)
                lower = middle + 1;
            else
                upper = middle;
        }
        if (lower < stops.length)
            return stops[lower];
        if (!repeat)
            return undefined;
        const origin = relative ? stops.at(-1) ?? 0 : 0;
        const next = column + repeat - (column - origin) % repeat;
        session.check(next, Number.MAX_SAFE_INTEGER, "column");
        return next;
    };
}
export function createUnexpandCommand(limits) {
    return command("unexpand", limits, async (session) => {
        const normalized = [], obsolete = [];
        let ended = false;
        for (let index = 0; index < session.context.args.length; index++) {
            const argument = session.context.args[index];
            if (!ended && /^-\d[\d,]*$/u.test(argument))
                obsolete.push(argument.slice(1));
            else {
                normalized.push(argument);
                if (argument === "--")
                    ended = true;
                if (!ended && (argument === "-t" || argument === "--tabs") && index + 1 < session.context.args.length)
                    normalized.push(session.context.args[++index]);
            }
        }
        const parsed = options(normalized, "at:F", { all: "a", tabs: "t", "first-only": "F" });
        const nextTab = tabStops([...obsolete, ...parsed.values.get("t") ?? []], session);
        const all = !parsed.flags.has("F") && (parsed.flags.has("a") || parsed.flags.has("t"));
        const output = new ByteOutput(session);
        let column = 0, initial = true, active = true;
        let pendingStart = 0, pendingCount = 0, pendingTab = false;
        const flushBlanks = async () => {
            if (!pendingCount)
                return;
            let position = pendingStart;
            const convertSingle = initial || pendingCount > 1 || pendingTab;
            while (position < column) {
                await session.step();
                const stop = nextTab(position);
                if (stop !== undefined && stop <= column && (stop - position > 1 || convertSingle)) {
                    await output.byte(9);
                    position = stop;
                }
                else {
                    await output.byte(32);
                    position++;
                }
            }
            pendingCount = 0;
            pendingTab = false;
        };
        await session.files(session.names(parsed.operands), async (source) => {
            for await (const chunk of source) {
                for (const byte of chunk) {
                    await session.step();
                    if (active && (byte === 32 || byte === 9)) {
                        const stop = nextTab(column);
                        if (stop !== undefined) {
                            if (!pendingCount)
                                pendingStart = column;
                            pendingCount++;
                            pendingTab ||= byte === 9;
                            column = byte === 9 ? stop : column + 1;
                            session.check(column, Number.MAX_SAFE_INTEGER, "column");
                            continue;
                        }
                        await flushBlanks();
                        active = false;
                    }
                    else
                        await flushBlanks();
                    await output.byte(byte);
                    if (byte === 10) {
                        column = 0;
                        initial = true;
                        active = true;
                    }
                    else if (active) {
                        column = byte === 8 ? Math.max(0, column - 1) : column + 1;
                        session.check(column, Number.MAX_SAFE_INTEGER, "column");
                        initial = false;
                        if (!all)
                            active = false;
                    }
                }
                await output.flush();
            }
        });
        await flushBlanks();
        await output.flush();
    });
}
//# sourceMappingURL=unexpand.js.map