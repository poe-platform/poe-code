import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import reference from "./runtime/__snapshots__/list-native-descriptor-contracts-3.14.7.json";

it.each(reference.rows)("matches native list descriptors: $name", ({source, expected}) => {
  const session = new PythonSession({limits: {maxSteps: 200_000, maxAllocatedBytes: 4_000_000, maxDepth: 100}, hashSeed: [1n, 2n]});
  expect(session.exec(source)).toEqual({status: "ok"});
  expect(session.eval("repr(actual)")).toMatchObject({status: "ok", value: {primitive: expected}});
});

it.each(["lookup", "render"])("keeps list diagnostic %s cancellation fatal", stage => {
  const controller = new AbortController(), writes: string[] = [];
  const session = new PythonSession({signal: controller.signal,
    limits: {maxSteps: 200_000, maxAllocatedBytes: 4_000_000, maxDepth: 100}, hashSeed: [1n, 2n],
    output: {write(text) { writes.push(text); controller.abort(); }, flush() {}}
  });
  expect(session.exec(`
class Text(str):
    def __str__(self):
        ${stage === "render" ? "print('cancel')" : "pass"}
        return 'Visible'
class Meta(type):
    def __getattribute__(self, name):
        if name == '__qualname__':
            ${stage === "lookup" ? "print('cancel')" : "pass"}
            return Text('Stored')
        return type.__getattribute__(self, name)
class L(list, metaclass=Meta): pass
method = L().append
try:
    method()
except BaseException:
    print('recovered')
`)).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(writes).toEqual(["cancel"]);
});
