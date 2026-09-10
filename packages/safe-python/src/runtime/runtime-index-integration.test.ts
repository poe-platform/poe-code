import { expect, it } from "vitest";
import { analyzeModule } from "../analysis.js";
import { compileProgram } from "./program-compilation.js";
import { createFunctionState } from "./function-state.js";
import { executeRuntimeProgram } from "./runtime-program.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { createRange } from "./integer-sequence.js";
import { createRepresentationBuiltin } from "./builtin-representation.js";
import { CallStack } from "./call-stack.js";

it.each([
  ["result=[10,20,30][index]\n","30",1],
  ["result=(10,20,30)[index]\n","30",1],
  ["result=\"abcd\"[index]\n","'c'",1],
  ["result=b\"abcd\"[index]\n","99",1],
  ["result=progression[index]\n","4",1],
  ["data=[0,1,2,3]\ndata[index:]=[8,9]\nresult=data\n","[0, 1, 8, 9]",1],
  ["data=[0,1,2,3]\ndel data[::index]\nresult=data\n","[1, 3]",1],
  ["data=[0,1,2,3]\ndata[index]+=5\nresult=data\n","[0, 1, 7, 3]",2],
  ["data=[0,1,2,3]\nresult=data[:index:index]\n","[0]",2],
  ["data=[0,1,2,3]\nresult=data.pop(index)\n","2",1],
  ["data=[0,1,2,3]\ndata.insert(index,9)\nresult=data\n","[0, 1, 9, 2, 3]",1],
  ["result=\"abcabc\".find(\"c\",index)\n","2",1],
  ["result=b\"abcabc\".find(b\"c\",index)\n","2",1],
  ["result=(258).to_bytes(index,\"big\")\n","b'\\x01\\x02'",1]
] as const)("matches native index conversion and call count: %s", (source, expected, count) => {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const registry = new RuntimeTypeRegistry(v, keys, meter);
  const base = registry.publish(new RuntimeTypeLayout("Base", [registry.object.value], v.dictionary(new OrderedKeyMap(keys, meter)), meter), registry.type);
  const derived = registry.publish(new RuntimeTypeLayout("Derived", [base.value], v.dictionary(new OrderedKeyMap(keys, meter)), meter), registry.type);
  const index = v.cell({}), globals = new Map<string, RuntimeValue>([["index", index], ["progression", v.range(createRange(0n, 10n, 2n))]]);
  let invocations = 0;
  const visit = v.builtinFunction({ name: "visit", invoke() { invocations++; return v.none; } });
  const definitions = compileProgram<RuntimeValue>(analyzeModule("def index(self):\n visit()\n return 2\n"), { stripDocstring: false }, v, meter);
  base.value.namespace.items.set(v.string("__index__"), v.function(createFunctionState(definitions.functions.values().next().value!, new Map(), { globals: new Map(), builtins: new Map([["visit", visit]]), none: v.none }, meter)));
  const program = compileProgram<RuntimeValue>(analyzeModule(source + "rendered=repr(result)\n"), { stripDocstring: false }, v, meter);
  let lookups = 0;
  const unused = (): never => { throw Error("unexpected guest operation"); };
  executeRuntimeProgram(program, {
    values: v, globals, keys, builtins: new Map([["repr", createRepresentationBuiltin("repr", v, meter)]]), calls: new CallStack<object>(50, meter),
    hooks: {
      specialMethods: () => ({ typeOf(value) { if (value.kind === "list") return registry.listType(); expect(value).toBe(index); lookups++; return derived; }, slots: unused }),
      expressions: () => ({ warn: unused }), statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused }),
      callable: () => false, name: () => "index()", keywordName: unused, invoke: unused
    }
  }, meter);
  expect(globals.get("rendered")).toEqual(v.string(expected));
  expect(lookups).toBe(count);
  expect(invocations).toBe(count);
});
