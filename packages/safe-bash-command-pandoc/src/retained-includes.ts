import {PagedStorage} from "safe-bash-io-engine/storage";
import {BackedText, emptyText, type TextRange} from "./backed-text.js";
import type {ExecutionContext} from "./execution.js";
import type {ConversionOptions, WorkingStorageOptions} from "./types.js";

/** Include text and each replacement generation belong to caller storage.
 * String.replace's replacement tokens are intentional compatibility behavior. */
export class RetainedIncludes {
  private readonly text: BackedText;
  private readonly before = emptyText();
  private readonly after = emptyText();
  private readonly header = emptyText();
  private readonly release: () => void;
  private closing: Promise<void> | undefined;
  private constructor(private readonly storage: PagedStorage, context: ExecutionContext) {
    this.text = new BackedText(storage, units => context.cooperate(units));
    this.release = context.onClose(() => this.close());
  }
  static async acquire(context: ExecutionContext, working: WorkingStorageOptions, options: ConversionOptions): Promise<RetainedIncludes | undefined> {
    if (!options.includeInHeader?.length && !options.includeBeforeBody?.length && !options.includeAfterBody?.length) return undefined;
    const pages = (working.cacheBytes ?? 1048576) / 16384;
    if (!Number.isSafeInteger(pages) || pages < 1) context.fail("E_OPTION", "Working storage cacheBytes must be a positive multiple of 16384");
    if (typeof working.directory !== "string" || !working.directory.startsWith("/")) context.fail("E_OPTION", "Working storage requires an absolute caller filesystem directory");
    const storage = new PagedStorage({fs: working.fs, cwd: working.directory, env: {}, signal: context.signal ?? new AbortController().signal}, pages);
    const result = new RetainedIncludes(storage, context);
    try {
      for (const [sources, target] of [[options.includeInHeader, result.header], [options.includeBeforeBody, result.before], [options.includeAfterBody, result.after]] as const) {
        for (const source of sources ?? []) {
          context.charge("includes", 1);
          await context.decodeUtf8To("bytes" in source ? [source.bytes] : source.chunks, async chunk => {
            await result.text.append(target, await result.text.from([chunk]));
          }, ["inputBytes", "resourceBytes"]);
        }
      }
      return result;
    } catch (error) {try {await result.close();} catch { /* Preserve acquisition failure. */ } throw error;}
  }
  close(): Promise<void> {
    this.closing ??= this.storage.close().finally(this.release);
    return this.closing;
  }
  private async *slice(value: TextRange, start = 0, end = value.units): AsyncGenerator<string> {
    let position = 0;
    for await (const chunk of this.text.chunks(value)) {
      const from = Math.max(0, start - position), to = Math.min(chunk.length, end - position);
      if (to > from) yield chunk.slice(from, to);
      position += chunk.length;
      if (position >= end) break;
    }
  }
  private async find(value: TextRange, needle: string): Promise<number> {
    let pending = "", position = 0;
    for await (const chunk of this.text.chunks(value)) {
      const text = pending + chunk, found = text.indexOf(needle);
      if (found >= 0) return position - pending.length + found;
      position += chunk.length; pending = text.slice(-Math.min(needle.length - 1, text.length));
    }
    return -1;
  }
  private async replace(value: TextRange, needle: string, prefix: string, include: TextRange, suffix: string): Promise<TextRange> {
    const position = await this.find(value, needle);
    if (position < 0) return value;
    const before = await this.text.from(this.slice(value, 0, position));
    const after = await this.text.from(this.slice(value, position + needle.length));
    return this.text.from((async function* (this: RetainedIncludes) {
      yield* this.text.chunks(before);
      yield prefix;
      let dollar = false, output = "";
      for await (const chunk of this.text.chunks(include)) for (const char of chunk) {
        if (dollar) {
          dollar = false;
          if (char === "$" || char === "&") output += char === "$" ? "$" : needle;
          else if (char === "`" || char === "'") {
            if (output) {yield output; output = "";}
            yield* this.text.chunks(char === "`" ? before : after);
          } else output += "$" + char;
        } else if (char === "$") dollar = true;
        else output += char;
        if (output.length >= 4096) {yield output; output = "";}
      }
      if (dollar) output += "$";
      if (output) yield output;
      yield suffix;
      yield* this.text.chunks(after);
    }).call(this));
  }
  async render(source: AsyncIterable<string>): Promise<() => AsyncIterable<string>> {
    let value = await this.text.from(source);
    if (!this.before.units && !this.after.units && !this.header.units) return () => this.text.unicodeChunks(value);
    if (await this.find(value, "<body>") >= 0) {
      value = await this.replace(value, "<body>\n", "<body>\n", this.before, "");
      value = await this.replace(value, "</body>", "", this.after, "</body>");
      value = await this.replace(value, "</head>", "", this.header, "</head>");
    } else {
      const text = this.text, before = this.before, after = this.after, body = value;
      value = await text.from((async function* () {yield* text.chunks(before); yield* text.chunks(body); yield* text.chunks(after);})());
    }
    return () => this.text.unicodeChunks(value);
  }
}
