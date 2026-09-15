import {PythonRuntimeError} from "./error.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {runtimeDictionaryPayload} from "./runtime-dictionary-payload.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import type {BuiltinInvocationContext, RuntimeValue, RuntimeValues} from "./runtime-values.js";

/** Resolve guest package metadata before module discovery. Like CPython's
 * resolve_name, dictionary reads use native storage, while spec descriptors and
 * package equality use guest protocols. No name grants access to host modules. */
export function resolveRuntimeRelativeImport(name: string, globals: RuntimeValue | undefined, level: number, values: RuntimeValues, meter: ExecutionMeter, context: BuiltinInvocationContext): string {
  meter.checkpoint(1,128);
  if (globals === undefined) throw new PythonRuntimeError("KeyError", "'__name__' not in globals");
  const dictionary = runtimeDictionaryPayload(globals);
  if (dictionary === undefined) throw new PythonRuntimeError("TypeError", "globals must be a dict");
  let packageValue = dictionary.items.lookup(values.internString("__package__"))?.value;
  const spec = dictionary.items.lookup(values.internString("__spec__"))?.value;
  if (packageValue?.kind === "none") packageValue = undefined;
  const string = (value: RuntimeValue, message: string): string => {
    const payload = runtimeStringPayload(value);
    if (payload === undefined) throw new PythonRuntimeError("TypeError", message);
    let result = "";
    for (const point of payload.value) {meter.checkpoint(1,4); result += String.fromCodePoint(point);}
    return result;
  };
  let packageName: string;
  if (packageValue !== undefined) {
    packageName = string(packageValue, "package must be a string");
    if (spec !== undefined && spec.kind !== "none") {
      if (context.attribute === undefined || context.compareTruth === undefined) throw Error("relative imports require guest attribute and comparison protocols");
      const parent = context.attribute(spec, "parent");
      meter.checkpoint();
      const equal = context.compareTruth("==", packageValue, parent);
      meter.checkpoint();
      if (!equal) {
        if (context.warn === undefined) throw Error("relative imports require the warning service");
        context.warn("DeprecationWarning", "__package__ != __spec__.parent");
        meter.checkpoint();
      }
    }
  } else if (spec !== undefined && spec.kind !== "none") {
    if (context.attribute === undefined) throw Error("relative imports require guest attributes");
    const parent = context.attribute(spec, "parent");
    meter.checkpoint();
    packageName = string(parent, "__spec__.parent must be a string");
  } else {
    if (context.warn === undefined) throw Error("relative imports require the warning service");
    context.warn("ImportWarning", "can't resolve package from __spec__ or __package__, falling back on __name__ and __path__");
    meter.checkpoint();
    const moduleName = dictionary.items.lookup(values.internString("__name__"))?.value;
    if (moduleName === undefined) throw new PythonRuntimeError("KeyError", "'__name__' not in globals");
    packageName = string(moduleName, "__name__ must be a string");
    if (!dictionary.items.containsKey(values.internString("__path__"))) {
      meter.checkpoint(packageName.length);
      const dot = packageName.lastIndexOf(".");
      if (dot < 0) throw new PythonRuntimeError("ImportError", "attempted relative import with no known parent package");
      packageName = packageName.slice(0, dot);
    }
  }
  if (packageName.length === 0) throw new PythonRuntimeError("ImportError", "attempted relative import with no known parent package");
  let end = packageName.length;
  for (let up = 1; up < level; up++) {
    meter.checkpoint(end + 1);
    end = end === 0 ? -1 : packageName.lastIndexOf(".", end - 1);
    if (end < 0) throw new PythonRuntimeError("ImportError", "attempted relative import beyond top-level package");
  }
  meter.checkpoint(1, 2 * (end + name.length + 1));
  return packageName.slice(0, end) + (name.length === 0 ? "" : "." + name);
}
