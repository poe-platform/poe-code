import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { parseModule } from "./parser.js";
import { validatePrivateNames } from "./private-names.js";

const source = "class C { #x=3; read(){return this.#x} }";
const klass = parseModule(source).body[0];
if (klass?.type !== "ClassDeclaration") throw new Error("Expected class declaration.");
const method = klass.body.body[1];
if (method?.type !== "MethodDefinition") throw new Error("Expected method definition.");
const expression = method.value.body;

it("accepts private references declared in an enclosing evaluation context", () => {
  expect(runInNewContext('class C {#x=3; read(){return eval("this.#x")}}; new C().read()')).toBe(3);
  expect(() => validatePrivateNames(expression, new Set(["x"]))).not.toThrow();
});

it("does not admit undeclared private references without an enclosing context", () => {
  expect(() => validatePrivateNames(expression)).toThrow("Undeclared private name #x.");
  expect(() => validatePrivateNames(expression, new Set(["other"])))
    .toThrow("Undeclared private name #x.");
});

it("keeps class-local private declarations independent of the caller's set", () => {
  const inherited = new Set(["outer"]);
  expect(() => validatePrivateNames(klass, inherited)).not.toThrow();
  expect([...inherited]).toEqual(["outer"]);
  expect(() => validatePrivateNames(expression, inherited)).toThrow("Undeclared private name #x.");
});
