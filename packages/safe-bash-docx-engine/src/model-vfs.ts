import {
  CancellationError,
  InputTypeError,
  InvalidValueError,
  ResourceLimitError
} from "./archive.js";
import { matchesModelVfs, type AdmittedModelContext } from "./model-context.js";
import type { DocumentByteSource } from "./io.js";
import { UnsupportedEditError } from "./xml-write.js";

/** One canonical virtual path grammar for document, template and image reads. */
export function modelVfsResolver(
  path: unknown,
  capability: unknown,
  context: AdmittedModelContext
) {
  if (
    typeof path !== "string" ||
    capability === undefined ||
    capability === null ||
    (typeof capability !== "string" && typeof capability !== "object") ||
    capability === ""
  )
    throw new InputTypeError("Expected a capability-bearing virtual path.");
  if (path.length > context.limits.maxPathBytes)
    throw new ResourceLimitError("Virtual path byte limit exceeded.");
  context.budget.charge("work", path.length);
  context.budget.charge("retainedBytes", path.length * 4);
  if (new TextEncoder().encode(path).length > context.limits.maxPathBytes)
    throw new ResourceLimitError("Virtual path byte limit exceeded.");
  if (
    !path.startsWith("/") ||
    path.includes("\\") ||
    [...path].some((scalar) => {
      const point = scalar.codePointAt(0)!;
      return point < 32 || point === 127 || (point >= 0xd800 && point <= 0xdfff);
    }) ||
    path
      .slice(1)
      .split("/")
      .some((part) => !part || part === "." || part === "..")
  )
    throw new InvalidValueError("Expected a canonical virtual path.");
  const resolver =
    typeof capability === "string"
      ? context.binaryResolver?.capability === capability
        ? context.binaryResolver
        : undefined
      : matchesModelVfs(capability, context)
        ? context.vfs
        : undefined;
  if (!resolver)
    throw new UnsupportedEditError("Virtual paths require a matching explicit capability.");
  return resolver;
}

export function modelVfsSource(path: unknown, capability: unknown, context: AdmittedModelContext, maxBytes: number): DocumentByteSource {
  const resolver = modelVfsResolver(path, capability, context);
  return {
    open(signal) {
      return {
        async *[Symbol.asyncIterator]() {
          context.budget.check("work", 0);
          const source = await resolver.open(path as string, Object.freeze({ signal, maxBytes }));
          context.budget.check("work", 0);
          if (signal.aborted) throw new CancellationError("Virtual input admission cancelled.");
          if (!source || typeof source[Symbol.asyncIterator] !== "function")
            throw new InputTypeError("Expected a virtual byte source.");
          const iterator = source[Symbol.asyncIterator]();
          let exhausted = false,
            failed = false;
          let failure: unknown;
          try {
            if (!iterator || typeof iterator.next !== "function")
              throw new InputTypeError("Expected a virtual byte iterator.");
            while (true) {
              if (signal.aborted) throw new CancellationError("Virtual input admission cancelled.");
              const item = await iterator.next();
              if (item === null || (typeof item !== "object" && typeof item !== "function"))
                throw new InputTypeError("Expected a virtual byte iterator result.");
              if (item.done) {
                exhausted = true;
                break;
              }
              yield item.value;
            }
          } catch (error) {
            failed = true;
            failure = error;
          } finally {
            // Delegating with yield* does not close an iterator whose next rejects.
            if (!exhausted && iterator?.return) {
              try {
                await iterator.return();
              } catch (error) {
                if (!failed) {
                  failed = true;
                  failure = error;
                }
              }
            }
          }
          if (failed) throw failure;
        }
      };
    }
  };
}
