import {pythonNativeWheelGzip} from './native-wheel.generated.js';
let decoded:Promise<string>|undefined;
/** Decode the trusted installer once; production bundles omit the source template. */
export function loadPythonNativeWheel():Promise<string>{
 return decoded??=new Response(new Blob([Uint8Array.from(atob(pythonNativeWheelGzip),character=>character.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

/** Pinned Pyodide extraction helpers, with a seekable host source in place of
 * the whole-wheel JsBuffer/NamedTemporaryFile handoff. Native entry records use
 * caller scratch and extraction uses caller storage; dynamic libraries load one at a
 * time, while some package metadata still materializes interpreter-owned lists.
 */
export const pythonNativeWheel = `
def _safe_extract_native_wheel(read, serialized):
 import io as _native_io, json as _native_json, shutil as _native_shutil
 from pathlib import Path as _NativePath
 from zipfile import ZipFile as _NativeZip, ZipInfo as _NativeInfo
 from pyodide import _package_loader as _native_loader
 from pyodide.ffi import run_sync as _native_sync

 class _NativeWheel(_native_io.RawIOBase):
  def __init__(self, size):
   self.size, self.position = size, 0
   self.window, self.window_offset = b'', 0
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
    if not self.window_offset <= self.position < self.window_offset + len(self.window):
     requested = min(65536, self.size-self.position)
     result = read(self.position, requested)
     if hasattr(result, 'then'):
      result = _native_sync(result)
     self.window = bytes(result)
     self.window_offset = self.position
     if not self.window or len(self.window) > requested:
      raise OSError('Invalid Python package chunk')
    start = self.position-self.window_offset
    length = min(size-len(output), len(self.window)-start)
    output.extend(self.window[start:start+length])
    self.position += length
   return bytes(output)

 # Preserve native validation and ambiguous-directory ordering. Ordinary wheels
 # need at most one candidate; malformed multi-directory wheels retain the native
 # set path, whose interpreter allocation remains an explicit compatibility gap.
 def _native_metadata_helper(original, suffix=None):
  import ast, inspect, textwrap, __future__
  def directories(source, suffix):
   candidate = None
   for path in source.namelist():
    root = path.split('/', 1)[0]
    if root.endswith(suffix):
     if candidate is not None and root != candidate:
      return {path.split('/', 1)[0] for path in source.namelist()}
     candidate = root
   return () if candidate is None else (candidate,)
  tree = ast.parse(textwrap.dedent(inspect.getsource(original)))
  expected = ast.dump(ast.parse('{p.split("/", 1)[0] for p in source.namelist()}').body[0].value)
  class Rewrite(ast.NodeTransformer):
   count = 0
   def visit_SetComp(self, node):
    if ast.dump(node) != expected:return self.generic_visit(node)
    self.count += 1
    return ast.copy_location(ast.Call(func=ast.Name(id='_safe_metadata_directories', ctx=ast.Load()), args=[ast.Name(id='source', ctx=ast.Load()), ast.Constant(value=suffix) if suffix is not None else ast.Name(id='suffix', ctx=ast.Load())], keywords=[]), node)
  rewrite = Rewrite()
  tree = rewrite.visit(tree)
  if rewrite.count != 1:raise RuntimeError('Unsupported native wheel metadata discovery')
  namespace = dict(original.__globals__, _safe_metadata_directories=directories)
  exec(compile(ast.fix_missing_locations(tree), '<safe wheel metadata>', 'exec', flags=__future__.annotations.compiler_flag), namespace)
  return namespace[original.__name__]

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
  index = globals().get('_safe_native_wheel_index')
  def call(operation, *args):
   result = index(operation, *args)
   return _native_sync(result) if hasattr(result, 'then') else result
  def lookup(operation, key):
   chunks, offset = [], 0
   while True:
    chunk = call(operation, key, offset)
    chunks.append(chunk)
    offset += len(chunk)
    if len(chunk) < 8192:break
   record = _native_json.loads(''.join(chunks))
   if record is None:raise KeyError(key)
   payload, end = record
   entry = _NativeInfo.__new__(_NativeInfo)
   for name, value in _native_json.loads(payload):
    if isinstance(value, dict):value = bytes.fromhex(value['bytes'])
    elif name == 'date_time':value = tuple(value)
    setattr(entry, name, value)
   entry._end_offset = int(end)
   return entry
  class Entries:
   count = 0
   def append(self, entry):
    payload = _native_json.dumps([(name, {'bytes':value.hex()} if isinstance(value, bytes) else value) for name in _NativeInfo.__slots__ if hasattr(entry, name) for value in [getattr(entry, name)]])
    call('append', entry.filename, str(entry.header_offset), payload)
    self.count += 1
   def __len__(self):return self.count
   def __iter__(self):
    for ordinal in range(self.count):yield lookup('get', ordinal)
   def __getitem__(self, ordinal):
    if ordinal < 0:ordinal += self.count
    if not 0 <= ordinal < self.count:raise IndexError(ordinal)
    return lookup('get', ordinal)
  class Names:
   def __getitem__(self, name):return lookup('name', name)
   def get(self, name, default=None):
    try:return self[name]
    except KeyError:return default
  def store_name(archive, entry):
   if not isinstance(archive.filelist, Entries):archive.NameToInfo[entry.filename] = entry
  def seal(archive):call('seal', str(archive.start_dir))
  assignment = ast.dump(ast.parse('self.NameToInfo[x.filename] = x').body[0])
  order = ast.parse('''for zinfo in reversed(sorted(self.filelist, key=lambda zinfo: zinfo.header_offset)):
 zinfo._end_offset = end_offset
 end_offset = zinfo.header_offset''').body[0]
  class Rewrite(ast.NodeTransformer):
   reads = buffers = names = orders = 0
   def visit_Assign(self, node):
    shape = ast.dump(node)
    if index is not None and shape == assignment:
     self.names += 1
     return ast.copy_location(ast.parse('_safe_store_name(self, x)').body[0], node)
    if shape == read:
     self.reads += 1
     return None
    if shape == buffer:
     self.buffers += 1
     return ast.copy_location(ast.parse('fp = _safe_directory_window(fp, size_cd)').body[0], node)
    return node
   def visit_For(self, node):
    if index is not None and ast.dump(node) == ast.dump(order):
     self.orders += 1
     replacement = ast.parse('''if isinstance(self.filelist, _safe_native_entries):
 _safe_index_seal(self)''').body[0]
     replacement.orelse = [node]
     return ast.copy_location(replacement, node)
    return self.generic_visit(node)
  rewrite = Rewrite()
  tree = rewrite.visit(tree)
  if rewrite.reads != 1 or rewrite.buffers != 1 or index is not None and (rewrite.names != 1 or rewrite.orders != 1):
   raise RuntimeError('Unsupported native ZIP directory parser')
  class Window:
   def __init__(self, source, size):
    self.source, self.remaining = source, size
   def read(self, size=-1):
    size = self.remaining if size is None or size < 0 else min(size, self.remaining)
    data = self.source.read(size)
    self.remaining -= len(data)
    return data
  namespace = dict(original.__globals__, _safe_directory_window=Window, _safe_store_name=store_name, _safe_native_entries=Entries, _safe_index_seal=seal)
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
   if cached is not None:return parse(archive)
   if index is not None:
    call('start')
    archive.filelist, archive.NameToInfo = Entries(), Names()
   parse(archive)
   cached = (encoding, archive._comment, archive.start_dir, archive.filelist, archive.NameToInfo, archive.fp.tell())
  # The pinned installer consumes filenames sequentially. ZIP Path only needs
  # membership for metadata reads; neither needs a second full filename index.
  from zipfile import CompleteDirs
  import sys
  path_module = sys.modules[CompleteDirs.__module__]
  FastLookup, _parents = path_module.FastLookup, path_module._parents
  original_names = _NativeZip.namelist
  original_sets = [(cls, cls._name_set) for cls in (CompleteDirs, FastLookup)]
  def names(archive):
   if isinstance(archive.filelist, Entries):
    return (entry.filename for entry in archive.filelist)
   return original_names(archive)
  class NameSet:
   def __init__(self, archive):self.archive = archive
   def __contains__(self, name):
    if self.archive.NameToInfo.get(name) is not None:return True
    if not name.endswith('/'):return False
    return any(name == parent + '/' for entry in self.archive.filelist for parent in _parents(entry.filename))
  metadata_helper = getattr(_native_loader, 'find_wheel_metadata_dir', None)
  adapted_metadata = _native_metadata_helper(metadata_helper) if metadata_helper is not None else None
  try:
   if metadata_helper is not None:_native_loader.find_wheel_metadata_dir = adapted_metadata
   _NativeZip._RealGetContents = contents
   _NativeZip.namelist = names
   for cls, original_set in original_sets:
    def name_set(archive, original_set=original_set):
     return NameSet(archive) if isinstance(archive.filelist, Entries) else original_set(archive)
    cls._name_set = name_set
   yield
  finally:
   if metadata_helper is not None:_native_loader.find_wheel_metadata_dir = metadata_helper
   _NativeZip._RealGetContents = original
   _NativeZip.namelist = original_names
   for cls, original_set in original_sets:cls._name_set = original_set

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
    _native_metadata_dir = _native_metadata_helper(_native_metadata_dir, '.dist-info')
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
   emit = globals().get('_safe_native_wheel_dynlib')
   discover = _native_loader.get_dynlibs
   if emit is not None:
    # Preserve the pinned predicate, order and path resolution. Only defer
    # each native result until the previous library has finished loading.
    import ast, inspect, textwrap
    tree = ast.parse(textwrap.dedent(inspect.getsource(discover)))
    returns = [node for node in ast.walk(tree) if isinstance(node, ast.Return)]
    if len(returns) != 1 or not isinstance(returns[0].value, ast.ListComp):
     raise RuntimeError('Unsupported native dynamic library discovery')
    values = returns[0].value
    returns[0].value = ast.copy_location(ast.GeneratorExp(elt=values.elt, generators=values.generators), values)
    namespace = dict(discover.__globals__)
    exec(compile(ast.fix_missing_locations(tree), '<safe native library discovery>', 'exec'), namespace)
    discover = namespace[discover.__name__]
   _native_dynlibs = discover(_native_archive, _NativePath(_native_config['filename']).suffix, _native_target)
   if emit is not None:
    for path in _native_dynlibs:
     result = emit(path)
     if hasattr(result, 'then'):result = _native_sync(result)
     if result != '':return _native_json.dumps({'dynlibError':result})
    return '[]'
  return _native_json.dumps(_native_dynlibs)
_safe_extract_native_wheel(_safe_native_wheel_read, _safe_native_wheel_config)
`;
