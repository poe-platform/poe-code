import { base64Text } from "safe-bash-byte-engine";
import { bytesFrom, concatBytes } from "safe-bash-byte-engine";
import type { Match } from "./matcher.js";
import type { Arguments } from "./options.js";
import { Limits, type Line } from "./shared.js";
import { Replacement } from "./replacement.js";

export const elapsed = Object.freeze({ secs: 0, nanos: 0, human: "0.000000s" });
export interface Stats { elapsed: typeof elapsed; searches: number; searches_with_match: number; bytes_searched: number; bytes_printed: number; matched_lines: number; matches: number }
export const stats = (): Stats => ({ elapsed, searches: 0, searches_with_match: 0, bytes_searched: 0, bytes_printed: 0, matched_lines: 0, matches: 0 });
export function data(bytes: Uint8Array): { text: string } | { bytes: string } {
  try { return { text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) }; }
  catch { return { bytes: base64Text(bytesFrom(bytes)) }; }
}

export class Printer {
  private lastFile: string | undefined;
  private lastLine = 0;
  private headings: Set<string> | undefined;
  private replacement: Replacement | undefined;
  constructor(public args: Arguments, public limits: Limits) {
    this.replacement = args.replacement === undefined ? undefined : new Replacement(args.replacement);
  }
  resetForRun(args: Arguments, limits: Limits): void {
    this.args = args;
    this.limits = limits;
    this.lastFile = undefined;
    this.lastLine = 0;
    this.headings = undefined;
    this.replacement = args.replacement === undefined ? undefined : new Replacement(args.replacement);
  }
  async event(type: string, value: unknown): Promise<void> {
    const ordered = (input: unknown): unknown => input && typeof input === "object" && !Array.isArray(input)
      ? Object.fromEntries(Object.entries(input).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => [key, ordered(item)])) : input;
    await this.limits.output(`${JSON.stringify(type === "summary" ? ordered({ type, data: value }) : { type, data: value })}\n`);
  }
  filenameSyncOrAsync(label: string): Promise<void> | undefined { return this.limits.outputFilenameSyncOrAsync(label, this.args.nullPath); }
  filenamePartsSyncOrAsync(dirLabel: string, entryName: string): Promise<void> | undefined {
    return this.limits.outputFilenamePartsSyncOrAsync(dirLabel, entryName, this.args.nullPath);
  }
  async filename(label: string): Promise<void> { await this.filenameSyncOrAsync(label); }
  countSyncOrAsync(label: string, amount: number, filename: boolean): Promise<void> | undefined {
    return this.limits.outputCountSyncOrAsync(label, amount, filename, this.args.nullPath);
  }
  countPartsSyncOrAsync(dirLabel: string, entryName: string, amount: number, filename: boolean): Promise<void> | undefined {
    return this.limits.outputCountPartsSyncOrAsync(dirLabel, entryName, amount, filename, this.args.nullPath);
  }
  async count(label: string, amount: number, filename: boolean): Promise<void> {
    await this.countSyncOrAsync(label, amount, filename);
  }
  async binary(label: string, offset: number, filename: boolean): Promise<void> {
    await this.limits.output(`${filename ? label + ": " : ""}binary file matches (found "\\0" byte around offset ${offset})\n`);
  }
  async record(label: string, line: Line, matches: readonly Match[], selected: boolean, filename: boolean, multiline = false, sourceLines = 1): Promise<void> {
    if (this.args.mode === "json") {
      await this.event(selected ? "match" : "context", {
        path: data(bytesFrom(label)), lines: data(line.rawBytes), line_number: line.number, absolute_offset: line.offset,
        submatches: matches.map(match => ({ match: data(line.content.subarray(match.start, match.end)), start: match.start, end: match.end })),
      });
      return;
    }
    if (this.args.heading && filename && !this.headings?.has(label)) {
      const headings = (this.headings ??= new Set<string>());
      if (headings.size) await this.limits.output("\n");
      await this.limits.output(label + (this.args.nullPath ? "\0" : "\n"));
      headings.add(label);
    } else if ((this.args.before || this.args.after) && this.lastFile !== undefined && (this.lastFile !== label || line.number > this.lastLine + 1) && this.args.separator !== undefined) {
      await this.limits.output(this.args.separator + "\n");
    }
    const pieces = this.args.onlyMatching && selected && !this.args.invert ? matches : [undefined];
    let expandedCursor = 0, expandedOffset = 0, expandedLine = line.number;
    for (const match of pieces) {
      const separator = selected ? ":" : "-";
      if (multiline && match) {
        for (let index = expandedCursor; index < match.start; index++) {
          if (line.content[index] === (this.args.nullData ? 0 : 10)) expandedLine++;
        }
        expandedOffset += match.start - expandedCursor;
      }
      let content = match ? line.content.subarray(match.start, match.end) : line.content;
      if (this.replacement && selected && !this.args.invert) {
        content = this.replacement.expand(line.content, match ? [match] : matches, match !== undefined, this.limits.maxOutputBytes - this.limits.outputBytes);
      }
      const terminator = this.args.nullData ? "\0" : match && this.args.crlf ? "\r\n" : "\n";
      let start = 0, number = multiline && match ? expandedLine : line.number;
      do {
        const delimiter = multiline ? content.indexOf(this.args.nullData ? 0 : 10, start) : -1;
        let chunk = content.subarray(start, delimiter < 0 ? content.length : delimiter);
        let prefix = filename && !this.args.heading ? label + (this.args.nullPath ? "\0" : separator) : "";
        if (this.args.lineNumber) prefix += number + separator;
        if (this.args.column && matches.length) prefix += (multiline && match ? expandedOffset : (match ?? matches[0])!.start) + 1 + separator;
        if (this.args.byteOffset) prefix += (line.offset + (multiline && match ? expandedOffset : match?.start ?? start)) + separator;
        if (this.args.trim) {
          let trim = 0;
          while (trim < chunk.length && (chunk[trim] === 32 || chunk[trim]! >= 9 && chunk[trim]! <= 13)) trim++;
          chunk = chunk.subarray(trim);
        }
        let outputTerminator = terminator;
        if (this.args.maxColumns > 0) {
          // Ripgrep includes the input terminator, except when printing only a match.
          const lineEndingBytes = match ? 0 : delimiter >= 0 ? 1 : line.rawLength - line.content.length;
          if (chunk.length + lineEndingBytes > this.args.maxColumns) {
            chunk = bytesFrom(this.replacement && selected && !this.args.invert
              ? `[Omitted long line with ${match ? 1 : matches.length} matches]`
              : `[Omitted long ${selected ? "matching" : "context"} line]`);
            outputTerminator = this.args.nullData ? "\0" : this.args.crlf ? "\r\n" : "\n";
          }
        }
        if (!multiline || !match || chunk.length > 0) {
          await this.limits.output(concatBytes([bytesFrom(prefix), chunk, bytesFrom(outputTerminator)]));
        }
        if (delimiter < 0) break;
        start = delimiter + 1;
        number++;
      } while (start < content.length);
      if (multiline && match) {
        expandedCursor = match.end;
        expandedOffset += content.length;
        expandedLine = number;
      }
    }
    this.lastFile = label; this.lastLine = line.number + sourceLines - 1;
  }
}
