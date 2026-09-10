import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { createRuntimeNativeFormatMethod } from "./runtime-native-format-method.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

it.each(["none", "ellipsis", "not-implemented", "bytes", "list", "tuple", "bool", "int", "float", "complex", "str"] as const)("uses the defining native format owner for %s argument errors", kind => {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const receivers = { none: v.none, ellipsis: v.ellipsis, "not-implemented": v.notImplemented, bytes: v.bytes([]), list: v.list([]), tuple: v.tuple([]), bool: v.true, int: v.integer(1), float: v.float(1), complex: v.complex(1,2), str: v.string("a") };
  const receiver = receivers[kind], owner = kind === "bool" ? "int" : ["none","ellipsis","not-implemented","bytes","list","tuple"].includes(kind) ? "object" : kind;
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({ hash: () => 0n, equal: (a,b) => a === b }, meter));
  const method = createRuntimeNativeFormatMethod(receiver,v,meter);
  expect(()=>method.value.invoke([],keywords,meter)).toThrow(`${owner}.__format__() takes exactly one argument (0 given)`);
  expect(()=>method.value.invoke([v.string(""),v.none],keywords,meter)).toThrow(`${owner}.__format__() takes exactly one argument (2 given)`);
  keywords.items.set(v.string("spec"),v.string(""));
  expect(()=>method.value.invoke([],keywords,meter)).toThrow(`${owner}.__format__() takes no keyword arguments`);
});
