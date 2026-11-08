import { assert, expect, it } from "vitest";
import { Scope } from "./scope.js";
import { addPrivateElement, findPrivateElement, privateElements } from "./private-state.js";
import { measureSandboxData } from "./values.js";
import { createSandboxBox } from "./boxed.js";
import { classOrigins } from "./classes.js";
import { run } from "../run.js";
import { Budget } from "./budget.js";

it.each([
  "class C{#x=[];fill(){for(let i=0;i<100;i++)this.#x.push('x'.repeat(100))}}new C().fill()",
  "class C{static #x=[];static fill(){for(let i=0;i<100;i++)this.#x.push('x'.repeat(100))}}C.fill()",
  "class C{#x='';fill(){for(let i=0;i<100;i++)this.#x+='x'.repeat(100)}}new C().fill()"
])("enforces the data budget while private fields grow: %s", async source => {
  expect(await run(source)).toMatchObject({ok: true});
  await expect(run(source, {budget: new Budget({dataSize: 4096})}))
    .rejects.toMatchObject({code: "budgetExceeded", budget: "dataSize"});
});

it("retains private method blueprints before any instance exists", async () => {
  const result=await run("class C{#m(){return 1}read(){return this.#m()}}return C");
  assert(result.ok && result.returnValue !== null && typeof result.returnValue === "object");
  const origin=classOrigins.get(result.returnValue);
  assert(origin !== undefined);
  const entry=[...origin.privateMethods.values()][0];
  assert(entry.kind === "method" && entry.value.properties !== undefined);
  const before=measureSandboxData([result.returnValue]);
  entry.value.properties.payload="x".repeat(2000);
  expect(measureSandboxData([result.returnValue])-before).toBeGreaterThanOrEqual(2000);
});

it("resolves private names lexically without exposing ordinary bindings", () => {
  const outer = new Scope();
  const name = outer.declarePrivateName("value");
  const child = outer.child();
  expect(child.resolvePrivateName("value")).toBe(name);
  expect(child.lookup("value").found).toBe(false);
  expect(child.snapshot().bindings).toEqual({});
  const shadow = child.declarePrivateName("value");
  expect(shadow).not.toBe(name);
  expect(child.child().resolvePrivateName("value")).toBe(shadow);
  expect(new Scope().declarePrivateName("value")).not.toBe(name);
});

it("rejects undeclared private names", () => {
  expect(() => new Scope().resolvePrivateName("missing")).toThrow(SyntaxError);
});

it("retains lexical private identities in scope data accounting", () => {
  const scope=new Scope();
  scope.declarePrivateName("x".repeat(200));
  expect(measureSandboxData(scope.child().retainedValues())).toBeGreaterThanOrEqual(200);
});

it("keeps receiver private slots separate from public and inherited properties", () => {
  const name = new Scope().declarePrivateName("value");
  const receiver = {};
  const element = { kind: "field" as const, value: 7 };
  addPrivateElement(receiver, name, element);
  expect(findPrivateElement(receiver, name)).toBe(element);
  expect(Reflect.ownKeys(receiver)).toEqual([]);
  expect(findPrivateElement(Object.create(receiver), name)).toBeUndefined();
  expect(privateElements.get(receiver)?.size).toBe(1);
});

it("rejects duplicate private installation but permits independent same-spelling brands", () => {
  const receiver = {};
  const first = new Scope().declarePrivateName("value");
  const second = new Scope().declarePrivateName("value");
  addPrivateElement(receiver, first, { kind: "field", value: 1 });
  expect(() => addPrivateElement(receiver, first, { kind: "field", value: 2 })).toThrow(TypeError);
  addPrivateElement(receiver, second, { kind: "field", value: 3 });
  expect(findPrivateElement(receiver, first)).toEqual({ kind: "field", value: 1 });
  expect(findPrivateElement(receiver, second)).toEqual({ kind: "field", value: 3 });
});

it.each([undefined, null, 1, "x", true])("rejects private lookup on primitive %s", receiver => {
  const name = new Scope().declarePrivateName("value");
  expect(() => findPrivateElement(receiver, name)).toThrow(TypeError);
});

it("charges retained private field data without exposing it as a public property", () => {
  const receiver = {};
  const name = new Scope().declarePrivateName("payload");
  addPrivateElement(receiver, name, { kind: "field", value: "x".repeat(200) });
  expect(measureSandboxData([receiver])).toBeGreaterThanOrEqual(200);
});

it("charges private state attached to boxed primitive receivers", () => {
  const receiver = createSandboxBox(1);
  const name = new Scope().declarePrivateName("payload");
  addPrivateElement(receiver, name, { kind: "field", value: "x".repeat(200) });
  expect(measureSandboxData([receiver])).toBeGreaterThanOrEqual(200);
});
