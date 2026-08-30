import { integer, UsageError, value } from "../internal.js";
import { numericOptions } from "./numeric-options.js";
import { command, RecordBuffer } from "./shared.js";
export function createStringsCommand(limits) {
    return command("strings", limits, async (session) => {
        const parsed = numericOptions(session.context.args, "afn:t:", { all: "a", "print-file-name": "f", bytes: "n", radix: "t" });
        let minimum = 4;
        for (const specification of parsed.values.get("n") ?? [])
            minimum = integer(specification, 1);
        if (parsed.legacyValue !== undefined) {
            const specification = parsed.legacyValue;
            if (!/^(?:0[0-7]*|[1-9][0-9]*)$/u.test(specification))
                throw new UsageError(`invalid number '${specification}'`);
            minimum = Number.parseInt(specification, specification.startsWith("0") ? 8 : 10);
            if (minimum < 1 || minimum >= 4294967295)
                throw new UsageError(`invalid number '${specification}'`);
        }
        const radix = value(parsed, "t");
        if (radix !== undefined && !["d", "o", "x"].includes(radix))
            throw new UsageError(`invalid radix '${radix}'`);
        const files = parsed.operands.filter(name => name !== "-");
        if (parsed.operands.length && !files.length)
            throw new UsageError("missing file operand after '-' (use no operands for stdin)");
        await session.files(session.names(files), async (source, name) => {
            const record = new RecordBuffer(session);
            let offset = 0, start = 0;
            const flush = async () => {
                if (record.size >= minimum) {
                    const label = parsed.flags.has("f") ? `${name === "-" ? "{standard input}" : name}: ` : "";
                    const location = radix === undefined ? "" : `${start.toString(radix === "x" ? 16 : radix === "o" ? 8 : 10).padStart(7, " ")} `;
                    await session.output(new TextEncoder().encode(label + location));
                    await session.output(record.view());
                    await session.output(Uint8Array.of(10));
                }
                record.clear();
            };
            for await (const chunk of source) {
                for (const byte of chunk) {
                    await session.step();
                    if (byte === 9 || byte >= 32 && byte <= 126) {
                        if (!record.size)
                            start = offset;
                        record.push(byte);
                    }
                    else
                        await flush();
                    offset++;
                }
            }
            await flush();
        });
    });
}
//# sourceMappingURL=strings.js.map