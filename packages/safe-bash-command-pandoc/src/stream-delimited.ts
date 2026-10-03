import {PagedStorage} from "safe-bash-io-engine/storage";
import {DelimitedParser} from "./delimited-parser.js";
import {PandocError} from "./errors.js";
import type {ExecutionContext} from "./execution.js";
import type {InputSource, WorkingStorageOptions} from "./types.js";

/** Decode one document, preserving BOM and newline semantics across chunk edges. */
class DocumentDecoder {
  private readonly decoder = new TextDecoder("utf-8", {fatal: true});
  private cr = false;
  constructor(private readonly accept: (text: string) => Promise<void>) {}
  async push(bytes?: Uint8Array): Promise<void> {
    let decoded: string;
    try {decoded = this.decoder.decode(bytes, {stream: bytes !== undefined});}
    catch {throw new PandocError("E_ENCODING", "convert", "Invalid UTF-8 input");}
    let text = "";
    for (const char of decoded) {
      if (this.cr) {
        text += "\n";
        this.cr = false;
        if (char === "\n") continue;
      }
      if (char === "\r") this.cr = true;
      else text += char;
    }
    if (bytes === undefined && this.cr) {text += "\n"; this.cr = false;}
    if (text) await this.accept(text);
  }
}

/** Parse before publishing. The tape and table dimensions live in caller storage;
 * no input, field, row, document tree or output grows a resident collection. */
export async function streamDelimitedHtml(
  inputs: readonly InputSource[], format: "csv" | "tsv", context: ExecutionContext,
  working: WorkingStorageOptions, options: {readonly ascii?: boolean; readonly eol?: "lf" | "crlf" | "native"}
): Promise<void> {
  const cacheBytes = working.cacheBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(cacheBytes) || cacheBytes < 16384 || cacheBytes % 16384 !== 0)
    context.fail("E_OPTION", "Working storage cacheBytes must be a positive multiple of 16384");
  if (typeof working.directory !== "string" || !working.directory.startsWith("/"))
    context.fail("E_OPTION", "Working storage requires an absolute caller filesystem directory");
  const storage = new PagedStorage({fs: working.fs, cwd: working.directory, env: {}, signal: context.signal ?? new AbortController().signal}, cacheBytes / 16384);
  const release = context.onClose(() => storage.close());
  let failure: {reason: unknown} | undefined;
  try {
    // Headers are fixed-size records followed immediately by the original bytes.
    // Keep per-document dimensions on the tape too, not in an in-memory index.
    const first = storage.allocate(0);
    for (const input of inputs) {
      const header = storage.allocate(24);
      let length = 0;
      const decoder = new DocumentDecoder(async () => {});
      await context.consume("bytes" in input ? [input.bytes] : input.chunks, async bytes => {
        for (let offset = 0; offset < bytes.length; offset += 16384) {
          const chunk = bytes.subarray(offset, offset + 16384);
          await storage.append(chunk);
          await decoder.push(chunk);
          length += chunk.length;
          await context.cooperate();
        }
      }, ["inputBytes"]);
      await decoder.push();
      const bytes = new Uint8Array(24);
      new DataView(bytes.buffer).setFloat64(0, length, true);
      await storage.write(header, bytes);
    }
    const replay = async (position: number, length: number, parser: DelimitedParser): Promise<void> => {
      const decoder = new DocumentDecoder(text => parser.accept(text));
      for (let offset = 0; offset < length; offset += 16384) {
        await decoder.push(await storage.read(position + offset, Math.min(16384, length - offset)));
        await context.cooperate();
      }
      await decoder.push();
      await parser.finish();
    };
    let position = first;
    let nul = false;
    for (const input of inputs) {
      const bytes = await storage.read(position, 24);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      const length = view.getFloat64(0, true);
      const parser = new DelimitedParser(format, context, {async text(text) {if (text.includes("\0")) nul = true;}});
      try {await replay(position + 24, length, parser);}
      catch (error) {
        if (error instanceof PandocError && error.code === "E_PARSE" && (input.source || input.base))
          throw new PandocError(error.code, "convert", error.message, error.format, `${input.source ?? input.base}:${error.location ?? "1:1"}`);
        throw error;
      }
      context.charge("tableCells", parser.rows * parser.width);
      view.setFloat64(8, parser.rows, true);
      view.setFloat64(16, parser.width, true);
      await storage.write(position, bytes);
      position += 24 + length;
    }
    if (nul) throw new PandocError("E_CAPABILITY", "convert", "NUL cannot be represented in HTML", "html5");

    let output = "";
    let measuring = false;
    let outputLength = 0;
    const encoder = new TextEncoder();
    const flush = async () => {
      if (!output) return;
      const bytes = encoder.encode(output);
      output = "";
      if (measuring) {outputLength += bytes.length; context.bound("outputBytes", outputLength);}
      else await context.emit(bytes);
    };
    const add = async (text: string) => {
      for (const char of text) {
        output += char === "\n" && options.eol === "crlf" ? "\r\n" : char;
        if (output.length >= 4096) await flush();
      }
    };
    // A finite output budget must reject before publishing any prefix. Replay
    // the same renderer into a byte count, retaining only its normal chunk.
    for (const measurement of Number.isFinite(context.limits.outputBytes) ? [true, false] : [false]) {
      measuring = measurement;
      position = first;
      for (let index = 0; index < inputs.length; index++) {
        const bytes = await storage.read(position, 24);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
        const length = view.getFloat64(0, true), rows = view.getFloat64(8, true), width = view.getFloat64(16, true);
        if (rows) {
          await add("<table>\n<colgroup>");
          for (let column = 0; column < width; column++) {await add("<col>"); await context.cooperate();}
          await add("</colgroup>\n<thead>\n");
          let row = 0, column = 0;
          let opened = false;
          const open = async () => {
            if (opened) return;
            if (!column) await add("<tr>");
            await add(row ? "<td>" : '<th scope="col">');
            opened = true;
          };
          const field = async () => {
            await open();
            await add(row ? "</td>" : "</th>");
            column++;
            opened = false;
          };
          const parser = new DelimitedParser(format, context, {
            async text(text) {
              await open();
              let escaped = "";
              for (const char of text) {
                escaped += char === "\n" ? "<br>" : char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;"
                  : options.ascii && char.codePointAt(0)! > 127 ? `&#${char.codePointAt(0)};` : char;
                if (escaped.length >= 4096) {await add(escaped); escaped = "";}
              }
              if (escaped) await add(escaped);
            },
            field,
            async record() {
              while (column < width) {await field(); await context.cooperate();}
              await add("</tr>\n");
              if (!row) await add("</thead>\n<tbody>\n");
              row++;
              column = 0;
            }
          });
          await replay(position + 24, length, parser);
          await add("</tbody>\n</table>\n");
        }
        position += 24 + length;
      }
      await flush();
    }
    await context.completeOutput();
  } catch (reason) {failure = {reason};}
  try {await storage.close();} catch (reason) {failure ??= {reason};}
  finally {release();}
  if (failure) throw failure.reason;
}
