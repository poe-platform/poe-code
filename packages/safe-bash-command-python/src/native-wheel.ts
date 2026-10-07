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
