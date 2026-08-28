import { argument, Budget, command, compare, encode, fail, Inputs, OrderCheck, requireCLocale, settings } from "./internal.js";
export function createCommCommand(options = {}) {
    const limits = settings(options);
    return command("comm", async (context) => {
        const budget = new Budget(context, limits), files = [], suppressed = new Set();
        let separator = 10, delimiter = Uint8Array.of(9), literal = false, total = false, mode = "default";
        let delimiterSet = false;
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
            if (token === "--check-order") {
                mode = "check";
                continue;
            }
            if (token === "--nocheck-order") {
                mode = "none";
                continue;
            }
            if (token === "--total") {
                total = true;
                continue;
            }
            if (token === "--zero-terminated") {
                separator = 0;
                continue;
            }
            if (token === "--output-delimiter" || token.startsWith("--output-delimiter=")) {
                let value;
                [value, index] = argument(context.args, index, token.includes("=") ? token.slice(19) : undefined, token);
                const candidate = value ? encode(value) : Uint8Array.of(0);
                if (delimiterSet && compare(candidate, delimiter) !== 0)
                    fail("multiple conflicting output delimiters");
                delimiter = candidate;
                delimiterSet = true;
                continue;
            }
            if (/^-[123z]+$/u.test(token)) {
                for (const flag of token.slice(1))
                    if (flag === "z")
                        separator = 0;
                    else
                        suppressed.add(Number(flag) - 1);
            }
            else
                fail(`unsupported option ${token}`);
        }
        if (files.length !== 2)
            fail("comm requires exactly two files");
        requireCLocale(context);
        const inputs = new Inputs(context, budget, separator), order = new OrderCheck(mode, context), terminator = Uint8Array.of(separator);
        try {
            const readers = [await inputs.open(files[0]), await inputs.open(files[1])];
            const rows = [await readers[0].next(), await readers[1].next()];
            const previous = [undefined, undefined];
            const totals = [0n, 0n, 0n];
            while (rows[0] !== undefined || rows[1] !== undefined) {
                await budget.step();
                const comparison = rows[0] === undefined ? 1 : rows[1] === undefined ? -1 : compare(rows[0], rows[1]);
                const column = comparison < 0 ? 0 : comparison > 0 ? 1 : 2;
                totals[column] = totals[column] + 1n;
                if (column !== 2)
                    order.unpaired = true;
                if (!suppressed.has(column)) {
                    const parts = [];
                    for (let index = 0; index < column; index++)
                        if (!suppressed.has(index))
                            parts.push(delimiter);
                    parts.push(rows[column === 1 ? 1 : 0], terminator);
                    await budget.output(parts);
                }
                for (let index = 0; index < 2; index++) {
                    if ((index === 0 && comparison > 0) || (index === 1 && comparison < 0))
                        continue;
                    const next = await readers[index].next();
                    if (next === undefined)
                        await order.check(previous[index], rows[index], index + 1);
                    else
                        await order.check(rows[index], next, index + 1);
                    previous[index] = rows[index];
                    rows[index] = next;
                }
            }
            for (const [index, reader] of readers.entries())
                await reader.closeOperand(files[index]);
            if (total)
                await budget.output([encode(totals[0].toString()), delimiter, encode(totals[1].toString()), delimiter, encode(totals[2].toString()), delimiter, encode("total"), terminator]);
            return { exitCode: order.failed ? 1 : 0 };
        }
        finally {
            await inputs.close();
        }
    });
}
//# sourceMappingURL=comm.js.map