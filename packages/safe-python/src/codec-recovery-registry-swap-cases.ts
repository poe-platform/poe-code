/** Complete guest programs also executed by the external pinned oracle. */
export const codecRecoveryRegistrySwapCases = [
  {encoding: "utf-8", prefix: "\\xe2", tail: "\\x82\\xac\\xffA", resume: -1},
  {encoding: "utf-8-sig", prefix: "\\xef\\xbb\\xbf\\xe2", tail: "\\x82\\xac\\xffA", resume: -1},
  {encoding: "utf-7", prefix: "+IK", tail: "w-\\xffA", resume: -1},
  {encoding: "utf-16-le", prefix: "\\xac", tail: "\\x20\\x00\\xdcA\\x00", resume: -2},
  {encoding: "utf-32-be", prefix: "\\x00\\x00", tail: "\\x20\\xac\\x00\\x11\\x00\\x00\\x00\\x00\\x00A", resume: -4},
  {encoding: "utf-16", prefix: "\\xff\\xfe\\xac", tail: "\\x20\\x00\\xdcA\\x00", resume: -2},
  {encoding: "utf-32", prefix: "\\xff\\xfe\\x00\\x00\\xac", tail: "\\x20\\x00\\x00\\x00\\x00\\x11\\x00A\\x00\\x00\\x00", resume: -4},
].flatMap(({encoding, prefix, tail, resume}) => [false, true].map(fail => ({
  name: `${encoding}; guest failure=${fail}`,
  source: `import codecs
native = codecs.lookup('${encoding}')
old = codecs.CodecInfo(native.encode, native.decode, incrementaldecoder=native.incrementaldecoder, name='old')
new = codecs.CodecInfo(native.encode, native.decode, incrementaldecoder=native.incrementaldecoder, name='new')
events = []
def first(name):
    events.append(('first', name))
    if name == 'recovery_swap':
        return old
def second(name):
    events.append(('second', name))
    if name == 'recovery_swap':
        return new
codecs.register(first)
assert codecs.lookup('Recovery-Swap') is old
factory = codecs.getincrementaldecoder('RECOVERY SWAP')
failure = ValueError('recovery failed')
def recover(error):
    codecs.unregister(first)
    codecs.register(second)
    assert codecs.lookup('Recovery Swap') is new
    assert codecs.getincrementaldecoder('recovery_swap') is factory
    assert codecs.lookup_error('swap-handler') is recover
    codecs.register_error('swap-handler', lambda error: ('!', error.end))
    print('boundary', input())
    ${fail ? "raise failure" : `return ('?', ${resume})`}
codecs.register_error('swap-handler', recover)
decoder = factory('swap-handler')
assert decoder.decode(b'${prefix}', False) == ''
state = decoder.getstate()
try:
    result = decoder.decode(b'${tail}', True)
except ValueError as caught:
    assert caught is failure
    assert decoder.getstate() == state
    result = decoder.decode(b'${tail}', True)
assert result == '\\u20ac${fail ? "!" : "?"}A'
assert decoder.getstate()[0] == b''
assert codecs.lookup('RECOVERY-SWAP') is new
assert events == [('first', 'recovery_swap'), ('second', 'recovery_swap')]
codecs.unregister(second)
try:
    codecs.lookup('recovery-swap')
except LookupError:
    pass
else:
    raise AssertionError('removed codec remained cached')
assert decoder.decode(b'', True) == ''
print(result, decoder.getstate())
`
})));
