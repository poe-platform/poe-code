/** Public programs shared with the external pinned-reference replay. */
export const codecFailureNoteCases=(["encode","decode"] as const).flatMap(operation=>
  (["list","failure","invalid"] as const).map(outcome=>({
    name:`${operation}: note getter ${outcome}`,
    source:`
import codecs
events = []
notes = []
secondary = ValueError('note lookup failed')
class Failure(ValueError):
    def __getattribute__(self, name):
        if name == '__notes__':
            events.append(input())
            ${outcome==="failure"?"raise secondary":`return ${outcome==="list"?"notes":"42"}`}
        return super().__getattribute__(name)
failure = Failure('codec failed')
def transform(*args):
    raise failure
def search(name):
    if name == 'note_probe':
        return (transform, transform, None, None)
codecs.register(search)
try:
    codecs.${operation}(${operation==="encode"?"'x'":"b'x'"}, 'note-probe')
except BaseException as error:
    ${outcome==="list"?"assert error is failure":outcome==="failure"?"assert error is secondary":"assert type(error) is TypeError\n    assert error.args == ('Cannot add note: __notes__ is not a list',)"}
    ${outcome==="list"?"assert error.__context__ is None":"assert error.__context__ is failure"}
else:
    assert False
assert events == ['service']
assert notes == ${outcome==="list"?`["${operation==="encode"?"encoding":"decoding"} with 'note-probe' codec failed"]`:"[]"}
print('verified')
`
  })));
