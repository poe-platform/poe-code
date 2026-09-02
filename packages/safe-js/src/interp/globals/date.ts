import type { Budget, CompileOwner } from "../budget.js";
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
import { createSandboxClosure, type SandboxClosure, type SandboxValue } from "../values.js";
import type { ConsoleJsonGlobalsOptions } from "./console-json.js";

type DateIntrinsics = {
  constructor: SandboxClosure;
  prototype: Date;
  methods: Map<string, SandboxClosure>;
};
const intrinsics = new WeakMap<object, DateIntrinsics>();
const constructors = new WeakSet<object>();

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
      options.budget.chargeDataUsage(9);
      return createSandboxDate(time);
    },
    properties: {
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
    }
  });
  const methods = new Map<string, SandboxClosure>();
  for (const [name, method] of dateMethods)
    methods.set(
      name,
      createSandboxClosure({
        sandbox: true,
        name,
        length: method.length,
        call: (args, context) => {
          const receiver = context?.thisValue;
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
  constructors.add(constructor);
  intrinsics.set(options.compileOwner ?? options.budget, { constructor, prototype, methods });
  return constructor;
}

export function isDateConstructor(value: unknown): boolean {
  return typeof value === "object" && value !== null && constructors.has(value);
}

export function getDateMember(
  property: string | number,
  budget: Budget,
  owner?: CompileOwner
): SandboxValue {
  const state = intrinsics.get(owner ?? budget);
  return property === "constructor" ? state?.constructor : state?.methods.get(String(property));
}

export function getDatePrototype(value: Date, budget: Budget, owner?: CompileOwner): Date | null {
  const prototype = intrinsics.get(owner ?? budget)?.prototype;
  return prototype === value ? null : (prototype ?? null);
}
