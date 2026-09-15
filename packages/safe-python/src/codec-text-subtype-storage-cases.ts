export const textSubtypeStorageCases=["ascii","latin1","utf8","utf16","utf32"].flatMap(encoding=>[false,true].map(empty=>({
  name:`${encoding}; empty=${empty}`,
  source:`events = []
class Export(bytes):
    def __buffer__(self, flags):
        events.append(flags)
        raise RuntimeError('must not export')
    def __bytes__(self):
        raise RuntimeError('must not convert')
source = Export(${empty?"b''":encoding==="utf16"?"b'A\\x00'":encoding==="utf32"?"b'A\\x00\\x00\\x00'":"b'A'"})
assert str(source, '${encoding}') == ${empty?"''":"'A'"}
assert source.decode('${encoding}') == ${empty?"''":"'A'"}
assert events == []
`
})));
