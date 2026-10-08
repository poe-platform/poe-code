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
     if group not in ('0', '1') or not isinstance(name, str):
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
  # The guarded native initializer creates exactly the infos and eggs maps.
  for group in ('0', '1'):
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
  def __init__(self, path):
   self.path, self.root = path, path.root
  def children(self):
   with suppress(Exception):
    return self.path.zip_children()
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
     initialize(self, path if os.path.isdir(absolute) else ZipFallback(path))
    except ScanFailure:
     self._safe_store.cleanup()
     self._safe_store = Store()
     initialize(self, ZipFallback(path))
   except BaseException:
    self._safe_store.cleanup()
    raise
 metadata.Lookup = Lookup
 metadata.MetadataPathFinder.invalidate_caches()

if '_safe_installation_root' in globals():
 _safe_install_metadata_lookup(_safe_installation_root, _safe_runtime_mount)
del _safe_install_metadata_lookup
