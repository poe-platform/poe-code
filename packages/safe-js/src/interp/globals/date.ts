import type { Budget } from "../budget.js";
import { objectToPrimitive } from "../string-coercion.js";
import { createSandboxBox } from "../boxed.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { getSandboxPropertyDescriptor, installDatePrototype, materializeFunctionProperties, setSandboxPrototype } from "../object-model.js";
import { readPropertyDescriptor } from "../accessors.js";
import type { RunClock } from "../../run.js";
import {
  createSandboxDate,
  dateFromParts,
  dateMethods,
  dateNumber,
  dateString,
  dateTime,
  isSandboxDate,
  parseDate
} from "../date.js";
import { declareHostOperation, wrapCallerInjectedBindings } from "../host-bridge.js";
import { allocateProducedSandboxValue, createSandboxClosure, isSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxValue } from "../values.js";
import type { ConsoleJsonGlobalsOptions } from "./console-json.js";

export function createDateGlobal(
  options: ConsoleJsonGlobalsOptions & { clock?: RunClock }
): SandboxClosure {
  const validateClockTime = (value: unknown): number => {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || Math.abs(value) > 8.64e15)
      throw new TypeError("Date clock must return a finite integer epoch within the Date range.");
    return value;
  };
  const readNow = declareHostOperation(
    () => {
      options.budget.visitNode();
      const value = options.clock?.now === undefined ? Date.now() : options.clock.now();
      return validateClockTime(value);
    },
    "re-issue",
    {
      onReplay: (_args, outcome) => {
        if (outcome.status === "fulfilled") {
          const time = validateClockTime(outcome.value);
          options.clock?.restore?.({ next: time + 1 });
        }
      }
    }
  );
  const now = wrapCallerInjectedBindings({ now: readNow }, { ...options, moduleId: "<Date>" })
    .now as SandboxClosure;
  const prototype = createSandboxDate(NaN);
  const constructor = createSandboxClosure({
    guest: true,
    sandbox: true,
    name: "Date",
    length: 7,
    call: async (_args, context) =>
      options.budget.allocateString(
        dateString(createSandboxDate(Number(await now.call([], context))))
      ),
    construct: async (args, context) => {
      let time: number;
      if (args.length === 0) time = Number(await now.call([], context));
      else if (args.length > 1) time = dateFromParts(args, false);
      else if (isSandboxDate(args[0])) time = dateTime(args[0]);
      else if (typeof args[0] === "string") time = parseDate(args[0], options.budget);
      else time = dateNumber(args[0]);
      const newTarget = context?.newTarget;
      const selectedPrototype = newTarget === undefined || newTarget === constructor ? prototype
        : context?.getProperty !== undefined ? await context.getProperty(newTarget, "prototype")
        : await readPropertyDescriptor(getSandboxPropertyDescriptor(newTarget, "prototype", options.budget) ?? { value: undefined }, newTarget, context);
      options.budget.chargeDataUsage(9);
      const value = createSandboxDate(time);
      if (selectedPrototype !== prototype && typeof selectedPrototype === "object" && selectedPrototype !== null)
        setSandboxPrototype(value, selectedPrototype, options.budget);
      return value;
    }
  });
  const staticProperties = {
    now,
    prototype,
    parse: createSandboxClosure({
      sandbox: true,
      name: "parse",
      length: 1,
      call: ([value]) => parseDate(value, options.budget)
    }),
    UTC: createSandboxClosure({
      sandbox: true,
      name: "UTC",
      length: 7,
      call: (args) => dateFromParts(args, true)
    })
  };
  const methods = new Map<PropertyKey, SandboxClosure>();
  for (const [name, method] of dateMethods)
    methods.set(
      name,
      createSandboxClosure({
        guest: true,
        sandbox: true,
        name,
        length: method.length,
        call: (args, context) => {
          const receiver = context?.thisValue;
          if (name === "toJSON") return dateToJSON(receiver, options.budget, context);
          if (!isSandboxDate(receiver))
            throw new TypeError(`Date#${name} requires a Date receiver.`);
          options.budget.visitNode();
          const value = method.invoke(receiver, args);
          return typeof value === "string"
            ? options.budget.allocateString(value)
            : (value as SandboxValue);
        }
      })
    );
  methods.set(Symbol.toPrimitive, createSandboxClosure({
    guest: true,
    sandbox: true,
    name: "[Symbol.toPrimitive]",
    length: 1,
    call: ([hint], context) => {
      const receiver = context?.thisValue;
      if (receiver === null || typeof receiver !== "object") throw new TypeError("Date primitive conversion requires an object receiver.");
      if (hint !== "string" && hint !== "default" && hint !== "number") throw new TypeError("Invalid Date primitive conversion hint.");
      return objectToPrimitive(receiver, options.budget, context, new Set(), hint === "number" ? "number" : "string", true);
    }
  }));
  const properties = materializeFunctionProperties(constructor);
  for (const [key, value] of Object.entries(staticProperties))
    Object.defineProperty(properties, key, { value, writable: key !== "prototype", configurable: key !== "prototype" });
  Object.defineProperty(prototype, "constructor", { value: constructor, writable: true, configurable: true });
  for (const [key, value] of methods)
    Object.defineProperty(prototype, key, { value, writable: key !== Symbol.toPrimitive, configurable: true });
  installDatePrototype(options.budget, prototype, constructor);
  return constructor;
}

export async function dateToJSON(receiver: SandboxValue, budget: Budget, context?: SandboxCallContext): Promise<SandboxValue> {
  if (receiver === null || receiver === undefined) throw new TypeError("Date JSON conversion requires a receiver.");
  if (typeof receiver === "number" || typeof receiver === "string" || typeof receiver === "boolean") {
    const box = createSandboxBox(receiver);
    allocateProducedSandboxValue(box, budget);
    receiver = box;
  }
  const primitive = typeof receiver === "object"
    ? await objectToPrimitive(receiver, budget, context, new Set(), "number")
    : receiver;
  if (typeof primitive === "number" && !Number.isFinite(primitive)) return null;
  let method: SandboxValue;
  if (context?.getProperty !== undefined) method = await context.getProperty(receiver, "toISOString");
  else {
    const descriptor = getSandboxPropertyDescriptor(receiver, "toISOString", budget);
    method = descriptor === undefined ? undefined : await readPropertyDescriptor(descriptor, receiver, context);
  }
  if (!isSandboxClosure(method)) throw new TypeError("Date JSON conversion requires a callable toISOString.");
  return invokeBuiltinClosure(method, [], budget, context, receiver);
}
