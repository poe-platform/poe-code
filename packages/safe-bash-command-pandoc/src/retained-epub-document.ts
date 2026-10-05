import {PagedStorage} from "safe-bash-io-engine/storage";
import {BackedJson} from "./backed-json.js";
import {readRetainedEpubBook} from "./epub-retained-book.js";
import {readRetainedJson} from "./retained-json.js";
import {PandocError} from "./errors.js";
import type {RetainedAstUsage} from "./retained-ast-budgets.js";
import type {ExecutionContext} from "./execution.js";
import type {InputSource, WorkingStorageOptions} from "./types.js";

/** Retire the temporary wire tape before publication. The validated document,
 * archive and caller-backed resource index remain owned until writers finish. */
export async function readRetainedEpubDocument(input: InputSource, context: ExecutionContext, working: WorkingStorageOptions) {
  const owner = {fs: working.fs, cwd: working.directory, env: {}, signal: context.signal ?? new AbortController().signal};
  const pages = (working.cacheBytes ?? 1048576) / 16384;
  const storage = new PagedStorage(owner, pages), wire = new PagedStorage(owner, pages);
  let book: Awaited<ReturnType<typeof readRetainedEpubBook>> | undefined;
  let document: Awaited<ReturnType<typeof readRetainedJson>> | undefined, closing: Promise<void> | undefined;
  const close = (): Promise<void> => closing ??= (async () => {
    let failure: {reason: unknown} | undefined;
    for (const resource of [document, book?.archive, wire, storage]) try {await resource?.close();} catch (reason) {failure ??= {reason};}
    release(); if (failure) throw failure.reason;
  })();
  const release = context.onClose(close);
  try {
    if ("bytes" in input) {context.charge("inputBytes", input.bytes.length); context.charge("compressedBytes", input.bytes.length);}
    book = await readRetainedEpubBook(input, storage, context);
    const tree = new BackedJson(wire, units => context.cooperate(units));
    await tree.begin("object"); await tree.key("pandoc-api-version"); await tree.value([1, 23, 1, 2]);
    await tree.key("meta"); await book.ast.write(book.metadata, tree);
    await tree.key("blocks"); await book.ast.write(book.blocks, tree); await tree.end();
    document = await readRetainedJson({chunks: tree.chunks()}, context, working, false);
    const reserve = async (usage?: RetainedAstUsage, aggregate = false): Promise<void> => {
      let total = 0, nodes = usage?.nodes, text = usage?.text;
      const node = (path: string, count = 1, reserve = true) => {
        if (nodes === undefined) return;
        if (nodes + count > context.limits.nodes) throw new PandocError("E_LIMIT", "convert", `${path}: AST budget exceeded`, undefined, path);
        if (reserve) {nodes += count; if (!aggregate) context.charge("nodes", count);}
      };
      const string = (path: string, length: number) => {
        if (text === undefined) return;
        text += length;
        if (text > context.limits.text) throw new PandocError("E_LIMIT", "convert", `${path}: AST budget exceeded`, undefined, path);
        if (!aggregate) context.charge("text", length);
        context.charge("retainedBytes", length * 2);
      };
      node("$.resources", book!.resourceCount, false);
      let index = 0;
      for await (const id of book!.mediaParts) {
        const path = `$.resources[${index++}]`;
        node(path); node(path); string(path, 2); node(path + ".id"); string(path + ".id", id.length);
        node(path); string(path, 5); node(path + ".bytes");
        const record = (await book!.archive.partRecord(id))!;
        const length = record.length;
        total += length;
        if (!Number.isSafeInteger(total) || total > context.limits.resourceBytes) throw new PandocError("E_LIMIT", "convert", `${path}.bytes: AST budget exceeded`, undefined, `${path}.bytes`);
        if (!aggregate) {context.charge("resourceBytes", length); context.charge("resources", 1);}
        context.charge("retainedBytes", length); await context.cooperate();
      }
      for (const [key, length] of [["language", book!.language ? (await book!.ast.range(book!.language)).units : undefined], ["direction", book!.direction?.length]] as const) {
        if (length === undefined) continue;
        node("$"); string("$", key.length); node("$." + key); string("$." + key, length);
      }
    };
    await reserve(document.normalizedUsage); await wire.close();
    const get = async (id: string) => {
      if (!await book!.mediaParts.has(id)) return undefined;
      const record = await book!.archive.partRecord(id);
      if (!record || record instanceof Uint8Array) throw new PandocError("E_IO", "convert", "Missing retained EPUB media");
      return {identity: record.position, chunks: () => book!.archive.partChunks(record)};
    };
    return {document, resources: {count: book.resourceCount, maxIdLength: book.maxIdLength, reserve, get}, close};
  } catch (error) {await close().catch(() => {}); throw error;}
}
