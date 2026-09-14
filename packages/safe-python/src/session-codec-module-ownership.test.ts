import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecModuleOwnershipCases} from "./codec-module-ownership-cases.js";

it.each(codecModuleOwnershipCases)("public codec module ownership: $name", ({source}) => {
  const session = new PythonSession({limits: {maxSteps: 200000, maxAllocatedBytes: 4000000, maxDepth: 100}, hashSeed: [1n, 2n]});
  const result = session.exec(source);
  let detail: string | undefined;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const message = session.eval("str(failure)");
    if (message.status === "ok") detail = String(message.value.primitive);
  }
  expect(result.status, detail).toBe("ok");
});

it("keeps native codec module owners local to their session", () => {
  const sessions = Array.from({length: 2}, () => new PythonSession({limits: {maxSteps: 200000, maxAllocatedBytes: 4000000, maxDepth: 100}, hashSeed: [1n, 2n]}));
  expect(sessions[0].exec("import _codecs\n_codecs.ascii_encode.__self__.marker = 'first'")).toEqual({status: "ok"});
  expect(sessions[1].exec("import _codecs\nassert _codecs.ascii_encode.__self__ is _codecs\nassert not hasattr(_codecs, 'marker')")).toEqual({status: "ok"});
  expect(sessions[0].eval("_codecs.marker")).toMatchObject({status: "ok"});
});
