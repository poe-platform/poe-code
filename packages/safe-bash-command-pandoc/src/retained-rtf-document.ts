import {PagedStorage} from "safe-bash-io-engine/storage";
import {BackedJson} from "./backed-json.js";
import {RetainedRtfSyntax} from "./retained-rtf-syntax.js";
import {readRetainedRtf} from "./retained-rtf-reader.js";
import {readRetainedJson} from "./retained-json.js";
import type {ExecutionContext} from "./execution.js";
import type {InputSource, WorkingStorageOptions} from "./types.js";

/** Own reader resources independently of replaceable filter document generations.
 * Source syntax and the temporary wire tape retire before returning. */
export async function readRetainedRtfDocument(input: InputSource, context: ExecutionContext, working: WorkingStorageOptions) {
  const syntax = await RetainedRtfSyntax.acquire(input, context, working);
  const owner = {fs: working.fs, cwd: working.directory, env: {}, signal: context.signal ?? new AbortController().signal};
  const pages = (working.cacheBytes ?? 1048576) / 16384;
  const storage = new PagedStorage(owner, pages), wire = new PagedStorage(owner, pages);
  let document: Awaited<ReturnType<typeof readRetainedJson>> | undefined, closing: Promise<void> | undefined;
  const close = (): Promise<void> => closing ??= (async () => {
    let failure: {reason: unknown} | undefined;
    for (const resource of [document, syntax, wire, storage]) {
      try {await resource?.close();} catch (reason) {failure ??= {reason};}
    }
    release();
    if (failure) throw failure.reason;
  })();
  const release = context.onClose(close);
  try {
    const reader = await readRetainedRtf(syntax, storage, context);
    const tree = new BackedJson(wire, units => context.cooperate(units));
    await tree.begin("object");
    await tree.key("pandoc-api-version"); await tree.value([1, 23, 1, 2]);
    await tree.key("meta"); await tree.value({});
    await tree.key("blocks"); await reader.ast.write(reader.blocks, tree);
    await tree.end();
    document = await readRetainedJson({chunks: tree.chunks()}, context, working, false);
    await reader.reserveResources();
    await syntax.close(); await wire.close();
    return {document, resources: {count: reader.resourceCount, maxIdLength: `rtf-picture-${reader.resourceCount}.png`.length, get: reader.resource.bind(reader), reserve: reader.reserveResources.bind(reader)}, close};
  } catch (error) {
    try {await close();} catch { /* Preserve the original reader or storage error. */ }
    throw error;
  }
}
