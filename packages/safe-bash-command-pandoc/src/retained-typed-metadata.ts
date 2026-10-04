import {IntegerTable, PagedStorage} from "safe-bash-io-engine/storage";
import {BackedJson} from "./backed-json.js";
import {validateBackedPandoc} from "./backed-pandoc.js";
import {RetainedJsonOptions} from "./retained-json-options.js";
import type {ExecutionContext} from "./execution.js";
import type {ConversionOptions, WorkingStorageOptions} from "./types.js";

/** Admit SDK MetaValue nodes before input acquisition. Only enum positions from
 * the schema become wire constructors; authored strings and metadata keys do not.
 * Snapshot frames, enum indexes and the wire tape all use caller backing. */
export async function retainTypedMetadata(value: NonNullable<ConversionOptions["metadata"]>, context: ExecutionContext, working: WorkingStorageOptions, scratch: PagedStorage) {
  const snapshot = await RetainedJsonOptions.acquire(value, context, working, scratch, "ast");
  const storage = new PagedStorage({fs: working.fs, cwd: working.directory, env: {}, signal: context.signal ?? new AbortController().signal}, (working.cacheBytes ?? 1048576) / 16384);
  const release = context.onClose(() => close());
  let closing: Promise<void> | undefined;
  const close = () => closing ??= storage.close().finally(release);
  const source = snapshot.tree, tree = new BackedJson(storage, units => context.cooperate(units));
  let failure: {reason: unknown} | undefined;
  try {
    const enums = new IntegerTable(scratch, 64);
    await validateBackedPandoc(source, scratch, context, async position => {await enums.set(BigInt(position), 1n);}, false, snapshot.invalidPrototypes);
    let position = source.rootPosition, closingContainer = false;
    while (position) {
      await context.cooperate();
      const header = await source.describe(position);
      if (!closingContainer) {
        if (header.kind === "string" && await enums.get(BigInt(position))) {
          await tree.value({t: (await source.smallText(position, 32))!});
        } else {
          await tree.begin(header.kind);
          if (header.kind === "array" || header.kind === "object") {
            if (header.children) {position += 32; continue;}
          } else for await (const chunk of source.scalarChunks(position)) await tree.text(chunk);
          await tree.end();
        }
      }
      if (position === source.rootPosition) break;
      const parent = await source.describe(header.parent);
      if (header.end < parent.end) {position = header.end; closingContainer = false;}
      else {await tree.end(); position = header.parent; closingContainer = true;}
    }
  } catch (reason) {failure = {reason};}
  try {await snapshot.close();} catch (reason) {failure ??= {reason};}
  if (failure) {try {await close();} catch { /* Preserve admission/retirement failure. */ } throw failure.reason;}
  return {tree, close};
}
