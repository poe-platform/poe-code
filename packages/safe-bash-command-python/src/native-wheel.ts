import {pythonNativeWheelGzip} from './native-wheel.generated.js';
let decoded:Promise<string>|undefined;
/** Decode the trusted installer once; production bundles omit the source template. */
export function loadPythonNativeWheel():Promise<string>{
 return decoded??=new Response(new Blob([Uint8Array.from(atob(pythonNativeWheelGzip),character=>character.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

/** Pinned Pyodide extraction helpers, with a seekable host source in place of
 * the whole-wheel JsBuffer/NamedTemporaryFile handoff. ZIP metadata and extracted
 * files still belong to the interpreter; this does not qualify their storage.
 */
export const pythonNativeWheel = `
def _safe_extract_native_wheel(read, serialized):
 import io as _native_io, json as _native_json, shutil as _native_shutil
 from pathlib import Path as _NativePath
 from zipfile import ZipFile as _NativeZip
 from pyodide import _package_loader as _native_loader
 from pyodide.ffi import run_sync as _native_sync

 class _NativeWheel(_native_io.RawIOBase):
  def __init__(self, size):
   self.size, self.position = size, 0
  def readable(self):
   return True
  def seekable(self):
   return True
  def tell(self):
   return self.position
  def seek(self, offset, whence=0):
   if whence not in (0, 1, 2):
    raise ValueError('invalid whence')
   position = offset + (0, self.position, self.size)[whence]
   if position < 0:
    raise OSError(22, 'Invalid argument')
   self.position = position
   return position
  def read(self, size=-1):
   remaining = max(0, self.size - self.position)
   size = remaining if size is None or size < 0 else min(size, remaining)
   # CPython probes at most 64 KiB + its 22-byte EOCD header. Other
   # consumers must accept short RawIO reads instead of accumulating a wheel.
   size = min(size, 65558)
   output = bytearray()
   while len(output) < size:
    result = read(self.position, min(size-len(output), 65536))
    if hasattr(result, 'then'):
     result = _native_sync(result)
    chunk = bytes(result)
    if not chunk or len(chunk) > size-len(output):
     raise OSError('Invalid Python package chunk')
    output.extend(chunk)
    self.position += len(chunk)
   return bytes(output)

 # Retain the pinned interpreter parser and replace only its eager directory
 # handoff. The window enforces the same declared end as BytesIO(data), including
 # malformed/truncated fields. Entry objects still belong to native ZipFile.
 from contextlib import contextmanager as _native_contextmanager
 @_native_contextmanager
 def _native_directory_parser(source):
  import ast, inspect, textwrap
  original = _NativeZip._RealGetContents
  tree = ast.parse(textwrap.dedent(inspect.getsource(original)))
  read = ast.dump(ast.parse('data = fp.read(size_cd)').body[0])
  buffer = ast.dump(ast.parse('fp = io.BytesIO(data)').body[0])
  class Rewrite(ast.NodeTransformer):
   reads = buffers = 0
   def visit_Assign(self, node):
    shape = ast.dump(node)
    if shape == read:
     self.reads += 1
     return None
    if shape == buffer:
     self.buffers += 1
     return ast.copy_location(ast.parse('fp = _safe_directory_window(fp, size_cd)').body[0], node)
    return node
  rewrite = Rewrite()
  tree = rewrite.visit(tree)
  if rewrite.reads != 1 or rewrite.buffers != 1:
   raise RuntimeError('Unsupported native ZIP directory parser')
  class Window:
   def __init__(self, source, size):
    self.source, self.remaining = source, size
   def read(self, size=-1):
    size = self.remaining if size is None or size < 0 else min(size, self.remaining)
    data = self.source.read(size)
    self.remaining -= len(data)
    return data
  namespace = dict(original.__globals__, _safe_directory_window=Window)
  exec(compile(ast.fix_missing_locations(tree), '<safe ZIP directory>', 'exec'), namespace)
  parse = namespace['_RealGetContents']
  cached = None
  def contents(archive):
   nonlocal cached
   # Extraction, metadata and dynlib discovery open the same immutable retained
   # source independently. Share its native read-only index for this call only.
   # Unrelated files (including imports during installation) keep their own index.
   encoding = getattr(archive, 'metadata_encoding', None)
   if archive.fp is not source or archive.mode != 'r':
    return parse(archive)
   if cached is not None and encoding == cached[0]:
    _, archive._comment, archive.start_dir, archive.filelist, archive.NameToInfo, position = cached
    archive.fp.seek(position)
    return
   parse(archive)
   cached = (encoding, archive._comment, archive.start_dir, archive.filelist, archive.NameToInfo, archive.fp.tell())
  _NativeZip._RealGetContents = contents
  try:
   yield
  finally:
   _NativeZip._RealGetContents = original

 _native_config = _native_json.loads(serialized)
 with _NativeWheel(_native_config['size']) as _native_archive:
  if 'integrity' in _native_config:
   import hashlib
   algorithm, expected = _native_config['integrity']
   checksum = hashlib.new(algorithm)
   while chunk := _native_archive.read(65536):
    checksum.update(chunk)
   if checksum.hexdigest() != expected:
    raise ValueError('Python package integrity mismatch: ' + algorithm)
   return '""'
  with _native_directory_parser(_native_archive):
   if 'metadata_name' in _native_config:
    from micropip.metadata import wheel_dist_info_dir as _native_metadata_dir
    from zipfile import Path as _NativeZipPath
    with _NativeZip(_native_archive) as _native_zip:
     path = _NativePath(_native_metadata_dir(_native_zip, _native_config['metadata_name'])) / 'METADATA'
     return _native_json.dumps(_NativeZipPath(_native_zip, str(path)).read_text(encoding='utf-8'))
   _native_target = _NativePath(_native_config['extract_dir'] if 'extract_dir' in _native_config else _native_loader.get_install_dir(_native_config['target']))
   _native_target.mkdir(parents=True, exist_ok=True)
   _native_shutil._unpack_zipfile(_native_archive, _native_target)
   with _NativeZip(_native_archive) as _native_zip:
    if _NativePath(_native_config['filename']).suffix == '.whl':
     _native_loader.set_wheel_metadata(_native_config['filename'], _native_zip, _native_target, _native_config['metadata'])
     _native_loader.install_datafiles(_native_config['filename'], _native_zip, _native_target)
   _native_dynlibs = _native_loader.get_dynlibs(_native_archive, _NativePath(_native_config['filename']).suffix, _native_target)
  return _native_json.dumps(_native_dynlibs)
_safe_extract_native_wheel(_safe_native_wheel_read, _safe_native_wheel_config)
`;
