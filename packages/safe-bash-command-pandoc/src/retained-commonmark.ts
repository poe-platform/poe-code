import {mergeRetainedMetadata} from "./retained-metadata.js";
import {BackedText} from "./backed-text.js";
import {BackedTextSet} from "./backed-text-set.js";
import {RetainedOrigins} from "./retained-origins.js";
import {AstError} from "./ast.js";
import {PandocError} from "./errors.js";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {RetainedSourceText, type SourceRange} from "./retained-source-text.js";
import {RetainedRtfAst} from "./retained-rtf-ast.js";
import {RetainedCommonMarkBlocks} from "./retained-commonmark-blocks.js";
import {assembleRetainedCommonMark} from "./retained-commonmark-document.js";
import {readRetainedYamlMetadata} from "./retained-yaml-metadata.js";
import {BackedJson} from "./backed-json.js";
import {readRetainedJson} from "./retained-json.js";
import {retainInput} from "./retained-input.js";
import type {ExecutionContext} from "./execution.js";
import type {InputSource, WorkingStorageOptions} from "./types.js";

/** Recognize precisely the existing frontmatter envelope using source spans.
 * Ordinary Markdown, including arbitrarily long first lines, stays backed. */
async function frontmatter(source: RetainedSourceText, range: SourceRange, context: ExecutionContext): Promise<{yaml: SourceRange; end: number} | undefined> {
  const line = async (start: number) => {
    const end = await source.find({start, end: range.end}, "\n");
    return end < 0 ? undefined : {start, end};
  };
  const marker = async (range: SourceRange, closing = false) => {
    if (!await source.starts(range, "---") && !(closing && await source.starts(range, "..."))) return false;
    for (let i = range.start + 3; i < range.end; i++) {
      if (![" ", "\t"].includes(await source.unit(i))) return false;
      await context.cooperate();
    }
    return true;
  };
  if (!await source.starts(range, "---")) return;
  const first = await line(range.start);
  if (!first || !await marker(first)) return;
  const begin = first.end + 1; let start = begin, count = 0;
  while (start < range.end) {
    const current = await line(start); if (!current) return;
    if (await marker(current, true)) {
      if (!count) return;
      const tail = await source.trim({start: current.end + 1, end: range.end});
      return tail.start < tail.end ? {yaml: {start: begin, end: start}, end: current.end + 1} : undefined;
    }
    const initial = await source.unit(start);
    if (initial !== " " && initial !== "\t") {
      const letter = (char: string) => char >= "a" && char <= "z" || char >= "A" && char <= "Z" || char === "_";
      if (!letter(initial)) return;
      let cursor = start + 1;
      for (; cursor < current.end; cursor++) {
        const char = await source.unit(cursor); if (!letter(char) && !(char >= "0" && char <= "9") && char !== "-") break;
        await context.cooperate();
      }
      while (cursor < current.end && [" ", "\t"].includes(await source.unit(cursor))) {cursor++; await context.cooperate();}
      if (await source.unit(cursor) !== ":") return;
    }
    count++; start = current.end + 1;
  }
  return;
}

/** Markdown source, YAML frontmatter and joined operands use caller storage. */
export async function readRetainedCommonMark(inputs: readonly InputSource[], context: ExecutionContext, working: WorkingStorageOptions,
  extensions: Readonly<Record<string, boolean>>, fileScope = false, onReaderError?: (error: PandocError) => void) {
  const cache = working.cacheBytes ?? 1048576;
  if (!Number.isSafeInteger(cache) || cache < 16384 || cache % 16384) context.fail("E_OPTION", "Working storage cacheBytes must be a positive multiple of 16384");
  if (typeof working.directory !== "string" || !working.directory.startsWith("/")) context.fail("E_OPTION", "Working storage requires an absolute caller filesystem directory");
  const owner = {fs: working.fs, cwd: working.directory, env: {}, signal: context.signal ?? new AbortController().signal};
  const sourceStore = new PagedStorage(owner, cache / 16384), tape = new PagedStorage(owner, cache / 16384), nodes = new PagedStorage(owner, cache / 16384), wireStore = new PagedStorage(owner, cache / 16384);
  const combined = new PagedStorage(owner, cache / 16384);
  const stores = [sourceStore, tape, nodes, wireStore, combined]; let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {let error: unknown; for (const store of stores) {try {await store.close();} catch (reason) {error ??= reason;}} release(); if (error) throw error;})();
  const release = context.onClose(close);
  try {
    const source = new RetainedSourceText(sourceStore, units => context.cooperate(units));
    // Fixed-size operand descriptors stay backed, including joined source lines.
    const descriptors = tape.allocate(inputs.length * 32);
    const put = async (index: number, values: readonly number[]) => {
      const bytes = new Uint8Array(32), view = new DataView(bytes.buffer);
      values.forEach((value, offset) => view.setFloat64(offset * 8, value, true));
      await tape.write(descriptors + index * 32, bytes);
    };
    const get = async (index: number) => {
      const bytes = await tape.read(descriptors + index * 32, 32), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      return {start: view.getFloat64(0, true), end: view.getFloat64(8, true), line: view.getFloat64(16, true), blocks: view.getFloat64(24, true)};
    };
    for (const [index, input] of inputs.entries()) {
      const start = source.length;
      context.charge("references", 1);
      await context.decodeUtf8To(retainInput("bytes" in input ? [input.bytes] : input.chunks, context, tape, ["inputBytes"], true), async chunk => {await source.append([chunk]);}, [], false);
      context.charge("retainedBytes", (source.length - start) * 2);
      await put(index, [start, source.length, 1]);
    }
    let range = {start: 0, end: source.length};
    if (!fileScope) {
      const joinedStart = source.length; let line = 1;
      for (let index = 0; index < inputs.length; index++) {
        const part = await get(index);
        if (index) {context.charge("retainedBytes", 2); await source.append(["\n"]); line++;}
        await put(index, [part.start, part.end, line]);
        context.charge("retainedBytes", (part.end - part.start) * 2 + 2);
        for await (const chunk of source.chunks(part)) {
          await source.append([chunk]);
          for (const char of chunk) if (char === "\n") line++;
        }
        if (part.end === part.start || await source.unit(part.end - 1) !== "\n") {await source.append(["\n"]); line++;}
      }
      range = {start: joinedStart, end: source.length};
      context.charge("retainedBytes", (range.end - range.start) * 2);
      context.charge("retainedBytes", (range.end - range.start) * 3);
    }
    let readerIndex = 0;
    const sourceAt = async (line: number) => {
      if (fileScope) return readerIndex;
      let low = 0, high = inputs.length;
      while (low < high) {const middle = Math.floor((low + high) / 2); if ((await get(middle)).line <= line) low = middle + 1; else high = middle;}
      return Math.max(0, low - 1);
    };
    const originFor = (source: number) => {
      const input = inputs[source - 1]!;
      return fileScope ? input : {...input, source: input.source ?? `input[${source - 1}]`};
    };
    const originStorage = new PagedStorage(owner, cache / 16384);
    const releaseOrigins = context.onClose(() => originStorage.close());
    const astOrigins = new RetainedOrigins(originStorage, units => context.cooperate(units)); astOrigins.clear();
    const origins = new RetainedOrigins(originStorage, units => context.cooperate(units)); origins.clear();
    const parse = async (range: SourceRange) => {
      try {
        astOrigins.clear(); origins.clear();
        const envelope = await frontmatter(source, range, context);
        const metadata = await readRetainedYamlMetadata(source, envelope?.yaml, tape, wireStore, units => context.cooperate(units));
        if (envelope && metadata.parsed) range = {start: envelope.end, end: range.end};
        const parser = new RetainedCommonMarkBlocks(source, tape, context, inputs[readerIndex]!.base, extensions); await parser.parse(range);
        const ast = new RetainedRtfAst(nodes, units => context.cooperate(units));
        const blocks = await assembleRetainedCommonMark(parser, ast, tape, context, {...extensions,
          citations: !!(extensions.citations || await metadata.tree.property(metadata.tree.rootPosition, "bibliography") !== undefined || await metadata.tree.property(metadata.tree.rootPosition, "references") !== undefined)}, async (target, line) => {await astOrigins.seed(target.position, await sourceAt(line) + 1);});
        if (envelope) {
          try {await metadata.validate();}
          catch (error) {if (error instanceof AstError) throw new PandocError(error.code, "convert", error.message, undefined, error.path); throw error;}
        }
        const tree = new BackedJson(wireStore, units => context.cooperate(units));
        await tree.begin("object"); await tree.key("pandoc-api-version"); await tree.value([1, 23, 1, 2]);
        await tree.key("meta"); await metadata.write(tree); await tree.key("blocks"); await ast.write(blocks, tree, async (value, position) => {const source = await astOrigins.source(value.position); if (source) await origins.seed(position, source);}); await tree.end();
        const document = await readRetainedJson({chunks: tree.chunks()}, context, working, false);
        await origins.transfer(tree, document.tree);
        return document;
      } catch (error) {
        if (error instanceof PandocError && error.code !== "E_IO" && error.code !== "E_CANCELLED") {
          const parts = error.location?.split(":") ?? [], line = Number(parts[0]);
          const numeric = parts.length === 2 && Number.isSafeInteger(line) && line > 0 && Number.isSafeInteger(Number(parts[1]));
          const index = numeric ? await sourceAt(line) : readerIndex, origin = originFor(index + 1);
          // Session.call latches its first failure; expose qualified reader errors
          // to the outer API boundary without mutating that failure.
          if (origin.source) onReaderError?.(new PandocError(error.code, "convert", error.message, error.format,
            numeric ? `${origin.source}:${line - (await get(index)).line + 1}:${parts[1]}` : `${origin.source}:${error.location ?? "1:1"}`));
        }
        throw error;
      }
    };
    let document;
    if (!fileScope || inputs.length === 1) document = await parse(range);
    else {
      const encoder = new TextEncoder();
      const empty = encoder.encode('{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[]}');
      let metadata = await readRetainedJson({bytes: empty}, context, working, false, false);
      const text = new BackedText(tape, units => context.cooperate(units)), keys = new BackedTextSet(tape, text);
      const begin = combined.allocate(0); let length = 0, count = 0;
      const append = async (bytes: Uint8Array) => {await combined.append(bytes); length += bytes.length;};
      await append(encoder.encode("["));
      try {
        for (readerIndex = 0; readerIndex < inputs.length; readerIndex++) {
          const descriptor = await get(readerIndex), part = await parse(descriptor);
          try {
            const blocks = (await part.tree.property(part.tree.rootPosition, "blocks"))!;
            const blockCount = (await part.tree.describe(blocks)).children;
            await put(readerIndex, [descriptor.start, descriptor.end, 1, blockCount]);
            context.charge("references", blockCount);
            for await (const block of part.tree.children(blocks)) {
              if (count++) await append(encoder.encode(","));
              for await (const bytes of part.tree.chunks(block, part.order)) await append(bytes);
            }
            const root = (await part.tree.property(part.tree.rootPosition, "meta"))!;
            const end = (await part.tree.describe(root)).end;
            for (let key = root + 32; key < end;) {
              const value = (await part.tree.describe(key)).end;
              const range = await text.from(part.tree.scalarChunks(key));
              if (await keys.has(range)) {
                let name = ""; for await (const chunk of text.chunks(range)) name += chunk;
                context.report({code: "W_METADATA_CONFLICT", operation: "convert", message: `Later metadata replaces ${name}`, location: `input[${readerIndex}].metadata.${name}`});
              } else {context.charge("references", 1); await keys.add(range);}
              key = (await part.tree.describe(value)).end;
            }
            const next = await mergeRetainedMetadata(metadata, {tree: part.tree, root, typed: true}, context, working);
            await metadata.close(); metadata = next;
          } finally {await part.close();}
        }
        await append(encoder.encode("]"));
        document = await readRetainedJson({chunks: (async function* () {
          yield encoder.encode('{"pandoc-api-version":[1,23,1,2],"meta":');
          yield* metadata.tree.chunks((await metadata.tree.property(metadata.tree.rootPosition, "meta"))!, metadata.order);
          yield encoder.encode(',"blocks":');
          for (let offset = 0; offset < length; offset += 16384) yield await combined.read(begin + offset, Math.min(16384, length - offset));
          yield encoder.encode("}");
        })()}, context, working, false, false);
      } finally {await metadata.close();}
      origins.clear();
      const blocks = (await document.tree.property(document.tree.rootPosition, "blocks"))!;
      let index = 0, remaining = (await get(0)).blocks;
      for await (const block of document.tree.children(blocks)) {
        while (!remaining) remaining = (await get(++index)).blocks;
        remaining--;
        const end = (await document.tree.describe(block)).end;
        for (let node = block; node < end;) {
          const header = await document.tree.describe(node);
          if (header.kind === "object") {
            const tag = await document.tree.property(node, "t");
            if (tag !== undefined && await document.tree.smallText(tag, 5) === "Image") {
              let target = (await document.tree.property(node, "c"))! + 32;
              for (let i = 0; i < 2; i++) target = (await document.tree.describe(target)).end;
              await origins.seed(target + 32, index + 1);
            }
          }
          node = header.kind === "array" || header.kind === "object" ? node + 32 : header.end;
          await context.cooperate();
        }
      }
    }
    await close(); return {...document, referencesAggregated: fileScope && inputs.length > 1, origins, originFor, async closeResources() {
      try {await originStorage.close();} finally {releaseOrigins();}
    }};
  } catch (error) {try {await close();} catch { /* Preserve the conversion failure. */ } throw error;}
}
