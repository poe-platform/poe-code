import { isUtf8 } from "node:buffer";
import { Limits } from "./shared.js";
export const elapsed = Object.freeze({ secs: 0, nanos: 0, human: "0.000000s" });
export const stats = () => ({ elapsed, searches: 0, searches_with_match: 0, bytes_searched: 0, bytes_printed: 0, matched_lines: 0, matches: 0 });
export const data = (bytes) => isUtf8(bytes) ? { text: Buffer.from(bytes).toString("utf8") } : { bytes: Buffer.from(bytes).toString("base64") };
export class Printer {
    args;
    limits;
    lastFile;
    lastLine = 0;
    headings = new Set();
    constructor(args, limits) {
        this.args = args;
        this.limits = limits;
    }
    async event(type, value) {
        const ordered = (input) => input && typeof input === "object" && !Array.isArray(input)
            ? Object.fromEntries(Object.entries(input).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => [key, ordered(item)])) : input;
        await this.limits.output(`${JSON.stringify(type === "summary" ? ordered({ type, data: value }) : { type, data: value })}\n`);
    }
    async filename(label) { await this.limits.output(label + (this.args.nullPath ? "\0" : "\n")); }
    async count(label, amount, filename) {
        await this.limits.output(`${filename ? label + (this.args.nullPath ? "\0" : ":") : ""}${amount}\n`);
    }
    async binary(label, offset, filename) {
        await this.limits.output(`${filename ? label + ": " : ""}binary file matches (found "\\0" byte around offset ${offset})\n`);
    }
    async record(label, line, matches, selected, filename) {
        if (this.args.mode === "json") {
            await this.event(selected ? "match" : "context", {
                path: data(Buffer.from(label)), lines: data(line.bytes), line_number: line.number, absolute_offset: line.offset,
                submatches: matches.map(match => ({ match: data(line.content.subarray(match.start, match.end)), start: match.start, end: match.end })),
            });
            return;
        }
        if (this.args.heading && filename && !this.headings.has(label)) {
            if (this.headings.size)
                await this.limits.output("\n");
            await this.limits.output(label + (this.args.nullPath ? "\0" : "\n"));
            this.headings.add(label);
        }
        else if ((this.args.before || this.args.after) && this.lastFile !== undefined && (this.lastFile !== label || line.number > this.lastLine + 1) && this.args.separator !== undefined) {
            await this.limits.output(this.args.separator + "\n");
        }
        const pieces = this.args.onlyMatching && selected && !this.args.invert ? matches : [undefined];
        for (const match of pieces) {
            const separator = selected ? ":" : "-";
            let prefix = filename && !this.args.heading ? label + (this.args.nullPath ? "\0" : separator) : "";
            if (this.args.lineNumber)
                prefix += line.number + separator;
            if (this.args.column && matches.length)
                prefix += (match ?? matches[0]).start + 1 + separator;
            if (this.args.byteOffset)
                prefix += (line.offset + (match?.start ?? 0)) + separator;
            const content = match ? line.content.subarray(match.start, match.end) : line.content;
            const terminator = this.args.nullData ? "\0" : match && this.args.crlf ? "\r\n" : "\n";
            await this.limits.output(Buffer.concat([Buffer.from(prefix), content, Buffer.from(terminator)]));
        }
        this.lastFile = label;
        this.lastLine = line.number;
    }
}
//# sourceMappingURL=output.js.map