/** Executed unchanged by the pinned CPython oracle and the guest interpreter. */
export const codecClassDocumentationCases = [
  ...[false, true].flatMap(subtype => ["\\ud800", "a\\ud800\\udfffz", "a\\x00\\ud800"].map(text => ({
    name: `strict documentation UTF-8: subtype=${subtype} ${text}`,
    source: `
import codecs
class Text(str):
    def __str__(self):
        raise AssertionError('virtual string conversion')
    def encode(self, *args):
        raise AssertionError('virtual encoding')
doc = ${subtype ? `Text('${text}')` : `'${text}'`}
cell = (lambda value: lambda: value)(None).__closure__[0]
namespace = {'__doc__': doc, '__classcell__': cell}
try:
    type('Decoder', (codecs.IncrementalDecoder,), namespace)
except UnicodeEncodeError as error:
    assert error.object is doc
    assert error.encoding == 'utf-8'
    assert error.start == ${text.startsWith("a") ? text.includes("x00") ? 2 : 1 : 0}
    assert error.end == ${text.includes("udfff") ? 3 : text.includes("x00") ? 3 : 1}
    assert error.reason == 'surrogates not allowed'
    assert error.args == ('utf-8', doc, error.start, error.end, 'surrogates not allowed')
else:
    raise AssertionError('surrogate documentation accepted')
assert cell.cell_contents is None
assert namespace['__doc__'] is doc
`
  }))),
  ...[
    ["Decoder", "Decoder(data, /)\n--\n\nDocumentation", "(data, /)"],
    ["Outer.Decoder", "Decoder(é,\n 🐍=1)\n--\n\nDocumentation", "(é,\n 🐍=1)"],
    ["Decoder", "Decoder()\n--\n\n", "()"],
    ["Decoder", "Decoder(x)\n\n)\n--\n\nDocumentation", null],
    ["Decoder", "Decoder(x)\n--\nDocumentation", null],
    ["Decoder", "Other(x)\n--\n\nDocumentation", null],
    ["Decoder", "Decoder(x)\n--\n\nBefore\0After", "(x)"],
    ["Decoder", "Decoder(x\0)\n--\n\nDocumentation", null],
    ["Decoder", "Decoder((x)\n--\n\nDocumentation", "((x)"],
    ["Decoder", "Decoder(x)\n--\n\nOne)\n--\n\nTwo", "(x)"],
    ["Decoder", "Decoder(x)\r\n--\r\n\r\nDocumentation", null],
    ["包.🐍", "🐍(x)\n--\n\nDocumentation", "(x)"],
    ["Decoder", "Decoder(x)\n--\n", null],
    ["Decoder", "", null]
  ].flatMap(([name, doc, signature]) => [false, true].map(subtype => ({
    name: `captured signature ${JSON.stringify(doc)} subtype=${subtype}`,
    source: `
import codecs
class Text(str):
    def __str__(self):
        raise AssertionError('virtual string conversion')
doc = ${subtype ? `Text(${JSON.stringify(doc)})` : JSON.stringify(doc)}
Decoder = type(${JSON.stringify(name)}, (codecs.IncrementalDecoder,), {'__doc__': doc})
assert Decoder.__doc__ is doc
assert Decoder.__dict__['__doc__'] is doc
assert Decoder.__text_signature__ == ${signature === null ? "None" : JSON.stringify(signature)}
Decoder.__doc__ = 'changed'
assert Decoder.__text_signature__ == ${signature === null ? "None" : JSON.stringify(signature)}
Decoder.__name__ = 'Other'
assert Decoder.__text_signature__ == ${doc!.startsWith("Other(") ? "'(x)'" : "None"}
class Child(Decoder):
    pass
assert Child.__doc__ is None and Child.__text_signature__ is None
`
  }))),
  {
    name: "literal class documentation rejects surrogates during compilation",
    source: `
import codecs
class Decoder(codecs.IncrementalDecoder):
    'a\\ud800\\udfffz'
`,
    exception: "assert type(failure) is UnicodeEncodeError\nassert failure.args == ('utf-8', 'a\\ud800\\udfffz', 1, 3, 'surrogates not allowed')\nassert (failure.encoding, failure.object, failure.start, failure.end, failure.reason) == failure.args\n"
  },
  {
    name: "non-string documentation binds descriptors without string conversion",
    source: `
import codecs
events = []
class Documentation:
    def __str__(self):
        raise AssertionError('documentation string conversion')
    def __get__(self, instance, owner):
        events.append((instance, owner))
        return self
doc = Documentation()
Decoder = type('Decoder', (codecs.IncrementalDecoder,), {'__doc__': doc})
assert events == []
assert Decoder.__doc__ is doc
assert events == [(None, Decoder)]
assert Decoder.__dict__['__doc__'] is doc
assert Decoder.__text_signature__ is None
Decoder.__doc__ = 'Decoder(x)\\n--\\n\\nLater'
assert Decoder.__text_signature__ is None
Decoder.__doc__ = '\\ud800'
assert Decoder.__doc__ == '\\ud800'
assert Decoder.__text_signature__ is None
for value in (None, 42, b'bytes', ['documentation']):
    Other = type('Other', (codecs.IncrementalEncoder,), {'__doc__': value})
    assert Other.__doc__ is value
    assert Other.__text_signature__ is None
`
  },
  {
    name: "documentation conversion precedes reserved wrappers and class cells",
    source: `
import codecs
events = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            events.append(str(self))
        return str.__eq__(self, other)
namespace = {Key('__module__'): 'probe', Key('__qualname__'): 'Decoder', Key('__doc__'): '\\ud800', Key('__new__'): None, Key('__classcell__'): None}
try:
    type('Decoder', (codecs.IncrementalDecoder,), namespace)
except UnicodeEncodeError:
    pass
else:
    raise AssertionError('documentation did not fail first')
assert events == ['__module__', '__qualname__', '__qualname__', '__doc__'], events
`
  },
  ...[1, 2].map(at => ({
    name: `documentation namespace failure at lookup ${at}`,
    source: `
import codecs
failure = ValueError('documentation namespace')
expected = '__doc__'
seen = []
cell = (lambda value: lambda: value)(None).__closure__[0]
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other is expected)
            if len(seen) == ${at}:
                raise failure
        return str.__eq__(self, other)
namespace = {Key('__doc__'): 'Decoder(x)\\n--\\n\\nDocumentation', '__classcell__': cell}
try:
    type('Decoder', (codecs.IncrementalDecoder,), namespace)
except ValueError as error:
    assert error is failure
else:
    raise AssertionError('documentation callback failure ignored')
assert seen == [True] * ${at}, seen
assert ${at === 1 ? "cell.cell_contents is None" : "cell.cell_contents.__name__ == 'Decoder'"}
assert len(namespace) == 2
`
  }))
];

export function codecClassDocumentationCancellationSource(at: number): string {
  return `
import codecs
seen = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other)
            if len(seen) == ${at}:
                input()
        return str.__eq__(self, other)
try:
    type('Decoder', (codecs.IncrementalDecoder,), {Key('__doc__'): 'documentation'})
except BaseException:
    raise AssertionError('cancellation reached guest')
raise AssertionError('cancellation ignored')
`;
}
