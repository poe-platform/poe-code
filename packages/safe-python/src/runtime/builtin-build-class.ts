import { buildClass, type ClassBuilderContext } from "./class-builder.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface RuntimeClassBuilderContext extends Omit<ClassBuilderContext<RuntimeValue, RuntimeValue>, "isFunction" | "isString" | "preparation"> {
  readonly preparation: Omit<ClassBuilderContext<RuntimeValue, RuntimeValue>["preparation"], "isMetaclassKeyword">;
}

/** Explicitly register the concrete builtin using the runtime's object policies.
 * Intrinsic function/string checks and reserved keyword recognition are owned
 * here. Bases, metaclass protocols and prepared-body execution remain supplied
 * capabilities; registration never executes them or grants filesystem access.
 */
export function createBuildClassBuiltin(context: RuntimeClassBuilderContext, values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  const metaclassKey = values.string("metaclass");
  return values.builtinFunction({
    name: "__build_class__",
    invoke(positional, keywords, meter) {
      meter.checkpoint(1, 320);
      const entries = new Map<RuntimeValue, RuntimeValue>();
      for (const [key, value] of keywords.items.snapshot()) {
        meter.checkpoint(1, 48);
        if (key.kind !== "str") throw new PythonRuntimeError("TypeError", "keywords must be strings");
        entries.set(key, value);
      }
      const preparation = context.preparation;
      const result = buildClass(positional, entries, {
        isFunction: value => value.kind === "function",
        isString: value => value.kind === "str",
        bases: context.bases, construction: context.construction,
        executeBody: context.executeBody.bind(context),
        storeOriginalBases: context.storeOriginalBases.bind(context),
        preparation: {
          defaultType: preparation.defaultType,
          tupleItems: preparation.tupleItems.bind(preparation),
          isType: preparation.isType.bind(preparation), typeOf: preparation.typeOf.bind(preparation),
          mro: preparation.mro.bind(preparation), typeName: preparation.typeName.bind(preparation),
          lookupPrepare: preparation.lookupPrepare.bind(preparation), callPrepare: preparation.callPrepare.bind(preparation),
          emptyNamespace: preparation.emptyNamespace.bind(preparation), isMapping: preparation.isMapping.bind(preparation),
          isMetaclassKeyword: key => key.kind === "str" && key.value.compare(metaclassKey.value, meter) === 0
        }
      }, meter);
      meter.checkpoint();
      return result;
    }
  });
}
