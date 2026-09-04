import type { Match } from "./matcher.js";
import type { Arguments } from "./options.js";
import { Limits, type Line } from "./shared.js";

export const elapsed = Object.freeze({ secs: 0, nanos: 0, human: "0.000000s" });
export interface Stats { elapsed: typeof elapsed; searches: number; searches_with_match: number; bytes_searched: number; bytes_printed: number; matched_lines: number; matches: number }
export const stats = (): Stats => ({ elapsed, searches: 0, searches_with_match: 0, bytes_searched: 0, bytes_printed: 0, matched_lines: 0, matches: 0 });
export function data(bytes: Uint8Array): { text: string } | { bytes: string } {
  try { return { text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) }; }
  catch { return { bytes: Buffer.from(bytes).toString("base64") }; }
}

export class Printer {
  private lastFile: string | undefined;
  private lastLine = 0;
  private headings = new Set<string>();
  constructor(readonly args: Arguments, readonly limits: Limits) {}
  async event(type: string, value: unknown): Promise<void> {
    const ordered = (input: unknown): unknown => input && typeof input === "object" && !Array.isArray(input)
      ? Object.fromEntries(Object.entries(input).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => [key, ordered(item)])) : input;
    await this.limits.output(`${JSON.stringify(type === "summary" ? ordered({ type, data: value }) : { type, data: value })}\n`);
  }
  async filename(label: string): Promise<void> { await this.limits.output(label + (this.args.nullPath ? "\0" : "\n")); }
  async count(label: string, amount: number, filename: boolean): Promise<void> {
    await this.limits.output(`${filename ? label + (this.args.nullPath ? "\0" : ":") : ""}${amount}\n`);
  }
  async binary(label: string, offset: number, filename: boolean): Promise<void> {
    await this.limits.output(`${filename ? label + ": " : ""}binary file matches (found "\\0" byte around offset ${offset})\n`);
  }
  async record(label: string, line: Line, matches: readonly Match[], selected: boolean, filename: boolean): Promise<void> {
    if (this.args.mode === "json") {
      await this.event(selected ? "match" : "context", {
        path: data(Buffer.from(label)), lines: data(line.bytes), line_number: line.number, absolute_offset: line.offset,
        submatches: matches.map(match => ({ match: data(line.content.subarray(match.start, match.end)), start: match.start, end: match.end })),
      });
      return;
    }
    if (this.args.heading && filename && !this.headings.has(label)) {
      if (this.headings.size) await this.limits.output("\n");
      await this.limits.output(label + (this.args.nullPath ? "\0" : "\n"));
      this.headings.add(label);
    } else if ((this.args.before || this.args.after) && this.lastFile !== undefined && (this.lastFile !== label || line.number > this.lastLine + 1) && this.args.separator !== undefined) {
      await this.limits.output(this.args.separator + "\n");
    }
    const pieces = this.args.onlyMatching && selected && !this.args.invert ? matches : [undefined];
    for (const match of pieces) {
      const separator = selected ? ":" : "-";
      let prefix = filename && !this.args.heading ? label + (this.args.nullPath ? "\0" : separator) : "";
      if (this.args.lineNumber) prefix += line.number + separator;
      if (this.args.column && matches.length) prefix += (match ?? matches[0])!.start + 1 + separator;
      if (this.args.byteOffset) prefix += (line.offset + (match?.start ?? 0)) + separator;
      const content = match ? line.content.subarray(match.start, match.end) : line.content;
      const terminator = this.args.nullData ? "\0" : match && this.args.crlf ? "\r\n" : "\n";
      await this.limits.output(Buffer.concat([Buffer.from(prefix), content, Buffer.from(terminator)]));
    }
    this.lastFile = label; this.lastLine = line.number;
  }
}
