import {
  createSandboxClosure,
  createSandboxRegex,
  isSandboxClosure,
  isSandboxRegex,
  reconcileCompiledValues,
  type SandboxCallContext,
  type SandboxClosure,
  type SandboxObject,
  type SandboxRegex,
  type SandboxValue
} from "../values.js";
import { CompileScope } from "../regex/compile-guard.js";
import { SandboxError, type Budget, type CompileOwner } from "../budget.js";
import { sandboxNumber, sandboxString } from "../string-coercion.js";
import { getSandboxPropertyDescriptor, installRegexPrototype, materializeFunctionProperties, setSandboxPrototype } from "../object-model.js";
import { accessorAdapter, readPropertyDescriptor } from "../accessors.js";
import { callRegexMethod, getRegexMember, regexFlagProperties, regexSearch, type RegexMethodName } from "../methods/regex.js";
import { regexMatch, regexReplace } from "../methods/string.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { restoreSandboxRegExpIterator } from "../regexp-iterator.js";
import { normalizeLastIndex } from "../regex/engine.js";
import { retainValues } from "../resources.js";
import { setSandboxProperty } from "../interpreter.js";

export function createRegexGlobals(options: { budget: Budget; compileOwner?: CompileOwner }): { RegExp: SandboxClosure } {
  const invoke = (construct: boolean) => async (args: readonly SandboxValue[], context?: SandboxCallContext) => {
    const selected = options.compileOwner ?? context?.compilation?.owner;
    if (context?.compilation?.owner !== undefined && selected !== context.compilation.owner) {
      throw new SandboxError("reentry");
    }
    const operation = options.budget.acquireCompileOwner(false, selected);
    const compilation = context?.compilation?.owner === operation.owner
      ? context.compilation : new CompileScope(operation.owner);
    let source = "";
    let retainedSource: SandboxValue;
    let retainedFlags: SandboxValue;
    let retainedPrototype: SandboxValue;
    const retained = {};
    options.budget.setRetainedValues(retained, () => [...args, source, retainedSource, retainedFlags, retainedPrototype]);
    try {
      const pattern = args[0];
      const flags = args[1];
      const read = (key: PropertyKey) => {
        const descriptor = getSandboxPropertyDescriptor(pattern, key, options.budget);
        if (context?.getProperty !== undefined) return context.getProperty(pattern, key);
        return descriptor === undefined ? undefined : readPropertyDescriptor(descriptor, pattern, context);
      };
      let regexLike = false;
      if (pattern !== null && typeof pattern === "object") {
        const match = await read(Symbol.match);
        regexLike = match === undefined ? isSandboxRegex(pattern) : Boolean(match);
      }
      if (!construct && regexLike && flags === undefined && await read("constructor") === constructor) return pattern;
      let sourceValue: SandboxValue = pattern;
      let flagsValue: SandboxValue = flags;
      if (isSandboxRegex(pattern)) {
        sourceValue = pattern.source;
        if (flags === undefined) flagsValue = pattern.flags;
      } else if (regexLike) {
        sourceValue = retainedSource = await read("source");
        if (flags === undefined) flagsValue = retainedFlags = await read("flags");
      }
      if (construct && context?.newTarget !== undefined && context.newTarget !== constructor) {
        retainedPrototype = context.getProperty !== undefined
          ? await context.getProperty(context.newTarget, "prototype")
          : await readPropertyDescriptor(getSandboxPropertyDescriptor(context.newTarget, "prototype", options.budget) ?? { value: undefined }, context.newTarget, context);
      }
      source = sourceValue === undefined ? "" : await sandboxString(sourceValue, options.budget, context);
      retainedSource = undefined;
      const flagText = flagsValue === undefined ? "" : await sandboxString(flagsValue, options.budget, context);
      retainedFlags = undefined;
      const regex = createSandboxRegex(
        source,
        flagText,
        0,
        compilation
      );
      if (typeof retainedPrototype === "object" && retainedPrototype !== null)
        setSandboxPrototype(regex, retainedPrototype, options.budget);
      if (compilation !== context?.compilation) {
        reconcileCompiledValues(options.budget, [regex], compilation);
      }
      return regex;
    } finally {
      options.budget.setRetainedValues(retained, undefined);
      if (compilation !== context?.compilation) compilation.dispose();
      operation.release();
    }
  };
  const constructor = createSandboxClosure({ guest: true, sandbox: true, name: "RegExp", length: 2, call: invoke(false), construct: invoke(true) });
  const prototype = Object.create(null) as SandboxObject;
  Object.defineProperty(materializeFunctionProperties(constructor), Symbol.species, {
    get: accessorAdapter(createSandboxClosure({ sandbox: true, name: "get [Symbol.species]", length: 0,
      call: (_args, context) => context?.thisValue }), "get"), configurable: true
  });
  Object.defineProperty(materializeFunctionProperties(constructor), "prototype", { value: prototype, writable: false });
  Object.defineProperty(prototype, "constructor", { value: constructor, writable: true, configurable: true });
  Object.defineProperty(prototype, Symbol.search, {
    value: createSandboxClosure({ guest: true, sandbox: true, name: "[Symbol.search]", length: 1,
      call: (args, context) => regexSearch(context?.thisValue, args[0], options.budget, context) }),
    writable: true, configurable: true
  });
  Object.defineProperty(prototype, Symbol.match, {
    value: createSandboxClosure({ guest: true, sandbox: true, name: "[Symbol.match]", length: 1,
      call: (args, context) => regexMatch(args[0], context?.thisValue, options.budget, context) }),
    writable: true, configurable: true
  });
  Object.defineProperty(prototype, Symbol.replace, {
    value: createSandboxClosure({ guest: true, sandbox: true, name: "[Symbol.replace]", length: 2,
      call: (args, context) => regexReplace(args[0], context?.thisValue, args[1], options.budget,
        (closure, values) => invokeBuiltinClosure(closure, values, options.budget, context, undefined), context) }),
    writable: true, configurable: true
  });
  Object.defineProperty(prototype, Symbol.matchAll, {
    value: createSandboxClosure({ guest: true, sandbox: true, name: "[Symbol.matchAll]", length: 1,
      call: async (args, context) => {
        const target = context?.thisValue;
        if (target === null || typeof target !== "object") throw new TypeError("RegExp matchAll requires an object receiver.");
        let input: SandboxValue = args[0];
        let string: string | undefined;
        let species: SandboxValue;
        let field: SandboxValue;
        let flags: string | undefined;
        let matcher: SandboxValue;
        const release = retainValues(options.budget, () => [target, input, string, species, field, flags, matcher]);
        const read = (value: SandboxValue, key: PropertyKey) => {
          if (context?.getProperty !== undefined) return context.getProperty(value, key);
          const descriptor = getSandboxPropertyDescriptor(value, key, options.budget);
          return descriptor === undefined ? undefined : readPropertyDescriptor(descriptor, value, context);
        };
        try {
          string = await sandboxString(input, options.budget, context);
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
          flags = await sandboxString(field, options.budget, context);
          field = undefined;
          matcher = await invokeBuiltinClosure(species, [target, flags], options.budget, context, undefined, true);
          field = await read(target, "lastIndex");
          const cursor = normalizeLastIndex(await sandboxNumber(field, options.budget, context));
          field = undefined;
          await setSandboxProperty(matcher, "lastIndex", cursor, options.budget, true, context);
          return restoreSandboxRegExpIterator({ matcher, input: string, exhausted: false,
            global: flags.includes("g"), unicode: flags.includes("u") || flags.includes("v") });
        } finally {
          release();
        }
      } }),
    writable: true, configurable: true
  });
  for (const name of ["exec", "test", "toString"] as RegexMethodName[]) {
    Object.defineProperty(prototype, name, {
      value: createSandboxClosure({ sandbox: true, name, length: name === "toString" ? 0 : 1,
        call: (args, context) => callRegexMethod(context?.thisValue, name, args, options.budget, context) }),
      writable: true, configurable: true
    });
  }
  for (const name of ["source", "flags", ...Object.keys(regexFlagProperties)]) {
    const getter = createSandboxClosure({ sandbox: true, name: `get ${name}`, length: 0,
      call: (_args, context) => {
        const receiver = context?.thisValue;
        if (name === "flags") {
          if (receiver === null || typeof receiver !== "object") throw new TypeError("RegExp flags requires an object receiver.");
          return getRegexMember(receiver as SandboxRegex, name, options.budget, context);
        }
        if (receiver === prototype) return name === "source" ? "(?:)" : undefined;
        if (!isSandboxRegex(receiver)) throw new TypeError("RegExp accessor requires a regex receiver.");
        return getRegexMember(receiver, name, options.budget, context);
      }
    });
    Object.defineProperty(prototype, name, { get: accessorAdapter(getter, "get"), configurable: true });
  }
  installRegexPrototype(options.budget, prototype, constructor);
  return { RegExp: constructor };
}
