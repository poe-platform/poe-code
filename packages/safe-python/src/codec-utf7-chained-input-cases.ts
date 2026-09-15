/** Run unchanged in CPython and PythonSession; each callback replaces the input. */
export const codecUtf7ChainedInputCases = ["+AOQ", "+AOR", "+2AA"].flatMap(tail => [false, true].flatMap(final => [false, true].map(incremental => ({
  name: `${incremental ? "incremental" : "native"} final=${final} tail=${tail}`,
  source: String.raw`
import codecs
seen = []
retained = []
objects = [b'\xff+IKw-\xff', b'\xff+2D3eAA-\xff', b'\xff${tail}']
class Position:
    def __index__(self):
        retained[0].object = objects[len(seen) - 1]
        return 1 - len(retained[0].object)
def handler(error):
    if retained:
        assert error is retained[0]
    else:
        retained.append(error)
    seen.append((error.args, error.object, error.start, error.end, error.reason))
    if len(seen) <= 3:
        return (str(len(seen)), Position())
    assert len(seen) == 4
    return ('4', len(error.object))
codecs.register_error('chained_input', handler)
${incremental ? "decoder = codecs.getincrementaldecoder('utf-7')('chained_input')\nresult = decoder.decode(b'\\xfforiginal', " + (final ? "True" : "False") + ")\nprint(ascii((result, decoder.getstate())))\nprint(ascii((decoder.decode(b'w-', True), decoder.getstate())))" : "print(ascii(codecs.utf_7_decode(b'\\xfforiginal', 'chained_input', " + (final ? "True" : "False") + ")))"}
print(ascii(seen))
`
}))));
