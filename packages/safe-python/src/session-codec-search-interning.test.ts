import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecSearchInterningCases} from "./codec-search-interning-cases.js";

it.each(codecSearchInterningCases)("codec search interning: $name", ({source}) => {
  const session = new PythonSession({limits: {maxSteps: 500000, maxAllocatedBytes: 8000000, maxDepth: 100}, hashSeed: [1n, 2n]});
  const result = session.exec(source);
  let detail: string | undefined;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const diagnostic = session.eval("str(failure)");
    if (diagnostic.status === "ok") detail = String(diagnostic.value.primitive);
  }
  expect(result.status, detail).toBe("ok");
});

it("retains search-name identity for literals in later compilations", () => {
  const session = new PythonSession({limits: {maxSteps: 500000, maxAllocatedBytes: 8000000, maxDepth: 100}, hashSeed: [1n, 2n]});
  expect(session.exec(`
import _codecs
seen = []
def search(name):
    seen.append(name)
    return (None, None, None, None)
_codecs.register(search)
_codecs.lookup('CODEC LATER LITERAL')
`).status).toBe("ok");
  expect(session.exec("literal = 'codec_later_literal'\nassert seen[0] is literal").status).toBe("ok");
});
