import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { representationObject, type RepresentationContext } from "./representation-protocol.js";
import { runtimeTruth } from "./runtime-truth.js";
import { suggestName } from "./name-suggestion.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface PrintContext {
  readonly representation: RepresentationContext<RuntimeValue>;
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
  return values.builtinFunction({ name: "print", invoke(positional, keywords, meter) {
    meter.checkpoint();
    let sep: RuntimeValue = values.none, end: RuntimeValue = values.none, file: RuntimeValue = values.none, flush: RuntimeValue | undefined;
    for (const [key, value] of keywords.items.snapshot()) {
      if (key.kind !== "str") throw new PythonRuntimeError("TypeError", "keywords must be strings");
      let name = "";
      for (const point of key.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); name += String.fromCodePoint(point); }
      if (name === "sep") sep = value;
      else if (name === "end") end = value;
      else if (name === "file") file = value;
      else if (name === "flush") flush = value;
      else {
        const suggestion = suggestName(name, ["sep", "end", "file", "flush"], meter);
        const hint = suggestion === undefined ? "" : `. Did you mean '${suggestion}'?`;
        throw new PythonRuntimeError("TypeError", `print() got an unexpected keyword argument '${name}'${hint}`);
      }
    }
    const shouldFlush = flush === undefined ? false : context.truth === undefined ? runtimeTruth(flush, meter) : context.truth(flush);
    meter.checkpoint();
    if (file.kind === "none") { file = context.stdout(); meter.checkpoint(); }
    if (file.kind === "none") return values.none;
    meter.checkpoint(0, 112);
    for (const [name, value] of [["sep", sep], ["end", end]] as const) {
      meter.checkpoint();
      if (value.kind !== "none" && context.representation.string(value) === undefined) {
        throw new PythonRuntimeError("TypeError", `${name} must be None or a string, not ${diagnosticTypeName(context.representation.typeName(value), meter)}`);
      }
      meter.checkpoint();
    }
    meter.checkpoint(0, 64);
    const write = (value: RuntimeValue) => {
      const invoke = context.lookupWrite(file); meter.checkpoint();
      const text = representationObject(value, "str", context.representation, meter);
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
