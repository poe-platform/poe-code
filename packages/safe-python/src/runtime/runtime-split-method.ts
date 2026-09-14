import {bindRuntimeClinicArguments} from "./runtime-clinic-arguments.js";
import { PythonRuntimeError } from "./error.js";
import {unsupportedBuffer} from "./runtime-buffer-error.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { runtimeStringPayload } from "./runtime-string-payload.js";
import type { CodePointString } from "./code-point-string.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { ListStorage } from "./list-storage.js";
import { runtimeSizeIndex } from "./runtime-size-index.js";
import type { IntegerIndexContext } from "./index-protocol.js";
import type { RuntimeBufferContext, RuntimeBufferLease } from "./runtime-buffer-context.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Native string/bytes splitting with optional guest index slots. String subtype
 * storage is inspected without conversions; split results are exact strings. */
export function createRuntimeSplitMethod(receiver: RuntimeValue, name: "split" | "rsplit", values: RuntimeValues, meter: ExecutionMeter, context?: IntegerIndexContext<RuntimeValue>, buffers?: RuntimeBufferContext): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  const source = receiver.kind === "bytes" ? receiver : runtimeStringPayload(receiver);
  if (source === undefined) throw Error("splitting requires native string or bytes storage");
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter, invocation) {
      meter.checkpoint();
      const count = positional.length + keywords.items.size;
      if (count > 2) throw new PythonRuntimeError("TypeError", `${name}() takes at most 2 ${positional.length === 0 ? "keyword " : ""}arguments (${count} given)`);
      const args=bindRuntimeClinicArguments(name,["sep","maxsplit"],positional,keywords,values,meter,invocation);
      const separator=args[0]??values.none,limit=args[1];
      const maxsplit = limit === undefined ? -1n : runtimeSizeIndex(limit, meter, context);
      if (source.kind === "bytes") {
        let lease: RuntimeBufferLease | undefined;
        try {
          if (separator.kind !== "none" && separator.kind !== "bytes") {
            lease = buffers?.acquireSimple(separator); meter.checkpoint();
            if (lease === undefined) unsupportedBuffer(separator,meter,buffers);
          }
          const storage = separator.kind === "none" ? null : separator.kind === "bytes" ? separator.value : lease!.copy();
          meter.checkpoint();
          const reverse = name === "rsplit", result = new ListStorage<RuntimeValue>([], meter);
          for (const part of source.value.split(storage, maxsplit, reverse, meter)) {
            meter.checkpoint();
            result.append(part === source.value ? receiver : values.bytes(part));
          }
          if (reverse) result.reverse();
          return values.list(result);
        } finally {
          lease?.release(); meter.checkpoint();
        }
      }
      const separatorPayload = runtimeStringPayload(separator);
      if (separator.kind !== "none" && separatorPayload === undefined) throw new PythonRuntimeError("TypeError", `must be str or None, not ${diagnosticTypeName(separator.kind === "not-implemented" ? "NotImplementedType" : separator.kind === "instance" ? separator.type.value.diagnosticName : separator.kind, meter, 100)}`);
      // CPython's impossible-separator shortcut precedes the copying split
      // kernels, retaining even subtype receivers. Exact strings already retain
      // their unchanged storage below and need no extra Unicode-width scan.
      if (receiver.kind === "instance" && separatorPayload !== undefined &&
        (separatorPayload.value.length > source.value.length || unicodeStorageWidth(separatorPayload.value, meter) > unicodeStorageWidth(source.value, meter))) return values.list([receiver]);
      const reverse = name === "rsplit", result = new ListStorage<RuntimeValue>([], meter);
      for (const part of source.value.split(separator.kind === "none" ? null : separatorPayload!.value, maxsplit, reverse, meter)) {
        meter.checkpoint();
        // A zero-limit whitespace remainder uses the copying path, not the
        // unsplit fast path. Canonical construction handles Latin-1 caching.
        const copyRemainder = separator.kind === "none" && maxsplit === 0n;
        result.append(receiver.kind === "str" && part === source.value && !copyRemainder ? receiver : values.stringPoints(part, "canonical"));
      }
      if (reverse) result.reverse();
      return values.list(result);
    }
  });
}

function unicodeStorageWidth(text: CodePointString, meter: ExecutionMeter): number {
  let width = 1;
  for (const point of text) {
    meter.checkpoint();
    if (point > 0xffff) return 4;
    if (point > 0xff) width = 2;
  }
  return width;
}
