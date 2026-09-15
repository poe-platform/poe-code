/** Public programs replayed unchanged against the pinned external oracle. */
export const codecArgumentTypeCases = ["encode", "decode"].flatMap(operation =>
  ["encoding", "errors"].flatMap(parameter =>
    [
      ["iter([])", "list_iterator"],
      ["iter(())", "tuple_iterator"],
      ["iter('')", "str_ascii_iterator"],
      ["iter('é')", "str_iterator"],
      ["iter(b'')", "bytes_iterator"],
      ["iter({})", "dict_keyiterator"],
      ["iter({}.values())", "dict_valueiterator"],
      ["iter({}.items())", "dict_itemiterator"],
      ["iter(set())", "set_iterator"],
      ["reversed([])", "list_reverseiterator"],
      ["iter(range(2))", "range_iterator"],
      ["iter(lambda: None, None)", "callable_iterator"],
      ["C", "Meta"],
      ["None", "None"],
      ["42", "int"],
      ["len", "builtin_function_or_method"],
    ].map(([expression, typeName]) => ({
      name: `${operation} ${parameter}: ${typeName}`,
      source: `
import _codecs
class Meta(type):
    def __getattribute__(self, name):
        raise AssertionError('metaclass attribute lookup')
class C(metaclass=Meta):
    pass
value = ${expression}
for data in ${operation === "encode" ? "('', 'A', 'é')" : "(b'', b'A', b'\\xff')"}:
    for invoke in (
        lambda: data.${operation}(${parameter === "errors" ? "'ascii', " : ""}value),
        lambda: data.${operation}(${parameter}=value),
        lambda: ${operation === "encode" ? "str" : "bytes"}.${operation}(data, ${parameter}=value),
    ):
        try:
            invoke()
        except TypeError as error:
            assert error.args == (${JSON.stringify(`${operation}() argument '${parameter}' must be str, not ${typeName}`)},), error.args
        else:
            raise AssertionError('invalid codec argument accepted')
    for invoke in (
        lambda: _codecs.${operation}(data, ${parameter === "errors" ? "'ascii', " : ""}value),
        lambda: _codecs.${operation}(data, ${parameter}=value),
    ):
        try:
            invoke()
        except TypeError as error:
            assert error.args == (${JSON.stringify(`${operation}() argument '${parameter}' must be str, not ${typeName}`)},), error.args
        else:
            raise AssertionError('invalid registry argument accepted')
    for invoke, expected_type in (
        (lambda: ${operation === "encode" ? "bytes" : "str"}(data, ${parameter === "errors" ? "'ascii', " : ""}value), ${JSON.stringify(operation === "decode" && typeName === "None" ? "NoneType" : typeName)}),
        (lambda: ${operation === "encode" ? "bytes" : "str"}(data, ${parameter}=value), ${JSON.stringify(typeName)}),
    ):
        try:
            invoke()
        except TypeError as error:
            assert error.args == (${JSON.stringify(`${operation === "encode" ? "bytes" : "str"}() argument '${parameter}' must be str, not `)} + expected_type,), error.args
        else:
            raise AssertionError('invalid constructor argument accepted')
`
    }))
  )
);
