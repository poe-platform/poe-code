import {expect, it} from "vitest";
import {PythonSession} from "./index.js";

const setup = String.raw`
import codecs
original = codecs.lookup_error('strict')
name = 'utf\ud800'
seen = []
def strict(error):
    assert error.object is name
    seen.append(error)
    return (b'8', error.end)
codecs.register_error('strict', strict)
`;
const limits = {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100};

it.each([false, true])("lookup shares the Unicode byte cache (prepopulated=%s)", prepopulated => {
  const source = setup + (prepopulated ? String.raw`
assert codecs.lookup_error('surrogatepass')(UnicodeEncodeError(name, '\ud800', 0, 1, 'x')) == (b'\xed\xa0\x80', 1)
codecs.register_error('strict', original)
` : "") + String.raw`
assert codecs.lookup(name).name == 'utf-8'
codecs.register_error('strict', original)
assert codecs.lookup(name).name == 'utf-8'
def search(name):
    return None
codecs.register(search)
codecs.unregister(search)
assert codecs.lookup(name).name == 'utf-8'
assert len(seen) == 1
`;
  expect(new PythonSession({hashSeed: [1n, 2n], limits}).exec(source).status).toBe("ok");
});

it.each([
  [String.raw`b'\xff'`, String.raw`'\ufffd'`],
  [String.raw`b'\xc3\xa9'`, String.raw`'\xe9'`],
  [String.raw`b'\xed\xa0\x80'`, String.raw`'\ufffd\ufffd\ufffd'`],
  [String.raw`b'\xf0\x90'`, String.raw`'\ufffd'`]
])("lookup normalizes raw bytes and renders UTF-8 diagnostics: %s", (replacement, suffix) => {
  const source = String.raw`
import codecs
name = 'notcodec\ud800'
seen = []
codecs.register_error('strict', lambda error: (${replacement}, error.end))
def search(name):
    seen.append(name)
codecs.register(search)
try:
    codecs.lookup(name)
except LookupError as error:
    assert str(error) == 'unknown encoding: notcodec' + ${suffix}
else:
    assert False
assert seen == ['notcodec']
`;
  expect(new PythonSession({hashSeed: [1n, 2n], limits}).exec(source).status).toBe("ok");
});

it("rejects NUL in recovered bytes before searching, retaining the Unicode cache", () => {
  expect(new PythonSession({hashSeed: [1n, 2n], limits}).exec(setup + String.raw`
codecs.register_error('strict', lambda error: (b'8\x00tail', error.end))
for attempt in range(2):
    try:
        codecs.lookup(name)
    except ValueError as error:
        assert str(error) == 'embedded null character'
    else:
        assert False
    codecs.register_error('strict', original)
assert codecs.lookup_error('surrogatepass')(UnicodeEncodeError(name, '\ud800', 0, 1, 'x')) == (b'\xed\xa0\x80', 1)
`).status).toBe("ok");
});

it.each([false, true])("lookup recovery observes service cancellation (throws=%s)", throws => {
  const controller = new AbortController();
  let reads = 0;
  const session = new PythonSession({hashSeed: [1n, 2n], limits, signal: controller.signal, output: {write() {}, flush() {}}, input: {
    readLine() {
      reads++;
      controller.abort();
      if (throws) throw Error("cancelled service");
      return "8\n";
    }
  }});
  expect(session.exec(setup + String.raw`
codecs.register_error('strict', lambda error: (input(), error.end))
codecs.lookup(name)
`)).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(reads).toBe(1);
  expect(session.exec("pass")).toMatchObject({status: "terminated", reason: "cancelled"});
});

it("keeps failed conversions retryable, uses negative positions, and bypasses subtype methods", () => {
  expect(new PythonSession({hashSeed: [1n, 2n], limits}).exec(setup + String.raw`
class Name(str):
    def __str__(self):
        raise AssertionError('virtual str')
    def encode(self, *args):
        raise AssertionError('virtual encode')
name = Name('utf\ud800x')
sentinel = ValueError('strict failure')
def fail(error):
    assert error.object is name
    seen.append(error)
    raise sentinel
codecs.register_error('strict', fail)
for attempt in range(2):
    try:
        codecs.lookup(name)
    except ValueError as error:
        assert error is sentinel
    else:
        assert False
assert len(seen) == 2
def repair(error):
    assert error.object is name
    seen.append(error)
    return (b'8', -1)
codecs.register_error('strict', repair)
def search(normalized):
    assert normalized == 'utf8x'
    return codecs.lookup('utf8')
codecs.register(search)
assert codecs.lookup(name).name == 'utf-8'
codecs.register_error('strict', original)
assert codecs.lookup(name).name == 'utf-8'
assert len(seen) == 3
`).status).toBe("ok");
});
