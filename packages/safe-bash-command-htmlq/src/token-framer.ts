import { HtmlBudget } from "./contracts.js";
import { asciiLower, htmlSpace } from "./entities.js";

export interface TokenFrame<T> {
  write(value: string): void | Promise<void>;
  finish(): T | Promise<T>;
}

/** One shared lexical framer; the caller chooses stored or convenience frames. */
export class HtmlTokenFramer<Frame, Token> {
  private buffer = "";
  private ended = false;
  private readonly input: AsyncIterator<string>;
  get residentInputUnits(): number { return this.buffer.length; }
  constructor(source: AsyncIterable<string>, private readonly budget: HtmlBudget,
    private readonly createFrame: () => TokenFrame<Frame>,
    private readonly decode: (frame: Frame, raw: string | undefined, foreign: boolean) => Token | undefined | Promise<Token | undefined>) {
    this.input = source[Symbol.asyncIterator]();
  }
  private async peek(length = 1): Promise<string> {
    while (!this.ended && this.buffer.length < length) {
      const next = await this.input.next();
      this.budget.check();
      if (next.done) this.ended = true;
      else this.buffer += next.value;
    }
    return this.buffer.slice(0, length);
  }
  async close(): Promise<void> { if (!this.ended) await this.input.return?.(); }
  async next(raw?: string, foreign = false): Promise<Token | undefined> {
    if (!await this.peek()) return undefined;
    const frame = this.createFrame();
    let size = 0;
    const take = async (length = 1): Promise<void> => {
      const value = await this.peek(length);
      this.budget.bound("tokenBytes", (size + value.length) * 2);
      await frame.write(value);
      size += value.length;
      this.buffer = this.buffer.slice(value.length);
    };
    const until = async (delimiter: string): Promise<void> => {
      while (await this.peek(delimiter.length)) {
        const at = this.buffer.indexOf(delimiter);
        if (at >= 0) { await take(at + delimiter.length); break; }
        await take(Math.max(1, this.buffer.length - delimiter.length + 1));
      }
    };
    if (raw) {
      let scriptState: "data" | "escaped" | "double" = "data";
      while (await this.peek()) {
        let end = raw === "plaintext" ? this.buffer.length : this.buffer.indexOf("<");
        if (end < 0) end = this.buffer.length;
        if (raw === "script" && scriptState !== "data") {
          const dash = this.buffer.indexOf("-");
          if (dash >= 0) end = Math.min(end, dash);
        }
        if (end > 0) { await take(end); continue; }
        if (raw !== "plaintext") {
          if (raw === "script") {
            if (scriptState === "data" && await this.peek(4) === "<!--") {
              scriptState = "escaped"; await take(4); continue;
            }
            if (scriptState !== "data" && await this.peek(3) === "-->") {
              scriptState = "data"; await take(3); continue;
            }
            const opening = asciiLower(await this.peek(8));
            if (scriptState === "escaped" && opening.startsWith("<script") && delimiter(opening[7])) {
              scriptState = "double"; await take(7); continue;
            }
            const closing = asciiLower(await this.peek(9));
            if (scriptState === "double" && closing.startsWith("</script") && delimiter(closing[8])) {
              scriptState = "escaped"; await take(8); continue;
            }
          }
          if (scriptState !== "double" && await this.peek(2) === "</") {
            const closing = asciiLower(await this.peek(raw.length + 3));
            if (closing.slice(2, 2 + raw.length) === raw && delimiter(closing[2 + raw.length])) break;
          }
        }
        await take();
      }
      if (size) return this.decode(await frame.finish(), raw, foreign);
    }
    if (await this.peek() !== "<") {
      while (await this.peek() && this.buffer[0] !== "<") {
        const end = this.buffer.indexOf("<");
        await take(end < 0 ? this.buffer.length : end);
      }
    } else if (foreign && await this.peek(9) === "<![CDATA[") {
      await take(9); await until("]]>");
    } else if (await this.peek(4) === "<!--") {
      await take(4);
      let state: "start" | "startDash" | "data" | "dash" | "end" | "bang" = "start";
      while (await this.peek()) {
        if (state === "data") {
          const end = this.buffer.indexOf("-");
          if (end !== 0) { await take(end < 0 ? this.buffer.length : end); continue; }
        }
        const c = await this.peek(); await take();
        if (state === "start" || state === "startDash") {
          if (c === ">") break;
          state = c === "-" ? state === "start" ? "startDash" : "end" : "data";
        } else if (state === "data") { if (c === "-") state = "dash"; }
        else if (state === "dash") state = c === "-" ? "end" : "data";
        else if (state === "end") {
          if (c === ">") break;
          if (c !== "-") state = c === "!" ? "bang" : "data";
        } else {
          if (c === ">") break;
          state = c === "-" ? "dash" : "data";
        }
      }
    } else if (asciiLower(await this.peek(9)) === "<!doctype") {
      await take(9); await until(">");
    } else {
      await take(); // <
      const closing = await this.peek() === "/";
      if (closing) await take();
      const first = await this.peek();
      if (!asciiLetter(first)) {
        if (closing || first === "!" || first === "?") await until(">");
      } else {
        while (await this.peek() && !delimiter(await this.peek())) {
          let end = 0;
          while (end < this.buffer.length && !delimiter(this.buffer[end])) end++;
          await take(end);
        }
        // Quotes are special only after '='. Quotes in malformed attribute
        // names must not hide a token's closing angle bracket.
        let state: "before" | "name" | "after" | "value" | "unquoted" | "quoted" = "before";
        let quote = "";
        while (await this.peek()) {
          const c = await this.peek();
          if (state === "quoted") {
            const end = this.buffer.indexOf(quote);
            await take(end < 0 ? this.buffer.length : end + 1);
            if (end >= 0) state = "before";
            continue;
          }
          if (state === "name" || state === "unquoted") {
            let end = 0;
            while (end < this.buffer.length && !htmlSpace(this.buffer[end]!) && this.buffer[end] !== ">" &&
              (state === "unquoted" || this.buffer[end] !== "=" && this.buffer[end] !== "/")) end++;
            if (end) { await take(end); continue; }
          } else if (htmlSpace(c) || state === "before" && c === "/") {
            let end = 0;
            while (end < this.buffer.length && (htmlSpace(this.buffer[end]!) || state === "before" && this.buffer[end] === "/")) end++;
            await take(end); continue;
          }
          if (c === ">") { await take(); break; }
          if (state === "before") {
            await take();
            if (!htmlSpace(c) && c !== "/") state = "name";
          } else if (state === "name") {
            if (c === "=") { await take(); state = "value"; }
            else if (htmlSpace(c) || c === "/") state = "after";
            else await take();
          } else if (state === "after") {
            if (htmlSpace(c)) await take();
            else if (c === "=") { await take(); state = "value"; }
            else state = "before";
          } else if (state === "value") {
            await take();
            if (!htmlSpace(c)) {
              if (c === '"' || c === "'") { quote = c; state = "quoted"; }
              else state = "unquoted";
            }
          } else {
            await take(); if (htmlSpace(c)) state = "before";
          }
        }
      }
    }
    return this.decode(await frame.finish(), undefined, foreign);
  }
}
function delimiter(c: string | undefined): boolean { return c !== undefined && (htmlSpace(c) || c === "/" || c === ">"); }
function asciiLetter(c: string): boolean { return c >= "A" && c <= "Z" || c >= "a" && c <= "z"; }
