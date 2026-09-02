import { createConsoleJsonGlobals } from "./globals/console-json.js";
import { createCollectionGlobals } from "./globals/collections.js";
import { createFloat32ArrayGlobal } from "./globals/float32array.js";
import { createErrorGlobals } from "./globals/error.js";
import { createMathGlobals } from "./globals/math.js";
import { createRegexGlobals } from "./globals/regex.js";
import { createMiscGlobals } from "./globals/misc.js";
import { createObjectArrayGlobals } from "./globals/object-array.js";
import { createPromiseGlobals } from "./promise.js";

export function createBuiltinBindings(
  options: Parameters<typeof createConsoleJsonGlobals>[0] & { random?: () => number }
) {
  return {
    ...createConsoleJsonGlobals(options),
    ...createCollectionGlobals(options),
    Float32Array: createFloat32ArrayGlobal(options.budget),
    ...createErrorGlobals(options),
    ...createMathGlobals({ random: options.random }),
    ...createObjectArrayGlobals(options),
    ...createMiscGlobals(options),
    ...createPromiseGlobals(options),
    ...createRegexGlobals(options.compileOwner)
  };
}
