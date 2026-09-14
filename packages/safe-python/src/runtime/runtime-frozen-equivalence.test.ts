import {expect, it} from "vitest";
import {analyzeModule} from "../analysis.js";
import {CodePointString} from "./code-point-string.js";
import {ImmutableBytes} from "./immutable-bytes.js";
import {ExecutionBudget} from "./execution-budget.js";
import {compileProgram} from "./program-compilation.js";
import {RuntimeValues} from "./runtime-values.js";
import {RuntimeFrozenProgram} from "./runtime-frozen-program.js";
import {codecLibrarySources} from "./runtime-codec-library-source.js";
import {codecFamilySources} from "./runtime-codec-family-source.js";
import {singleByteLibrarySources} from "./runtime-single-byte-library-source.js";
import {rot13UndefinedSources} from "./runtime-rot13-undefined-source.js";
import {platformCodecSources} from "./runtime-platform-codec-source.js";
import {punycodeLibrarySources} from "./runtime-punycode-library-source.js";

// Compare both values and the complete alias graph. Immutable payload storage
// may be shared by preparation, but guest wrappers must preserve compiler identity.
function compareGraphs(actual: unknown, expected: unknown, forward = new Map<object, object>(), reverse = new Map<object, object>()): void {
  if (actual instanceof CodePointString && expected instanceof CodePointString || actual instanceof ImmutableBytes && expected instanceof ImmutableBytes) {
    expect([...actual]).toEqual([...expected]);
    return;
  }
  if (actual === null || expected === null || typeof actual !== "object" || typeof expected !== "object") {
    expect(actual).toBe(expected);
    return;
  }
  if (forward.has(actual) || reverse.has(expected)) {
    expect(forward.get(actual)).toBe(expected);
    expect(reverse.get(expected)).toBe(actual);
    return;
  }
  forward.set(actual, expected);
  reverse.set(expected, actual);
  if (actual === expected) return; // The same analyzed immutable syntax/scope.
  expect(Object.getPrototypeOf(actual)).toBe(Object.getPrototypeOf(expected));
  if (actual instanceof Map && expected instanceof Map) {
    compareGraphs([...actual], [...expected], forward, reverse);
  }
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const key of Object.keys(actual)) {
    compareGraphs(Reflect.get(actual, key), Reflect.get(expected, key), forward, reverse);
  }
}

it.each([...codecLibrarySources, ...codecFamilySources, ...singleByteLibrarySources,
  ...rot13UndefinedSources, ...platformCodecSources, ...punycodeLibrarySources,
  ["nested annotations", `"""module doc"""
shared = ('interned_name', 'not interned', 999, b'bytes', 2.5, 3j, None, True, ...)
def outer(value: 'interned_name') -> tuple:
    """function doc"""
    class Inner:
        field: int
        def method(self, other: 'Inner'):
            self.value = value
            return (lambda: ('interned_name', 999)), (item for item in (value,))
    return Inner, [item for item in (value,)]
`] as const])("preserves ordinary compiler values, metadata and aliases for %s", (name, source) => {
  const filename = `<frozen equivalence ${name}>`;
  const analysis = analyzeModule(source, {filename});
  const frozen = new RuntimeFrozenProgram(analysis, filename);
  const create = () => {
    const meter = new ExecutionBudget({maxSteps: 10000000, maxAllocatedBytes: 100000000});
    const values = new RuntimeValues(meter);
    // Existing pool entries must win over prepared payloads.
    values.internString("interned_name");
    values.internString("strict");
    return {meter, values};
  };
  const ordinary = create(), prepared = create();
  compareGraphs(frozen.instantiate(prepared.values, prepared.meter),
    compileProgram(analysis, {filename, stripDocstring: false}, ordinary.values, ordinary.meter));
});
