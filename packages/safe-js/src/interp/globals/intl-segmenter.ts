import type { Budget } from "../budget.js";
import { getFunctionRealmPrototype } from "../function-realm.js";
import { readPropertyDescriptor } from "../accessors.js";
import { canonicalizeGuestLocales, convertIntlOption, intlOptionsObject, readIntlProperty } from "../intl-options.js";
import { containingSegment, createSandboxSegmenter, createSandboxSegments, segmenterState, segmentState } from "../intl-segmenter.js";
import { registerBuiltinIdentities, resolveIntrinsicIdentity } from "../intrinsics.js";
import { createIntrinsicObject, getSandboxPropertyDescriptor, materializeFunctionProperties, registerIntrinsicFunction, registerIntrinsicObject, setSandboxPrototype } from "../object-model.js";
import { retainValues } from "../resources.js";
import { sandboxNumber, sandboxString } from "../string-coercion.js";
import { allocateProducedSandboxValue, createSandboxClosure, type SandboxClosure } from "../values.js";

const supportedLocalesOf = Intl.Segmenter.supportedLocalesOf;
const optionTypes = [
  ["localeMatcher", ["lookup", "best fit"]],
  ["granularity", ["grapheme", "word", "sentence"]]
] as const;

export function createSegmenterConstructor(budget: Budget): SandboxClosure {
  const prototype = createIntrinsicObject();
  const segmentsPrototype = createIntrinsicObject();
  const iteratorPrototype = createIntrinsicObject();
  setSandboxPrototype(iteratorPrototype, resolveIntrinsicIdentity(budget, '["%IteratorPrototype%"]'));
  const constructor = createSandboxClosure({
    guest: true, sandbox: true, name: "Segmenter", length: 0,
    call: () => { throw new TypeError("Constructor Segmenter requires 'new'."); },
    construct: async ([input, options], context) => {
      const target = context?.newTarget;
      let selected = target === undefined || target === constructor ? prototype
        : context?.getProperty !== undefined ? await context.getProperty(target, "prototype")
        : await readPropertyDescriptor(getSandboxPropertyDescriptor(target, "prototype", budget) ?? { value: undefined }, target, context);
      if (selected === null || typeof selected !== "object")
        selected = getFunctionRealmPrototype(target, "Intl.Segmenter", prototype);
      let locales: string[] = [];
      const converted: Record<string, string> = Object.create(null);
      const release = retainValues(budget, () => [selected, locales, converted]);
      try {
        locales = await canonicalizeGuestLocales(input, budget, context);
        const source = intlOptionsObject(options, budget);
        for (const [key, type] of optionTypes) {
          const raw = await readIntlProperty(source, key, budget, context);
          if (raw !== undefined) converted[key] = await convertIntlOption(raw, key, type, budget, context) as string;
        }
        const value = createSandboxSegmenter(locales, converted);
        setSandboxPrototype(value, typeof selected === "object" && selected !== null ? selected : prototype, budget);
        return allocateProducedSandboxValue(value, budget);
      } finally { release(); }
    }
  });
  const properties = materializeFunctionProperties(constructor);
  Object.defineProperty(properties, "prototype", { value: prototype, writable: false, configurable: false });
  Object.defineProperty(properties, "supportedLocalesOf", { value: createSandboxClosure({
    guest: true, sandbox: true, name: "supportedLocalesOf", length: 1,
    call: async ([input, options], context) => {
      const locales = await canonicalizeGuestLocales(input, budget, context);
      const release = retainValues(budget, () => [locales]);
      try {
        const source = intlOptionsObject(options, budget);
        const raw = await readIntlProperty(source, "localeMatcher", budget, context);
        const matcher = raw === undefined ? undefined : await convertIntlOption(raw, "localeMatcher", ["lookup", "best fit"], budget, context);
        return allocateProducedSandboxValue(supportedLocalesOf(locales, { localeMatcher: matcher as "lookup" | "best fit" | undefined }), budget);
      } finally { release(); }
    }
  }), writable: true, configurable: true });
  Object.defineProperties(prototype, {
    constructor: { value: constructor, writable: true, configurable: true },
    [Symbol.toStringTag]: { value: "Intl.Segmenter", configurable: true },
    resolvedOptions: { value: createSandboxClosure({
      guest: true, sandbox: true, name: "resolvedOptions", length: 0,
      call: (_args, context) => allocateProducedSandboxValue({ ...segmenterState(context?.thisValue).options }, budget)
    }), writable: true, configurable: true },
    segment: { value: createSandboxClosure({
      guest: true, sandbox: true, name: "segment", length: 1,
      call: async ([input], context) => {
        const receiver = context?.thisValue;
        segmenterState(receiver);
        const release = retainValues(budget, () => [receiver, input]);
        try {
          const text = await sandboxString(input, budget, context);
          budget.visitNode(text.length);
          const value = createSandboxSegments({ segmenter: receiver as ReturnType<typeof createIntrinsicObject>, input: text });
          setSandboxPrototype(value, segmentsPrototype, budget);
          return allocateProducedSandboxValue(value, budget);
        } finally { release(); }
      }
    }), writable: true, configurable: true }
  });
  const containing = createSandboxClosure({
    guest: true, sandbox: true, name: "containing", length: 1,
    call: async ([input], context) => {
      const receiver = context?.thisValue;
      segmentState(receiver, false);
      const release = retainValues(budget, () => [receiver, input]);
      try {
        const number = await sandboxNumber(input, budget, context);
        const index = Number.isNaN(number) ? 0 : Math.trunc(number);
        return allocateProducedSandboxValue(containingSegment(receiver, index, false, budget), budget);
      } finally { release(); }
    }
  });
  const iterate = createSandboxClosure({
    guest: true, sandbox: true, name: "[Symbol.iterator]", length: 0,
    call: (_args, context) => {
      const state = segmentState(context?.thisValue, false);
      budget.visitNode(state.input.length);
      const value = createSandboxSegments({ segmenter: state.segmenter, input: state.input, index: 0 });
      setSandboxPrototype(value, iteratorPrototype, budget);
      return allocateProducedSandboxValue(value, budget);
    }
  });
  const next = createSandboxClosure({
    guest: true, sandbox: true, name: "next", length: 0,
    call: (_args, context) => {
      const receiver = context?.thisValue;
      const state = segmentState(receiver, true);
      const value = containingSegment(receiver, state.index!, true, budget);
      return allocateProducedSandboxValue({ value, done: value === undefined }, budget);
    }
  });
  Object.defineProperties(segmentsPrototype, {
    containing: { value: containing, writable: true, configurable: true },
    [Symbol.iterator]: { value: iterate, writable: true, configurable: true }
  });
  Object.defineProperties(iteratorPrototype, {
    next: { value: next, writable: true, configurable: true },
    [Symbol.toStringTag]: { value: "Segmenter String Iterator", configurable: true }
  });
  registerBuiltinIdentities(budget, { "%IntlSegmentsPrototype%": segmentsPrototype, "%IntlSegmentIteratorPrototype%": iteratorPrototype });
  for (const closure of [containing, iterate, next]) registerIntrinsicFunction(budget, closure);
  for (const value of [segmentsPrototype, iteratorPrototype]) registerIntrinsicObject(budget, value);
  return constructor;
}
