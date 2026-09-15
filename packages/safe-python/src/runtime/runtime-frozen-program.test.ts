import {expect, it} from "vitest";
import {analyzeModule} from "../analysis.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {RuntimeValues} from "./runtime-values.js";
import {RuntimeFrozenProgram} from "./runtime-frozen-program.js";

const source = `"""module documentation"""
shared = ('frozen_name', 999)
class Codec:
    """class documentation"""
    def encode(self, data):
        """encode documentation"""
        return (item for item in (data, 'frozen_name'))
`;

it("materializes frozen constants and code graphs separately for each interpreter", () => {
  const frozen = new RuntimeFrozenProgram(analyzeModule(source), "<frozen contract>");
  const create = () => {
    const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 1000000});
    const values = new RuntimeValues(meter);
    return {values, program: frozen.instantiate(values, meter)};
  };
  const first = create(), second = create();
  expect(first.program.module).not.toBe(second.program.module);
  expect(first.program.module.docstring!.value).not.toBe(second.program.module.docstring!.value);
  expect(first.program.module.source).not.toBe(second.program.module.source);
  for (const [node, code] of first.program.functions) {
    expect(code).not.toBe(second.program.functions.get(node));
    expect(code.source).toBe(first.program.module.source);
    expect(code.definitions).toBe(first.program.functions);
    expect(code.classDefinitions).toBe(first.program.classFunctions);
    expect(code.literals).toBe(first.program.literals);
    expect(code.generatorExpressions).toBe(first.program.generatorExpressions);
  }
  for (const [node, code] of first.program.classFunctions) {
    expect(code.body).toEqual({kind: "class", code: first.program.classes.get(node)});
    expect(code).not.toBe(second.program.classFunctions.get(node));
  }
  for (const [node, value] of first.program.literals!) {
    if (node.literalKind === "string") {
      expect(value).toBe(first.values.internString("frozen_name"));
      expect(value).not.toBe(second.program.literals!.get(node));
      const other = second.program.literals!.get(node)!;
      if (value.kind === "str" && other.kind === "str") expect(value.value).toBe(other.value);
    }
  }
  expect(first.program.generatorExpressions!.size).toBe(1);
});

it("charges each materialization independently and leaves cancellation fatal", () => {
  const frozen = new RuntimeFrozenProgram(analyzeModule(source), "<frozen contract>");
  const controller = new AbortController();
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 1000000, signal: controller.signal});
  const values = new RuntimeValues(meter);
  const start = meter.usage;
  frozen.instantiate(values, meter);
  expect(meter.usage.steps).toBeGreaterThan(start.steps);
  expect(meter.usage.allocatedBytes).toBeGreaterThan(start.allocatedBytes);
  controller.abort();
  expect(() => frozen.instantiate(values, meter)).toThrow(ExecutionLimitError);
  const exhausted = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 0});
  expect(() => frozen.instantiate(values, exhausted)).toThrow(ExecutionLimitError);
});

it("shares immutable prepared literal storage without copying documentation on each load", () => {
  const allocations = [10, 10000].map(length => {
    const frozen = new RuntimeFrozenProgram(analyzeModule(`"${"!".repeat(length)}"`), "<frozen documentation>");
    const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
    const values = new RuntimeValues(meter);
    const first = frozen.instantiate(values, meter);
    const start = meter.usage.allocatedBytes;
    const second = frozen.instantiate(values, meter);
    expect(first.module.docstring!.value).not.toBe(second.module.docstring!.value);
    const left = first.module.docstring!.value, right = second.module.docstring!.value;
    expect(left.kind).toBe("str");
    expect(right.kind).toBe("str");
    if (left.kind === "str" && right.kind === "str") expect(left.value).toBe(right.value);
    return meter.usage.allocatedBytes - start;
  });
  expect(allocations[1]).toBe(allocations[0]);
});

it("reuses prepared non-interned string literal payloads with per-load value identities", () => {
  const frozen = new RuntimeFrozenProgram(analyzeModule('value = "literal with spaces and \\ud800\\udc00"'), "<frozen literal>");
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 1000000});
  const values = new RuntimeValues(meter);
  const first = frozen.instantiate(values, meter), second = frozen.instantiate(values, meter);
  for (const [node, left] of first.literals!) {
    const right = second.literals!.get(node)!;
    expect(left).not.toBe(right);
    expect(left.kind).toBe("str");
    expect(right.kind).toBe("str");
    if (left.kind === "str" && right.kind === "str") {
      expect(left.value).toBe(right.value);
      expect([...left.value].slice(-2)).toEqual([0xd800, 0xdc00]);
    }
  }
});
