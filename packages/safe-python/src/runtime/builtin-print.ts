import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { representationObject, type RepresentationContext } from "./representation-protocol.js";
import { createRuntimeRepresentationContext } from "./runtime-representation.js";
import { runtimeTruth } from "./runtime-truth.js";
import { runtimeStringPayload } from "./runtime-string-payload.js";
import { unexpectedBuiltinKeyword } from "./unexpected-builtin-keyword.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface PrintContext {
  readonly representation?: RepresentationContext<RuntimeValue>;
  /** Resolve the execution's current sys.stdout. Missing attributes must throw;
   * None disables output. No host stream is selected implicitly. */
  stdout(): RuntimeValue;
  /** Resolve write separately for every chunk, before str conversion. The
   * returned invocation owns guest callability/argument checks and call limits. */
  lookupWrite(file: RuntimeValue): (text: RuntimeValue) => unknown;
  /** Resolve and invoke flush only after every write succeeds. */
  flush(file: RuntimeValue): unknown;
  truth?(value: RuntimeValue): boolean;
}

/** Explicit print registration. Streams may be guest objects or safe-fs-backed
 * capabilities; this builtin performs no implicit filesystem or console access.
 * Preserve incremental writes and partial output on failure, not a joined line.
 */
export function createPrintBuiltin(values: RuntimeValues, meter: ExecutionMeter, context: PrintContext): BuiltinFunctionValue {
  meter.checkpoint(1, 96);
  return values.builtinFunction({ name: "print", invoke(positional, keywords, meter, invocation) {
    meter.checkpoint();
    let sep: RuntimeValue = values.none, end: RuntimeValue = values.none, file: RuntimeValue = values.none, flush: RuntimeValue | undefined;
    meter.checkpoint(0, 64 + keywords.items.size * 32);
    const bound = new Set<string>();
    let unexpected = false;
    for (const [key, value] of keywords.items.snapshot()) {
      const payload = runtimeStringPayload(key);
      if (payload === undefined) throw new PythonRuntimeError("TypeError", "keywords must be strings");
      let name = "";
      for (const point of payload.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); name += String.fromCodePoint(point); }
      if (bound.has(name)) { unexpected = true; continue; }
      bound.add(name);
      if (name === "sep") sep = value;
      else if (name === "end") end = value;
      else if (name === "file") file = value;
      else if (name === "flush") flush = value;
      else unexpected = true;
    }
    if (unexpected) unexpectedBuiltinKeyword("print", keywords, ["sep", "end", "file", "flush"], values, meter, invocation);
    const shouldFlush = flush === undefined ? false : context.truth !== undefined ? context.truth(flush) : invocation?.truth !== undefined ? invocation.truth(flush) : runtimeTruth(flush, meter);
    meter.checkpoint();
    if (file.kind === "none") { file = context.stdout(); meter.checkpoint(); }
    if (file.kind === "none") return values.none;
    const representation = context.representation ?? invocation?.formatting ?? createRuntimeRepresentationContext(values, meter, {
      defaultRepr() { throw new Error("print() requires a representation policy for this value"); }
    });
    meter.checkpoint();
    meter.checkpoint(0, 112);
    for (const [name, value] of [["sep", sep], ["end", end]] as const) {
      meter.checkpoint();
      if (value.kind !== "none" && representation.string(value) === undefined) {
        throw new PythonRuntimeError("TypeError", `${name} must be None or a string, not ${diagnosticTypeName(representation.typeName(value), meter)}`);
      }
      meter.checkpoint();
    }
    meter.checkpoint(0, 64);
    const write = (value: RuntimeValue) => {
      const invoke = context.lookupWrite(file); meter.checkpoint();
      const text = representationObject(value, "str", representation, meter);
      invoke(text); meter.checkpoint();
    };
    for (let i = 0; i < positional.length; i++) {
      meter.checkpoint();
      if (i > 0) write(sep.kind === "none" ? values.string(" ") : sep);
      write(positional[i]);
    }
    write(end.kind === "none" ? values.string("\n") : end);
    if (shouldFlush) { context.flush(file); meter.checkpoint(); }
    return values.none;
  } });
}
