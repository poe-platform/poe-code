/** Public programs also executed unchanged by the external CPython oracle. */
const typeNames = [
  ["X".repeat(250), "X".repeat(50), "X".repeat(100)],
  ["é".repeat(125), "é".repeat(25), "é".repeat(50)],
  ["a".repeat(49) + "€", "a".repeat(49), "a".repeat(49) + "€"],
  ["a".repeat(48) + "€", "a".repeat(48), "a".repeat(48) + "€"],
  ["a".repeat(47) + "€", "a".repeat(47) + "€", "a".repeat(47) + "€"],
  ["a".repeat(99) + "🐍", "a".repeat(50), "a".repeat(99)],
  ["a".repeat(97) + "🐍", "a".repeat(50), "a".repeat(97)],
  ["a".repeat(96) + "🐍", "a".repeat(50), "a".repeat(96) + "🐍"],
];

const prelude = `import _codecs
def forbidden(*args):
    raise AssertionError('guest conversion or attribute lookup')
class Meta(type):
    __getattribute__ = forbidden
for full, clinic, buffer in ${JSON.stringify(typeNames)}:
    C = Meta(full, (), {'__str__': forbidden, '__repr__': forbidden, '__getattribute__': forbidden})
    value = C()
`;

const operations = [
  ...["ascii", "latin_1", "utf_8", "utf_7", "charmap", "unicode_escape", "raw_unicode_escape",
    "utf_16", "utf_16_le", "utf_16_be", "utf_32", "utf_32_le", "utf_32_be", "escape"]
    .flatMap(codec => [codec + "_encode", codec + "_decode"]),
  "utf_16_ex_decode", "utf_32_ex_decode", "readbuffer_encode",
];

export const codecDiagnosticPrecisionCases = [
  ...operations.map(name => ({
    name,
    source: prelude + `
    convert = _codecs.${name}
    for invalid_errors in (None, value, '\\0', '\\ud800'):
        try:
            convert(value, invalid_errors)
        except TypeError as error:
            assert type(error) is TypeError
            assert error.args == (${name.endsWith("encode") && name !== "readbuffer_encode"
              ? `${JSON.stringify(name + "() argument 1 must be " + (name === "escape_encode" ? "bytes" : "str") + ", not ")} + clinic`
              : `"a bytes-like object is required, not '" + buffer + "'"`},), error.args
        else:
            raise AssertionError('invalid input accepted')
    for source in ${name.endsWith("encode") && name !== "escape_encode" && name !== "readbuffer_encode" ? "('', 'A')" : "(b'', b'A')"}:
        try:
            convert(source, value)
        except TypeError as error:
            assert error.args == (${JSON.stringify(name + "() argument 2 must be str or None, not ")} + clinic,), error.args
        else:
            raise AssertionError('invalid errors accepted')
`
  })),
  ...["lookup", "lookup_error", "_unregister_error", "register_error", "charmap_build"].map(name => ({
    name,
    source: prelude + `
    try:
        _codecs.${name}(value${name === "register_error" ? ", None" : ""})
    except TypeError as error:
        assert error.args == (${JSON.stringify(name + "() argument" + (name === "register_error" ? " 1" : "") + " must be str, not ")} + clinic,), error.args
    else:
        raise AssertionError('invalid name accepted')
`
  })),
  ...["encode", "decode"].flatMap(operation => ["encoding", "errors"].map(parameter => ({
    name: `${operation} ${parameter} consumers`,
    source: prelude + `
    source = ${operation === "encode" ? "''" : "b''"}
    for invoke in (
        lambda: source.${operation}(${parameter}=value),
        lambda: source.${operation}(${parameter === "errors" ? "'ascii', " : ""}value),
        lambda: _codecs.${operation}(source, ${parameter}=value),
        lambda: _codecs.${operation}(source, ${parameter === "errors" ? "'ascii', " : ""}value),
    ):
        try:
            invoke()
        except TypeError as error:
            assert error.args == (${JSON.stringify(operation + "() argument '" + parameter + "' must be str, not ")} + clinic,), error.args
        else:
            raise AssertionError('invalid name accepted')
    for invoke, expected in (
        (lambda: ${operation === "encode" ? "bytes" : "str"}(source, ${parameter}=value), clinic),
        (lambda: ${operation === "encode" ? "bytes" : "str"}(source, ${parameter === "errors" ? "'ascii', " : ""}value), ${operation === "encode" ? "clinic" : "full"}),
        (lambda: ${operation === "encode" ? "bytes.__new__(bytes" : "str.__new__(str"}, source, ${parameter === "errors" ? "'ascii', " : ""}value), clinic),
    ):
        try:
            invoke()
        except TypeError as error:
            assert error.args == (${JSON.stringify((operation === "encode" ? "bytes" : "str") + "() argument '" + parameter + "' must be str, not ")} + expected,), error.args
        else:
            raise AssertionError('invalid constructor name accepted')
`
  }))),
];
