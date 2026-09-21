import type { ArchiveSink } from "./archive-write.js";
import { CancellationError, InputTypeError, ResourceLimitError } from "./archive.js";
import type { AdmittedModelContext } from "./model-context.js";
import type { DocxVfsPath } from "./operation-types.js";
import type { PublicationContext, PublicationOptions } from "./publication.js";
import { UnsupportedEditError } from "./xml-write.js";

export interface StagedByteSink {
  write(bytes: Uint8Array): Promise<void>;
  commit(): Promise<void>;
  abort(): Promise<void>;
}
export interface ByteSink {
  stage(signal?: AbortSignal): Promise<StagedByteSink>;
}
export type DocumentModelOutput = ByteSink | ArchiveSink | DocxVfsPath;

function capabilityMethod(
  value: object,
  name: string
): ((...args: never[]) => unknown) | undefined {
  let prototype: object | null = value;
  while (prototype) {
    const method = Object.getOwnPropertyDescriptor(prototype, name);
    if (method) {
      if (!("value" in method) || typeof method.value !== "function")
        throw new InputTypeError("Expected a capability method without accessors.");
      return method.value.bind(value);
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  return undefined;
}

/** Captures explicit output authority before serialization can suspend. */
export function modelOutput(
  output: DocumentModelOutput,
  context: AdmittedModelContext
): { options: PublicationOptions; transport: Pick<PublicationContext, "stdout" | "filesystem"> } {
  if (!output || typeof output !== "object")
    throw new InputTypeError("Expected an explicit document output capability.");
  const stage = capabilityMethod(output, "stage");
  if (stage) {
    return {
      options: { output: "-" },
      transport: {
        stdout: {
          async write(bytes, signal) {
            if (signal.aborted) throw new CancellationError("Byte sink staging cancelled.");
            const acquired = await (stage as ByteSink["stage"])(signal);
            if (!acquired || typeof acquired !== "object")
              throw new InputTypeError("Expected an owned byte sink stage.");
            const abort = capabilityMethod(acquired, "abort");
            if (!abort) throw new InputTypeError("Expected a byte sink abort capability.");
            try {
              const write = capabilityMethod(acquired, "write"),
                commit = capabilityMethod(acquired, "commit");
              if (!write || !commit)
                throw new InputTypeError("Expected byte sink write and commit capabilities.");
              if (signal.aborted) throw new CancellationError("Byte sink staging cancelled.");
              await (write as StagedByteSink["write"])(bytes);
              if (signal.aborted) throw new CancellationError("Byte sink writing cancelled.");
              await commit();
            } catch (error) {
              try {
                await abort();
              } catch (cleanup) {
                throw new AggregateError([error, cleanup], "Byte sink cleanup failed.");
              }
              throw error;
            }
          }
        }
      }
    };
  }
  const write = capabilityMethod(output, "write");
  if (write)
    return {
      options: { output: "-" },
      transport: { stdout: { write: write as ArchiveSink["write"] } }
    };
  if (![Object.prototype, null].includes(Object.getPrototypeOf(output)))
    throw new InputTypeError("Expected a finite document output path.");
  const record: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(output)) {
    const descriptor = Object.getOwnPropertyDescriptor(output, key)!;
    if (
      typeof key !== "string" ||
      !["path", "capability"].includes(key) ||
      !("value" in descriptor)
    )
      throw new InputTypeError("Expected a finite document output path.");
    record[key] = descriptor.value;
  }
  if (
    typeof record.path !== "string" ||
    typeof record.capability !== "string" ||
    !record.capability
  )
    throw new InputTypeError("Expected a capability-bearing document output path.");
  const path = record.path;
  if (
    path.length > context.limits.maxPathBytes ||
    new TextEncoder().encode(path).length > context.limits.maxPathBytes
  )
    throw new ResourceLimitError("Document output path byte limit exceeded.");
  if (
    !path.startsWith("/") ||
    path === "/" ||
    path.includes("\0") ||
    path
      .slice(1)
      .split("/")
      .some((part) => !part || part === "." || part === "..")
  )
    throw new InputTypeError("Expected a canonical virtual document output path.");
  if (!context.vfs || context.vfs.capability !== record.capability)
    throw new UnsupportedEditError(
      "Document output paths require a matching explicit VFS capability."
    );
  return { options: { output: path }, transport: { filesystem: context.vfs.filesystem } };
}
