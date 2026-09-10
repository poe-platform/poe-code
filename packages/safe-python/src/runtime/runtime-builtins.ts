import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";
import { createAbsBuiltin } from "./builtin-abs.js";
import {createAiterBuiltin} from "./builtin-aiter.js";
import {createAnextBuiltin} from "./builtin-anext.js";
import { createAllAnyBuiltin } from "./builtin-all-any.js";
import { createAttributeLookupBuiltin } from "./builtin-attribute-lookup.js";
import { createAttributeMutationBuiltin } from "./builtin-attribute-mutation.js";
import { createBuildClassBuiltin } from "./builtin-build-class.js";
import { createCallableBuiltin } from "./builtin-callable.js";
import { createChrBuiltin } from "./builtin-chr.js";
import { createDivmodBuiltin } from "./builtin-divmod.js";
import { createEnumerateBuiltin } from "./builtin-enumerate.js";
import { createFilterBuiltin } from "./builtin-filter.js";
import { createFormatBuiltin } from "./builtin-format.js";
import { createHashBuiltin } from "./builtin-hash.js";
import { createIdBuiltin } from "./builtin-id.js";
import { createIterBuiltin, createNextBuiltin } from "./builtin-iteration.js";
import { createLenBuiltin } from "./builtin-len.js";
import { createMapBuiltin } from "./builtin-map.js";
import { createMinMaxBuiltin } from "./builtin-min-max.js";
import { createOrdBuiltin } from "./builtin-ord.js";
import { createPowBuiltin } from "./builtin-pow.js";
import { createPrintBuiltin } from "./builtin-print.js";
import { createRadixBuiltin } from "./builtin-radix.js";
import { createRepresentationBuiltin } from "./builtin-representation.js";
import { createReversedBuiltin } from "./builtin-reversed.js";
import { createRoundBuiltin } from "./builtin-round.js";
import { createSortedBuiltin } from "./builtin-sorted.js";
import { createSumBuiltin } from "./builtin-sum.js";
import { createZipBuiltin } from "./builtin-zip.js";

/** Execution-owned capabilities; contracts stay derived from their factories.
 * Optional protocols retain each factory's native fallback. Required policies
 * never fall back to host attributes, console output or filesystem access. */
export interface RuntimeBuiltinContexts {
  abs?: Parameters<typeof createAbsBuiltin>[2];
  aiter?:Parameters<typeof createAiterBuiltin>[2];
  anext?:Parameters<typeof createAnextBuiltin>[2];
  allAny?: Parameters<typeof createAllAnyBuiltin>[3];
  attributeLookup?: Parameters<typeof createAttributeLookupBuiltin>[3];
  attributeMutation?: Parameters<typeof createAttributeMutationBuiltin>[3];
  buildClass: Parameters<typeof createBuildClassBuiltin>[0];
  callable?: Parameters<typeof createCallableBuiltin>[2];
  integerIndex?: Parameters<typeof createChrBuiltin>[2];
  divmod?: Parameters<typeof createDivmodBuiltin>[2];
  enumerate?: Parameters<typeof createEnumerateBuiltin>[2];
  filter?: Parameters<typeof createFilterBuiltin>[2];
  format?: Parameters<typeof createFormatBuiltin>[2];
  hash: Parameters<typeof createHashBuiltin>[2];
  identity: Parameters<typeof createIdBuiltin>[2];
  iter?: Parameters<typeof createIterBuiltin>[2];
  iteration?: Parameters<typeof createIterBuiltin>[3];
  len?: Parameters<typeof createLenBuiltin>[2];
  map?: Parameters<typeof createMapBuiltin>[2];
  minMax?: Parameters<typeof createMinMaxBuiltin>[3];
  ord?: Parameters<typeof createOrdBuiltin>[2];
  power?: Parameters<typeof createPowBuiltin>[2];
  print: Parameters<typeof createPrintBuiltin>[2];
  representation?: Parameters<typeof createRepresentationBuiltin>[3];
  reversed?: Parameters<typeof createReversedBuiltin>[2];
  round?: Parameters<typeof createRoundBuiltin>[2];
  sorted?: Parameters<typeof createSortedBuiltin>[2];
  sum?: Parameters<typeof createSumBuiltin>[2];
  zip?: Parameters<typeof createZipBuiltin>[2];
}

/** Assemble currently implemented builtin function/constructor capabilities and
 * singleton names. Native type objects, exception classes, module metadata and
 * not-yet-implemented builtins still need object/stdlib assembly. Explicit
 * extensions may supply those objects or override entries. Each invocation
 * produces an independent mutable namespace with stable values inside it. */
export function createRuntimeBuiltins(values: RuntimeValues, meter: ExecutionMeter, context: RuntimeBuiltinContexts, extensions?: Iterable<readonly [string, RuntimeValue]>): Map<string, RuntimeValue> {
  meter.checkpoint(1, 128);
  const namespace = new Map<string, RuntimeValue>();
  const register = (value: BuiltinFunctionValue) => {
    meter.checkpoint(1, 48 + value.value.name.length * 2);
    namespace.set(value.value.name, value);
  };
  register(createAbsBuiltin(values, meter, context.abs));
  register(createAiterBuiltin(values,meter,context.aiter));
  register(createAnextBuiltin(values,meter,context.anext));
  for (const name of ["all", "any"] as const) register(createAllAnyBuiltin(name, values, meter, context.allAny));
  for (const name of ["getattr", "hasattr"] as const) register(createAttributeLookupBuiltin(name, values, meter, context.attributeLookup));
  for (const name of ["setattr", "delattr"] as const) register(createAttributeMutationBuiltin(name, values, meter, context.attributeMutation));
  register(createBuildClassBuiltin(context.buildClass, values, meter));
  register(createCallableBuiltin(values, meter, context.callable));
  register(createChrBuiltin(values, meter, context.integerIndex));
  register(createDivmodBuiltin(values, meter, context.divmod));
  register(createEnumerateBuiltin(values, meter, context.enumerate));
  register(createFilterBuiltin(values, meter, context.filter));
  register(createFormatBuiltin(values, meter, context.format));
  register(createHashBuiltin(values, meter, context.hash));
  register(createIdBuiltin(values, meter, context.identity));
  register(createIterBuiltin(values, meter, context.iter, context.iteration));
  register(createNextBuiltin(values, meter, context.iteration));
  register(createLenBuiltin(values, meter, context.len));
  register(createMapBuiltin(values, meter, context.map));
  for (const name of ["min", "max"] as const) register(createMinMaxBuiltin(name, values, meter, context.minMax));
  register(createOrdBuiltin(values, meter, context.ord));
  register(createPowBuiltin(values, meter, context.power));
  register(createPrintBuiltin(values, meter, context.print));
  for (const name of ["bin", "oct", "hex"] as const) register(createRadixBuiltin(name, values, meter, context.integerIndex));
  for (const name of ["repr", "ascii"] as const) register(createRepresentationBuiltin(name, values, meter, context.representation));
  register(createReversedBuiltin(values, meter, context.reversed));
  register(createRoundBuiltin(values, meter, context.round));
  register(createSortedBuiltin(values, meter, context.sorted));
  register(createSumBuiltin(values, meter, context.sum));
  register(createZipBuiltin(values, meter, context.zip));
  meter.checkpoint(1, 512);
  for (const [name, value] of [["None", values.none], ["True", values.true], ["False", values.false], ["Ellipsis", values.ellipsis], ["NotImplemented", values.notImplemented], ["__debug__", values.true]] as const) namespace.set(name, value);
  if (extensions !== undefined) {
    try {
      for (const entry of extensions) {
        meter.checkpoint();
        const [name, value] = entry;
        meter.checkpoint(1, 48 + name.length * 2);
        namespace.set(name, value);
      }
    } finally {
      // Iterator acquisition, next, entry access and iterator cleanup can all
      // fail after cancellation. A cancelled assembly never publishes a map.
      meter.checkpoint();
    }
  }
  return namespace;
}
