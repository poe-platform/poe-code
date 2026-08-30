import { readBytes, writeBytes } from "../../../contracts/index.js";
import { define, diagnostic, output } from "../../internal.js";
import { planOperands, unchangedSource, writeFileOperand } from "./files.js";
import { parseOptions } from "./options.js";
import { chunkBytes, transform } from "./stream.js";
export function createCompressionCommands() {
    return ["gzip", "gunzip", "zcat"].map((name) => define(name, async (context) => {
        const options = parseOptions(name, context.args);
        if (options.help) {
            await output(context, `Usage: ${name} [OPTION]... [FILE]...\n-c, --stdout, --to-stdout\n-d, --decompress, --uncompress\n-k, --keep\n-f, --force\n-t, --test\n-1..-9, --fast, --best\n-n, --no-name (always enabled)\n-h, --help\nNo FILE or FILE '-' uses stdin; file output uses private VFS staging.\n`);
            return { exitCode: 0 };
        }
        const plans = await planOperands(context, options);
        let exitCode = 0;
        for (const plan of plans) {
            try {
                let warned;
                if (plan.destination)
                    warned = await writeFileOperand(context, plan, options);
                else {
                    await unchangedSource(context, plan);
                    const source = plan.source === "-" ? context.stdin
                        : (signal) => context.fs.readStream(plan.source, { signal, chunkSize: chunkBytes });
                    warned = await transform(source, async (bytes, signal) => {
                        for await (const chunk of readBytes(bytes, signal)) {
                            if (!options.test)
                                await writeBytes(context.stdout, chunk, signal);
                        }
                    }, { ...options, force: options.force && (options.stdout || options.test || plan.source === "-") }, context.signal);
                }
                if (warned) {
                    await diagnostic(context, new Error(`${plan.source}: decompression OK, trailing garbage ignored`));
                    if (exitCode === 0)
                        exitCode = 2;
                }
            }
            catch (error) {
                context.signal.throwIfAborted();
                await diagnostic(context, error);
                exitCode = 1;
            }
        }
        return { exitCode };
    }));
}
//# sourceMappingURL=index.js.map