import {retainInput} from "./retained-input.js";
import {validateRetainedWire} from "./retained-wire.js";
import {reserveRetainedAstBudgets, type RetainedAstUsage} from "./retained-ast-budgets.js";
import {retainedUtf8} from "./retained-utf8.js";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {BackedJson} from "./backed-json.js";
import {parseBackedJson} from "./backed-json-parser.js";
import {validateBackedPandoc} from "./backed-pandoc.js";
import {backedJsonOrder} from "./backed-json-order.js";
import {readJsonNumber, JsonNumberError} from "./json-number.js";
import {PandocError} from "./errors.js";
import type {ExecutionContext} from "./execution.js";
import type {InputSource, WorkingStorageOptions} from "./types.js";

/** Own a validated, replayable Pandoc wire document in caller storage. */
export async function readRetainedJson(input: InputSource, context: ExecutionContext, working: WorkingStorageOptions, chargeInput = true, chargeAst = true, onInputDecoded?: () => void, decodeInput = chargeInput) {
  const cacheBytes = working.cacheBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(cacheBytes) || cacheBytes < 16384 || cacheBytes % 16384)
    context.fail("E_OPTION", "Working storage cacheBytes must be a positive multiple of 16384");
  if (typeof working.directory !== "string" || !working.directory.startsWith("/"))
    context.fail("E_OPTION", "Working storage requires an absolute caller filesystem directory");
  const owner = {fs: working.fs, cwd: working.directory, env: {}, signal: context.signal ?? new AbortController().signal};
  const storage = new PagedStorage(owner, cacheBytes / 16384), scratch = new PagedStorage(owner, cacheBytes / 16384);
  const cleanup = context.onClose(async () => {try {await storage.close();} finally {await scratch.close();}});
  const tree = new BackedJson(storage, units => context.cooperate(units));
  const chunks = "bytes" in input ? [input.bytes] : input.chunks;
  const source = Symbol.asyncIterator in chunks ? chunks[Symbol.asyncIterator]() : chunks[Symbol.iterator]();
  let sourceDone = false;
  const closeSource = async () => {if (!sourceDone) {sourceDone = true; await source.return?.();}};
  const releaseSource = context.onClose(closeSource);
  const text = (async function* () {
    const decoder = new TextDecoder("utf-8", {fatal: true});
    let cr = false;
    const normalize = (decoded: string, final = false): string => {
      let text = "";
      for (const char of decoded) {
        if (cr) {text += "\n"; cr = false; if (char === "\n") continue;}
        if (char === "\r") cr = true;
        else text += char;
      }
      if (final && cr) {text += "\n"; cr = false;}
      return text;
    };
    while (true) {
      const part = await context.call(async () => source.next());
      if (part.done) {sourceDone = true; break;}
      if (!(part.value instanceof Uint8Array)) context.fail("E_IO", "Producer must yield bytes");
      if (chargeInput) context.charge("inputBytes", part.value.byteLength);
      for (let offset = 0; offset < part.value.byteLength; offset += 16384) {
        let decoded: string;
        try {decoded = decoder.decode(part.value.subarray(offset, offset + 16384), {stream: true});}
        catch {throw new PandocError("E_ENCODING", "convert", "Invalid UTF-8 input");}
        const normalized = normalize(decoded);
        if (normalized) yield normalized;
        await context.cooperate();
      }
    }
    try {const tail = normalize(decoder.decode(), true); if (tail) yield tail;}
    catch {throw new PandocError("E_ENCODING", "convert", "Invalid UTF-8 input");}
    onInputDecoded?.();
  })();
  let failure: {reason: unknown} | undefined;
  let result: {normalizedUsage?: RetainedAstUsage; tree: BackedJson; order: Awaited<ReturnType<typeof backedJsonOrder>>; chunks(eol?: "lf" | "crlf" | "native"): AsyncGenerator<Uint8Array>; close(): Promise<void>} | undefined;
  const close = async () => {
    let failure: {reason: unknown} | undefined;
    try {await storage.close();} catch (reason) {failure = {reason};}
    try {await scratch.close();} catch (reason) {failure ??= {reason};}
    finally {cleanup();}
    if (failure) throw failure.reason;
  };
  let nodes = 0;
  let normalizedUsage: RetainedAstUsage = {nodes: 0, text: 0};
  try {
    const retained = Number.isFinite(context.limits.retainedBytes);
    const references = chargeInput && (Number.isFinite(context.limits.references) || retained);
    const bytes = async function* () {
      while (true) {
        const part = await context.call(async () => source.next());
        if (part.done) {sourceDone = true; return;}
        yield part.value;
      }
    };
    const parsedText = decodeInput && (Number.isFinite(context.limits.text) || Number.isFinite(context.limits.references) || retained) ? retainedUtf8(references ? retainInput(bytes(), context, scratch, ["inputBytes"], retained) : bytes(), context, scratch, chargeInput && !references ? ["inputBytes"] : [], onInputDecoded, retained) : text;
    await parseBackedJson(parsedText, tree, scratch, units => context.cooperate(units), (offset, message) => {
      throw new PandocError("E_AST", "read", message, "json", `$@${offset}`);
    }, async (node, offset) => {
      try {await readJsonNumber(tree.scalarChunks(node), units => context.cooperate(units));}
      catch (error) {
        if (!(error instanceof JsonNumberError)) throw error;
        throw new PandocError("E_AST", "read", error.message, "json", `$@${offset}`);
      }
    }, false, decodeInput && Number.isFinite(context.limits.depth) ? (depth, container) => {if (!container) context.bound("depth", depth);} : undefined, decodeInput ? (_kind, complete) => {if (!complete) {context.bound("nodes", ++nodes); if (retained) context.charge("retainedBytes", 16);}} : undefined, decodeInput && Number.isFinite(context.limits.references) ? () => context.charge("references", 1) : undefined, decodeInput && retained ? bytes => context.charge("retainedBytes", bytes) : undefined);
    const order = await backedJsonOrder(tree, scratch, units => context.cooperate(units));
    if (chargeAst) {
      try {
        const enums = (Number.isFinite(context.limits.tableCells) || Number.isFinite(context.limits.attributes) || Number.isFinite(context.limits.depth) || Number.isFinite(context.limits.nodes) || Number.isFinite(context.limits.text) || Number.isFinite(context.limits.references) || retained) ? await validateRetainedWire(tree, order, scratch, context) : undefined;
        normalizedUsage = await reserveRetainedAstBudgets(tree, order, context, enums);
      }
      catch (error) {
        if (error instanceof PandocError && error.code === "E_LIMIT" && input.source)
          throw new PandocError(error.code, error.operation, error.message, error.format, `${input.source}:${error.location ?? "1:1"}`);
        throw error;
      }
    }
    await validateBackedPandoc(tree, scratch, context, undefined, chargeAst && (Number.isFinite(context.limits.tableCells) || Number.isFinite(context.limits.attributes) || Number.isFinite(context.limits.depth) || Number.isFinite(context.limits.nodes) || Number.isFinite(context.limits.text) || Number.isFinite(context.limits.references) || retained));
    const meta = (await tree.property(tree.rootPosition, "meta"))!, blocks = (await tree.property(tree.rootPosition, "blocks"))!;
    const encoder = new TextEncoder();
    const output = async function* (eol?: "lf" | "crlf" | "native") {
      yield encoder.encode('{"pandoc-api-version":[1,23,1,2],"meta":');
      yield* tree.chunks(meta, order);
      yield encoder.encode(',"blocks":');
      yield* tree.chunks(blocks, order);
      yield encoder.encode(eol === "crlf" ? "}\r\n" : "}\n");
    };
    result = {normalizedUsage, tree, order, chunks: output, close};
  } catch (reason) {
    failure = {reason: reason instanceof PandocError && reason.code === "E_AST" && input.source
      ? new PandocError(reason.code, reason.operation, reason.message, reason.format, `${input.source}:${reason.location ?? "1:1"}`)
      : reason};
  }
  try {await closeSource();} catch (reason) {failure ??= {reason};}
  finally {releaseSource();}
  if (failure) {
    try {await close();} catch { /* Preserve the original parse or source error. */ }
    throw failure.reason;
  }
  return result!;
}
