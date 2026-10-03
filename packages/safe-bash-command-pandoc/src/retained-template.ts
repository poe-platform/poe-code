import type {PagedStorage} from "safe-bash-io-engine/storage";
import {BackedText, emptyText, type TextRange} from "./backed-text.js";
import type {ExecutionContext} from "./execution.js";
import type {InputSource} from "./types.js";

/** Template source and evaluation continuations reside in caller storage.
 * Names are compared in pieces, including arbitrarily long unknown names. */
export class RetainedTemplate {
  private start = 0;
  private length = 0;
  private window = "";
  private windowStart = -1;
  constructor(private readonly storage: PagedStorage, private readonly context: ExecutionContext) {}
  async acquire(source: InputSource): Promise<void> {
    this.context.charge("includes", 1);
    this.start = this.storage.allocate(0);
    await this.context.decodeUtf8To("bytes" in source ? [source.bytes] : source.chunks, async chunk => {
      const bytes = new Uint8Array(chunk.length * 2), view = new DataView(bytes.buffer);
      for (let i = 0; i < chunk.length; i++) view.setUint16(i * 2, chunk.charCodeAt(i), true);
      await this.storage.append(bytes); this.length += chunk.length;
    }, ["inputBytes", "resourceBytes"]);
  }
  private async char(position: number): Promise<string> {
    if (position >= this.length) return "";
    if (position < this.windowStart || position >= this.windowStart + this.window.length) {
      this.windowStart = Math.floor(position / 4096) * 4096;
      const bytes = await this.storage.read(this.start + this.windowStart * 2, Math.min(4096, this.length - this.windowStart) * 2);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length); this.window = "";
      for (let i = 0; i < bytes.length; i += 2) this.window += String.fromCharCode(view.getUint16(i, true));
    }
    return this.window[position - this.windowStart]!;
  }
  private async *slice(start: number, end: number): AsyncGenerator<string> {
    let output = "";
    for (let i = start; i < end; i++) {
      output += await this.char(i);
      if (output.length === 4096) {await this.context.cooperate(output.length); yield output; output = "";}
    }
    if (output) {await this.context.cooperate(output.length); yield output;}
  }
  private async find(start: number, end: number): Promise<number> {
    for (let i = start; i < end; i++) {
      if (await this.char(i) === "$") return i;
      if (i % 4096 === 0) await this.context.cooperate(4096);
    }
    return -1;
  }
  private async equal(start: number, end: number, value: string): Promise<boolean> {
    if (end - start !== value.length) return false;
    for (let i = 0; i < value.length; i++) if (await this.char(start + i) !== value[i]) return false;
    return true;
  }
  private async prefix(start: number, end: number, value: string): Promise<boolean> {
    return end - start >= value.length && this.equal(start, start + value.length, value);
  }
  async render(text: BackedText, values: Readonly<Record<string, TextRange>>): Promise<TextRange> {
    const context = this.context;
    return text.from((async function* (this: RetainedTemplate) {
      let cursor = 0, end = this.length, depth = 0, stack = 0;
      while (true) {
        if (cursor >= end) {
          if (!stack) break;
          const bytes = await this.storage.read(stack, 32), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
          stack = view.getFloat64(0, true); cursor = view.getFloat64(8, true); end = view.getFloat64(16, true); depth = view.getFloat64(24, true);
          continue;
        }
        await context.cooperate();
        const open = await this.find(cursor, end);
        if (open < 0) {yield* this.slice(cursor, end); cursor = end; continue;}
        yield* this.slice(cursor, open);
        const close = await this.find(open + 1, end);
        if (close < 0) context.fail("E_PARSE", "Unclosed template interpolation");
        const token = open + 1;
        cursor = close + 1;
        if (token === close) {yield "$"; continue;}
        const loop = await this.prefix(token, close, "for(") && await this.char(close - 1) === ")";
        const condition = await this.prefix(token, close, "if(") && await this.char(close - 1) === ")";
        let value: TextRange | undefined, map = false;
        const keyStart = loop ? token + 4 : condition ? token + 3 : token;
        const keyEnd = loop || condition ? close - 1 : close;
        for (const key of Object.keys(values)) if (await this.equal(keyStart, keyEnd, key)) {value = values[key]; break;}
        if (!value) for (const key of Object.getOwnPropertyNames(Object.prototype)) {
          if (await this.equal(keyStart, keyEnd, key)) {
            const inherited: unknown = values[key];
            map = typeof inherited === "object" && inherited !== null;
            value = map ? emptyText() : await text.from([String(inherited)]);
            break;
          }
        }
        if (loop || condition) {
          let nesting = 1, scan = cursor, alternate = -1, finish = -1, finishEnd = -1;
          while (scan < end) {
            await context.cooperate();
            const a = await this.find(scan, end);
            if (a < 0) break;
            const b = await this.find(a + 1, end);
            if (b < 0) break;
            if (await this.prefix(a + 1, b, "if(") || await this.prefix(a + 1, b, "for(")) nesting++;
            const endif = await this.equal(a + 1, b, "endif"), endfor = await this.equal(a + 1, b, "endfor");
            if ((endif || endfor) && --nesting === 0) {
              if (loop ? !endfor : !endif) context.fail("E_PARSE", "Mismatched template block");
              finish = a; finishEnd = b + 1; break;
            }
            if (nesting === 1 && await this.equal(a + 1, b, "else")) alternate = a;
            scan = b + 1;
          }
          if (finish < 0) context.fail("E_PARSE", "Unclosed template block");
          if (loop && alternate >= 0) context.fail("E_UNSUPPORTED_FEATURE", "Template loop separators are unsupported");
          const selectedStart = loop ? value ? cursor : -1 : value?.units || map ? cursor : alternate < 0 ? -1 : alternate + 6;
          const selectedEnd = !loop && (value?.units || map) && alternate >= 0 ? alternate : finish;
          if (selectedStart >= 0) {
            context.bound("depth", depth + 1);
            const bytes = new Uint8Array(32), view = new DataView(bytes.buffer);
            [stack, finishEnd, end, depth].forEach((n, i) => view.setFloat64(i * 8, n, true));
            stack = await this.storage.append(bytes); depth++; cursor = selectedStart; end = selectedEnd;
          } else cursor = finishEnd;
        } else {
          let invalid = false;
          for (const key of ["else", "endif", "endfor", "sep"]) if (await this.equal(token, close, key)) invalid = true;
          for await (const chunk of this.slice(token, close)) for (const ch of chunk) {
            if (!(ch >= "a" && ch <= "z") && !(ch >= "A" && ch <= "Z") && !(ch >= "0" && ch <= "9") && ch !== "_" && ch !== "-") invalid = true;
          }
          if (invalid) {
            // The public error contract includes the offending expression.
            let expression = ""; for await (const chunk of this.slice(token, close)) expression += chunk;
            context.fail("E_UNSUPPORTED_FEATURE", `Unsupported template expression: ${expression}`);
          }
          if (map) context.fail("E_UNSUPPORTED_FEATURE", "Template map interpolation is unsupported");
          if (value) {
            const trim = await this.equal(token, close, "body") && await this.char(cursor) === "\n";
            let pending = "";
            for await (const chunk of text.chunks(value)) {if (pending) yield pending; pending = chunk;}
            if (pending) yield trim && pending.endsWith("\n") ? pending.slice(0, -1) : pending;
          }
        }
      }
    }).call(this));
  }
}
