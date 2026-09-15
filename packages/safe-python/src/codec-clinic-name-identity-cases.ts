/** Guest programs shared with the external pinned differential oracle. */
export const codecClinicNameIdentityCases = ["encode", "decode"].flatMap(operation =>
  ["reject", "accept", "raise"].map(behavior => ({
    name: `${operation} ${behavior}`,
    source: `
import codecs
names = ('obj', 'encoding', 'errors')
events = []
failure = ValueError('comparison')
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        events.append((other, other is names[0], other is names[1], other is names[2]))
        if '${behavior}' == 'raise':
            input()
            raise failure
        return '${behavior}' == 'accept'
try:
    codecs.${operation}(${operation === "encode" ? "'a'" : "b'a'"}, **{Key('unexpected'): 1})
except Exception as error:
    print(type(error).__name__, str(error), error is failure)
print(events)
`
  }))
);
