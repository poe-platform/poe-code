import { expect, it } from "vitest";
import { Budget } from "../interp/budget.js";
import { createEvalSource } from "./dynamic-source.js";
import {
  CompactModuleAst,
  compactAstStatistics,
  compilerEntries,
  compilerField
} from "./compact-module-ast.js";
import { validatePrivateNames } from "./private-names.js";
const pad = `/*${"x".repeat(512)}*/`;
function compile(source: string, compactAst: boolean, limits = {}) {
  const budget = new Budget({
    maxSteps: 1000000,
    stringLength: 1000000,
    dataSize: 1000000,
    ...limits
  });
  const lease = budget.acquireCompileOwner();
  try {
    return { parsed: createEvalSource(source, {}, lease.owner, "classic.js", { compactAst }) };
  } finally {
    lease.release();
    expect(budget.currentDataSize).toBe(0);
  }
}
it("does not expand function bodies for fresh IDs or complete private-name validation", () => {
  const source = `function f(){${pad}class A {#x=1;method(){${pad}return this.#x}};return [${Array.from({ length: 1000 }, (_, i) => i).join(",")}];}`;
  const parsed = compile(source, true).parsed;
  const declaration = parsed.node.body[0];
  expect(declaration.type).toBe("FunctionDeclaration");
  const body = (declaration as { body: object }).body;
  const before = compactAstStatistics(body)!;
  expect(before.bodies).toBe(2);
  expect(before.materializedRecords).toBeLessThan(20);
  validatePrivateNames(parsed.node);
  expect(compactAstStatistics(body)!.materializedRecords).toBe(before.materializedRecords);
  expect(JSON.stringify(parsed).length).toBeGreaterThan(10000);
  expect(compactAstStatistics(body)!.materializedRecords).toBeGreaterThan(1000);
});

it("keeps ordinary mutable arrays and stable decoded identities through deletion, sealing and freezing", () => {
  const parsed = compile(`function f(){${pad}return [first,second]}`, true).parsed;
  const fn = parsed.node.body[0] as {
    body: { body: Array<{ argument: { elements: Array<{ name: string }> } }> };
  };
  const body = fn.body,
    statements = body.body,
    elements = statements[0]!.argument.elements;
  expect(fn.body).toBe(body);
  (body as { nodeId?: number }).nodeId = 400000;
  expect((fn.body as { nodeId?: number }).nodeId).toBe(400000);
  expect(body.body).toBe(statements);
  expect(Object.getPrototypeOf(body)).toBe(Object.prototype);
  expect(Object.getPrototypeOf(elements)).toBe(Array.prototype);
  const first = elements[0]!,
    second = elements[1]!;
  Object.seal(first);
  first.name = "changed";
  expect(first.name).toBe("changed");
  Object.freeze(first);
  expect(() => {
    first.name = "forbidden";
  }).toThrow(TypeError);
  delete (second as { name?: string }).name;
  expect(second.name).toBeUndefined();
  expect(Object.keys(second)).not.toContain("name");
  second.name = "restored";
  expect(elements[1]).toBe(second);
  expect(second.name).toBe("restored");
  elements.push(first);
  elements.splice(0, 1);
  expect(elements[1]).toBe(first);
  expect(statements[0]!.argument.elements).toBe(elements);
});

it("rejects forged records and foreign/different-shape accessor receivers", () => {
  const first = compile(`function f(){${pad}return value}`, true).parsed.node.body[0] as {
    body: { body: Array<{ argument: { name: string } }> };
  };
  const other = compile(`function f(){${pad}return other}`, true).parsed.node
    .body[0] as typeof first;
  const identifier = first.body.body[0]!.argument;
  const descriptor = Object.getOwnPropertyDescriptor(first.body, "type")!;
  expect(() => descriptor.get!.call({})).toThrow("Foreign");
  expect(() => descriptor.get!.call(identifier)).toThrow("Foreign");
  expect(() => descriptor.set!.call(other.body, "stolen")).toThrow("Foreign");
  const raw = [...compilerEntries(first.body)].find(([key]) => key === "body")![1] as object;
  const forged = Object.create(Object.getPrototypeOf(raw));
  expect(compilerField(forged, "type")).toBeUndefined();
  expect(() => Reflect.construct(raw.constructor, [Symbol(), {}, 0])).toThrow("authority");
});

it.each([
  `function f(){${pad}return object.#missing}`,
  `function f(){${pad}return class A {#x=1;#x=2}}`,
  `function f(){${pad}return class A {#x=1;method(){return delete this.#x}}}`,
  `function f(){${pad}return class A {#x=1;method(){return super.#x}}}`,
  `function f(){${pad}return class A {#constructor=1}}`,
  `function f(){${pad}return class A {static get #x(){};set #x(x){}}}`
])("preserves complete private-name rejection for %j", (source) => {
  const outcome = (compact: boolean) => {
    try {
      compile(source, compact);
      return "success";
    } catch (error) {
      return { name: (error as Error).name, message: (error as Error).message };
    }
  };
  expect(outcome(true)).toEqual(outcome(false));
  expect(outcome(true)).not.toBe("success");
});

it("validates mutations of exposed private references", () => {
  const parsed = compile(
    `function f(){${pad}return class A {#x=1;method(){return this.#x}}}`,
    true
  ).parsed;
  const pending: unknown[] = [parsed.node];
  let changed = false;
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;
    if ("type" in value && value.type === "MemberExpression") {
      const member = value as unknown as {
        property: { type: string; name: string };
      };
      if (member.property.type === "PrivateIdentifier") {
        member.property.name = "missing";
        changed = true;
        break;
      }
    }
    for (const key of Object.keys(value))
      if (key !== "span") pending.push((value as Record<string, unknown>)[key]);
  }
  expect(changed).toBe(true);
  expect(() => validatePrivateNames(parsed.node)).toThrow("Undeclared private name #missing");
});

it.each([{ maxSteps: 1 }, { stringLength: 5 }, { dataSize: 5 }])(
  "preserves compile admission failures for %j",
  (limits) => {
    const outcome = (compact: boolean) => {
      try {
        compile(`function f(){${pad}return /a[b-c]+/giu};f;`, compact, limits);
        return "success";
      } catch (error) {
        return {
          name: (error as Error).name,
          message: (error as Error).message
        };
      }
    };
    expect(outcome(true)).toEqual(outcome(false));
    expect(outcome(true)).not.toBe("success");
  }
);
it("bounds numeric storage by its admitted source and rejects unsupported scalar values", () => {
  const storage = new CompactModuleAst("x");
  expect(() => storage.pack({ items: Array.from({ length: 2000 }, (_, i) => i) })).toThrow(
    "dataSize"
  );
  const other = new CompactModuleAst("x");
  expect(() => other.pack({ value: Symbol() })).toThrow("scalar");
  other.finish();
  expect(() => other.pack({})).toThrow("finished");
});
