import {PandocError} from "./errors.js";
import {jsonReader, jsonWriter} from "./json.js";
import type {FilterCapability} from "./types.js";
import type {Inline} from "./ast-types.js";

/** Explicit trusted runtime. Await every stdout write and honor cancellation.
 * Return the filter's exit status only after its output and cleanup finish.
 * Runtime execution and its filesystem authority remain the caller's responsibility. */
export interface JsonFilterRuntime {
  run(invocation: {
    readonly path: string;
    readonly args: readonly [string];
    readonly stdin: Uint8Array;
    readonly stdout: {write(bytes: Uint8Array): Promise<void>};
    readonly signal: AbortSignal | undefined;
  }): Promise<number>;
}

/** Pandoc JSON protocol for an explicitly supplied runtime; never loads or runs host tools. */
export function createJsonFilterCapability(runtime: JsonFilterRuntime): FilterCapability {
  if (!runtime || typeof runtime.run !== "function") throw new TypeError("A JSON filter runtime is required");
  return {
    supports: request => request.kind === "json",
    async apply(document, request, context) {
      if (request.kind !== "json") throw new PandocError("E_CAPABILITY", "convert", "This runtime supports JSON filters only");
      const serialized = await jsonWriter.write(document, context);
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
      await checkImages(document);
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
          if (!failed) {failed = true; outputFailure = error;}
          throw error;
        }
      }};
      let exitCode: number;
      try {
        exitCode = await runtime.run({path: request.path, args: [context.to.split("+")[0]!.split("-")[0]!], stdin, stdout, signal: context.signal});
      } finally {open = false;}
      context.checkpoint();
      if (failed) throw outputFailure;
      if (exitCode !== 0) throw new PandocError("E_IO", "convert", Number.isInteger(exitCode) ? `JSON filter ${request.path} exited with status ${exitCode}` : "JSON filter returned an invalid exit status");
      const text = await context.decodeUtf8(chunks);
      return jsonReader.read({bytes: new Uint8Array(), text}, context);
    }
  };
}
