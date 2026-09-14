import {expect, it} from "vitest";
import {PythonSession} from "./index.js";

const limits = {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100};

it.each(["encode", "decode"])("%s uses cached native name bytes and preserves failure notes", operation => {
  const source = String.raw`
import codecs
original = codecs.lookup_error('strict')
name = 'utf\ud8008'
seen = []
def repair(error):
    assert error.object is name
    seen.append(error)
    return (b'', -1)
codecs.register_error('strict', repair)
assert codecs.lookup(name).name == 'utf-8'
codecs.register_error('strict', original)
assert codecs.${operation}(${operation === "encode" ? "'x'" : "b'x'"}, name) == ${operation === "encode" ? "b'x'" : "'x'"}
assert len(seen) == 1
name = 'custom\ud800'
codecs.register_error('strict', lambda error: (b'\xff', error.end))
sentinel = ValueError('failure')
def fail(*args):
    raise sentinel
def search(normalized):
    assert normalized == 'custom'
    return codecs.CodecInfo(fail, fail, name=normalized)
codecs.register(search)
try:
    codecs.${operation}('x', name)
except ValueError as error:
    assert error is sentinel
    assert error.__notes__ == ["${operation === "encode" ? "encoding" : "decoding"} with 'custom\ufffd' codec failed"]
else:
    assert False
`;
  expect(new PythonSession({hashSeed: [1n, 2n], limits}).exec(source).status).toBe("ok");
});

it.each(["encode", "decode"])("%s cancels during name recovery", operation => {
  const controller = new AbortController();
  let reads = 0;
  const session = new PythonSession({hashSeed: [1n, 2n], limits, signal: controller.signal,
    output: {write() {}, flush() {}}, input: {readLine() {reads++; controller.abort(); return "8\n";}}
  });
  expect(session.exec(String.raw`
import codecs
codecs.register_error('strict', lambda error: (input(), error.end))
codecs.${operation}('x', 'utf\ud800')
`)).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(reads).toBe(1);
});

it.each(["encode", "decode"])("%s retains raw bytes, retries failures, and validates NUL before errors", operation => {
  expect(new PythonSession({hashSeed: [1n, 2n], limits}).exec(String.raw`
import codecs
original = codecs.lookup_error('strict')
class Name(str):
    def encode(self, *args):
        raise AssertionError('virtual encode')
    def __str__(self):
        raise AssertionError('virtual str')
name = Name('missing\ud800')
sentinel = ValueError('repair failed')
def fail(error):
    assert error.object is name
    raise sentinel
codecs.register_error('strict', fail)
for attempt in range(2):
    try:
        codecs.${operation}('x', name)
    except ValueError as error:
        assert error is sentinel
    else:
        assert False
codecs.register_error('strict', lambda error: (b'\xff', error.end))
for attempt in range(2):
    try:
        codecs.${operation}('x', name)
    except LookupError as error:
        assert str(error) == 'unknown encoding: missing\ufffd'
    else:
        assert False
    codecs.register_error('strict', original)
name = Name('utf\ud800')
codecs.register_error('strict', lambda error: (b'8\x00', error.end))
for attempt in range(2):
    try:
        codecs.${operation}('x', name, 42)
    except ValueError as error:
        assert str(error) == 'embedded null character'
    else:
        assert False
    codecs.register_error('strict', original)
`).status).toBe("ok");
});
