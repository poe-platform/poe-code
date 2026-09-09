import { createConsoleJsonGlobals } from "./globals/console-json.js";
import { createCollectionGlobals } from "./globals/collections.js";
import { installCollectionIteratorPrototypes } from "./globals/collection-prototypes.js";
import { createNumericTypedArrayGlobal, createNumericTypedArrayPrototypes } from "./globals/numeric-typed-array.js";
import { numericTypedArrayConstructors } from "./typed-array.js";
import type { SandboxClosure } from "./values.js";
import { createErrorGlobals, createErrorPrototypes } from "./globals/error.js";
import { createMathGlobals } from "./globals/math.js";
import { createRegexGlobals, installRegExpIteratorPrototype } from "./globals/regex.js";
import { createMiscGlobals } from "./globals/misc.js";
import { createUriGlobals } from "./globals/uri.js";
import { createObjectArrayGlobals } from "./globals/object-array.js";
import { createFunctionPrototype, installDynamicFunctionConstructors } from "./globals/function.js";
import { createEvalGlobal } from "./globals/eval.js";
import { createGeneratorPrototypes } from "./globals/generator.js";
import { createPromiseGlobals } from "./promise.js";
import { createDateGlobal } from "./globals/date.js";
import { createIteratorGlobal } from "./globals/iterator.js";
import { createDisposableStackGlobal } from "./globals/disposable-stack.js";
import { createAsyncDisposableStackGlobal } from "./globals/async-disposable-stack.js";
import { createSymbolGlobal } from "./globals/symbol.js";
import { createBigIntGlobal } from "./globals/bigint.js";
import { createArrayBufferGlobal } from "./globals/array-buffer.js";
import { createDataViewGlobal } from "./globals/data-view.js";
import { createReflectGlobal } from "./globals/reflect.js";
import { createAtomicsGlobal } from "./globals/atomics.js";
import { createSharedArrayBufferGlobal } from "./globals/shared-array-buffer.js";
import { createProxyGlobal } from "./globals/proxy.js";
import { activeFunctionRealmPrototypes } from "./function-realm.js";
import { createIntlGlobal } from "./globals/intl.js";
import type { RunClock } from "../run.js";
import { builtinGlobalObjects, mutableBuiltinBindings, registerBuiltinIdentities } from "./intrinsics.js";
import { createIntrinsicObject, getSandboxPrototype, registerIntrinsicObject, setSandboxPrototype } from "./object-model.js";

export function createBuiltinBindings(
  options: Parameters<typeof createConsoleJsonGlobals>[0] & { random?: () => number; clock?: RunClock; functionHasInstance?: boolean; errorPrototypes?: boolean; typedArrayPrototypes?: boolean }
) {
  activeFunctionRealmPrototypes.delete(options.budget);
  const date = createDateGlobal(options);
  const baseBindings = {
    eval: createEvalGlobal(options.budget),
    ...createConsoleJsonGlobals(options),
    ...createCollectionGlobals(options),
    ...Object.fromEntries(Object.entries(numericTypedArrayConstructors).map(([name, Native]) =>
      [name, createNumericTypedArrayGlobal(options.budget, options.typedArrayPrototypes !== false, Native)])) as Record<keyof typeof numericTypedArrayConstructors, SandboxClosure>,
    Date: date,
    Symbol: createSymbolGlobal(options.budget),
    BigInt: createBigIntGlobal(options.budget),
    ...createErrorGlobals({ ...options, errorPrototypes: options.errorPrototypes !== false }),
    ...createMathGlobals({ random: options.random, budget: options.budget }),
    ...createObjectArrayGlobals(options),
    Iterator: createIteratorGlobal(options.budget),
    DisposableStack: createDisposableStackGlobal(options.budget),
    AsyncDisposableStack: createAsyncDisposableStackGlobal(options.budget),
    Reflect: createReflectGlobal(options.budget),
    Atomics: createAtomicsGlobal(options.budget),
    SharedArrayBuffer: createSharedArrayBufferGlobal(options.budget),
    Proxy: createProxyGlobal(options.budget),
    Intl: createIntlGlobal(options.budget, date.properties!.now as SandboxClosure),
    ArrayBuffer: createArrayBufferGlobal(options.budget),
    DataView: createDataViewGlobal(options.budget),
    ...createMiscGlobals(options),
    ...createUriGlobals(options.budget),
    ...createPromiseGlobals(options),
    ...createRegexGlobals(options)
  };
  installCollectionIteratorPrototypes(options.budget);
  installRegExpIteratorPrototype(options.budget);
  const bindings = {...baseBindings, Function: createFunctionPrototype(options.budget, options.functionHasInstance)};
  if (options.typedArrayPrototypes !== false) createNumericTypedArrayPrototypes(options.budget, bindings);
  if (options.errorPrototypes !== false) createErrorPrototypes(options.budget, bindings);
  createGeneratorPrototypes(options.budget);
  installDynamicFunctionConstructors(options.budget, bindings.Function);
  registerBuiltinIdentities(options.budget, bindings);
  mutableBuiltinBindings.set(bindings, new Set(Object.keys(bindings).filter(name =>
    name !== "Infinity" && name !== "NaN" && name !== "undefined")));
  const globalObject = createIntrinsicObject();
  // Builtins already have canonical identities; register only the new root.
  registerBuiltinIdentities(options.budget, {globalThis: globalObject});
  for (const [name, value] of Object.entries({...bindings, undefined})) {
    const mutable = name !== "Infinity" && name !== "NaN" && name !== "undefined";
    Object.defineProperty(globalObject, name, {value, writable: mutable, configurable: mutable});
  }
  Object.defineProperty(globalObject, "globalThis", {value: globalObject, writable: true, configurable: true});
  setSandboxPrototype(globalObject, getSandboxPrototype(globalObject, options.budget), options.budget);
  registerIntrinsicObject(options.budget, globalObject, false);
  builtinGlobalObjects.set(bindings, globalObject);
  return bindings;
}
