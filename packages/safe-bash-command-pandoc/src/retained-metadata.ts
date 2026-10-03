import {IntegerTable, PagedStorage} from "safe-bash-io-engine/storage";
import {BackedJson} from "./backed-json.js";
import {BackedText} from "./backed-text.js";
import {BackedTextSet} from "./backed-text-set.js";
import {parseBackedJson} from "./backed-json-parser.js";
import {readJsonNumber} from "./json-number.js";
import {readRetainedJson} from "./retained-json.js";
import {PandocError} from "./errors.js";
import type {ExecutionContext} from "./execution.js";
import type {InputSource, WorkingStorageOptions} from "./types.js";

type RetainedDocument = Awaited<ReturnType<typeof readRetainedJson>>;

/** JSON metadata retains its native last-key-wins/Number semantics. Merge jobs,
 * key identities and each document generation use caller storage, including
 * arbitrarily long keys, strings, lists and nested maps. */
export async function mergeRetainedMetadata(document: RetainedDocument, input: {source: InputSource} | {tree: BackedJson; root: number; typed?: boolean}, context: ExecutionContext, working: WorkingStorageOptions): Promise<RetainedDocument> {
  const owner = {fs: working.fs, cwd: working.directory, env: {}, signal: context.signal ?? new AbortController().signal};
  const pages = (working.cacheBytes ?? 1048576) / 16384;
  const raw = "tree" in input ? undefined : new PagedStorage(owner, pages), scratch = new PagedStorage(owner, pages), output = new PagedStorage(owner, pages);
  const close = async () => {
    let failure: {reason: unknown} | undefined;
    for (const storage of [raw, scratch, output]) try {await storage?.close();} catch (reason) {failure ??= {reason};}
    if (failure) throw failure.reason;
  };
  const release = context.onClose(close);
  const cooperate = (units?: number) => context.cooperate(units);
  const source = document.tree, overlay = "tree" in input ? input.tree : new BackedJson(raw!, cooperate), merged = new BackedJson(output, cooperate);
  let next: RetainedDocument | undefined, failure: {reason: unknown} | undefined;
  const option = (message: string): never => {throw new PandocError("E_OPTION", "convert", message);};
  try {
    if (!("tree" in input)) {
      const file = input.source;
      const start = raw!.allocate(0); let length = 0;
      await context.consume("bytes" in file ? [file.bytes] : file.chunks, async bytes => {
        await raw!.append(bytes); length += bytes.length;
      }, ["inputBytes"]);
      const decoded = async function* () {
        const decoder = new TextDecoder("utf-8", {fatal: true}); let cr = false;
        for (let offset = 0; offset <= length; offset += 16384) {
          let chunk: string;
          try {chunk = offset < length ? decoder.decode(await raw!.read(start + offset, Math.min(16384, length - offset)), {stream: true}) : decoder.decode();}
          catch {throw new PandocError("E_ENCODING", "convert", "Invalid UTF-8 input");}
          let text = "";
          for (const char of chunk) {
            if (cr) {text += "\n"; cr = false; if (char === "\n") continue;}
            if (char === "\r") cr = true; else text += char;
          }
          if (text) yield text;
          await cooperate();
          // Always flush the decoder, including a final non-page-sized fragment.
          if (offset < length && offset + 16384 > length) {
            try {const tail = decoder.decode(); if (tail) yield tail;}
            catch {throw new PandocError("E_ENCODING", "convert", "Invalid UTF-8 input");}
          }
        }
        if (cr) yield "\n";
      };
      let parseError: {offset: number} | undefined;
      try {await parseBackedJson(decoded(), overlay, scratch, cooperate, (offset, _message, tokenOffset) => {
        parseError = {offset: tokenOffset ?? offset}; throw new PandocError("E_PARSE", "convert", "Invalid JSON metadata", "json");
      }, undefined, true);} catch (error) {
        if (!parseError) throw error;
        let line = 1, column = 1, offset = 0;
        for await (const text of decoded()) {
          for (const char of text) {
            if (offset >= parseError.offset) break;
            offset += char.length;
            if (char === "\n") {line++; column = 1;} else column += char.length;
          }
          if (offset >= parseError.offset) break;
        }
        const name = file.source ?? file.base;
        throw new PandocError("E_PARSE", "convert", "Invalid JSON metadata", "json", `${name ? name + ":" : ""}${line}:${column}`);
      }
    }
    const overlayRoot = "tree" in input ? input.root : overlay.rootPosition;
    if ((await overlay.describe(overlayRoot)).kind !== "object") option("JSON metadata must be an object");
    const text = new BackedText(scratch, cooperate), keys = new BackedTextSet(scratch, text);
    const values = new IntegerTable(scratch, 64), first = new IntegerTable(scratch, 64), identities = new IntegerTable(scratch, 64), used = new IntegerTable(scratch, 64);
    const identity = async (tree: BackedJson, key: number, parent: number) => keys.add(await text.from((async function* () {
      yield `${parent}:`; yield* tree.scalarChunks(key);
    })()));
    const end = (await overlay.describe(overlayRoot)).end;
    for (let node = overlayRoot; node < end;) {
      const header = await overlay.describe(node);
      if (header.kind === "key") {
        const id = await identity(overlay, node, header.parent);
        await identities.set(BigInt(node), BigInt(id));
        if (await first.get(BigInt(id)) === undefined) await first.set(BigInt(id), BigInt(node));
        await values.set(BigInt(id), BigInt(header.end));
      }
      node = header.kind === "object" || header.kind === "array" ? node + 32 : header.end;
      await cooperate();
    }
    const unsafe = async (key: number) => {
      if (["__proto__", "constructor", "prototype"].includes(await overlay.smallText(key, 11) ?? "")) option("Unsafe metadata key");
    };
    const isNull = async (node: number) => (await overlay.describe(node)).kind === "literal" && await overlay.smallText(node, 4) === "null";
    let top = 0;
    // Jobs: copy, siblings, end, map, old keys, metadata value, new keys, list.
    const push = async (op: number, a = 0, b = 0, c = 0) => {
      const bytes = new Uint8Array(40), view = new DataView(bytes.buffer);
      [top, op, a, b, c].forEach((value, index) => view.setFloat64(index * 8, value, true));
      top = await scratch.append(bytes);
    };
    await push(3, (await source.property(source.rootPosition, "meta"))!, overlayRoot);
    while (top) {
      await cooperate();
      const bytes = await scratch.read(top, 40), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      top = view.getFloat64(0, true);
      const op = view.getFloat64(8, true), a = view.getFloat64(16, true), b = view.getFloat64(24, true), c = view.getFloat64(32, true);
      if (op === 2) {await merged.end(); continue;}
      if (op === 0 || op === 1) {
        if (op === 1 && a >= c) continue;
        const tree = b ? overlay : source, header = await tree.describe(a);
        if (op === 1) {if (a < c) {await push(1, header.end, b, c); await push(0, a, b);} continue;}
        await merged.begin(header.kind);
        if (header.kind === "object" || header.kind === "array") {await push(2); if (header.end > a + 32) await push(1, a + 32, b, header.end);}
        else {for await (const chunk of tree.scalarChunks(a)) await merged.text(chunk); await merged.end();}
      } else if (op === 3) {
        await merged.begin("object"); await push(2);
        const right = await overlay.describe(b);
        if (right.children) await push(6, b + 32, right.end);
        if (a) {const left = await source.describe(a); if (left.children) await push(4, a + 32, b, left.end);}
      } else if (op === 4) {
        if (a >= c) continue;
        const value = (await source.describe(a)).end;
        await push(4, (await source.describe(value)).end, b, c);
        const id = await identity(source, a, b), replacement = Number(await values.get(BigInt(id)) ?? 0n);
        if (replacement) {
          await used.set(BigInt(id), 1n);
          await unsafe(Number((await first.get(BigInt(id)))!));
          if (await isNull(replacement)) continue;
          await push(5, value, replacement);
        } else await push(0, value);
        await push(0, a);
      } else if (op === 6) {
        if (a >= b) continue;
        const rawValue = (await overlay.describe(a)).end;
        await push(6, (await overlay.describe(rawValue)).end, b);
        const id = (await identities.get(BigInt(a)))!;
        if (await first.get(id) !== BigInt(a) || await used.get(id)) continue;
        await unsafe(a);
        const value = Number((await values.get(id))!);
        if (await isNull(value)) continue;
        await push(5, 0, value); await push(0, a, 1);
      } else if (op === 7) {
        if (a >= b) continue;
        await push(7, (await overlay.describe(a)).end, b); await push(5, 0, a);
      } else if (op === 5) {
        if ("tree" in input && input.typed) {
          const tag = (await overlay.property(b, "t"))!;
          if (await overlay.smallText(tag, 7) === "MetaMap") {
            await merged.begin("object"); await merged.key("t"); await merged.value("MetaMap"); await merged.key("c"); await push(2);
            const oldTag = a ? await source.property(a, "t") : undefined;
            const left = oldTag !== undefined && await source.smallText(oldTag, 7) === "MetaMap" ? (await source.property(a, "c"))! : 0;
            await push(3, left, (await overlay.property(b, "c"))!);
          } else await push(0, b, 1);
          continue;
        }
        const header = await overlay.describe(b);
        if (await isNull(b)) option("Null metadata list elements are unsupported");
        await merged.begin("object"); await merged.key("t");
        if (header.kind === "object") {
          await merged.value("MetaMap"); await merged.key("c"); await push(2);
          const tag = a ? await source.property(a, "t") : undefined;
          const left = tag !== undefined && await source.smallText(tag, 7) === "MetaMap" ? (await source.property(a, "c"))! : 0;
          await push(3, left, b);
        } else if (header.kind === "array") {
          await merged.value("MetaList"); await merged.key("c"); await merged.begin("array"); await push(2); await push(2);
          if (header.children) await push(7, b + 32, header.end);
        } else if (header.kind === "string") {
          await merged.value("MetaString"); await merged.key("c"); await push(2); await push(0, b, 1);
        } else {
          const literal = await overlay.smallText(b, 5);
          if (literal === "true" || literal === "false") {
            await merged.value("MetaBool"); await merged.key("c"); await merged.value(literal === "true");
          } else {
            const number = await readJsonNumber(overlay.scalarChunks(b), units => cooperate(units), false);
            if (!Number.isFinite(number)) option("Invalid JSON metadata value");
            await merged.value("MetaString"); await merged.key("c"); await merged.value(String(number));
          }
          await merged.end();
        }
      }
    }
    const encoder = new TextEncoder(), blocks = (await source.property(source.rootPosition, "blocks"))!;
    next = await readRetainedJson({chunks: (async function* () {
      yield encoder.encode('{"pandoc-api-version":[1,23,1,2],"meta":');
      yield* merged.chunks(); yield encoder.encode(',"blocks":');
      yield* source.chunks(blocks, document.order); yield encoder.encode("}");
    })()}, context, working, false);
  } catch (reason) {failure = {reason};}
  try {await close();} catch (reason) {failure ??= {reason};}
  finally {release();}
  if (failure) {try {await next?.close();} catch { /* Preserve the merge failure. */ } throw failure.reason;}
  return next!;
}
