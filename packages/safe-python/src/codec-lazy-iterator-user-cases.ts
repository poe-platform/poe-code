/** Public programs run unchanged by the pinned oracle and PythonSession. */
export const codecLazyIteratorUserCases = ["encode", "decode"].flatMap(operation =>
  ["finish", "suppress-final", "close", "empty"].map(mode => ({
    name: `${operation}: ${mode}`,
    source: `import codecs
import encodings
events = []
outputs = []
empty = ${operation === "encode" ? "''" : "b''"}
chunks = ${mode === "empty" ? "[]" : operation === "encode" ? "['', 'A', 'B']" : "[b'', b'A', b'B']"}
class Source:
    def __init__(self):
        self.position = 0
    def __iter__(self):
        events.append('iter')
        return self
    def __next__(self):
        events.append(('next', self.position))
        if self.position == len(chunks):
            raise StopIteration
        value = chunks[self.position]
        self.position += 1
        return value
    def close(self):
        events.append('source-close')
class Output:
    def __init__(self, value, final, method):
        self.value = value
        self.final = final
        self.method = method
        outputs.append(self)
    def __bool__(self):
        events.append(('truth', self.value, self.final, self.method))
        if len(outputs) == 1:
            assert input() == 'continue'
        return ${mode === "suppress-final" ? "not self.final and bool(self.value)" : "self.final or bool(self.value)"}
class Incremental:
    def __init__(self, errors, marker):
        assert errors is policy and marker is token
        events.append(('init', errors is policy, marker is token))
    def ${operation}(self, value, final=False):
        events.append(('original', value, final))
        return Output(value, final, 'original')
def changed(self, value, final=False):
    events.append(('changed', value, final))
    return Output(value, final, 'changed')
def forbidden(*args, **kwargs):
    raise AssertionError('obsolete factory was called')
info = codecs.CodecInfo(None, None, incremental${operation === "encode" ? "encoder" : "decoder"}=Incremental)
def old_search(name):
    events.append(('old-search', name))
    raise AssertionError('lookup was not deferred')
def search(name):
    events.append(('search', name))
    assert name == 'lazy_codec'
    return info
codecs.unregister(encodings.search_function)
codecs.register(old_search)
policy = object()
token = object()
source = Source()
iterator = codecs.iter${operation}(source, 'LaZy /Codec', policy, marker=token)
assert events == []
codecs.unregister(old_search)
codecs.register(search)
${mode === "empty" ? `first = next(iterator)
assert first is outputs[0]
assert first.value == empty and first.final
assert first.method == 'original'` : `first = next(iterator)
assert first is outputs[1]
assert first.value == chunks[1] and not first.final
assert first.method == 'original'`}
info.incremental${operation === "encode" ? "encoder" : "decoder"} = forbidden
codecs.unregister(search)
Incremental.${operation} = changed
${mode === "close" ? `assert iterator.close() is None
assert list(iterator) == []
assert source.position == 2` : `remaining = list(iterator)
assert all(any(value is output for output in outputs) for value in remaining)
print([(value.value, value.final, value.method) for value in remaining])`}
assert iterator.close() is None
assert 'source-close' not in events
assert list(iterator) == []
print(events)
print([(value.value, value.final, value.method) for value in outputs])
print(source.position)
`
  }))
);
