/** Iterator lifecycle and metadata remain visible through normal guest calls. */
export const codecStreamIteratorLifecycleCases = ['encode', 'decode'].map(operation => ({
  name: `iter${operation} metadata, suspension, reentry and final failures`,
  source: `
import codecs
function = codecs.iter${operation}
code = function.__code__
print(function.__name__, function.__qualname__, function.__module__, function.__doc__)
print(function.__defaults__, function.__kwdefaults__, function.__annotations__, function.__annotate__)
print(code.co_varnames, code.co_argcount, code.co_posonlyargcount, code.co_kwonlyargcount, code.co_flags, code.co_firstlineno, code.co_filename)
events = []
failure = LookupError('source')
class Codec:
    def __init__(self, errors, **kwargs):
        events.append(('init', errors, kwargs))
    def ${operation}(self, data, final=False):
        events.append((data, final))
        if reenter:
            try:
                next(iterator)
            except ValueError as error:
                events.append(error.args)
        if final and stop:
            raise StopIteration('final')
        return 'final' if final else data
codecs.getincremental${operation === 'encode' ? 'encoder' : 'decoder'} = lambda name: Codec
reenter = False
stop = False
iterator = function(['A', 'B'], 'unused', 'policy', marker=17)
print(events)
try:
    iterator.send(1)
except TypeError as error:
    print(error.args, events)
print(next(iterator), events)
reenter = True
print(iterator.send('ignored'), events)
print(next(iterator), events)
try:
    next(iterator)
except StopIteration as error:
    print(error.args)
print(iterator.close())
events.clear()
iterator = function(['A'], 'unused')
print(next(iterator))
try:
    iterator.throw(failure)
except LookupError as error:
    print(error is failure, events)
print(list(iterator), iterator.close())
events.clear()
reenter = False
stop = True
iterator = function([], 'unused')
try:
    next(iterator)
except RuntimeError as error:
    print(error.args, type(error.__cause__).__name__, error.__cause__.args, error.__cause__ is error.__context__, error.__suppress_context__)
print(events, list(iterator))
`
}));
