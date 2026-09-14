import {expect, it} from "vitest";
import {PythonSession} from "./index.js";

const limits = {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100};

it.each(["'x'.encode(name)", "b'x'.decode(name)"])("native name cache: %s", expression => {
  expect(new PythonSession({hashSeed: [1n, 2n], limits}).exec(String.raw`
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
assert ${expression} == ${expression.startsWith("'x'") ? "b'x'" : "'x'"}
assert len(seen) == 1
name = 'missing\ud800'
codecs.register_error('strict', lambda error: (b'\xff', error.end))
for attempt in range(2):
    try:
        ${expression}
    except LookupError as error:
        assert str(error) == 'unknown encoding: missing\ufffd'
    else:
        assert False
    codecs.register_error('strict', original)
`).status).toBe("ok");
});

it.each(["'x'.encode", "b'x'.decode"])("native recovery cancellation: %s", expression => {
  const controller = new AbortController();
  let reads = 0;
  const session = new PythonSession({hashSeed: [1n, 2n], limits, signal: controller.signal,
    output: {write() {}, flush() {}}, input: {readLine() {reads++; controller.abort(); return "8\n";}}
  });
  expect(session.exec(String.raw`
import codecs
codecs.register_error('strict', lambda error: (input(), error.end))
${expression}('utf\ud800')
`).status).toBe("terminated");
  expect(reads).toBe(1);
});

it.each(["'x'.encode", "b''.decode"])("native name validation precedes errors and empty input: %s", expression => {
  expect(new PythonSession({hashSeed: [1n, 2n], limits}).exec(String.raw`
import codecs
original = codecs.lookup_error('strict')
class Name(str):
    def encode(self, *args):
        raise AssertionError('virtual encode')
    def __str__(self):
        raise AssertionError('virtual str')
name = Name('utf\ud800')
sentinel = ValueError('repair failure')
def fail(error):
    assert error.object is name
    raise sentinel
codecs.register_error('strict', fail)
for attempt in range(2):
    try:
        ${expression}(name)
    except ValueError as error:
        assert error is sentinel
    else:
        assert False
codecs.register_error('strict', lambda error: (b'8\x00', error.end))
for attempt in range(2):
    try:
        ${expression}(name, 42)
    except ValueError as error:
        assert str(error) == 'embedded null character'
    else:
        assert False
    codecs.register_error('strict', original)
`).status).toBe("ok");
});
