import type { openRetainedMediaExtraction,RetainedExtractedMediaMember } from "./retained-media-extraction.js";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import type { ByteSink, ByteSource } from "./contracts.js";
import { OfficeError } from "./errors.js";
import type { RetainedPackageContext } from "./retained-package.js";
import type { openRetainedObjectExtraction } from "./retained-object-extraction.js";
import type { RetainedPackageExtraction } from "./retained-package-extraction.js";
import { RetainedValues, literal, characters } from "./retained-values.js";
import { streamJson, rawJson, boundedOutput } from "./retained-output.js";

// Only the fixed extraction manifest schema enters this formatter. JSON tokens
// are already admitted; string contents stay streamed and nesting is fixed.
async function* prettyManifest(source: ByteSource): ByteSource {
  let depth = 0,
    quoted = false,
    escaped = false,
    previous = "",
    buffer = "";
  for await (const character of characters(source)) {
    if (quoted) {
      buffer += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === "}" || character === "]") {
      depth--;
      if (previous !== "{" && previous !== "[") buffer += "\n" + "  ".repeat(depth);
      buffer += character;
      previous = "value";
    } else if (character === ",") {
      buffer += ",\n" + "  ".repeat(depth);
      previous = ",";
    } else if (character === ":") {
      buffer += ": ";
      previous = ":";
    } else {
      if (previous === "{" || previous === "[") buffer += "\n" + "  ".repeat(depth);
      buffer += character;
      if (character === "{" || character === "[") {
        depth++;
        previous = character;
      } else {
        if (character === '"') quoted = true;
        previous = "value";
      }
    }
    if (buffer.length >= 2048) {
      yield* literal(buffer);
      buffer = "";
    }
  }
  if (buffer) yield* literal(buffer);
}
/** Store manifest fragments and prefix boundaries before publication. Diagnostic
 * storage survives publication cancellation so completed files can be reported. */
export async function stageRetainedExtractionOutput(
  extraction:
    | RetainedPackageExtraction
    | Awaited<ReturnType<typeof openRetainedObjectExtraction>>
    | Awaited<ReturnType<typeof openRetainedMediaExtraction>>,
  settings: RetainedPackageContext,
  output: {
    readonly directory: string;
    readonly json: boolean;
    readonly maxOutputBytes: number;
    readonly allowPartialOutput: boolean;
    readonly operation?: "extract" | "objects.extract" | "media.extract";
    readonly dryRun?: boolean;
  }
) {
  output = { ...output };
  const opaque = output.operation === "objects.extract",
    media = output.operation === "media.extract";
  const working = { ...settings.workingStorage },
    cacheBytes = working.cacheBytes ?? 1024 * 1024;
  if (
    !working.fs ||
    typeof working.directory !== "string" ||
    !working.directory.startsWith("/") ||
    !Number.isSafeInteger(cacheBytes) ||
    cacheBytes < 16384 ||
    cacheBytes % 16384 ||
    typeof output.directory !== "string" ||
    (!output.directory && (!opaque || !output.dryRun)) ||
    typeof output.json !== "boolean" ||
    typeof output.allowPartialOutput !== "boolean" ||
    !(
      output.maxOutputBytes > 0 &&
      (output.maxOutputBytes === Infinity || Number.isSafeInteger(output.maxOutputBytes))
    )
  )
    throw new OfficeError(
      "invalid-value",
      "Invalid extraction output storage or options.",
      "usage"
    );
  const signal = settings.signal ?? new AbortController().signal,
    controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const context = { fs: working.fs, cwd: working.directory, env: {}, signal: controller.signal };
  const pages = new PagedStorage(context, cacheBytes / 16384),
    offsets = new PagedStorage(context, cacheBytes / 16384);
  let closed = false,
    closing: Promise<void> | undefined;
  const check = () => {
    if (closed) throw new OfficeError("invalid-handle", "Extraction output is closed.", "publish");
    controller.signal.throwIfAborted();
  };
  const values = new RetainedValues(pages, check, controller.signal);
  const close = () => {
    closed = true;
    signal.removeEventListener("abort", abort);
    return (closing ??= (async () => {
      const results = await Promise.allSettled([pages.close(), offsets.close()]);
      for (const result of results) if (result.status === "rejected") throw result.reason;
    })());
  };
  try {
    const start = pages.allocate(0),
      offsetStart = offsets.allocate(0);
    let length = 0,
      count = 0;
    const path = (name: string) =>
      `${output.directory}${!output.directory || output.directory.endsWith("/") ? "" : "/"}${name}`;
    for await (const member of extraction.members()) {
      check();
      if (count++) {
        await pages.append(new Uint8Array([44]));
        length++;
      }
      const mediaMember = media ? member as RetainedExtractedMediaMember : undefined;
      const item = await values.store(
        boundedOutput(
          streamJson(
            mediaMember
              ? {
                  name: member.name,
                  sha256: member.sha256,
                  contentType: mediaMember.contentType,
                  sourceParts: mediaMember.sourceParts(),
                  occurrenceIds: mediaMember.occurrenceIds(),
                  path: path(member.name),
                  bytes: member.size
                }
              : opaque
                ? {
                    part: member.part,
                    name: member.name,
                    path: path(member.name),
                    sha256: member.sha256,
                    bytes: member.size
                  }
                : {
                    part: member.part,
                    name: member.name,
                    contentType: "contentType" in member ? member.contentType : undefined,
                    sha256: member.sha256,
                    path: path(member.name),
                    bytes: member.size
                  }
          ),
          controller.signal,
          output.maxOutputBytes
        )
      );
      length += item.length;
      if (!Number.isSafeInteger(length) || length > output.maxOutputBytes)
        throw new OfficeError("resource-limit", "Output limit exceeded.", "publish");
      const end = new Uint8Array(8);
      new DataView(end.buffer).setFloat64(0, length, true);
      await offsets.append(end);
    }
    const relationships =
      opaque && "relationships" in extraction
        ? await values.store(
            boundedOutput(
              streamJson(extraction.relationships()),
              controller.signal,
              output.maxOutputBytes
            )
          )
        : undefined;
    async function* manifest(count: number): ByteSource {
      check();
      yield* literal("[");
      if (count) {
        const bytes = await offsets.read(offsetStart + (count - 1) * 8, 8),
          end = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(0, true);
        yield* values.read({ start, length: end });
      }
      yield* literal("]");
      check();
    }
    function data(count: number, dryRun = false) {
      return opaque
        ? {
            outputs: { [rawJson]: () => manifest(count) },
            relationships: { [rawJson]: () => values.read(relationships!) },
            activationPerformed: false,
            recursiveParsingPerformed: false,
            dryRun
          }
        : { outputs: { [rawJson]: () => manifest(count) }, dryRun: false };
    }
    function envelope(code?: string, published = 0, reserve = false) {
      if (media)
        return {
          version: 1,
          operation: "media.extract",
          ok: !code,
          data:
            !code || reserve
              ? data(count)
              : output.allowPartialOutput && published > 0
                ? data(published)
                : null,
          warnings: [],
          errors: code
            ? [{ code, message: "Output could not be published.", context: { phase: "publish" } }]
            : [],
          affected: !code ? count : output.allowPartialOutput ? published : 0,
          locations: []
        };
      if (opaque)
        return {
          version: 1,
          operation: "objects.extract",
          ok: !code,
          affected: !code ? 1 : output.allowPartialOutput ? published : 0,
          warnings: [],
          errors: code
            ? [{ code, message: "Output could not be published.", context: { phase: "publish" } }]
            : [],
          locations: [],
          data:
            !code || reserve
              ? data(count, !code && Boolean(output.dryRun))
              : output.allowPartialOutput && published > 0
                ? data(published)
                : null
        };
      return {
        version: 1,
        operation: "extract",
        ok: !code,
        warnings: [],
        errors: code
          ? [{ code, message: "Output could not be published.", context: { phase: "publish" } }]
          : [],
        locations: [],
        affected: code && output.allowPartialOutput ? published : 0,
        data:
          !code || reserve
            ? data(count)
            : output.allowPartialOutput && published > 0
              ? data(published)
              : null
      };
    }
    async function* render(code?: string, published = 0): ByteSource {
      if (output.json) {
        yield* streamJson(envelope(code, published));
        yield* literal("\n");
      } else if (!code && media) {
        yield* literal("Extracted " + count + " media resource(s)\n");
        yield* prettyManifest(streamJson(data(count)));
        yield* literal("\n");
      } else if (!code)
        yield* literal(
          opaque
            ? `${output.dryRun ? "Validated" : "Extracted"} ${count} opaque resource file(s)\n`
            : `Extracted ${count} package part(s)\n`
        );
      else {
        yield* literal(`pptx: ${code}: Output could not be published.\n`);
        yield* streamJson(output.allowPartialOutput && published > 0 ? data(published) : null);
        yield* literal("\n");
      }
    }
    // Admit success and the largest diagnostic before any file can be published.
    for await (const chunk of boundedOutput(render(), signal, output.maxOutputBytes)) void chunk;
    async function* reserve() {
      yield* streamJson(envelope("publication-unsupported", count, true));
      yield* literal("\n");
    }
    if (!opaque || output.directory)
      for await (const chunk of boundedOutput(reserve(), signal, output.maxOutputBytes)) void chunk;
    signal.throwIfAborted();
    signal.removeEventListener("abort", abort);
    return Object.freeze({
      close,
      path,
      async write(sink: ByteSink, failure?: { readonly code: string; readonly published: number }) {
        check();
        if (
          failure &&
          (![
            "cancelled",
            "resource-limit",
            "stale-input",
            "publication-unsupported",
            "io-failure"
          ].includes(failure.code) ||
            !Number.isSafeInteger(failure.published) ||
            failure.published < 0 ||
            failure.published > count)
        )
          throw new OfficeError("invalid-value", "Invalid extraction outcome.", "usage");
        for await (const chunk of boundedOutput(
          render(failure?.code, failure?.published),
          failure ? controller.signal : signal,
          output.maxOutputBytes
        ))
          await sink.write(chunk);
      }
    });
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}
