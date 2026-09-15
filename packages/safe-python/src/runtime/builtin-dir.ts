import { PythonRuntimeError } from "./error.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { nativeIteratorLengthHint } from "./native-iterator-length-hint.js";
import { ProtocolIterator } from "./protocol-iterator.js";
import { runtimeExceptionMatches } from "./runtime-exception-matches.js";
import { runtimeIterate } from "./runtime-iteration.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Object discovery uses special lookup; namespace discovery belongs to the
 * active frame. Materialization and sorting retain guest iteration/comparison. */
export function createDirBuiltin(values: RuntimeValues, meter: ExecutionMeter, locals: () => RuntimeValue): BuiltinFunctionValue {
  meter.checkpoint(1, 96);
  return values.builtinFunction({ name: "dir", module: "builtins", doc: "dir([object]) -> list of strings\n\nIf called without an argument, return the names in the current scope.\nElse, return an alphabetized list of names comprising (some of) the\nattributes of the given object, and of attributes reachable from it.\nIf the object supplies a method named __dir__, it will be used;\notherwise the default dir() logic is used and returns:\n  for a module object: the module's attributes.\n  for a class object:  its attributes, and recursively the attributes\n    of its bases.\n  for any other object: its attributes, its class's attributes, and\n    recursively the attributes of its class's base classes.", invoke(args, kwargs, meter, invocation) {
    meter.checkpoint();
    if (kwargs.items.size) throw new PythonRuntimeError("TypeError", "dir() takes no keyword arguments");
    if (args.length > 1) throw new PythonRuntimeError("TypeError", `dir expected at most 1 argument, got ${args.length}`);
    if (!invocation?.lookupSpecial || !invocation.attribute || !invocation.compareTruth) throw Error("dir requires interpreter reflection and comparison capabilities");
    let source: RuntimeValue;
    let namespace: RuntimeValue | undefined;
    if (args.length) {
      const method = invocation.lookupSpecial(args[0], "__dir__");
      meter.checkpoint();
      if (method === undefined) throw new PythonRuntimeError("TypeError", "object does not provide __dir__");
      source = invocation.call(method, []);
    } else {
      namespace = locals();
      meter.checkpoint();
      if (namespace.kind === "dict") {
        source = values.list([]);
        for (const [key] of namespace.items.snapshot()) { meter.checkpoint(); source.items.append(key); }
      } else source = invocation.call(invocation.attribute(namespace, "keys"), []);
    }
    meter.checkpoint();
    const result = namespace !== undefined && source.kind === "list" ? source : values.list([]);
    if (source.kind === "list") {
      if (source !== result) result.items.extend(source.items);
    } else if (namespace === undefined) result.items.extendIterator(runtimeIterate(source, values, meter, invocation.iteration, undefined, true));
    else {
      let iterator;
      try { iterator = runtimeIterate(source, values, meter, invocation.iteration); }
      catch (error) {
        meter.checkpoint();
        if (!runtimeExceptionMatches(error, "TypeError", invocation)) throw error;
        const ownerName = diagnosticTypeName(invocation.typeName!(namespace), meter, 200);
        const resultName = diagnosticTypeName(invocation.typeName!(source), meter, 200);
        throw new PythonRuntimeError("TypeError", `${ownerName}.keys() returned a non-iterable (type ${resultName})`);
      }
      // PyMapping_Keys materializes the acquired iterator, requesting a second
      // iter() and its hint rather than the original keys result's length.
      if (iterator instanceof ProtocolIterator) {
        const original = iterator;
        iterator = original.reacquire();
        original.lengthHint(8n);
      } else nativeIteratorLengthHint(iterator, meter);
      result.items.extendIterator(iterator);
    }
    result.items.sort({ reverse: false, key: value => value, less: (a, b) => invocation.compareTruth!("<", a, b) });
    meter.checkpoint();
    return result;
  } });
}
