import referenceCases from "./runtime/__snapshots__/codec-errors-3.14.7.json" with {type:"json"};

// Complete pinned corpus, expressed as ordinary guest programs for both the
// public interpreter and the external CPython oracle. No injected entry points.
const literal=(points:readonly number[],bytes=false)=>`${bytes?"b":""}'${points.map(point=>bytes?`\\x${point.toString(16).padStart(2,"0")}`:`\\U${point.toString(16).padStart(8,"0")}`).join("")}'`;

export const standardCodecHandlerCases=[...new Set(referenceCases.map(row=>row.handler))].map(handler=>{
  const rows=referenceCases.filter(row=>row.handler===handler);
  const programs=rows.map((row,index)=>{
    const object=literal(row.object,row.mode==="decode");
    const exception=row.mode==="encode"?"UnicodeEncodeError":row.mode==="decode"?"UnicodeDecodeError":"UnicodeTranslateError";
    const args=`${row.mode==="translate"?"":`${JSON.stringify(row.encoding)}, `}${object}, ${row.start}, ${row.end}, 'reason'`;
    const mutation=!("mutation" in row)?"":row.mutation==="missing"?"del original.object":`original.object = ${row.mutation==="none"?"None":row.mutation==="int"?"1":row.mode==="decode"?"'wrong'":"b'wrong'"}`;
    const expected=row.expected;
    return `
row_index = ${index}
original = ${exception}(${args})
original_args = original.args
${mutation}
try:
    result = handler(original)
except BaseException as caught:
${"error" in expected?`    assert type(caught) is ${expected.error}
    assert (caught is original) is ${expected.same?"True":"False"}
${"message" in expected?`    assert str(caught) == ${JSON.stringify(expected.message)}`:""}`:"    raise"}
else:
${"error" in expected?"    raise AssertionError('expected handler failure')":`    assert type(result) is tuple
    assert type(result[0]) is ${expected.kind}
    assert type(result[1]) is int
    assert result == (${literal(expected.replacement!,expected.kind==="bytes")}, ${expected.position})`}
assert original.args is original_args
assert original.start == ${row.start} and original.end == ${row.end}
`;
  });
  return {name:handler,source:`import _codecs\nhandler = _codecs.lookup_error(${JSON.stringify(handler)})\n${programs.join("\n")}`};
});

standardCodecHandlerCases.push({name:"metadata and rejection type names",source:`
import _codecs
def generator():
    yield 1
class Outer:
    class Inner:
        pass
Outer.Inner.__module__ = 'owned'
objects = [(None, 'NoneType'), (NotImplemented, 'NotImplementedType'), (Ellipsis, 'ellipsis'), (int, 'type'), (42, 'int'), (True, 'bool'), (1.5, 'float'), (1j, 'complex'), ('', 'str'), (b'', 'bytes'), ([], 'list'), ((), 'tuple'), ({}, 'dict'), (set(), 'set'), (frozenset(), 'frozenset'), (range(1), 'range'), (slice(1), 'slice'), (int.__add__, 'wrapper_descriptor'), (str.upper, 'method_descriptor'), (object.__init__, 'wrapper_descriptor'), ([1].append, 'builtin_function_or_method'), (lambda: None, 'function'), (iter([]), 'list_iterator'), ({}.keys(), 'dict_keys'), ({}.values(), 'dict_values'), ({}.items(), 'dict_items'), (staticmethod(lambda: None), 'staticmethod'), (classmethod(lambda: None), 'classmethod'), (generator(), 'generator'), (Outer.Inner(), 'owned.Outer.Inner')]
for name in ('strict', 'ignore', 'replace', 'xmlcharrefreplace', 'backslashreplace', 'namereplace', 'surrogateescape', 'surrogatepass'):
    handler = _codecs.lookup_error(name)
    function_name = name if name.startswith('surrogate') else name + '_errors'
    assert handler.__name__ == handler.__qualname__ == function_name
    assert handler.__module__ is None and handler.__self__ is None
    assert handler.__text_signature__ == '($self, object, /)'
    for value, expected_type in objects:
        try:
            handler(value)
        except TypeError as error:
            message = 'codec must pass exception instance' if name == 'strict' else "don't know how to handle " + expected_type + ' in error callback'
            assert error.args == (message,), (name, expected_type, error.args)
        else:
            raise AssertionError('expected TypeError')
`});

standardCodecHandlerCases.push({name:"rejection diagnostics preserve surrogate code points in type metadata",source:String.raw`
import codecs
class Rejected:
    pass
for module in ('__main__', 'builtins', 'owned', '\ud800\udc00', '🐍'):
    for name in ('Inner', '\ud800\udc00', '\ud800X\udc00', '🐍'):
        Rejected.__module__ = module
        Rejected.__qualname__ = name
        qualified = name if module in ('__main__', 'builtins') else module + '.' + name
        expected = "don't know how to handle " + qualified + ' in error callback'
        for policy in ('ignore', 'replace', 'xmlcharrefreplace', 'backslashreplace', 'namereplace', 'surrogateescape', 'surrogatepass'):
            try:
                codecs.lookup_error(policy)(Rejected())
            except TypeError as error:
                assert error.args == (expected,), (module, name, policy, error.args)
                assert str(error) == expected
                assert [ord(point) for point in error.args[0]] == [ord(point) for point in expected]
            else:
                raise AssertionError('expected TypeError')
`});
