def _safe_install_metadata_lookup(installation_root, runtime_root):
 import ast, errno, inspect, json, os, pathlib, tempfile, textwrap, weakref, zipfile
 from contextlib import suppress
 import importlib.metadata as metadata
 original = metadata.Lookup
 def group_path(root, name):
  key = name.encode('utf-8', 'surrogatepass').hex()
  return os.path.join(root, 'keys', *(key[i:i+100] for i in range(0, len(key), 100)))
 def retire(root):
  # Deleting during enumeration invalidates namespace-checking backends. Replay
  # the owned creation journal instead; each record names one bounded group.
  journal = os.path.join(root, 'journal')
  if os.path.exists(journal):
   with open(journal, encoding='utf-8') as source:
    for line in source:
     group, name = json.loads(line)
     if group not in ('0', '1', '2', '3', '4', '5') or not isinstance(name, str):
      raise ValueError('Invalid metadata cleanup record')
     directory = group_path(os.path.join(root, group), name)
     with suppress(FileNotFoundError):
      os.unlink(os.path.join(directory, 'rows'))
     while directory != root:
      try:
       os.rmdir(directory)
      except FileNotFoundError:
       pass
      except OSError as error:
       if error.errno in (errno.ENOTEMPTY, errno.EEXIST):
        break
       raise
      directory = os.path.dirname(directory)
   os.unlink(journal)
  # Infos, eggs, ZIP entry records/name index, child and archive membership.
  for group in ('0', '1', '2', '3', '4', '5'):
   directory = os.path.join(root, group)
   with suppress(FileNotFoundError):
    os.unlink(os.path.join(directory, 'order'))
   with suppress(FileNotFoundError):
    os.rmdir(directory)
  os.rmdir(root)
 class Store:
  def __init__(self):
   self.root = tempfile.mkdtemp(dir=installation_root, prefix='.metadata-')
   self.cleanup = weakref.finalize(self, retire, self.root)
   self.count = 0
   self.archive = None
 class Rows:
  def __init__(self, store, path):
   self.store, self.path = store, path
  def append(self, value):
   if isinstance(value, zipfile.Path):
    if self.store.archive is not None and self.store.archive is not value.root:
     raise ValueError('Metadata lookup changed ZIP archive')
    self.store.archive = value.root
    value = [value.at]
   else:value = str(value)
   with open(self.path, 'a', encoding='utf-8') as output:
    output.write(json.dumps(value) + '\n')
  def __iter__(self):
   with open(self.path, encoding='utf-8') as source:
    for line in source:
     value = json.loads(line)
     yield zipfile.Path(self.store.archive, value[0]) if isinstance(value, list) else pathlib.Path(value)
 class Groups:
  def __init__(self, store):
   self.store = store
   self.root = os.path.join(store.root, str(store.count))
   store.count += 1
   os.makedirs(self.root)
   self.order = os.path.join(self.root, 'order')
   self.frozen = False
  def __contains__(self, name):
   return os.path.exists(os.path.join(group_path(self.root, name), 'rows'))
  def __getitem__(self, name):
   # Reversible keys avoid filesystem spelling rules and hash collisions. Each
   # component is bounded independently of a backend's filename length limit.
   directory = group_path(self.root, name)
   filename = os.path.join(directory, 'rows')
   if not os.path.exists(filename):
    if self.frozen:
     return ()
    with open(os.path.join(self.store.root, 'journal'), 'a', encoding='utf-8') as output:
     output.write(json.dumps([os.path.basename(self.root), name]) + '\n')
    os.makedirs(directory, exist_ok=True)
    with open(filename, 'w', encoding='utf-8'):
     pass
    with open(self.order, 'a', encoding='utf-8') as output:
     output.write(json.dumps(name) + '\n')
   return Rows(self.store, filename)
  def values(self):
   if os.path.exists(self.order):
    with open(self.order, encoding='utf-8') as source:
     for line in source:
      yield self[json.loads(line)]
  def freeze(self):
   self.frozen = True
 def groups(lookup):
  return Groups(lookup._safe_store)
 class BackingFailure(Exception):
  pass
 class Entries:
  def __init__(self, store):
   self.store, self.count = store, 0
   try:
    self.records, self.names = Groups(store), Groups(store)
   except Exception as error:raise BackingFailure() from error
  def write(self, ordinal, entry):
   try:
    with open(self.records[str(ordinal)].path, 'w', encoding='utf-8') as output:
     json.dump([(name, {'bytes':value.hex()} if isinstance(value, bytes) else value) for name in zipfile.ZipInfo.__slots__ if hasattr(entry, name) for value in [getattr(entry, name)]], output)
   except Exception as error:raise BackingFailure() from error
  def append(self, entry):
   self.write(self.count, entry)
   try:
    with open(self.names[entry.filename].path, 'w', encoding='utf-8') as output:json.dump(self.count, output)
   except Exception as error:raise BackingFailure() from error
   self.count += 1
  def __len__(self):return self.count
  def __getitem__(self, ordinal):
   if ordinal < 0:ordinal += self.count
   if not 0 <= ordinal < self.count:raise IndexError(ordinal)
   with open(self.records[str(ordinal)].path, encoding='utf-8') as source:record = json.load(source)
   entry = zipfile.ZipInfo.__new__(zipfile.ZipInfo)
   for name, value in record:
    if isinstance(value, dict):value = bytes.fromhex(value['bytes'])
    elif name == 'date_time':value = tuple(value)
    setattr(entry, name, value)
   return entry
  def __iter__(self):
   for ordinal in range(self.count):yield self[ordinal]
  def seal(self, end_offset):
   # Match reversed stable native sorting, including duplicate header offsets.
   # Sort scalar offset/ordinal pairs in bounded runs, then merge two at a time.
   import heapq
   root = None
   serial = 0
   def save(values):
    nonlocal serial
    path = os.path.join(root, str(serial))
    serial += 1
    with open(path, 'w', encoding='utf-8') as output:
     for value in values:output.write(json.dumps(value) + '\n')
   try:
    root = tempfile.mkdtemp(dir=self.store.root, prefix='.zip-sort-')
    chunk = []
    for ordinal, entry in enumerate(self):
     chunk.append([entry.header_offset, ordinal])
     if len(chunk) == 64:
      save(sorted(chunk, reverse=True));chunk.clear()
    if chunk:save(sorted(chunk, reverse=True))
    chunk.clear()
    current = 0
    while serial - current > 1:
     left_path, right_path = (os.path.join(root, str(index)) for index in (current, current + 1))
     with open(left_path, encoding='utf-8') as left, open(right_path, encoding='utf-8') as right:
      save(heapq.merge((json.loads(line) for line in left), (json.loads(line) for line in right), reverse=True))
     os.unlink(left_path);os.unlink(right_path);current += 2
    if serial:
     with open(os.path.join(root, str(current)), encoding='utf-8') as source:
      for line in source:
       offset, ordinal = json.loads(line)
       entry = self[ordinal];entry._end_offset = end_offset
       self.write(ordinal, entry);end_offset = offset
   except Exception as error:raise BackingFailure() from error
   finally:
    try:
     if root is not None:
      for index in range(serial):
       with suppress(FileNotFoundError):os.unlink(os.path.join(root, str(index)))
      os.rmdir(root)
    except Exception as error:raise BackingFailure() from error
 class Names:
  def __init__(self, entries):self.entries = entries
  def __getitem__(self, name):
   if name not in self.entries.names:raise KeyError(name)
   with open(self.entries.names[name].path, encoding='utf-8') as source:ordinal = json.load(source)
   return self.entries[ordinal]
  def get(self, name, default=None):
   try:return self[name]
   except KeyError:return default
 def unique_children(children, store):
  seen = Groups(store)
  for child in children:
   if child not in seen:
    seen[child]
    yield child
 def zip_names(archive, store):
  import sys
  parents = sys.modules[zipfile.CompleteDirs.__module__]._parents
  names = Groups(store)
  # Native Path.resolve_dir distinguishes explicit files from implied folders.
  # Build the complete membership snapshot before yielding any path, so a file
  # encountered before a later nested member resolves exactly as native ZIP.
  for entry in archive.filelist:
   names[entry.filename]
   for parent in parents(entry.filename):
    names[parent + '/']
  archive._name_set = lambda: names
  # Implied directory entries add no new top-level children. Their first root
  # already occurred in an explicit member, and native appends them at the end.
  for entry in archive.filelist:
   yield entry.filename
 native_parser = zipfile.ZipFile._RealGetContents
 parser_tree = ast.parse(textwrap.dedent(inspect.getsource(native_parser)))
 directory_read = ast.dump(ast.parse('data = fp.read(size_cd)').body[0])
 directory_buffer = ast.dump(ast.parse('fp = io.BytesIO(data)').body[0])
 name_assignment = ast.dump(ast.parse('self.NameToInfo[x.filename] = x').body[0])
 offset_order = ast.dump(ast.parse('''for zinfo in reversed(sorted(self.filelist, key=lambda zinfo: zinfo.header_offset)):
 zinfo._end_offset = end_offset
 end_offset = zinfo.header_offset''').body[0])
 class DirectoryRewrite(ast.NodeTransformer):
  reads = buffers = names = orders = 0
  def visit_Assign(self, node):
   shape = ast.dump(node)
   if shape == name_assignment:
    self.names += 1
    return None
   if shape == directory_read:
    self.reads += 1
    return None
   if shape == directory_buffer:
    self.buffers += 1
    return ast.copy_location(ast.parse('fp = _safe_directory_window(fp, size_cd)').body[0], node)
   return node
  def visit_For(self, node):
   if ast.dump(node) == offset_order:
    self.orders += 1
    return ast.copy_location(ast.parse('self.filelist.seal(end_offset)').body[0], node)
   return self.generic_visit(node)
 class Window:
  def __init__(self, source, size):
   self.source, self.remaining = source, size
  def read(self, size=-1):
   size = self.remaining if size is None or size < 0 else min(size, self.remaining)
   value = self.source.read(size)
   self.remaining -= len(value)
   return value
 parser_rewrite = DirectoryRewrite()
 parser_tree = parser_rewrite.visit(parser_tree)
 if (parser_rewrite.reads, parser_rewrite.buffers, parser_rewrite.names, parser_rewrite.orders) != (1, 1, 1, int('_end_offset' in zipfile.ZipInfo.__slots__)):
  raise RuntimeError('Unsupported native ZIP directory parser')
 parser_namespace = dict(native_parser.__globals__, _safe_directory_window=Window)
 exec(compile(ast.fix_missing_locations(parser_tree), '<safe metadata ZIP directory>', 'exec'), parser_namespace)
 def open_zip(root, store):
  # Construction is synchronous on the native dispatch lane. Restore even when
  # the native parser rejects an archive; later user ZIP opens remain unchanged.
  previous = zipfile.ZipFile._RealGetContents
  def parse(archive):
   archive.filelist = Entries(store)
   archive.NameToInfo = Names(archive.filelist)
   parser_namespace['_RealGetContents'](archive)
  zipfile.ZipFile._RealGetContents = parse
  try:
   return zipfile.Path(root)
  finally:
   zipfile.ZipFile._RealGetContents = previous
 # Keep the pinned ZIP path construction, joinpath binding and filename order.
 # Keep native validation while adapting its eager storage and discovery tables.
 zip_method = metadata.FastPath.zip_children
 zip_tree = ast.parse(textwrap.dedent(inspect.getsource(zip_method)))
 class ZipRewrite(ast.NodeTransformer):
  count = names = paths = 0
  def visit_Call(self, node):
   if ast.dump(node) == ast.dump(ast.parse('zipfile.Path(self.root)').body[0].value):
    self.paths += 1
    return ast.copy_location(ast.parse('_safe_open_zip(self.root, _safe_store)').body[0].value, node)
   if ast.dump(node) == ast.dump(ast.parse('zip_path.root.namelist()').body[0].value):
    self.names += 1
    return ast.copy_location(ast.parse('_safe_zip_names(zip_path.root, _safe_store)').body[0].value, node)
   if isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name) and node.func.value.id == 'dict' and node.func.attr == 'fromkeys' and len(node.args) == 1 and not node.keywords:
    self.count += 1
    return ast.copy_location(ast.Call(func=ast.Name(id='_safe_unique_children', ctx=ast.Load()), args=[node.args[0], ast.Name(id='_safe_store', ctx=ast.Load())], keywords=[]), node)
   return self.generic_visit(node)
 zip_rewrite = ZipRewrite()
 zip_tree = zip_rewrite.visit(zip_tree)
 if (zip_rewrite.count, zip_rewrite.names, zip_rewrite.paths) != (1, 1, 1):
  raise RuntimeError('Unsupported native ZIP metadata discovery')
 zip_tree.body[0].args.args.append(ast.arg(arg='_safe_store'))
 zip_namespace = dict(zip_method.__globals__, _safe_unique_children=unique_children, _safe_zip_names=zip_names, _safe_open_zip=open_zip)
 exec(compile(ast.fix_missing_locations(zip_tree), '<safe ZIP metadata children>', 'exec'), zip_namespace)
 zip_children = zip_namespace['zip_children']
 class ScanFailure(Exception):
  pass
 def children(path):
  if isinstance(path, ZipFallback):
   yield from path.children()
   return
  try:
   with os.scandir(path.root or '.') as entries:
    for entry in entries:
     yield entry.name
  except Exception as error:
   raise ScanFailure() from error
 class ZipFallback:
  def __init__(self, path, store):
   self.path, self.root, self.store = path, path.root, store
  def children(self):
   try:
    if getattr(self.path.zip_children, '__func__', None) is zip_method:
     return zip_children(self.path, self.store)
    return self.path.zip_children()
   except BackingFailure as error:raise error.__cause__
   except Exception:pass
   return ()
  def joinpath(self, child):
   return self.path.joinpath(child)
 tree = ast.parse(textwrap.dedent(inspect.getsource(original.__init__)))
 class Rewrite(ast.NodeTransformer):
  groups = children = 0
  def visit_Call(self, node):
   if isinstance(node.func, ast.Name) and node.func.id == 'FreezableDefaultDict' and len(node.args) == 1 and isinstance(node.args[0], ast.Name) and node.args[0].id == 'list' and not node.keywords:
    self.groups += 1
    return ast.copy_location(ast.Call(func=ast.Name(id='_safe_groups', ctx=ast.Load()), args=[ast.Name(id='self', ctx=ast.Load())], keywords=[]), node)
   if isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name) and node.func.value.id == 'path' and node.func.attr == 'children' and not node.args and not node.keywords:
    self.children += 1
    return ast.copy_location(ast.Call(func=ast.Name(id='_safe_children', ctx=ast.Load()), args=[ast.Name(id='path', ctx=ast.Load())], keywords=[]), node)
   return self.generic_visit(node)
 rewrite = Rewrite()
 tree = rewrite.visit(tree)
 if (rewrite.groups, rewrite.children) != (2, 1):
  raise RuntimeError('Unsupported native metadata discovery')
 namespace = dict(original.__init__.__globals__, _safe_groups=groups, _safe_children=children)
 exec(compile(ast.fix_missing_locations(tree), '<safe metadata lookup>', 'exec'), namespace)
 initialize = namespace['__init__']
 class Lookup(original):
  def __init__(self, path):
   absolute = os.path.abspath(path.root or '.')
   if absolute == runtime_root or absolute.startswith(runtime_root + '/'):
    super().__init__(path)
    return
   self._safe_store = Store()
   try:
    try:
     initialize(self, path if os.path.isdir(absolute) else ZipFallback(path, self._safe_store))
    except ScanFailure:
     self._safe_store.cleanup()
     self._safe_store = Store()
     initialize(self, ZipFallback(path, self._safe_store))
   except BaseException:
    self._safe_store.cleanup()
    raise
 metadata.Lookup = Lookup
 metadata.MetadataPathFinder.invalidate_caches()

if '_safe_installation_root' in globals():
 _safe_install_metadata_lookup(_safe_installation_root, _safe_runtime_mount)
del _safe_install_metadata_lookup
