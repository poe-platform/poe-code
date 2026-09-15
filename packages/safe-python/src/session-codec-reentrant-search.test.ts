import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecReentrantSearchCases} from "./codec-reentrant-search-cases.js";

it.each(codecReentrantSearchCases)("registry reentrancy: $name", ({source}) => {
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

it("isolates search caches and error handlers between live interpreters", () => {
  const sessions = [0, 1].map(() => new PythonSession({limits: {maxSteps: 500000, maxAllocatedBytes: 8000000, maxDepth: 100}, hashSeed: [1n, 2n]}));
  for (const [index, session] of sessions.entries()) {
    expect(session.exec(`
import _codecs
events = []
codec = (${index}, None, None, None)
def search(name):
    events.append(name)
    return codec
def handler(error):
    return ('${index}', error.end)
_codecs.register(search)
_codecs.register_error('isolated_handler', handler)
assert _codecs.lookup('isolated_search') is codec
assert _codecs.ascii_encode('é', 'isolated_handler') == (b'${index}', 1)
`).status).toBe("ok");
  }
  expect(sessions[0].exec(`
_codecs.unregister(search)
assert _codecs._unregister_error('isolated_handler') is True
try:
    _codecs.lookup('isolated_search')
except LookupError:
    pass
else:
    assert False
try:
    _codecs.lookup_error('isolated_handler')
except LookupError:
    pass
else:
    assert False
`).status).toBe("ok");
  expect(sessions[1].exec(`
assert _codecs.lookup('ISOLATED SEARCH') is codec
assert events == ['isolated_search']
assert _codecs.lookup_error('isolated_handler') is handler
assert _codecs.ascii_encode('é', 'isolated_handler') == (b'1', 1)
`).status).toBe("ok");
});

it.each([false, true])("keeps cancellation fatal after search-path mutation (throws=%s)", throws => {
  const controller = new AbortController(), writes: string[] = [];
  const session = new PythonSession({
    limits: {maxSteps: 500000, maxAllocatedBytes: 8000000, maxDepth: 100}, hashSeed: [1n, 2n], signal: controller.signal,
    output: {write(text) { writes.push(text); controller.abort(); }, flush() {}}
  });
  const result = session.exec(`
import _codecs
def later(name):
    raise AssertionError('search continued after cancellation')
def search(name):
    _codecs.unregister(search)
    _codecs.register(later)
    print('cancel')
    ${throws ? "raise ValueError('cancelled callback')" : "return (None, None, None, None)"}
_codecs.register(search)
try:
    _codecs.lookup('cancelled_mutation')
except BaseException:
    print('recovered')
`);
  expect(writes).toEqual(["cancel"]);
  expect(result).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(session.eval("1")).toMatchObject({status: "terminated", reason: "cancelled"});
});
