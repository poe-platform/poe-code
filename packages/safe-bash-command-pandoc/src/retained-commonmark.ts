import {normalizeDocumentCooperatively, AstError} from "./ast.js";
import {PandocError} from "./errors.js";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {RetainedSourceText, type SourceRange} from "./retained-source-text.js";
import {RetainedRtfAst} from "./retained-rtf-ast.js";
import {RetainedCommonMarkBlocks} from "./retained-commonmark-blocks.js";
import {assembleRetainedCommonMark} from "./retained-commonmark-document.js";
import {parseCommonMarkMetadata} from "./commonmark.js";
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

/** Single-operand Markdown source and body use caller storage. YAML frontmatter
 * retains the existing native parser boundary; it is not a full-memory claim. */
export async function readRetainedCommonMark(input: InputSource, context: ExecutionContext, working: WorkingStorageOptions,
  extensions: Readonly<Record<string, boolean>>, fileScope = false, onReaderStarted?: () => void) {
  const cache = working.cacheBytes ?? 1048576;
  if (!Number.isSafeInteger(cache) || cache < 16384 || cache % 16384) context.fail("E_OPTION", "Working storage cacheBytes must be a positive multiple of 16384");
  if (typeof working.directory !== "string" || !working.directory.startsWith("/")) context.fail("E_OPTION", "Working storage requires an absolute caller filesystem directory");
  const owner = {fs: working.fs, cwd: working.directory, env: {}, signal: context.signal ?? new AbortController().signal};
  const sourceStore = new PagedStorage(owner, cache / 16384), tape = new PagedStorage(owner, cache / 16384), nodes = new PagedStorage(owner, cache / 16384), wireStore = new PagedStorage(owner, cache / 16384);
  const stores = [sourceStore, tape, nodes, wireStore]; let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {let error: unknown; for (const store of stores) {try {await store.close();} catch (reason) {error ??= reason;}} release(); if (error) throw error;})();
  const release = context.onClose(close);
  try {
    const source = new RetainedSourceText(sourceStore, units => context.cooperate(units));
    context.charge("references", 1);
    await context.decodeUtf8To(retainInput("bytes" in input ? [input.bytes] : input.chunks, context, tape, ["inputBytes"], true), async chunk => {await source.append([chunk]);}, [], false);
    context.charge("retainedBytes", source.length * 2);
    let range = {start: 0, end: source.length};
    if (!fileScope) {
      context.charge("retainedBytes", source.length * 2 + 2);
      if (!source.length || await source.unit(source.length - 1) !== "\n") await source.append(["\n"]);
      range = {start: 0, end: source.length};
      context.charge("retainedBytes", source.length * 2);
      context.charge("retainedBytes", source.length * 3);
    }
    onReaderStarted?.();
    const envelope = await frontmatter(source, range, context), metadata = {};
    if (envelope) {
      let yaml = ""; for await (const text of source.chunks(envelope.yaml)) yaml += text;
      if (parseCommonMarkMetadata(yaml, metadata)) range = {start: envelope.end, end: range.end};
    }
    const parser = new RetainedCommonMarkBlocks(source, tape, context, input.base, extensions); await parser.parse(range);
    const ast = new RetainedRtfAst(nodes, units => context.cooperate(units));
    const blocks = await assembleRetainedCommonMark(parser, ast, tape, context, {...extensions,
      citations: !!(extensions.citations || Object.hasOwn(metadata, "bibliography") || Object.hasOwn(metadata, "references"))});
    if (envelope) {
      try {await normalizeDocumentCooperatively({blocks: [], metadata, resources: []}, {}, units => context.cooperateFast(units));}
      catch (error) {if (error instanceof AstError) throw new PandocError(error.code, "convert", error.message, undefined, error.path); throw error;}
    }
    const tree = new BackedJson(wireStore, units => context.cooperate(units));
    await tree.begin("object"); await tree.key("pandoc-api-version"); await tree.value([1, 23, 1, 2]);
    await tree.key("meta"); await tree.value(metadata); await tree.key("blocks"); await ast.write(blocks, tree); await tree.end();
    const document = await readRetainedJson({chunks: tree.chunks()}, context, working, false);
    await close(); return document;
  } catch (error) {try {await close();} catch { /* Preserve the conversion failure. */ } throw error;}
}
