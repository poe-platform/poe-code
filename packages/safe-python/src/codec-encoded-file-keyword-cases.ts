/** Unchanged public programs for the pinned CPython oracle and guest. */
export const codecEncodedFileKeywordCases = [
  {
    name: 'EncodedFile accepts string subclass keywords with native spelling',
    source: `import codecs
class Key(str):
    def __str__(self):
        raise AssertionError('conversion')
stream = object()
wrapped = codecs.EncodedFile(**{Key('file'): stream, Key('data_encoding'): 'utf-8'})
assert wrapped.stream is stream
assert wrapped.data_encoding == wrapped.file_encoding == 'utf-8'
`,
  },
  {
    name: 'EncodedFile keyword equality runs in parameter order and can redirect binding',
    source: `import codecs
events = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        events.append(other)
        return other == 'file'
stream = object()
wrapped = codecs.EncodedFile(**{Key('unrelated'): stream, 'data_encoding': 'utf-8'})
assert wrapped.stream is stream
assert events == ['file'], events
`,
  },
  {
    name: 'EncodedFile keyword equality failure short circuits later keys and lookup',
    source: `import codecs
events = []
failure = LookupError('keyword')
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        events.append(other)
        raise failure
key = Key('unrelated')
def lookup(name):
    raise AssertionError('body entered')
codecs.lookup = lookup
try:
    codecs.EncodedFile(**{'file': None, key: None})
except LookupError as error:
    assert error is failure
else:
    raise AssertionError('equality exception lost')
assert events == ['file'], events
`,
  },
  {
    name: 'EncodedFile duplicate binding stops before a later keyword callback',
    source: `import codecs
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        raise AssertionError('late equality')
try:
    codecs.EncodedFile(None, **{'file': None, Key('later'): None})
except TypeError as error:
    assert error.args == ("EncodedFile() got multiple values for argument 'file'",)
else:
    raise AssertionError('duplicate accepted')
`,
  },
];

codecEncodedFileKeywordCases.push(
  {
    name: 'EncodedFile duplicate diagnostic uses the original keyword str slot',
    source: `import codecs
events = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        events.append(other)
        return other == 'file'
    def __str__(self):
        events.append('str')
        return 'shown'
try:
    codecs.EncodedFile(None, **{Key('redirected'): None})
except TypeError as error:
    assert error.args == ("EncodedFile() got multiple values for argument 'shown'",), error.args
else:
    raise AssertionError('duplicate accepted')
assert events == ['file', 'str'], events
`,
  },
  {
    name: 'EncodedFile keyword truth conversion preserves its original exception',
    source: `import codecs
events = []
failure = ValueError('truth')
class Decision:
    def __bool__(self):
        events.append('truth')
        raise failure
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        events.append(other)
        return Decision()
try:
    codecs.EncodedFile(**{Key('other'): None})
except ValueError as error:
    assert error is failure
else:
    raise AssertionError('truth failure lost')
assert events == ['file', 'truth'], events
`,
  },
  {
    name: 'EncodedFile binding observes defaults mutated by keyword equality',
    source: `import codecs
stream = object()
errors = object()
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        codecs.EncodedFile.__defaults__ = ('utf-8', None, errors)
        return other == 'file'
wrapped = codecs.EncodedFile(**{Key('alias'): stream})
assert wrapped.stream is stream and wrapped.errors is errors
assert wrapped.data_encoding == wrapped.file_encoding == 'utf-8'
`,
  },
  {
    name: 'EncodedFile replacement code reports positional-only keyword aliases',
    source: `import codecs
events = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        events.append(other)
        return other == 'file'
def replacement(file, /, data_encoding):
    raise AssertionError('body entered')
codecs.EncodedFile.__code__ = replacement.__code__
try:
    codecs.EncodedFile(**{Key('alias'): None})
except TypeError as error:
    assert error.args == ("EncodedFile() got some positional-only arguments passed as keyword arguments: 'alias'",), error.args
else:
    raise AssertionError('positional-only accepted')
assert events == ['data_encoding', 'file'], events
`,
  },
);

export const codecEncodedFileKeywordServiceSource = `import codecs
events = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        events.append(other)
        assert input() == 'file'
        return other == 'file'
stream = object()
wrapped = codecs.EncodedFile(**{Key('alias'): stream, 'data_encoding': 'utf-8'})
assert wrapped.stream is stream and events == ['file']
print('verified')
`;

codecEncodedFileKeywordCases.push(
  {
    name: 'EncodedFile positional-only errors use native keyword text without str conversion',
    source: `import codecs
class Key(str):
    def __str__(self):
        raise AssertionError('virtual conflict text')
def replacement(file, /):
    raise AssertionError('body entered')
codecs.EncodedFile.__code__ = replacement.__code__
try:
    codecs.EncodedFile(**{Key('file'): None})
except TypeError as error:
    assert error.args == ("EncodedFile() got some positional-only arguments passed as keyword arguments: 'file'",), error.args
else:
    raise AssertionError('positional-only accepted')
`,
  },
  {
    name: 'EncodedFile keyword-only defaults replaced during keyword binding remain live',
    source: `import codecs
stream = object()
errors = object()
def replacement(file, *, errors='old'):
    return file, errors
codecs.EncodedFile.__code__ = replacement.__code__
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        codecs.EncodedFile.__kwdefaults__ = {'errors': errors}
        return other == 'file'
assert codecs.EncodedFile(**{Key('alias'): stream}) == (stream, errors)
`,
  },
);
