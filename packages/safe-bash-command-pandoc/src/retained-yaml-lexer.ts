/*!
 * YAML lexical state machine adapted from yaml 2.9.0.
 * Copyright Eemeli Aro <eemeli@gmail.com>
 *
 * Permission to use, copy, modify, and/or distribute this software for any purpose
 * with or without fee is hereby granted, provided that the above copyright notice
 * and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
 * REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
 * FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
 * INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
 * OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
 * TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
 * THIS SOFTWARE.
 */
import type {RetainedSourceText, SourceRange} from "./retained-source-text.js";

/** Controls match yaml's lexer; every other token is an uncollected source span. */
export type RetainedYamlToken = SourceRange | "\x02" | "\x18" | "\x1f";
type State = "stream" | "line" | "block" | "doc" | "flow";
type Tokens<T> = AsyncGenerator<RetainedYamlToken, T>;
const empty = (ch: string) => ch === "" || ch === " " || ch === "\n" || ch === "\r" || ch === "\t";
const flow = (ch: string) => ch !== "" && ",[]{}".includes(ch);
const anchorEnd = (ch: string) => !ch || " ,[]{}\n\r\t".includes(ch);
const tagChars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()";
const hex = (ch: string) => !!ch && "0123456789ABCDEFabcdef".includes(ch);

/** Complete, caller-backed input replaces the upstream growable string buffer.
 * State consists only of scalar cursors, even for nested flow collections.
 * Syntax validation and collection construction belong to the composer. */
export class RetainedYamlLexer {
  private pos: number;
  private indentNext = 0;
  private indentValue = 0;
  private flowLevel = 0;
  private flowKey = false;
  private blockIndent = -1;
  private blockKeep = false;
  private reads = 0;
  private cachedLineEnd = -1;
  constructor(private readonly source: RetainedSourceText, private readonly range: SourceRange,
    private readonly cooperate: (units?: number) => Promise<void>) {this.pos = range.start;}

  private async at(index: number): Promise<string> {
    if (++this.reads === 256) {this.reads = 0; await this.cooperate(256);}
    return index < this.range.start || index >= this.range.end ? "" : this.source.unit(index);
  }
  private async marker(index: number): Promise<boolean> {
    const char = await this.at(index);
    return (char === "-" || char === ".") && await this.at(index + 1) === char && await this.at(index + 2) === char && empty(await this.at(index + 3));
  }
  private async lineEnd(): Promise<number> {
    if (this.cachedLineEnd >= this.pos) return this.cachedLineEnd;
    let end = this.pos;
    while (end < this.range.end && await this.at(end) !== "\n") end++;
    this.cachedLineEnd = end > this.pos && await this.at(end - 1) === "\r" && end < this.range.end ? end - 1 : end;
    return this.cachedLineEnd;
  }
  private async atLineEnd(): Promise<boolean> {
    let i = this.pos, char = await this.at(i);
    while (char === " " || char === "\t") char = await this.at(++i);
    return !char || char === "#" || char === "\n" || char === "\r" && await this.at(i + 1) === "\n";
  }
  private async continueScalar(offset: number): Promise<number> {
    let char = await this.at(offset);
    if (this.indentNext > 0) {
      let indent = 0;
      while (char === " ") char = await this.at(offset + ++indent);
      if (char === "\r" && await this.at(offset + indent + 1) === "\n") return offset + indent + 1;
      return char === "\n" || indent >= this.indentNext ? offset + indent : -1;
    }
    return await this.marker(offset) ? -1 : offset;
  }
  private async *to(end: number, allowEmpty = false): Tokens<number> {
    end = Math.min(this.range.end, Math.max(this.pos, end));
    const start = this.pos; this.pos = end;
    if (end > start || allowEmpty) yield {start, end};
    return end - start;
  }
  private async *spaces(tabs: boolean): Tokens<number> {
    let end = this.pos, char = await this.at(end);
    while (char === " " || tabs && char === "\t") char = await this.at(++end);
    return yield* this.to(end);
  }
  private async *newline(): Tokens<number> {
    const char = await this.at(this.pos);
    return yield* this.to(this.pos + (char === "\n" ? 1 : char === "\r" && await this.at(this.pos + 1) === "\n" ? 2 : 0));
  }
  private async *until(test: (char: string) => boolean): Tokens<number> {
    let end = this.pos;
    while (!test(await this.at(end))) end++;
    return yield* this.to(end);
  }
  private async *tag(): Tokens<number> {
    let end = this.pos + 1, char = await this.at(end);
    if (char === "<") {
      char = await this.at(++end);
      while (!empty(char) && char !== ">") char = await this.at(++end);
      if (char === ">") end++;
    } else {
      while (char) {
        if (tagChars.includes(char)) char = await this.at(++end);
        else if (char === "%" && hex(await this.at(end + 1)) && hex(await this.at(end + 2))) {end += 3; char = await this.at(end);}
        else break;
      }
    }
    return yield* this.to(end);
  }
  private async *indicators(): Tokens<void> {
    while (true) {
      const char = await this.at(this.pos);
      if (char === "!") yield* this.tag();
      else if (char === "&") yield* this.until(anchorEnd);
      else if (char === "-" || char === "?" || char === ":") {
        const next = await this.at(this.pos + 1);
        if (!empty(next) && !(this.flowLevel > 0 && flow(next))) return;
        if (!this.flowLevel) this.indentNext = this.indentValue + 1;
        else if (this.flowKey) this.flowKey = false;
        yield* this.to(this.pos + 1);
      } else return;
      yield* this.spaces(true);
    }
  }
  async *lex(): Tokens<void> {
    let state: State = "stream";
    while (this.pos < this.range.end) {
      switch (state) {
        case "stream": state = yield* this.stream(); break;
        case "line": state = yield* this.line(); break;
        case "block": state = yield* this.block(); break;
        case "doc": state = yield* this.document(); break;
        case "flow": state = yield* this.collection(); break;
      }
    }
  }
  private async *stream(): Tokens<State> {
    const end = await this.lineEnd();
    if (await this.at(this.pos) === "\uFEFF") yield* this.to(this.pos + 1);
    if (await this.at(this.pos) === "%") {
      let dirEnd = end;
      for (let i = this.pos; i < end; i++) if (await this.at(i) === "#" && [" ", "\t"].includes(await this.at(i - 1))) {dirEnd = i - 1; break;}
      while ([" ", "\t"].includes(await this.at(dirEnd - 1))) dirEnd--;
      yield* this.to(dirEnd); yield* this.spaces(true); yield* this.to(end);
      // Match upstream: the following stream step emits the directive newline.
      return "stream";
    }
    if (await this.atLineEnd()) {yield* this.spaces(true); yield* this.to(end); yield* this.newline(); return "stream";}
    yield "\x02"; return yield* this.line();
  }
  private async *line(): Tokens<State> {
    if (await this.marker(this.pos)) {
      const char = await this.at(this.pos); yield* this.to(this.pos + 3);
      this.indentValue = this.indentNext = 0;
      return char === "-" ? "doc" : "stream";
    }
    this.indentValue = yield* this.spaces(false);
    if (this.indentNext > this.indentValue && !empty(await this.at(this.pos + 1))) this.indentNext = this.indentValue;
    return yield* this.block();
  }
  private async *block(): Tokens<State> {
    const char = await this.at(this.pos);
    if ((char === "-" || char === "?" || char === ":") && empty(await this.at(this.pos + 1))) {
      const size = (yield* this.to(this.pos + 1)) + (yield* this.spaces(true));
      this.indentNext = this.indentValue + 1; this.indentValue += size;
      return "block";
    }
    return "doc";
  }
  private async *document(): Tokens<State> {
    yield* this.spaces(true);
    const end = await this.lineEnd();
    yield* this.indicators();
    const char = this.pos < end ? await this.at(this.pos) : "";
    switch (char) {
      case "#": yield* this.to(end); // falls through
      case "": yield* this.newline(); return yield* this.line();
      case "{": case "[": yield* this.to(this.pos + 1); this.flowKey = false; this.flowLevel = 1; return "flow";
      case "}": case "]": yield* this.to(this.pos + 1); return "doc";
      case "*": yield* this.until(anchorEnd); return "doc";
      case '"': case "'": return yield* this.quoted();
      case "|": case ">":
        yield* this.blockHeader(); yield* this.spaces(true); yield* this.to(end); yield* this.newline();
        return yield* this.blockScalar();
      default: return yield* this.plain();
    }
  }
  private async *collection(): Tokens<State> {
    let newline: number, spaces: number, indent = -1;
    do {
      newline = yield* this.newline();
      if (newline) {spaces = yield* this.spaces(false); this.indentValue = indent = spaces;} else spaces = 0;
      spaces += yield* this.spaces(true);
    } while (newline + spaces > 0);
    const end = await this.lineEnd(), char = await this.at(this.pos);
    if (indent !== -1 && indent < this.indentNext && char !== "#" || indent === 0 && await this.marker(this.pos)) {
      if (!(indent === this.indentNext - 1 && this.flowLevel === 1 && (char === "]" || char === "}"))) {
        this.flowLevel = 0; yield "\x18"; return yield* this.line();
      }
    }
    while (await this.at(this.pos) === ",") {yield* this.to(this.pos + 1); yield* this.spaces(true); this.flowKey = false;}
    yield* this.indicators();
    switch (this.pos < end ? await this.at(this.pos) : "") {
      case "": return "flow";
      case "#": yield* this.to(end); return "flow";
      case "{": case "[": yield* this.to(this.pos + 1); this.flowKey = false; this.flowLevel++; return "flow";
      case "}": case "]": yield* this.to(this.pos + 1); this.flowKey = true; return --this.flowLevel ? "flow" : "doc";
      case "*": yield* this.until(anchorEnd); return "flow";
      case '"': case "'": this.flowKey = true; return yield* this.quoted();
      case ":": {
        const next = await this.at(this.pos + 1);
        if (this.flowKey || empty(next) || next === ",") {
          this.flowKey = false; yield* this.to(this.pos + 1); yield* this.spaces(true); return "flow";
        }
      } // falls through
      default: this.flowKey = false; return yield* this.plain();
    }
  }
  private async *quoted(): Tokens<State> {
    const quote = await this.at(this.pos);
    let end = this.pos + 1;
    for (; end < this.range.end; end++) {
      if (await this.at(end) !== quote) continue;
      if (quote === "'") {if (await this.at(end + 1) === "'") {end++; continue;}}
      else {let count = 0; while (await this.at(end - 1 - count) === "\\") count++; if (count % 2) continue;}
      break;
    }
    // An unterminated quote has no upstream quote-bounded newline scan.
    if (end < this.range.end) {
      for (let i = this.pos; i < end; i++) if (await this.at(i) === "\n") {
        const next = await this.continueScalar(i + 1);
        if (next === -1) {end = i - (await this.at(i - 1) === "\r" ? 2 : 1); break;}
        i = next - 1;
      }
    }
    yield* this.to(end + 1);
    return this.flowLevel ? "flow" : "doc";
  }
  private async *blockHeader(): Tokens<void> {
    this.blockIndent = -1; this.blockKeep = false;
    for (let i = this.pos + 1; ; i++) {
      const char = await this.at(i);
      if (char === "+") this.blockKeep = true;
      else if (char > "0" && char <= "9") this.blockIndent = Number(char) - 1;
      else if (char !== "-") break;
    }
    yield* this.until(char => empty(char) || char === "#");
  }
  private async *blockScalar(): Tokens<State> {
    let newline = this.pos - 1, indent = 0;
    for (let i = this.pos; i < this.range.end; i++) {
      const char = await this.at(i);
      if (char === " ") indent++;
      else if (char === "\n") {newline = i; indent = 0;}
      else if (char !== "\r" || await this.at(i + 1) !== "\n") break;
    }
    if (indent >= this.indentNext) {
      this.indentNext = this.blockIndent === -1 ? indent : this.blockIndent + (this.indentNext === 0 ? 1 : this.indentNext);
      do {
        const next = await this.continueScalar(newline + 1);
        if (next === -1) break;
        newline = next;
        while (newline < this.range.end && await this.at(newline) !== "\n") newline++;
      } while (newline < this.range.end);
    }
    let i = newline + 1, char = await this.at(i);
    while (char === " ") char = await this.at(++i);
    if (char === "\t") {
      while (char === "\t" || char === " " || char === "\r" || char === "\n") char = await this.at(++i);
      newline = i - 1;
    } else if (!this.blockKeep) {
      while (true) {
        let i = newline - 1, char = await this.at(i);
        if (char === "\r") char = await this.at(--i);
        const last = i;
        while (char === " ") char = await this.at(--i);
        if (char === "\n" && i >= this.pos && i + 1 + indent > last) newline = i; else break;
      }
    }
    yield "\x1f"; yield* this.to(newline + 1, true);
    return yield* this.line();
  }
  private async *plain(): Tokens<State> {
    const inFlow = this.flowLevel > 0;
    let end = this.pos - 1;
    for (let i = this.pos; i < this.range.end; i++) {
      let char = await this.at(i);
      if (char === ":") {
        const next = await this.at(i + 1);
        if (empty(next) || inFlow && flow(next)) break;
        end = i;
      } else if (empty(char)) {
        let next = await this.at(i + 1);
        if (char === "\r") {if (next === "\n") {i++; char = "\n"; next = await this.at(i + 1);} else end = i;}
        if (next === "#" || inFlow && flow(next)) break;
        if (char === "\n") {const next = await this.continueScalar(i + 1); if (next === -1) break; i = Math.max(i, next - 2);}
      } else {if (inFlow && flow(char)) break; end = i;}
    }
    yield "\x1f"; yield* this.to(end + 1, true);
    return inFlow ? "flow" : "doc";
  }
}
