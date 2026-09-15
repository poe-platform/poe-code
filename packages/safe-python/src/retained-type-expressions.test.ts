import { expect, it } from "vitest";
import { parseModule } from "./module.js";

it("retains annotations and starred function annotation expressions with source spans", () => {
  expect(parseModule("def f(x: mark(), *args: *Ts) -> Result:pass\nx: Other = 1\n")).toMatchObject({ body: [
    { kind: "function", parameters: [
      { annotation: { kind: "call", callee: { name: "mark" } } },
      { annotation: { kind: "unpack", value: { name: "Ts" } } }
    ], returns: { kind: "name", name: "Result" } },
    { kind: "annotated-assignment", annotation: { kind: "name", name: "Other" }, value: { value: 1n } }
  ] });
});

it("retains alias values, generic parameter kinds, bounds, constraints and defaults", () => {
  expect(parseModule("type Alias[T: Bound = Default, *Ts = *Tail, **P = Params] = tuple[T, *Ts]\nclass C[T: (int, str)]:pass\ndef f[T]():pass\n")).toMatchObject({ body: [
    { kind: "type-alias", value: { kind: "subscript" }, typeParameters: [
      { name: "T", kind: "type-var", bound: { name: "Bound" }, default: { name: "Default" } },
      { name: "Ts", kind: "type-var-tuple", default: { kind: "unpack", value: { name: "Tail" } } },
      { name: "P", kind: "param-spec", default: { name: "Params" } }
    ] },
    { kind: "class", typeParameters: [{ name: "T", kind: "type-var", bound: { kind: "tuple" } }] },
    { kind: "function", typeParameters: [{ name: "T", kind: "type-var", bound: null, default: null }] }
  ] });
});
