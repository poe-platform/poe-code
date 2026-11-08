import {readBytes} from "safe-bash-contracts";
import {PandocError} from "./errors.js";
import {jsonReader, jsonWriter} from "./json.js";
import type {FilterCapability} from "./types.js";
import type {Inline} from "./ast-types.js";

/** Internal handshake: retain producer write boundaries while forwarding bounded slices. */
export const jsonFilterWrite = Symbol("jsonFilterWrite");
export type JsonFilterOutput = {write(bytes: Uint8Array): Promise<void>; [jsonFilterWrite]?(length: number): Promise<void>};

/** Explicit trusted runtime. Await every stdout write and honor cancellation.
 * Return the filter's exit status only after its output and cleanup finish.
 * Runtime execution and its filesystem authority remain the caller's responsibility. */
interface JsonFilterInvocation<Input> {
  readonly path: string;
  readonly args: readonly [string];
  readonly stdin: Input;
  readonly stdout: {write(bytes: Uint8Array): Promise<void>};
  readonly signal: AbortSignal;
}
export interface JsonFilterRuntime {
  run(invocation: JsonFilterInvocation<Uint8Array>): Promise<number>;
  runStream?: JsonStreamFilterRuntime["runStream"];
}
export interface JsonStreamFilterRuntime {
  runStream(invocation: JsonFilterInvocation<AsyncIterable<Uint8Array>>): Promise<number>;
}

/** Pandoc JSON protocol for an explicitly supplied runtime; never loads or runs host tools. */
export function createJsonFilterCapability(runtime: JsonFilterRuntime | JsonStreamFilterRuntime): FilterCapability {
  if (!runtime || !("run" in runtime && typeof runtime.run === "function") && !("runStream" in runtime && typeof runtime.runStream === "function")) throw new TypeError("A JSON filter runtime is required");
  const streaming = typeof runtime.runStream === "function" ? runtime.runStream.bind(runtime) : undefined;
  return {
    supports: request => request.kind === "json",
    ...(streaming ? {
      async applyJsonStream(streams, request, context) {
        if (request.kind !== "json") throw new PandocError("E_CAPABILITY", "convert", "This runtime supports JSON filters only");
        const controller = new AbortController();
        const signal = AbortSignal.any([streams.signal, controller.signal, ...(context.signal ? [context.signal] : [])]);
        const reader = readBytes(streams.stdin, signal);
        const stdin = (async function* () {
          try {
            let chunk = new Uint8Array(16384), used = 0;
            for await (const bytes of reader) {
              if (!(bytes instanceof Uint8Array)) throw new PandocError("E_IO", "convert", "Filter input must be bytes");
              for (let offset = 0; offset < bytes.length;) {
                context.checkpoint(); signal.throwIfAborted();
                const count = Math.min(bytes.length - offset, chunk.length - used);
                chunk.set(bytes.subarray(offset, offset + count), used);
                offset += count; used += count;
                if (used === chunk.length) {yield chunk; chunk = new Uint8Array(16384); used = 0;}
              }
            }
            if (used) yield chunk.slice(0, used);
          } finally {await reader.return(undefined);}
        })();
        let open = true, writing = false, active: Promise<void> | undefined;
        let failure: {reason: unknown} | undefined;
        const fail = (reason: unknown) => {failure ??= {reason}; controller.abort(failure.reason); return failure.reason;};
        const stdout = {write(bytes: Uint8Array): Promise<void> {
          try {
            context.checkpoint(); signal.throwIfAborted();
            if (failure) throw failure.reason;
            if (!open || writing) throw new PandocError("E_IO", "convert", "Filter output is closed or a write is pending");
            if (!(bytes instanceof Uint8Array)) throw new PandocError("E_IO", "convert", "Filter output must be bytes");
          } catch (reason) {return Promise.reject(fail(reason));}
          writing = true;
          const operation = (async () => {
            try {
              context.charge("inputBytes", bytes.length);
              context.charge("retainedBytes", bytes.length);
              if (bytes.length) context.charge("references", 1);
              const boundary = (streams.stdout as JsonFilterOutput)[jsonFilterWrite];
              if (bytes.length && boundary) await boundary.call(streams.stdout, bytes.length);
              for (let offset = 0; offset < bytes.length; offset += 16384) {
                context.checkpoint(); signal.throwIfAborted();
                await streams.stdout.write(bytes.slice(offset, offset + 16384));
              }
            } catch (reason) {throw fail(reason);}
          })();
          active = operation;
          void operation.finally(() => {if (active === operation) {active = undefined; writing = false;}}).catch(() => {});
          return operation;
        }};
        try {
          const status = await streaming({path: request.path, args: [context.to.split("+")[0]!.split("-")[0]!], stdin, stdout, signal});
          context.checkpoint(); signal.throwIfAborted();
          if (active) throw new PandocError("E_IO", "convert", "Filter returned with an output write pending");
          if (status !== 0) throw new PandocError("E_IO", "convert", Number.isInteger(status) ? `JSON filter ${request.path} exited with status ${status}` : "JSON filter returned an invalid exit status");
        } catch (reason) {fail(reason);}
        open = false;
        controller.abort();
        try {await active;} catch (reason) {failure ??= {reason};}
        try {await stdin.return(undefined);} catch (reason) {failure ??= {reason};}
        if (failure) throw failure.reason;
      }
    } satisfies Pick<FilterCapability, "applyJsonStream"> : {}),
    async apply(document, request, context) {
      if (request.kind !== "json") throw new PandocError("E_CAPABILITY", "convert", "This runtime supports JSON filters only");
      // Resources and document sidecars stay SDK-owned; Pandoc's wire AST
      // contains only blocks and metadata.
      const wireDocument = {blocks: document.blocks, metadata: document.metadata, resources: []};
      const serialized = await jsonWriter.write(wireDocument, context);
      if (serialized.kind !== "text") throw new PandocError("E_INTERNAL", "convert", "Expected Pandoc JSON text");
      // JSON cannot carry parser-owned image origins through arbitrary reordering
      // or replacement by a filter. Refuse ambiguous targets instead of reading
      // a different file from the conversion working directory.
      const checkImages = async (value: unknown): Promise<void> => {
        await context.cooperate();
        if (!value || typeof value !== "object") return;
        if ("t" in value && value.t === "Image") {
          const target = (value as Extract<Inline, {t: "Image" | "Link"}>).c[2][0];
          if (!target.startsWith("/") && !URL.canParse(target))
            throw new PandocError("E_UNSUPPORTED_FEATURE", "convert", "JSON filters cannot preserve relative image source directories");
        }
        for (const child of Object.values(value)) await checkImages(child);
      };
      await checkImages(wireDocument);
      context.charge("retainedBytes", serialized.text.length * 2);
      let length = 0;
      for (const character of serialized.text) {
        const code = character.codePointAt(0)!;
        length += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
        context.bound("outputBytes", length);
        await context.cooperate();
      }
      context.charge("retainedBytes", length);
      const stdin = new TextEncoder().encode(serialized.text);
      const chunks: Uint8Array[] = [];
      const controller = new AbortController();
      const cancel = () => controller.abort(context.signal!.reason);
      let open = true;
      let outputFailure: unknown;
      let failed = false;
      const stdout = {async write(bytes: Uint8Array): Promise<void> {
        try {
          context.checkpoint();
          if (!open) throw new PandocError("E_IO", "convert", "Filter output is closed");
          if (failed) throw outputFailure;
          if (!(bytes instanceof Uint8Array)) throw new PandocError("E_IO", "convert", "Filter output must be bytes");
          context.charge("inputBytes", bytes.byteLength);
          context.charge("retainedBytes", bytes.byteLength);
          if (bytes.length) {
            context.charge("references", 1);
            chunks.push(new Uint8Array(bytes));
          }
        } catch (error) {
          if (!failed) {failed = true; outputFailure = error; controller.abort(error);}
          throw error;
        }
      }};
      let exitCode: number;
      context.signal?.addEventListener("abort", cancel, {once: true});
      if (context.signal?.aborted) cancel();
      try {
        const invocation = {path: request.path, args: [context.to.split("+")[0]!.split("-")[0]!] as const, stdout, signal: controller.signal};
        exitCode = "run" in runtime && typeof runtime.run === "function"
          ? await runtime.run({...invocation, stdin})
          : await streaming!({...invocation, stdin: (async function* () {for (let offset = 0; offset < stdin.length; offset += 16384) yield stdin.slice(offset, offset + 16384);})()});
      } catch (error) {
        if (failed) throw outputFailure;
        throw error;
      } finally {
        open = false;
        context.signal?.removeEventListener("abort", cancel);
        controller.abort();
      }
      context.checkpoint();
      if (failed) throw outputFailure;
      if (exitCode !== 0) throw new PandocError("E_IO", "convert", Number.isInteger(exitCode) ? `JSON filter ${request.path} exited with status ${exitCode}` : "JSON filter returned an invalid exit status");
      const text = await context.decodeUtf8(chunks);
      const parsed = await jsonReader.read({bytes: new Uint8Array(), text}, context);
      return {...document, blocks: parsed.blocks, metadata: parsed.metadata};
    }
  };
}
