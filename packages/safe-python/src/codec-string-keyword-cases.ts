/** Ordinary programs shared with the pinned external CPython oracle. */
export const codecStringKeywordCases = [
  {name: 'dictionary hash and equality determine parameter binding', source: `
events = []
failure = LookupError('binding')
class Key(str):
    def __hash__(self):
        return hash('encoding')
    def __eq__(self, other):
        events.append(other)
        if broken:
            raise failure
        return other == 'encoding'
    def __str__(self):
        raise AssertionError('rendered a bound keyword')
for convert in (str, lambda *args, **kwargs: str.__new__(str, *args, **kwargs)):
    broken = False
    events.clear()
    assert convert(b'\\xe9', **{Key('alias'): 'latin1'}) == 'é'
    assert events == ['encoding'], events
    broken = True
    events.clear()
    try:
        convert(b'\\xe9', **{Key('alias'): 'latin1'})
    except LookupError as error:
        assert error is failure
    else:
        assert False
    assert events == ['encoding'], events
`},
  {name: 'parameter-order keyword equality, duplicate precedence and text subtype construction', source: `
events = []
class Text(str):
    pass
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        events.append(other)
        return str.__eq__(self, other)
    def __str__(self):
        raise AssertionError('keyword rendering')
for convert in (str, Text, lambda *args, **kwargs: str.__new__(str, *args, **kwargs)):
    events.clear()
    result = convert(**{Key('errors'): 'strict', Key('encoding'): 'latin1', Key('object'): b'\\xe9'})
    assert result == 'é'
    assert type(result) is (Text if convert is Text else str)
    assert events == ['object', 'encoding', 'errors'], events
    try:
        convert(b'x', **{Key('object'): b'y'})
    except TypeError as error:
        assert error.args == ("argument for str() given by name ('object') and position (1)",)
    else:
        assert False
`},
  {name: 'unexpected keyword equality, truth, rendering and guest failures', source: `
events = []
mode = 'false'
failure = ValueError('keyword failure')
class Truth:
    def __bool__(self):
        events.append('truth')
        return mode == 'true'
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        events.append(other)
        if mode == 'raise':
            raise failure
        return Truth()
    def __str__(self):
        events.append('str')
        if mode == 'render-failure':
            raise failure
        return 'visible'
for convert in (str, lambda **kwargs: str.__new__(str, **kwargs)):
    for mode, expected in (
        ('false', ['object', 'truth', 'encoding', 'truth', 'errors', 'truth', 'str']),
        ('true', ['object', 'truth']),
        ('raise', ['object']),
        ('render-failure', ['object', 'truth', 'encoding', 'truth', 'errors', 'truth', 'str'])
    ):
        events.clear()
        try:
            convert(**{Key('encodign'): 'ascii'})
        except ValueError as error:
            assert mode in ('raise', 'render-failure') and error is failure
        except TypeError as error:
            assert mode in ('false', 'true')
            message = "invalid keyword argument for str()" if mode == 'true' else "str() got an unexpected keyword argument 'visible'. Did you mean 'encoding'?"
            assert error.args == (message,), error.args
        else:
            assert False
        assert events == expected, events
`},
];

export const codecStringKeywordCancellationCases = ['equality', 'truth', 'render'].map(stage => ({
  name: stage,
  source: `
class Truth:
    def __bool__(self):
        ${stage === 'truth' ? "print('cancel')" : 'pass'}
        return False
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        ${stage === 'equality' ? "print('cancel')" : 'pass'}
        return Truth()
    def __str__(self):
        ${stage === 'render' ? "print('cancel')" : 'pass'}
        return 'visible'
try:
    str(**{Key('encodign'): 'ascii'})
except BaseException:
    print('recovered')
`,
}));
