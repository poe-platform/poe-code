import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecRegistryBindingCases} from "./codec-registry-binding-cases.js";

it.each(codecRegistryBindingCases)("public registry binding: $name", ({source}) => {
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 4000000, maxDepth: 100}, hashSeed: [1n, 2n]});
  const result = session.exec(source);
  let detail: string | undefined;
  if (result.status === "exception") {
    session.globals.set("failure_result", result.exception);
    const diagnostic = session.eval("str(failure_result)");
    if (diagnostic.status === "ok") detail = String(diagnostic.value.primitive);
  }
  expect(result.status, detail).toBe("ok");
});

it.each(["encode", "decode"])("keeps cancellation fatal in repeated %s keyword diagnostics", operation => {
  for (const stage of ["equality", "truth", "render"]) {
    const controller = new AbortController();
    let reads = 0;
    const session = new PythonSession({
      limits: {maxSteps: 1000000, maxAllocatedBytes: 4000000, maxDepth: 100}, hashSeed: [1n, 2n], signal: controller.signal,
      input: {readLine() { reads++; controller.abort(); return "cancelled\n"; }}, output: {write() {}, flush() {}}
    });
    const result = session.exec(`
import _codecs
class Truth:
    def __bool__(self):
        ${stage === "truth" ? "input()" : "pass"}
        return False
class Key(str):
    def __hash__(self):
        return id(self)
    def __eq__(self, other):
        ${stage === "equality" ? "input()" : "pass"}
        return Truth()
    def __str__(self):
        ${stage === "render" ? "input()" : "pass"}
        return 'visible'
try:
    _codecs.${operation}(b'x', **{Key('errors'): 'first', Key('errors'): 'second'})
except BaseException:
    raise AssertionError('continued after cancellation')
`);
    expect(reads, stage).toBe(1);
    expect(result, stage).toMatchObject({status: "terminated", reason: "cancelled"});
    expect(session.eval("1"), stage).toMatchObject({status: "terminated", reason: "cancelled"});
  }
});
