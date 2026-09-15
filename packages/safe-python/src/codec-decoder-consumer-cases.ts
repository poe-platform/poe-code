/** Public contracts executed unchanged by the external CPython oracle. */
const consumers = ["source.decode('decoder-contract')", "bytes.decode(source, 'decoder-contract')", "str(source, 'decoder-contract')", "str.__new__(str, source, 'decoder-contract')"];

export const codecDecoderConsumerCases = consumers.flatMap(expression => [false, true].map(explicitErrors => ({
  name: `${expression}: ${explicitErrors ? "explicit" : "omitted"} errors and memoryview input`,
  source: `
import _codecs
class Data(bytes):
    def __bytes__(self):
        raise AssertionError('virtual bytes conversion')
class Text(str):
    def __str__(self):
        raise AssertionError('virtual str conversion')
class Pair(tuple):
    def __len__(self):
        raise AssertionError('virtual tuple length')
    def __getitem__(self, index):
        raise AssertionError('virtual tuple indexing')
source = Data(b'input')
result = Text('decoded')
seen = []
def decode(*args):
    seen.append(args)
    return Pair((result, object()))
def search(name):
    assert name == 'decoder_contract'
    return (None, decode, None, None)
_codecs.register(search)
assert ${explicitErrors ? `${expression.slice(0, -1)}, 'custom')` : expression} is result
assert len(seen) == 1
assert len(seen[0]) == ${explicitErrors ? 2 : 1}
${explicitErrors ? "assert seen[0][1] == 'custom'" : ""}
view = seen[0][0]
assert type(view) is memoryview
assert view.obj is None and view.readonly is True
assert (view.format, view.itemsize, view.ndim) == ('B', 1, 1)
assert (view.shape, view.strides, view.suboffsets) == ((5,), (1,), ())
assert view.nbytes == 5
assert view.contiguous and view.c_contiguous and view.f_contiguous
assert view.tobytes() == b'input'
view.release()
try:
    view.tobytes()
except ValueError as error:
    assert error.args == ('operation forbidden on released memoryview object',)
else:
    assert False
`
})));
