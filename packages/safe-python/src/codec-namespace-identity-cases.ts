/** Unchanged public programs for the interpreter and pinned external oracle. */
export const codecNamespaceIdentityCases: {name: string; source: string; output: string}[] = ([
  ['codecs', ['CodecInfo', 'lookup', 'encode', 'decode', '__name__', '__doc__', 'BOM_UTF8']],
  ['_codecs', ['register', 'unregister', 'lookup', 'encode', 'decode', 'register_error', 'lookup_error', '__name__', '__doc__', '__package__']],
  ['encodings', ['search_function', 'normalize_encoding', 'CodecRegistryError', '__name__', '__path__', 'aliases']],
  ['encodings.aliases', ['aliases', '__name__']],
  ['encodings.ascii', ['Codec', 'IncrementalEncoder', 'IncrementalDecoder', 'StreamWriter', 'StreamReader', 'StreamConverter', 'getregentry']],
  ['encodings.latin_1', ['Codec', 'IncrementalEncoder', 'IncrementalDecoder', 'StreamWriter', 'StreamReader', 'StreamConverter', 'getregentry']],
  ['encodings.utf_8', ['encode', 'decode', 'IncrementalEncoder', 'IncrementalDecoder', 'StreamWriter', 'StreamReader', 'getregentry']],
  ['encodings.charmap', ['Codec', 'IncrementalEncoder', 'IncrementalDecoder', 'StreamWriter', 'StreamReader', 'getregentry']],
] as const).map(([module, names]) => ({
  name: module,
  output: `${module} interned\n`,
  source: `
import ${module} as module
for name in ${JSON.stringify(names)}:
    found = False
    for key in module.__dict__:
        if key == name:
            assert key is name, (module.__name__, name)
            found = True
    assert found, name
print(module.__name__, 'interned')
`,
}));

codecNamespaceIdentityCases.push({
  name: 'core codec class namespace keys',
  output: 'class keys interned\n',
  source: `
import codecs
for owner, names in (
    (codecs.CodecInfo, ('__module__', '__new__', '__repr__', '_is_text_encoding')),
    (codecs.IncrementalEncoder, ('__module__', '__init__', 'encode', 'reset', 'getstate', 'setstate')),
    (codecs.IncrementalDecoder, ('__module__', '__init__', 'decode', 'reset', 'getstate', 'setstate')),
    (codecs.BufferedIncrementalEncoder, ('__init__', 'encode', 'reset', 'getstate', 'setstate')),
    (codecs.BufferedIncrementalDecoder, ('__init__', 'decode', 'reset', 'getstate', 'setstate')),
    (codecs.StreamReader, ('__module__', '__init__', 'read', 'readline', 'readlines', 'reset', 'seek')),
    (codecs.StreamWriter, ('__module__', '__init__', 'write', 'writelines', 'reset', 'seek')),
):
    for name in names:
        found = False
        for key in owner.__dict__:
            if key == name:
                assert key is name, (owner.__name__, name)
                found = True
        assert found, (owner.__name__, name)
print('class keys interned')
`,
});

export const codecNamespaceSearchSource = `
import codecs
events = []
expected_name = 'registry_namespace_search'
def registry_namespace_search(name):
    assert name is expected_name
    for key in tuple(globals()):
        if key == name:
            assert key is name
    events.append(name)
    print('search')
    return (None, None, None, None)
codecs.register(registry_namespace_search)
try:
    info = codecs.lookup('REGISTRY-NAMESPACE-SEARCH')
    assert codecs.lookup('registry_namespace_search') is info
    assert len(events) == 1
except BaseException:
    print('recovered')
    raise
`;

codecNamespaceIdentityCases.push({
  name: 'guest dictionary keys retain identity across module assignments',
  output: 'retained key\n',
  source: `
import codecs
name = ''.join(['codec_namespace_', 'retained'])
literal = 'codec_namespace_retained'
assert name is not literal
codecs.__dict__[name] = 'initial'
codecs.codec_namespace_retained = 'updated'
for key in codecs.__dict__:
    if key == name:
        assert key is name
assert codecs.codec_namespace_retained == 'updated'
del codecs.codec_namespace_retained
assert name not in codecs.__dict__
print('retained key')
`,
});
