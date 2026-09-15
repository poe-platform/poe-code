import { expect, it } from "vitest";
import { PythonSession } from "./index.js";

it.each([
  ["type(int | str).missing", "type object 'typing.Union' has no attribute 'missing'"],
  ["type.__getattribute__(type(int | str), 'missing')", "type object 'typing.Union' has no attribute 'missing'"],
  ["getattr(type(int | str), 'missing')", "type object 'typing.Union' has no attribute 'missing'"],
  ["int.missing", "type object 'int' has no attribute 'missing'"],
  ["Custom.missing", "type object 'Custom' has no attribute 'missing'"],
  ["type.__getattribute__(Custom, 'missing')", "type object 'Custom' has no attribute 'missing'"],
])("uses the native type name for missing attributes: %s", (expression, message) => {
  const session = new PythonSession({ limits: { maxSteps: 100_000, maxAllocatedBytes: 4_000_000, maxDepth: 100 }, hashSeed: [1n, 2n] });
  expect(session.exec(`
class Custom:
    pass
Custom.__module__ = 'different.module'
try:
    ${expression}
except AttributeError as error:
    result = (str(error), error.args)
`)).toEqual({ status: "ok" });
  expect(session.eval("result[0]")).toMatchObject({ status: "ok", value: { primitive: message } });
  expect(session.eval("result[1] == (result[0],)")).toMatchObject({ status: "ok", value: { primitive: true } });
});
