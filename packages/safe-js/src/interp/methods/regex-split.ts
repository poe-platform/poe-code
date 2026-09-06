import { type Budget } from "../budget.js";
import { type SandboxCallContext, type SandboxClosure, type SandboxValue, isSandboxClosure } from "../values.js";
import { getSandboxPropertyDescriptor } from "../object-model.js";
import { readPropertyDescriptor } from "../accessors.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { setSandboxProperty } from "../interpreter.js";
import { sandboxNumber, sandboxString } from "../string-coercion.js";
import { normalizeLastIndex } from "../regex/engine.js";
import { retainValues } from "../resources.js";
import { regexExec } from "./regex.js";

export async function regexSplit(target: SandboxValue, input: SandboxValue, limit: SandboxValue,
  constructor: SandboxClosure, budget: Budget, context?: SandboxCallContext): Promise<SandboxValue[]> {
  if (target === null || typeof target !== "object") throw new TypeError("RegExp split requires an object receiver.");
  let string: string | undefined;
  let species: SandboxValue;
  let field: SandboxValue;
  let flags: string | undefined;
  let matcher: SandboxValue;
  let match: SandboxValue;
  const result: SandboxValue[] = [];
  const release = retainValues(budget, () => [target, input, limit, string, species, field, flags, matcher, match, result]);
  const read = (value: SandboxValue, key: PropertyKey) => {
    if (context?.getProperty !== undefined) return context.getProperty(value, key);
    const descriptor = getSandboxPropertyDescriptor(value, key, budget);
    return descriptor === undefined ? undefined : readPropertyDescriptor(descriptor, value, context);
  };
  const append = (value: SandboxValue) => {
    budget.allocateArrayLength(result.length + 1);
    result.push(value);
  };
  try {
    string = await sandboxString(input, budget, context);
    input = undefined;
    field = await read(target, "constructor");
    species = constructor;
    if (field !== undefined) {
      if (field === null || typeof field !== "object") throw new TypeError("Invalid RegExp species constructor.");
      species = await read(field, Symbol.species);
      if (species === null || species === undefined) species = constructor;
    }
    field = undefined;
    if (!isSandboxClosure(species) || species.construct === undefined) throw new TypeError("RegExp species must be a constructor.");
    field = await read(target, "flags");
    flags = await sandboxString(field, budget, context);
    field = undefined;
    const unicode = flags.includes("u") || flags.includes("v");
    if (!flags.includes("y")) flags = budget.allocateString(flags + "y");
    matcher = await invokeBuiltinClosure(species, [target, flags], budget, context, undefined, true);
    const maximum = limit === undefined ? 2 ** 32 - 1 : (await sandboxNumber(limit, budget, context)) >>> 0;
    limit = undefined;
    if (maximum === 0) return result;
    if (string.length === 0) {
      match = await regexExec(matcher, string, budget, context);
      if (match === null) append(string);
      return result;
    }
    let end = 0;
    let index = 0;
    while (index < string.length) {
      budget.visitNode();
      match = undefined;
      await setSandboxProperty(matcher, "lastIndex", index, budget, true, context);
      match = await regexExec(matcher, string, budget, context);
      if (match !== null) {
        field = await read(matcher, "lastIndex");
        const next = Math.min(normalizeLastIndex(await sandboxNumber(field, budget, context)), string.length);
        field = undefined;
        if (next !== end) {
          append(budget.allocateString(string.slice(end, index)));
          if (result.length === maximum) return result;
          end = next;
          field = await read(match, "length");
          const length = normalizeLastIndex(await sandboxNumber(field, budget, context));
          field = undefined;
          for (let capture = 1; capture < length; capture++) {
            budget.visitNode();
            field = await read(match, String(capture));
            append(field);
            field = undefined;
            if (result.length === maximum) return result;
          }
          index = end;
          continue;
        }
      }
      index += unicode && (string.codePointAt(index) ?? 0) > 0xffff ? 2 : 1;
    }
    append(budget.allocateString(string.slice(end)));
    return result;
  } finally {
    release();
  }
}
