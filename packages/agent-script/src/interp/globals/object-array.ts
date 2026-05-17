import type { Budget } from "../budget.js";
import {
  createSandboxClosure,
  deepCopyToSandbox,
  isSandboxClosure,
  isSandboxPromise,
  type SandboxClosure,
  type SandboxObject,
  type SandboxValue
} from "../values.js";

export type ObjectArrayGlobals = {
  Object: SandboxObject;
  Array: SandboxObject;
  String: SandboxClosure;
  Number: SandboxClosure;
  Boolean: SandboxClosure;
};

export function createObjectArrayGlobals(options: { budget: Budget }): ObjectArrayGlobals {
  return {
    Object: {
      keys: createSandboxClosure({
        call: ([value]) => budgetSandboxValue(getOwnEnumerableKeys(value), options.budget),
        name: "keys"
      }),
      values: createSandboxClosure({
        call: ([value]) => budgetSandboxValue(getOwnEnumerableValues(value), options.budget),
        name: "values"
      }),
      entries: createSandboxClosure({
        call: ([value]) => budgetSandboxValue(getOwnEnumerableEntries(value), options.budget),
        name: "entries"
      }),
      fromEntries: createSandboxClosure({
        call: ([value]) =>
          budgetSandboxValue(Reflect.apply(Object.fromEntries, Object, [value]), options.budget),
        name: "fromEntries"
      }),
      freeze: createSandboxClosure({
        call: ([value]) => {
          if (typeof value === "object" && value !== null) {
            Object.freeze(value);
          }

          return value;
        },
        name: "freeze"
      }),
      assign: createSandboxClosure({
        call: ([target, ...sources]) => assignSandboxValues(target, sources),
        name: "assign"
      })
    },
    Array: {
      isArray: createSandboxClosure({
        call: ([value]) => Array.isArray(value),
        name: "isArray"
      }),
      from: createSandboxClosure({
        call: (args) => arrayFromSandboxValues(args, options.budget),
        name: "from"
      }),
      of: createSandboxClosure({
        call: (args) =>
          budgetSandboxValue(Reflect.apply(Array.of, Array, [...args]), options.budget),
        name: "of"
      })
    },
    String: createSandboxClosure({
      call: ([value]) => options.budget.allocateString(String(value)),
      name: "String"
    }),
    Number: createSandboxClosure({
      call: ([value]) => Number(value),
      name: "Number",
      properties: {
        isFinite: createSandboxClosure({
          call: ([value]) => typeof value === "number" && Number.isFinite(value),
          name: "isFinite"
        }),
        isNaN: createSandboxClosure({
          call: ([value]) => typeof value === "number" && Number.isNaN(value),
          name: "isNaN"
        }),
        isInteger: createSandboxClosure({
          call: ([value]) => typeof value === "number" && Number.isInteger(value),
          name: "isInteger"
        })
      }
    }),
    Boolean: createSandboxClosure({
      call: ([value]) => Boolean(value),
      name: "Boolean"
    })
  };
}

function assignSandboxValues(target: SandboxValue, sources: readonly SandboxValue[]): SandboxValue {
  if (target === null || target === undefined) {
    throw new TypeError("Object.assign(target, ...sources) requires a non-null target.");
  }

  if (!isAssignableSandboxTarget(target)) {
    throw new TypeError("Object.assign(target, ...sources) requires an object or array target.");
  }

  for (const source of sources) {
    if (source === null || source === undefined) {
      continue;
    }

    for (const [key, value] of getOwnEnumerableEntries(source)) {
      target[key] = value;
    }
  }

  return target;
}

function isAssignableSandboxTarget(
  value: SandboxValue
): value is
  | (SandboxObject & Record<string, SandboxValue>)
  | (SandboxValue[] & Record<string, SandboxValue>) {
  return (
    typeof value === "object" &&
    value !== null &&
    !isSandboxClosure(value) &&
    !isSandboxPromise(value)
  );
}

async function arrayFromSandboxValues(
  args: readonly SandboxValue[],
  budget: Budget
): Promise<SandboxValue> {
  const [items, mapFn] = args;

  if (mapFn === undefined || !isSandboxClosure(mapFn)) {
    return budgetSandboxValue(Reflect.apply(Array.from, Array, [...args]), budget);
  }

  const values = Reflect.apply(Array.from, Array, [items]) as SandboxValue[];
  const mappedValues: SandboxValue[] = [];

  for (const [index, value] of values.entries()) {
    const result = await mapFn.call([value, index]);
    mappedValues.push(isSandboxPromise(result) ? await result.promise : result);
  }

  return budgetSandboxValue(mappedValues, budget);
}

function getOwnEnumerableKeys(value: SandboxValue): string[] {
  return getOwnEnumerableEntries(value).map(([key]) => key);
}

function getOwnEnumerableValues(value: SandboxValue): SandboxValue[] {
  return getOwnEnumerableEntries(value).map(([, entryValue]) => entryValue);
}

function getOwnEnumerableEntries(value: SandboxValue): Array<[string, SandboxValue]> {
  if (value === null || value === undefined) {
    throw new TypeError("Cannot convert undefined or null to object.");
  }

  if (isSandboxClosure(value) || isSandboxPromise(value)) {
    return [];
  }

  return Object.entries(Object(value)) as Array<[string, SandboxValue]>;
}

function budgetSandboxValue(value: unknown, budget: Budget): SandboxValue {
  const sandboxValue = deepCopyToSandbox(value);

  allocateSandboxValue(sandboxValue, budget, new WeakSet());
  return sandboxValue;
}

function allocateSandboxValue(value: SandboxValue, budget: Budget, seen: WeakSet<object>): void {
  if (typeof value === "string") {
    budget.allocateString(value);
    return;
  }

  if (Array.isArray(value)) {
    budget.allocateArrayLength(value.length);

    if (seen.has(value)) {
      return;
    }

    seen.add(value);
    for (const entry of value) {
      allocateSandboxValue(entry, budget, seen);
    }

    return;
  }

  if (
    typeof value !== "object" ||
    value === null ||
    isSandboxClosure(value) ||
    isSandboxPromise(value)
  ) {
    return;
  }

  if (seen.has(value)) {
    return;
  }

  seen.add(value);
  for (const entry of Object.values(value)) {
    allocateSandboxValue(entry, budget, seen);
  }
}
