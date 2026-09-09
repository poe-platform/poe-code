import { expect, it } from "vitest";
import { executeRuntimeProgram } from "./runtime-program.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { compileProgram } from "./program-compilation.js";
import { analyzeModule } from "../analysis.js";
import { CallStack } from "./call-stack.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { createRuntimeFormatContext } from "./runtime-format.js";
import { createFormatBuiltin } from "./builtin-format.js";
import { NumericLocale } from "./numeric-locale.js";

it.each(["format(x, 'n')", "m('n')", "f'{x:n}'", "'{:n}'.format(x)", "'{x:n}'.format_map({'x': x})"])("shares locale ownership across frames for %s", expression => {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
  const values = new RuntimeValues(meter), globals = new Map<string, RuntimeValue>(), builtins = new Map<string, RuntimeValue>();
  const calls = new CallStack<object>(50, meter);
  const unused = (): never => { throw Error("unexpected guest hook"); };
  const hash = { none: values.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  const keys = { hash: (key: RuntimeValue) => runtimeHash(key, hash, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, values, meter).value };
  let locale = new NumericLocale({ decimalPoint: values.string(",").value, thousandsSeparator: values.string(".").value, grouping: [3, 0] }, meter);
  let acquisitions = 0;
  const formatting = createRuntimeFormatContext(values, meter, { defaultRepr: unused, numericLocale() { acquisitions++; return locale; } });
  builtins.set("format", createFormatBuiltin(values, meter, formatting));
  builtins.set("change", values.builtinFunction({ name: "change", invoke() {
    locale = new NumericLocale({ decimalPoint: values.string(".").value, thousandsSeparator: values.string("_").value, grouping: [3, 2, 0] }, meter);
    return values.none;
  } }));
  const program = compileProgram<RuntimeValue>(analyzeModule(`x=1234567\nm=x.__format__\na=${expression}\ndef outer():\n def inner():\n  return ${expression}\n return inner()\nb=outer()\nchange()\nc=outer()\nd=${expression}\n`), { stripDocstring: false }, values, meter);
  executeRuntimeProgram(program, { values, globals, builtins, calls, keys, formatting, hooks: {
    expressions: () => ({ warn: unused }),
    statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused }),
    callable: () => false, invoke: unused, name: () => "function()", keywordName: unused
  } }, meter);
  expect(["a", "b", "c", "d"].map(name => globals.get(name))).toEqual(["1.234.567", "1.234.567", "12_34_567", "12_34_567"].map(value => values.string(value)));
  expect(acquisitions).toBe(4);
  expect(calls.depth).toBe(0);
});
