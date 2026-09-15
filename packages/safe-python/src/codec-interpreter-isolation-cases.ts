/** Public programs shared by independent interpreter sessions and the oracle. */
export const codecInterpreterIsolationCases = [
  {encoding: "utf-8", prefix: "\\xe2", tail: "\\x82\\xac\\xffA", resume: -1},
  {encoding: "utf-16-le", prefix: "\\xac", tail: "\\x20\\x00\\xdcA\\x00", resume: -2},
  {encoding: "utf-32-be", prefix: "\\x00\\x00", tail: "\\x20\\xac\\x00\\x11\\x00\\x00\\x00\\x00\\x00A", resume: -4},
  {encoding: "utf-7", prefix: "+IK", tail: "w-\\xffA", resume: -1}
].map(({encoding, prefix, tail, resume}) => ({
  encoding,
  setup: `import codecs
searches = []
info = (None, None, None, None)
def search(name):
    searches.append(name)
    if name == 'isolation_codec':
        return info
codecs.register(search)
assert codecs.lookup('Isolation-Codec') is info
assert codecs.lookup('ISOLATION CODEC') is info
assert searches == ['isolation_codec']
seen = []
failure = ValueError('recovery failed')
def recover(error):
    seen.append(error)
    response = input()
    if response == 'guest-failure':
        raise failure
    assert response == 'ready'
    return ('?', ${resume})
codecs.register_error('isolation-handler', recover)
decoder = codecs.getincrementaldecoder('${encoding}')('isolation-handler')
assert decoder.decode(b'${prefix}', False) == ''
state = decoder.getstate()
assert state[0] == b'${prefix}'
`,
  resume: `assert codecs.lookup_error('isolation-handler') is recover
assert codecs.lookup('isolation codec') is info
assert decoder.getstate() == state
assert decoder.decode(b'${tail}', True) == '\\u20ac?A'
assert len(seen) == 1
assert decoder.getstate()[0] == b''
print('recovered')
`,
  remove: `codecs.unregister(search)
try:
    codecs.lookup('isolation-codec')
except LookupError:
    pass
else:
    raise AssertionError('removed codec survived invalidation')
codecs.register_error('isolation-handler', lambda error: ('!', error.end))
`
}));
