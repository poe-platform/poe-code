export const charmapMappingRejectionCases = [
  {operation: "encode", value: "-1", message: "character mapping must be in range(256)"},
  {operation: "encode", value: "256", message: "character mapping must be in range(256)"},
  {operation: "encode", value: "'invalid'", message: "character mapping must return integer, bytes or None, not str"},
  {operation: "decode", value: "-1", message: "character mapping must be in range(0x110000)"},
  {operation: "decode", value: "0x110000", message: "character mapping must be in range(0x110000)"},
  {operation: "decode", value: "1.5", message: "character mapping must return integer, None or str"},
].map(row => ({...row, source: `
import _codecs
calls = []
class Mapping:
    def __getitem__(self, key):
        calls.append(key)
        assert input() == 'ready'
        return ${row.value}
try:
    _codecs.charmap_${row.operation}(${row.operation === "encode" ? "'A'" : "b'A'"}, 'strict', Mapping())
except TypeError as error:
    assert error.args == (${JSON.stringify(row.message)},)
else:
    raise AssertionError('mapping accepted')
assert calls == [65]
print('verified')
`}));
