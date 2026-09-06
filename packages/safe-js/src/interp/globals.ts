import { createConsoleJsonGlobals } from "./globals/console-json.js";
import { createCollectionGlobals } from "./globals/collections.js";
import { createFloat32ArrayGlobal } from "./globals/float32array.js";
import { createErrorGlobals } from "./globals/error.js";
import { createMathGlobals } from "./globals/math.js";
import { createRegexGlobals } from "./globals/regex.js";
import { createMiscGlobals } from "./globals/misc.js";
import { createUriGlobals } from "./globals/uri.js";
import { createObjectArrayGlobals } from "./globals/object-array.js";
import { createPromiseGlobals } from "./promise.js";
import { createDateGlobal } from "./globals/date.js";
import { createSymbolGlobal } from "./globals/symbol.js";
import { createBigIntGlobal } from "./globals/bigint.js";
import type { RunClock } from "../run.js";
import { registerBuiltinIdentities } from "./intrinsics.js";
import { registerIntrinsicObject } from "./object-model.js";

export function createBuiltinBindings(
  options: Parameters<typeof createConsoleJsonGlobals>[0] & { random?: () => number; clock?: RunClock }
) {
  const bindings = {
    ...createConsoleJsonGlobals(options),
    ...createCollectionGlobals(options),
    Float32Array: createFloat32ArrayGlobal(options.budget),
    Date: createDateGlobal(options),
    Symbol: createSymbolGlobal(options.budget),
    BigInt: createBigIntGlobal(options.budget),
    ...createErrorGlobals(options),
    ...createMathGlobals({ random: options.random }),
    ...createObjectArrayGlobals(options),
    ...createMiscGlobals(options),
    ...createUriGlobals(options.budget),
    ...createPromiseGlobals(options),
    ...createRegexGlobals(options)
  };
  registerBuiltinIdentities(options.budget, bindings);
  registerIntrinsicObject(options.budget, bindings.Math);
  return bindings;
}
