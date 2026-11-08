import {reserveRetainedAstBudgets} from "./retained-ast-budgets.js";
import type {RetainedOptions} from "./retained-options.js";
import {BackedJson} from "./backed-json.js";
import {streamRetainedDocument} from "./stream-retained.js";
import {backedJsonOrder} from "./backed-json-order.js";
import {appendDelimitedJson} from "./backed-delimited-json.js";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {DelimitedParser} from "./delimited-parser.js";
import {PandocError} from "./errors.js";
import type {ExecutionContext} from "./execution.js";
import type {ConversionOptions, InputSource, WorkingStorageOptions} from "./types.js";

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
export async function streamDelimited(
  inputs: readonly InputSource[], format: "csv" | "tsv", target: "html5" | "json" | "plain" | "commonmark" | "gfm" | "rst" | "latex" | "rtf" | "odt", context: ExecutionContext,
  working: WorkingStorageOptions, options: ConversionOptions, includes?: RetainedOptions, readingInput?: (source?: string) => void
): Promise<void> {
  const retained = Number.isFinite(context.limits.retainedBytes);
  const references = Number.isFinite(context.limits.references) || retained;
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
    if (!inputs.length && !retained) {
      const tree = new BackedJson(storage, units => context.cooperate(units));
      await tree.value({blocks: [], meta: {}});
      await reserveRetainedAstBudgets(tree, await backedJsonOrder(tree, storage, units => context.cooperate(units)), context, undefined, true);
    }
    for (const input of inputs) {
      if (references) context.charge("references", 1);
      const header = storage.allocate(24);
      let length = 0;
      const decoder = Number.isFinite(context.limits.text) || references ? undefined : new DocumentDecoder(async () => {});
      await context.consume("bytes" in input ? [input.bytes] : input.chunks, async bytes => {
        if (references) {
          const blocks = Math.ceil((length + bytes.length) / 4096) - Math.ceil(length / 4096);
          for (let index = 0; index < blocks; index++) {
            if (retained) context.charge("retainedBytes", Math.min(4096, context.limits.inputBytes - (Math.ceil(length / 4096) + index) * 4096));
            context.charge("references", 1);
          }
        }
        for (let offset = 0; offset < bytes.length; offset += 16384) {
          const chunk = bytes.subarray(offset, offset + 16384);
          await storage.append(chunk);
          await decoder?.push(chunk);
          length += chunk.length;
          await context.cooperate();
        }
      }, ["inputBytes"]);
      // Native acquisition flattens the input, then the decoder owns one copy.
      if (retained) {context.charge("retainedBytes", length); context.charge("retainedBytes", length);}
      let decodedUnits = 0;
      if (decoder) await decoder.push();
      else await context.decodeUtf8To((async function* () {
        for (let offset = 0; offset < length; offset += 16384) yield await storage.read(header + 24 + offset, Math.min(16384, length - offset));
      })(), async text => {decodedUnits += text.length;}, [], !retained);
      if (retained) context.charge("retainedBytes", decodedUnits * 2);
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
      readingInput?.(input.source);
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
      if (Number.isFinite(context.limits.nodes) || references) {
        let nodes = 1, word = 0, nonempty = false, cell = false, fields = 0;
        const beginCell = () => {if (!cell) {if (references) context.charge("references", 1); if (retained) context.charge("retainedBytes", 128); cell = true;}};
        const node = (units: number) => {context.bound("nodes", ++nodes); if (references) context.charge("references", 1); if (retained) context.charge("retainedBytes", units * 2 + 32);};
        await replay(position + 24, length, new DelimitedParser(format, context, {
          async text(text) {
            beginCell();
            for (const char of text) {
              if (char === " " || char === "\n") {if (word) node(word); node(0); word = 0;}
              else word += char.length;
              nonempty = true;
            }
          },
          async field() {
            beginCell(); if (word) node(word); if (nonempty) context.bound("nodes", ++nodes);
            word = 0; nonempty = false; cell = false; fields++;
          },
          async record() {
            if (references) {
              for (let column = fields; column < parser.width; column++) {context.charge("references", 1); if (retained) context.charge("retainedBytes", 128);}
              context.charge("references", 1);
            }
            fields = 0;
          }
        }, false));
        if (references && parser.rows) {context.charge("references", parser.width); if (retained) context.charge("retainedBytes", parser.width * 64);}
      }
      if (Number.isFinite(context.limits.depth) || Number.isFinite(context.limits.nodes) || Number.isFinite(context.limits.text) || references) {
        // Depth can fail inside the generated cell structure before later
        // attribute/span charges. Replay that normalization in caller storage.
        const pages = new PagedStorage({fs: working.fs, cwd: working.directory, env: {}, signal: context.signal ?? new AbortController().signal}, cacheBytes / 16384);
        const retire = context.onClose(() => pages.close());
        try {
          const tree = new BackedJson(pages, units => context.cooperate(units));
          await tree.begin("object");
          await tree.key("meta"); await tree.value({});
          await tree.key("blocks"); await tree.begin("array");
          if (parser.rows) await appendDelimitedJson(tree, parser.width, events => replay(position + 24, length, new DelimitedParser(format, context, events, false)));
          await tree.end(); await tree.end();
          await reserveRetainedAstBudgets(tree, await backedJsonOrder(tree, pages, units => context.cooperate(units)), context);
        } finally {try {await pages.close();} finally {retire();}}
      } else {
        for (let cell = 0; cell < parser.rows * parser.width; cell++) {context.charge("tableCells", 1); await context.cooperate();}
        if (parser.rows && Number.isFinite(context.limits.attributes)) {
          // CSV/TSV emit only empty attribute tuples. Reserve them in the same
          // order as AST normalization, deriving paths only when a bound fails.
          let attributes = 0;
          const reserve = async (path: () => string): Promise<void> => {
            if (++attributes > context.limits.attributes) {
              const location = "$.blocks[0].c" + path();
              throw new PandocError("E_LIMIT", "convert", `${location}: AST budget exceeded`, undefined, location);
            }
            context.charge("attributes", 1);
            await context.cooperate();
          };
          await reserve(() => "[0]");
          await reserve(() => "[3][0]");
          for (let row = 0; row < parser.rows; row++) {
            if (row === 1) await reserve(() => "[4][0][0]");
            const path = () => row ? `[4][0][3][${row - 1}]` : "[3][1][0]";
            await reserve(() => path() + "[0]");
            for (let column = 0; column < parser.width; column++) await reserve(() => path() + `[1][${column}][0]`);
          }
          if (parser.rows === 1) await reserve(() => "[4][0][0]");
          await reserve(() => "[5][0]");
        }
      }
      readingInput?.();
      if (references && parser.rows) context.charge("references", 1);
      view.setFloat64(8, parser.rows, true);
      view.setFloat64(16, parser.width, true);
      await storage.write(position, bytes);
      position += 24 + length;
    }
    readingInput?.();
    if (!references && nul && target === "html5" && !options.filters?.length) throw new PandocError("E_CAPABILITY", "convert", "NUL cannot be represented in HTML", "html5");

    if (references || includes || target !== "html5" || options.metadataFiles?.length || options.filters?.length || options.standalone || options.embedResources || options.toc || options.numberSections || options.stripComments || options.shiftHeadingLevelBy) {
      const tree = new BackedJson(storage, units => context.cooperate(units));
      await tree.begin("object");
      await tree.key("pandoc-api-version"); await tree.value([1, 23, 1, 2]);
      await tree.key("meta"); await tree.value({});
      await tree.key("blocks"); await tree.begin("array");
      position = first;
      for (let index = 0; index < inputs.length; index++) {
        const bytes = await storage.read(position, 24);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
        const length = view.getFloat64(0, true), rows = view.getFloat64(8, true), width = view.getFloat64(16, true);
        if (rows) await appendDelimitedJson(tree, width, events => replay(position + 24, length, new DelimitedParser(format, context, events, false)));
        position += 24 + length;
      }
      await tree.end(); await tree.end();
      await streamRetainedDocument(async () => ({
        referencesAggregated: true, normalizedUsage: {nodes: 0, text: 0}, tree,
        order: await backedJsonOrder(tree, storage, units => context.cooperate(units)),
        async *chunks(eol) {
          yield* tree.chunks();
          yield new TextEncoder().encode(eol === "crlf" ? "\r\n" : "\n");
        },
        async close() {try {await storage.close();} finally {release();}}
      }), context, working, options, target, undefined, includes);
      return;
    } else {
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
    }
  } catch (reason) {failure = {reason};}
  try {await storage.close();} catch (reason) {failure ??= {reason};}
  finally {release();}
  if (failure) throw failure.reason;
  await context.completeOutput();
}
