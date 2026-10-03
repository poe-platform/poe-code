import {IntegerTable, PagedStorage} from "safe-bash-io-engine/storage";
import {BackedJson} from "./backed-json.js";
import {backedJsonOrder} from "./backed-json-order.js";
import {readJsonNumber} from "./json-number.js";
import type {readRetainedJson} from "./retained-json.js";
import type {ExecutionContext} from "./execution.js";
import type {ConversionOptions, WorkingStorageOptions} from "./types.js";

/** Match the existing literal HTML comment policy across arbitrary scalar slices.
 * Only a possible delimiter prefix and a bounded output chunk remain resident. */
async function* withoutComments(source: AsyncIterable<string>): AsyncGenerator<string> {
  let comment = false, pending = "", output = "";
  for await (const chunk of source) for (const char of chunk) {
    pending += char;
    const delimiter = comment ? "-->" : "<!--";
    while (pending && !delimiter.startsWith(pending)) {
      if (!comment) output += pending[0];
      pending = pending.slice(1);
    }
    if (pending === delimiter) {comment = !comment; pending = "";}
    if (output.length >= 4096) {yield output; output = "";}
  }
  if (!comment) output += pending;
  if (output) yield output;
}

/** Copy a validated document generation through bounded, caller-backed rewrite
 * jobs. Metadata is deliberately untouched, matching Session.writable. */
export async function transformRetainedJson(source: BackedJson, context: ExecutionContext, working: WorkingStorageOptions,
  options: Pick<ConversionOptions, "stripComments" | "shiftHeadingLevelBy">, copied?: (before:number,after:number)=>Promise<void>): Promise<Awaited<ReturnType<typeof readRetainedJson>>> {
  const owner = {fs: working.fs, cwd: working.directory, env: {}, signal: context.signal ?? new AbortController().signal};
  const pages = (working.cacheBytes ?? 1048576) / 16384;
  const storage = new PagedStorage(owner, pages), scratch = new PagedStorage(owner, pages);
  const release = context.onClose(async () => {try {await storage.close();} finally {await scratch.close();}});
  const close = async () => {
    let failure: {reason: unknown} | undefined;
    try {await storage.close();} catch (reason) {failure = {reason};}
    try {await scratch.close();} catch (reason) {failure ??= {reason};}
    finally {release();}
    if (failure) throw failure.reason;
  };
  try {
    const tree = new BackedJson(storage, units => context.cooperate(units));
    const replacements = new IntegerTable(scratch, 64), aliases = new IntegerTable(scratch, 64);
    let top = 0;
    // op 0 copies a node, op 1 advances siblings, op 2 closes a container.
    const push = async (op: number, node: number, end = 0) => {
      const bytes = new Uint8Array(32), view = new DataView(bytes.buffer);
      [top, op, node, end].forEach((value, index) => view.setFloat64(index * 8, value, true));
      top = await scratch.append(bytes);
    };
    const blocks = (await source.property(source.rootPosition, "blocks"))!;
    const blockEnd = (await source.describe(blocks)).end;
    await push(0, source.rootPosition);
    while (top) {
      await context.cooperate();
      const bytes = await scratch.read(top, 32), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      top = view.getFloat64(0, true);
      const op = view.getFloat64(8, true), original = view.getFloat64(16, true), end = view.getFloat64(24, true);
      if (op === 2) {await tree.end(); continue;}
      if (op === 1) {
        if (original < end) {await push(1, (await source.describe(original)).end, end); await push(0, original);}
        continue;
      }
      const node = Number(await aliases.get(BigInt(original)) ?? BigInt(original));
      const header = await source.describe(node);
      if (header.kind === "object" && node >= blocks && node < blockEnd) {
        const tagPosition = await source.property(node, "t");
        const tag = tagPosition === undefined ? undefined : await source.smallText(tagPosition, 16);
        const content = await source.property(node, "c");
        if (tag === "Header") {
          const levelNode = content! + 32;
          const level = await readJsonNumber(source.scalarChunks(levelNode), units => context.cooperate(units)) + (options.shiftHeadingLevelBy ?? 0);
          if (level < 1) {
            const attr = (await source.describe(levelNode)).end, inlines = (await source.describe(attr)).end;
            await replacements.set(BigInt(tagPosition!), 1n);
            await aliases.set(BigInt(content!), BigInt(inlines));
          } else await replacements.set(BigInt(levelNode), BigInt(10 + Math.min(6, level)));
        }
        if (options.stripComments && (tag === "RawInline" || tag === "RawBlock") && await source.smallText(content! + 32, 4) === "html") {
          const text = (await source.describe(content! + 32)).end;
          let nonempty = false;
          for await (const chunk of withoutComments(source.scalarChunks(text))) {if (chunk) {nonempty = true; break;}}
          if (!nonempty) continue;
          await replacements.set(BigInt(text), 2n);
        }
      }
      const target=await tree.begin(header.kind);
      await copied?.(node,target);
      if (header.kind === "array" || header.kind === "object") {
        await push(2, 0);
        await push(1, node + 32, header.end);
      } else {
        const replacement = Number(await replacements.get(BigInt(node)) ?? 0n);
        if (replacement === 1) await tree.text("Para");
        else if (replacement >= 10) await tree.text(String(replacement - 10));
        else for await (const chunk of replacement === 2 ? withoutComments(source.scalarChunks(node)) : source.scalarChunks(node)) await tree.text(chunk);
        await tree.end();
      }
    }
    const order = await backedJsonOrder(tree, scratch, units => context.cooperate(units));
    const meta = (await tree.property(tree.rootPosition, "meta"))!, outputBlocks = (await tree.property(tree.rootPosition, "blocks"))!;
    const encoder = new TextEncoder();
    return {tree, order, close, async *chunks(eol) {
      yield encoder.encode('{"pandoc-api-version":[1,23,1,2],"meta":');
      yield* tree.chunks(meta, order);
      yield encoder.encode(',"blocks":');
      yield* tree.chunks(outputBlocks, order);
      yield encoder.encode(eol === "crlf" ? "}\r\n" : "}\n");
    }};
  } catch (error) {
    try {await close();} catch { /* Preserve the transformation failure. */ }
    throw error;
  }
}
