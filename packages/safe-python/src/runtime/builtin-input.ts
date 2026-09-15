import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { representationObject, type RepresentationContext } from "./representation-protocol.js";
import { createRuntimeRepresentationContext } from "./runtime-representation.js";
import { runtimeExceptionMatches } from "./runtime-exception-matches.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Noninteractive text streams supplied by the execution owner. The adapter
 * owns service errors and cancellation; no ambient streams are consulted. */
export interface InputContext {
  streams(): {
    write(prompt: RuntimeValue): void;
    flush(): void;
    readLine(): string | null;
  };
  readonly representation?: RepresentationContext<RuntimeValue>;
}

export function createInputBuiltin(values: RuntimeValues, meter: ExecutionMeter, context: InputContext): BuiltinFunctionValue {
  meter.checkpoint(1, 96);
  return values.builtinFunction({ name: "input", invoke(args, kwargs, meter, invocation) {
    meter.checkpoint();
    if (kwargs.items.size) throw new PythonRuntimeError("TypeError", "input() takes no keyword arguments");
    if (args.length > 1) throw new PythonRuntimeError("TypeError", `input expected at most 1 argument, got ${args.length}`);
    const streams = context.streams();
    meter.checkpoint();
    if (args.length) {
      const representation = context.representation ?? invocation?.formatting ?? createRuntimeRepresentationContext(values, meter, {
        defaultRepr() { throw new Error("input() requires a representation policy for this value"); }
      });
      const prompt = representationObject(args[0], "str", representation, meter);
      streams.write(prompt);
      meter.checkpoint();
    }
    try { streams.flush(); }
    catch (error) {
      // CPython clears stdout flush errors before its noninteractive read.
      // Execution termination and host service failures remain fatal.
      if (!(error instanceof PythonRuntimeError) && !runtimeExceptionMatches(error, "BaseException", invocation)) throw error;
    }
    meter.checkpoint();
    const line = streams.readLine();
    meter.checkpoint();
    if (line === null || line === "") throw new PythonRuntimeError("EOFError", "EOF when reading a line");
    if (typeof line !== "string") throw new TypeError("input service must return a string or null synchronously");
    return values.string(line.endsWith("\n") ? line.slice(0, -1) : line);
  } });
}
