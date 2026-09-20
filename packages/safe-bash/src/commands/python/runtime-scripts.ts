export const pythonRuntimeRelocation = `
import sys, zipimport, importlib.machinery

def _rebase_runtime_path(value):
 return _safe_runtime_mount + value if isinstance(value, str) and (value == '/lib' or value.startswith('/lib/')) else value

def _rebase_runtime_loader(loader):
 if isinstance(loader, zipimport.zipimporter):
  archive = _rebase_runtime_path(loader.archive)
  if archive != loader.archive:
   return zipimport.zipimporter(archive + '/' + loader.prefix)
 elif isinstance(loader, (importlib.machinery.SourceFileLoader, importlib.machinery.SourcelessFileLoader, importlib.machinery.ExtensionFileLoader)):
  path = _rebase_runtime_path(loader.path)
  if path != loader.path:
   return type(loader)(loader.name, path)
 return loader
sys.path[:] = [_rebase_runtime_path(value) for value in sys.path]
for _module in list(sys.modules.values()):
 if _module is None:
  continue
 for _attribute in ('__file__', '__cached__'):
  if hasattr(_module, _attribute):
   setattr(_module, _attribute, _rebase_runtime_path(getattr(_module, _attribute)))
 if hasattr(_module, '__path__'):
  _module.__path__ = [_rebase_runtime_path(value) for value in _module.__path__]
 if hasattr(_module, '__loader__'):
  _module.__loader__ = _rebase_runtime_loader(_module.__loader__)
 _spec = getattr(_module, '__spec__', None)
 if _spec is not None:
  _spec.origin = _rebase_runtime_path(_spec.origin)
  _spec.loader = _rebase_runtime_loader(_spec.loader)
  if _spec.submodule_search_locations is not None:
   _spec.submodule_search_locations = [_rebase_runtime_path(value) for value in _spec.submodule_search_locations]
sys.path_importer_cache.clear()
`;

export const pythonImportMetadata = `
import importlib._bootstrap_external, types, json
_safe_import_stat_callback = _safe_import_stat
_safe_original_import_stat = importlib._bootstrap_external._path_stat
def _safe_import_path_stat(path):
 if path == _safe_runtime_mount or path.startswith(_safe_runtime_mount + '/'):
  return _safe_original_import_stat(path)
 value = json.loads(_safe_import_stat_callback(path))
 if 'errno' in value:
  raise OSError(value['errno'], 'filesystem import metadata unavailable', path)
 return types.SimpleNamespace(st_mode=value['mode'], st_size=value['size'], st_mtime=value['mtimeMs'] / 1000)
importlib._bootstrap_external._path_stat = _safe_import_path_stat
`;

export const pythonDirectoryEntries = `
import os, json, errno
_safe_directory_callback = _safe_directory_entries
def _safe_listdir(path='.'):
 if isinstance(path, int):
  raise OSError(errno.ENOTSUP, 'retained directory descriptors are unsupported')
 original = os.fspath(path) if path is not None else '.'
 value = json.loads(_safe_directory_callback(os.fsdecode(original)))
 if 'errno' in value:
  raise OSError(value['errno'], 'directory enumeration failed', path)
 return [os.fsencode(name) for name in value['entries']] if isinstance(original, bytes) else value['entries']
os.listdir = _safe_listdir
# The frozen importer holds the posix module separately from os.
importlib._bootstrap_external._os.listdir = _safe_listdir
`;

export const pythonStatProjection = `
import os, json, errno
_safe_stat_callback = _safe_stat_projection
_safe_stat_type = os.stat_result
_safe_fspath = os.fspath
_safe_fsdecode = os.fsdecode

def _safe_stat(path, *, dir_fd=None, follow_symlinks=True):
 if dir_fd is not None:
  raise OSError(errno.ENOTSUP, 'dir_fd metadata is unsupported')
 if isinstance(path, int):
  if not follow_symlinks:
   raise ValueError('stat: cannot use fd and follow_symlinks together')
 else:
  path = _safe_fsdecode(_safe_fspath(path))
 value = json.loads(_safe_stat_callback(path, follow_symlinks))
 if 'errno' in value:
  raise OSError(value['errno'], 'filesystem metadata unavailable', path)
 keys = ('mode','ino','dev','nlink','uid','gid','size')
 if any(key not in value for key in keys):
  raise OSError(errno.EOVERFLOW, 'canonical identity or required stat metadata unavailable', path)
 times = [value[key] / 1000 for key in ('atimeMs','mtimeMs','ctimeMs')]
 extras = dict(zip(('st_atime','st_mtime','st_ctime'), times))
 for name, milliseconds in zip(('atime','mtime','ctime'), (value['atimeMs'],value['mtimeMs'],value['ctimeMs'])):
  seconds = int(milliseconds // 1000)
  extras['st_' + name + '_ns'] = seconds * 1000000000 + round((milliseconds - seconds * 1000) * 1000000)
 for key in ('blocks','blksize','rdev'):
  if key in value:
   extras['st_' + key] = value[key]
 return _safe_stat_type(tuple(value[key] for key in keys) + tuple(int(time // 1) for time in times), extras)

def _safe_lstat(path, *, dir_fd=None):
 return _safe_stat(path, dir_fd=dir_fd, follow_symlinks=False)

def _safe_fstat(fd):
 if not isinstance(fd, int):
  raise TypeError('file descriptor must be an integer')
 return _safe_stat(fd)
os.stat = _safe_stat
os.lstat = _safe_lstat
os.fstat = _safe_fstat
import stat as _safe_stat_module
class _SafeDirEntry:
 def __init__(self, root, name):
  self.name = name
  self.path = os.path.join(root, name)
  self._cache = {}
 def __fspath__(self):
  return self.path
 def stat(self, *, follow_symlinks=True):
  if follow_symlinks not in self._cache:
   self._cache[follow_symlinks] = os.stat(self.path, follow_symlinks=follow_symlinks)
  return self._cache[follow_symlinks]
 def inode(self):
  return self.stat(follow_symlinks=False).st_ino
 def is_dir(self, *, follow_symlinks=True):
  try:
   return _safe_stat_module.S_ISDIR(self.stat(follow_symlinks=follow_symlinks).st_mode)
  except FileNotFoundError:
   return False
 def is_file(self, *, follow_symlinks=True):
  try:
   return _safe_stat_module.S_ISREG(self.stat(follow_symlinks=follow_symlinks).st_mode)
  except FileNotFoundError:
   return False
 def is_symlink(self):
  try:
   return _safe_stat_module.S_ISLNK(self.stat(follow_symlinks=False).st_mode)
  except FileNotFoundError:
   return False
class _SafeScandir:
 def __init__(self, path):
  self._entries = iter([_SafeDirEntry(path, name) for name in os.listdir(path)])
 def __iter__(self):
  return self
 def __next__(self):
  return next(self._entries)
 def close(self):
  self._entries = iter(())
 def __enter__(self):
  return self
 def __exit__(self, *args):
  self.close()
def _safe_scandir(path='.'):
 if isinstance(path, int):
  raise OSError(errno.ENOTSUP, 'retained directory descriptors are unsupported')
 return _SafeScandir(os.fspath(path) if path is not None else '.')
os.scandir = _safe_scandir

`;

export const pythonTreeCleanup = `
import shutil, os, json
_safe_tree_callback = _safe_tree_cleanup
_safe_original_rmtree_impl = shutil._rmtree_impl
def _safe_rmtree_impl(path, dir_fd, onexc):
 if dir_fd is not None:
  return _safe_original_rmtree_impl(path, dir_fd, onexc)
 value = json.loads(_safe_tree_callback(os.fsdecode(path)))
 if not value['supported']:
  return _safe_original_rmtree_impl(path, dir_fd, onexc)
 if 'errno' in value:
  onexc(os.rmdir, path, OSError(value['errno'], 'directory cleanup failed', path))
shutil._rmtree_impl = _safe_rmtree_impl
`;
