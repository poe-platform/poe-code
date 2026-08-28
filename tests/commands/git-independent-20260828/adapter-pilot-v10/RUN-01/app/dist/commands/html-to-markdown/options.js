export class HtmlUsageError extends Error {
}
export function settings(options) {
    const result = {
        maxInputBytes: 8 * 1024 * 1024, maxOutputBytes: 16 * 1024 * 1024,
        maxTokenBytes: 65_536, maxTokens: 200_000, maxNodes: 100_000, maxDepth: 128,
        maxAttributes: 64, maxTableCells: 10_000, maxTableCellBytes: 65_536,
        maxFiles: 64, maxArgumentBytes: 65_536, maxDiagnosticBytes: 8192,
        maxWorkUnits: 64 * 1024 * 1024, ...options.limits,
    };
    for (const [name, value] of Object.entries(result)) {
        if (!Number.isSafeInteger(value) || value < 1 || value > 64 * 1024 * 1024) {
            throw new RangeError(`Invalid html-to-markdown limit: ${name}`);
        }
    }
    if (result.maxDepth > 256 || result.maxTokenBytes > 1024 * 1024 || result.maxAttributes > 1024) {
        throw new RangeError("html-to-markdown depth/token/attribute ceiling exceeded");
    }
    return Object.freeze(result);
}
export function argumentsFor(args, limits) {
    let bytes = 0, literal = false;
    const files = [];
    if (args.length > limits.maxArgumentBytes)
        throw new HtmlUsageError("argument count limit exceeded");
    for (const argument of args) {
        if (argument.length > limits.maxArgumentBytes - bytes)
            throw new HtmlUsageError("argument limit exceeded");
        bytes += Buffer.byteLength(argument);
        if (bytes > limits.maxArgumentBytes || argument.includes("\0"))
            throw new HtmlUsageError("invalid or oversized argument");
        if (!literal && argument === "--") {
            literal = true;
            continue;
        }
        if (!literal && argument === "--help")
            return { files: [], info: helpText };
        if (!literal && argument === "--version")
            return { files: [], info: "html-to-markdown (safe-bash bounded HTML profile)\n" };
        if (!literal && argument.startsWith("-") && argument !== "-")
            throw new HtmlUsageError(`unknown option: ${argument}`);
        if (!argument)
            throw new HtmlUsageError("empty file operand");
        if (files.length >= limits.maxFiles)
            throw new HtmlUsageError("file limit exceeded");
        files.push(argument);
    }
    return { files: files.length ? files : ["-"] };
}
export const helpText = `Usage: html-to-markdown [--] [FILE|-] ...
Read VFS files or shared stdin; write bounded Markdown to stdout.
Supports headings, paragraphs, emphasis, links/images, lists, quotes, code and tables.
Drops scripts/styles/comments; unknown elements retain text. No fetching or execution.
This documented HTML subset is a converter, not a sanitizer or browser HTML5 parser.
`;
//# sourceMappingURL=options.js.map