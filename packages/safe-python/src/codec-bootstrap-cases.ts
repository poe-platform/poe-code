/** Run unchanged through the public interpreter and the external pinned oracle. */
export const codecBootstrapCases = [
  {name: 'native lookup initializes the standard search before custom callbacks', source: `
import _codecs
events = []
def search(name):
    events.append(name)
    return (None, None, None, None)
_codecs.register(search)
for encoding, canonical in [('utf8', 'utf-8'), ('us', 'ascii'), ('latin', 'iso8859-1'), ('charmap', 'charmap')]:
    info = _codecs.lookup(encoding)
    assert info.name == canonical
    assert isinstance(info, tuple) and len(info) == 4
assert events == []
assert _codecs.lookup('unowned-codec') == (None, None, None, None)
assert events == ['unowned_codec']
`},
  {name: 'encoder aliases use the live registry while native fast paths bypass it', source: `
import codecs
import encodings
codecs.unregister(encodings.search_function)
events = []
def encode(*args):
    events.append(args)
    return (b'registered', None)
def search(name):
    events.append(name)
    return codecs.CodecInfo(encode, None, name=name)
codecs.register(search)
for encoding in ('ascii', 'us-ascii', 'latin-1', 'latin1', 'iso-8859-1', 'iso8859-1', 'utf8', 'utf-8', 'utf16', 'utf-16', 'utf32', 'utf-32'):
    assert 'A'.encode(encoding) != b'registered'
assert events == []
for encoding in ('us', '646', 'latin', 'cp65001', 'utf-8-sig'):
    assert 'A'.encode(encoding) == b'registered', encoding
    assert bytes('B', encoding, 'custom') == b'registered', encoding
    assert events[-2:] == [('A',), ('B', 'custom')]
assert [event for event in events if type(event) is str] == ['us', '646', 'latin', 'cp65001', 'utf_8_sig']
`},
  {name: 'lookup alone initializes the owned encoding inventory', source: `
import _codecs
assert _codecs.lookup('utf-8').encode('é') == (b'\\xc3\\xa9', 1)
assert _codecs.lookup('ascii').decode(b'A') == ('A', 1)
assert _codecs.lookup('latin-1').encode('é') == (b'\\xe9', 1)
assert _codecs.lookup('charmap').decode(b'A') == ('A', 1)
`}
];
