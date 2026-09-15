import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {createRuntimeWideCodecFunctions} from "./runtime-wide-codec-functions.js";
import {RuntimeValues, type RuntimeValue} from "./runtime-values.js";

function fixture() {
  let budget = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
  const meter = {checkpoint(steps = 1, bytes = 0) {budget.checkpoint(steps, bytes);}};
  const values = new RuntimeValues(meter);
  const registry = new RuntimeCodecRegistry(values, meter);
  const functions = createRuntimeWideCodecFunctions(registry);
  const keywords = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({hash: () => 0n, equal: (a, b) => a === b}, meter));
  return {meter, values, functions, keywords, limit(bytes: number) {budget = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: bytes});}};
}

function expectTerminal(invoke: () => unknown) {
  let failure: unknown;
  try {invoke();} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  let retry: unknown;
  try {invoke();} catch (error) {retry = error;}
  expect(retry).toBe(failure);
}

const names = [16, 32].flatMap(width => [
  `utf_${width}_encode`, `utf_${width}_le_encode`, `utf_${width}_be_encode`,
  `utf_${width}_decode`, `utf_${width}_le_decode`, `utf_${width}_be_decode`, `utf_${width}_ex_decode`
]);

it.each(names.flatMap(name => ["arity", "keywords", "source", "errors"].map(kind => ({name, kind}))))("admits $name $kind rejection after argument storage", ({name, kind}) => {
  const {values, meter, functions, keywords, limit} = fixture();
  const source = name.endsWith("encode") ? values.string("") : values.bytes(new Uint8Array());
  const args = kind === "arity" ? [] : kind === "source" ? [values.none] : kind === "errors" ? [source, values.true] : [source];
  if (kind === "keywords") keywords.items.set(values.string("errors"), values.none);
  const fn = functions.get(name)!;
  // The invocation record fits exactly; allocating the catchable exception
  // must then terminate, rather than escaping the exhausted allocation budget.
  limit(128);
  expectTerminal(() => fn.value.invoke(args, keywords, meter, {call: () => {throw Error("unexpected guest call during argument rejection");}}));
});

it.each([16, 32].flatMap(width => ["encode", "ex_decode"].flatMap(operation => [-1n, 1n].map(sign => ({name: `utf_${width}_${operation}`, sign})))))("admits $name overflow after guest __index__ (sign=$sign)", ({name, sign}) => {
  const {values, meter, functions, keywords, limit} = fixture();
  const encode = name.endsWith("encode");
  const source = encode ? values.string("") : values.cell({});
  const index = values.cell({}), result = values.integer(sign * (1n << 100n));
  const fn = functions.get(name)!;
  let calls = 0, releases = 0;
  expectTerminal(() => fn.value.invoke([source, values.none, index], keywords, meter, {
    call: () => values.none,
    buffers: {acquireSimple: () => ({byteLength: 0, copy: () => {throw Error("must reject before copying");}, release: () => {releases++;}})},
    integerIndex: {
      integer: value => value.kind === "int" ? value.value : undefined,
      isExactInteger: value => value.kind === "int",
      typeName: value => value.kind,
      warn: () => {throw Error("unexpected warning");},
      lookupIndex: value => value === index ? () => {calls++; limit(0); return result;} : undefined
    }
  }));
  expect(calls).toBe(1);
  expect(releases).toBe(encode ? 0 : 1);
});

it.each(names)("admits %s embedded-NUL rejection after converting the handler name", name => {
  const {values, meter, functions, keywords, limit} = fixture();
  const source = name.endsWith("encode") ? values.string("") : values.bytes(new Uint8Array());
  const args = [source, values.string("\0")], fn = functions.get(name)!;
  // Name conversion and argument storage fit; the exception does not.
  limit(300);
  expectTerminal(() => fn.value.invoke(args, keywords, meter, {call: () => {throw Error("unexpected guest call during argument rejection");}}));
});
