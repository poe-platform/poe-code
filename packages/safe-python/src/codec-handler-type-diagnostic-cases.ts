const argumentsAndNames = [
  ["len", "builtin_function_or_method"],
  ["[].append", "builtin_function_or_method"],
  ["str.encode", "method_descriptor"],
  ["object.__str__", "wrapper_descriptor"],
  ["object().__str__", "method-wrapper"],
  ["lambda: None", "function"],
  ["iter([])", "list_iterator"],
  ["iter(())", "tuple_iterator"],
  ["iter('')", "str_ascii_iterator"],
  ["iter('é')", "str_iterator"],
  ["iter(b'')", "bytes_iterator"],
  ["iter({})", "dict_keyiterator"],
  ["iter(set())", "set_iterator"],
  ["iter(range(0))", "range_iterator"],
  ["reversed([])", "list_reverseiterator"],
  ["{}.keys()", "dict_keys"],
  ["{}.values()", "dict_values"],
  ["{}.items()", "dict_items"],
  ["classmethod(lambda: None)", "classmethod"],
  ["staticmethod(lambda: None)", "staticmethod"],
  ["property(lambda: None)", "property"],
  ["None", "NoneType"],
  ["NotImplemented", "NotImplementedType"],
  ["...", "ellipsis"],
  ["True", "bool"],
  ["object", "type"],
  ["type('X', (), {'__module__': '', '__qualname__': 'Outer.X'})()", ".Outer.X"],
  ["type('X', (), {'__module__': '__main__', '__qualname__': 'Outer.X'})()", "Outer.X"],
  ["type('X', (), {'__module__': 'builtins', '__qualname__': 'Outer.X'})()", "Outer.X"],
  ["type('X', (), {'__module__': 'pkg', '__qualname__': 'Outer.X'})()", "pkg.Outer.X"],
  ["type('X', (), {'__module__': None, '__qualname__': 'Outer.X'})()", "Outer.X"],
  ["type('X', (), {'__module__': 1, '__qualname__': 'Outer.X'})()", "Outer.X"]
] as const;


/** Identical public programs run by PythonSession and the external pinned oracle. */
export const codecHandlerTypeDiagnosticCases = argumentsAndNames.map(([expression, name]) => ({
  name: expression,
  source: `import codecs
value = ${expression}
try:
    codecs.strict_errors(value)
except TypeError as error:
    assert str(error) == 'codec must pass exception instance', str(error)
else:
    raise AssertionError('strict')
for name in ('ignore', 'replace', 'xmlcharrefreplace', 'backslashreplace', 'namereplace', 'surrogatepass', 'surrogateescape'):
    try:
        codecs.lookup_error(name)(value)
    except TypeError as error:
        assert str(error) == "don't know how to handle ${name} in error callback", str(error)
    else:
        raise AssertionError(name)
`
}));
