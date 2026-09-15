/** Unchanged programs for the pinned external oracle and the guest interpreter. */
export const codecCStringSearchCases = ['c2', 'c4', 'f0'].flatMap(lead => ['a', 'abc'].map(replacement => ({
  name: `${lead} recovered ${replacement} search representation`,
  source: String.raw`
import codecs
name = '\ud800'
def strict(error):
    input()
    if isinstance(error, UnicodeEncodeError):
        return (bytes.fromhex('${lead}'), error.end)
    return ('${replacement}', error.end)
codecs.register_error('strict', strict)
def capture(value, recovered):
    canonical = '${replacement}'
    for text, needle in [(canonical, recovered), (recovered, canonical), (recovered, recovered), ('x' + canonical * 2 + 'x', recovered)]:
        print(repr(text), repr(needle), needle in text, text.find(needle), text.rfind(needle), text.count(needle))
        print(text.startswith(needle), text.endswith(needle), repr(text.removeprefix(needle)), repr(text.removesuffix(needle)))
        for start, stop in [(0, 100), (-100, -1), (1, 0), (100, 200)]:
            print(text.find(needle, start, stop), text.rfind(needle, start, stop), text.count(needle, start, stop))
        for method in (text.index, text.rindex):
            try:
                print(method(needle))
            except ValueError as error:
                print(type(error).__name__, error.args)
        for count in (-1, 0, 1, 2):
            print(text.split(needle, count), text.rsplit(needle, count))
        left = text.partition(needle)
        right = text.rpartition(needle)
        print(left, right, left[0] is text, right[2] is text, left[1] is needle, right[1] is needle)
    return (value, 0)
codecs.register(lambda name: (capture, capture, None, None) if name == 'capture' else None)
codecs.encode('value', 'capture', name)
`
})));
