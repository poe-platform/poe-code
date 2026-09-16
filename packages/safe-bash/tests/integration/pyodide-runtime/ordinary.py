import os, pathlib, zipfile, tempfile, sys
sys.path.insert(0, '/work')
import localmod
assert localmod.VALUE == 42
with open('data.bin', 'w+b') as f:
    f.write(b'abcdef'); f.flush(); f.seek(2); assert f.tell() == 2
    f.write(b'XY'); f.flush(); f.seek(0); assert f.read() == b'abXYef'
assert pathlib.Path('data.bin').read_bytes() == b'abXYef'
with zipfile.ZipFile('archive.zip', 'w') as z: z.writestr('inner.txt', 'zip data')
with zipfile.ZipFile('archive.zip') as z: assert z.read('inner.txt') == b'zip data'
with tempfile.TemporaryDirectory(dir='/work') as d:
    p = pathlib.Path(d) / 'temporary.txt'; p.write_text('temporary'); assert p.read_text() == 'temporary'
with open('retained', 'w+b') as f:
    f.write(b'old'); f.flush(); os.rename('retained', 'renamed')
    pathlib.Path('retained').write_bytes(b'new')
    f.seek(0); assert f.read() == b'old'
assert pathlib.Path('retained').read_bytes() == b'new'
assert pathlib.Path('renamed').read_bytes() == b'old'
assert 'data.bin' in os.listdir('.')
