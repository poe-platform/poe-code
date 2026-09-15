/** Unchanged programs for PythonSession and the pinned external oracle. */
export const codecKeywordUnicodeCases = [
  ["registry encode", "codecs.encode", "'x'", "encode"],
  ["registry decode", "codecs.decode", "b'x'", "decode"],
  ["str encode", "str.encode", "'x'", "encode"],
  ["bytes decode", "bytes.decode", "b'x'", "decode"],
].map(([name, callable, argument, operation]) => ({name, source: String.raw`
import codecs
events = []
failure = ValueError('keyword rendering failed')
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        events.append(('compare', other))
        return False
    def __str__(self):
        events.append(('render', input()))
        if broken:
            raise failure
        return rendered
for spelling in ('\ud800\udc00', '\U00010000', 'encoding\ud800\udc00'):
    for subclass in (False, True):
        broken = False
        rendered = spelling
        key = Key('encodign') if subclass else spelling
        events.clear()
        try:
            ${callable}(${argument}, **{key: 'ascii'})
        except TypeError as error:
            expected = "${operation}() got an unexpected keyword argument '" + spelling + "'"
            if subclass:
                expected += ". Did you mean 'encoding'?"
            assert error.args == (expected,)
            assert str(error) == expected
            print([ord(character) for character in error.args[0]], events)
        else:
            raise AssertionError('keyword accepted')
broken = True
events.clear()
try:
    ${callable}(${argument}, **{Key('encodign'): 'ascii'})
except ValueError as error:
    assert error is failure
    print(error.args, events)
else:
    raise AssertionError('rendering failure swallowed')
` }));
