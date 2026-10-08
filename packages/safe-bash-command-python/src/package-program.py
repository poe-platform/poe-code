
import json as _safe_json
_safe_restoring = False
import importlib.metadata as _safe_metadata
from micropip._vendored.packaging.src.packaging.utils import canonicalize_name as _safe_name
from collections.abc import MutableSet as _SafeMutableSet
class _SafeNames(_SafeMutableSet):
 files = ('entry',)
 def __init__(self, names=()):
  import os, tempfile
  self.root = tempfile.mkdtemp(dir=_safe_installation_root, prefix='.names-')
  self.journal = os.path.join(self.root, 'journal')
  self.count = self.serial = 0
  with open(self.journal, 'w', encoding='utf-8'):pass
  self.update(names)
 def path(self, name, filename='entry'):
  import os
  key = name.encode('utf-8', 'surrogatepass').hex()
  return os.path.join(self.root, 'keys', *(key[i:i+100] for i in range(0, len(key), 100)), filename)
 def entry(self, name):
  try:
   with open(self.path(name), encoding='utf-8') as source:ordinal = source.read(len(str(self.serial)) + 1)
  except FileNotFoundError:return None
  if not ordinal.isascii() or not ordinal.isdecimal() or not 0 < int(ordinal) <= self.serial or str(int(ordinal)) != ordinal:
   raise ValueError('Invalid package name entry')
  return ordinal
 def __contains__(self, name):return self.entry(name) is not None
 def __len__(self):return self.count
 def __iter__(self):
  import json
  with open(self.journal, encoding='utf-8') as source:
   for line in source:
    ordinal, name = json.loads(line)
    if self.entry(name) == ordinal:yield name
 def add(self, name):
  import json, os
  if name in self:return
  self.serial += 1
  ordinal = str(self.serial)
  # Journal first so installation-root retirement can recover partial writes.
  with open(self.journal, 'a', encoding='utf-8') as output:output.write(json.dumps([ordinal, name]) + '\n')
  path = self.path(name)
  os.makedirs(os.path.dirname(path), exist_ok=True)
  with open(path, 'w', encoding='utf-8') as output:output.write(ordinal)
  self.count += 1
 def update(self, names):
  for name in names:self.add(name)
 def discard(self, name):
  import os
  try:os.unlink(self.path(name))
  except FileNotFoundError:return
  self.count -= 1
 def close(self):
  import errno, json, os
  # Replay owned paths; do not mutate a directory under an active scandir.
  with open(self.journal, encoding='utf-8') as source:
   for line in source:
    _, name = json.loads(line)
    path = self.path(name)
    for filename in self.files:
     try:os.unlink(self.path(name, filename))
     except FileNotFoundError:pass
    parent = os.path.dirname(path)
    while parent != self.root:
     try:os.rmdir(parent)
     except FileNotFoundError:pass
     except OSError as error:
      if error.errno in (errno.ENOTEMPTY, errno.EEXIST):break
      raise
     parent = os.path.dirname(parent)
  os.unlink(self.journal)
  os.rmdir(self.root)

 def ordered(self, key=None):
  import heapq, json, os, tempfile
  root = tempfile.mkdtemp(dir=self.root, prefix='.sort-')
  serial = 0
  def save(values):
   nonlocal serial
   path = os.path.join(root, str(serial))
   serial += 1
   with open(path, 'w', encoding='utf-8') as output:
    for value in values:output.write(json.dumps(value) + '\n')
  try:
   chunk = []
   for ordinal, name in enumerate(self):
    chunk.append((key(name), ordinal, name) if key else name)
    if len(chunk) == 64:
     save(sorted(chunk))
     chunk.clear()
   if chunk:save(sorted(chunk))
   chunk.clear()
   current = 0
   while serial - current > 1:
    left_path, right_path = (os.path.join(root, str(index)) for index in (current, current + 1))
    with open(left_path, encoding='utf-8') as left, open(right_path, encoding='utf-8') as right:
     save(heapq.merge((json.loads(line) for line in left), (json.loads(line) for line in right)))
    os.unlink(left_path)
    os.unlink(right_path)
    current += 2
   if serial:
    with open(os.path.join(root, str(current)), encoding='utf-8') as source:
     for line in source:
      value = json.loads(line)
      yield value[2] if key else value
  finally:
   for index in range(serial):
    try:os.unlink(os.path.join(root, str(index)))
    except FileNotFoundError:pass
   os.rmdir(root)

class _SafeValues(_SafeNames):
 files = ('entry', 'value')
 def put(self, name, value):
  import json
  self.add(name)
  with open(self.path(name, 'value'), 'w', encoding='utf-8') as output:json.dump(value, output)
 def get(self, name, default=None):
  import json
  if name not in self:return default
  with open(self.path(name, 'value'), encoding='utf-8') as source:return json.load(source)

class _SafeMetadataText:
 def __init__(self, lifetime):
  self.blocks = _SafeValues()
  lifetime.callback(self.blocks.close)
  self.ordinal = 0
  self.pending = ''
 def __bool__(self):return bool(len(self.blocks))
 def read(self, size):
  if not size:return ''
  if not self.pending and self.ordinal < len(self.blocks):
   self.pending = self.blocks.get(str(self.ordinal))
   self.ordinal += 1
  result, self.pending = self.pending[:size], self.pending[size:]
  return result
 def splitlines(self):
  tail = ''
  for key in self.blocks:
   lines = (tail + self.blocks.get(key)).splitlines(keepends=True)
   tail = lines.pop() if lines else ''
   for line in lines:yield line.splitlines()[0]
  yield from tail.splitlines()
def _safe_read_metadata_text(distribution, filename, lifetime):
 from pathlib import PosixPath, WindowsPath
 if type(distribution._path) not in (PosixPath, WindowsPath):return distribution.read_text(filename)
 missing = (FileNotFoundError, IsADirectoryError, KeyError, NotADirectoryError, PermissionError)
 try:source = distribution._path.joinpath(filename).open(encoding='utf-8')
 except missing:return None
 failed = False
 try:
  text = _SafeMetadataText(lifetime)
  while True:
   try:chunk = source.read(8192)
   except missing:
    failed = True
    break
   if not chunk:break
   text.blocks.put(str(len(text.blocks)), chunk)
 finally:
  try:source.close()
  except missing:failed = True
 return None if failed else text if text else ''
def _safe_distribution_metadata(distribution):
 from contextlib import ExitStack
 from types import FunctionType, SimpleNamespace
 import email
 from email.parser import Parser
 if type(distribution) is not _safe_metadata.PathDistribution or 'read_text' in vars(distribution):
  return distribution.metadata
 with ExitStack() as lifetime:
  view = _safe_metadata.PathDistribution(distribution._path)
  view.read_text = lambda filename: _safe_read_metadata_text(distribution, filename, lifetime)
  def parse(text):
   return Parser().parse(text) if isinstance(text, _SafeMetadataText) else email.message_from_string(text)
  native = _safe_metadata.Distribution.metadata.fget
  metadata = FunctionType(native.__code__, dict(native.__globals__, email=SimpleNamespace(message_from_string=parse)), native.__name__, native.__defaults__, native.__closure__)
  return metadata(view)

class _SafePreloaded:
 @classmethod
 async def snapshot(cls):
  await _safe_package_preloaded('start')
  for distribution in _safe_metadata.distributions():
   name = _safe_distribution_metadata(distribution)['Name']
   if name:
    await _safe_package_preloaded('add', _safe_name(name))
  await _safe_package_preloaded('seal')
  return cls()
 def __contains__(self, name):
  from pyodide.ffi import run_sync
  return run_sync(_safe_package_preloaded('has', name))
_safe_preloaded = await _SafePreloaded.snapshot()
from micropip._compat import compatibility_layer as _safe_compat
from micropip.package_manager import PackageManager as _SafePackageManager
from micropip.wheelinfo import WheelInfo as _SafeWheelInfo
from micropip._utils import check_compatible as _safe_check_compatible
from micropip._vendored.packaging.src.packaging.requirements import Requirement as _SafeRequirement, InvalidRequirement as _SafeInvalidRequirement

class _SafePackageCompatibility(_safe_compat):
 @staticmethod
 async def loadPackage(names):
  return await _safe_package_native(names)
 @staticmethod
 async def fetch_bytes(url, kwargs):
  return (await _safe_package_bytes(url)).to_bytes()
 @staticmethod
 async def fetch_string_and_headers(url, kwargs):
  value = _safe_json.loads(await _safe_package_metadata(url))
  return value['text'], value['headers']

async def _safe_wheel_fetch(self, url, kwargs, compat):
 expected = self.sha256 if url == self.url else None
 if url == self.metadata_url and isinstance(self.core_metadata, dict):
  expected = self.core_metadata.get('sha256')
 return (await _safe_package_bytes(url, expected)).to_bytes()
_SafeWheelInfo._fetch_bytes = _safe_wheel_fetch
def _safe_wheel_from_url(cls, url, original=_SafeWheelInfo.from_url):
 wheel = original(url)
 wheel._safe_direct_url = url
 return wheel
_SafeWheelInfo.from_url = classmethod(_safe_wheel_from_url)
from micropip.metadata import Metadata as _SafeWheelMetadata
async def _safe_wheel_download(self, fetch_kwargs, compat_layer):
 if self._data is not None:
  return
 self._data = _safe_json.loads(await _safe_package_wheel_download(self.url, self.sha256))
 if self._metadata is None:
  metadata = await _safe_package_wheel_metadata(_safe_json.dumps({'source': self._data, 'name': self.name}))
  self._metadata = _SafeWheelMetadata(metadata.encode('utf-8'))
async def _safe_wheel_install(self, target, compat_layer):
 if not self._data:
  raise RuntimeError('Micropip internal error: attempted to install wheel before downloading it?')
 source = 'pypi' if self.sha256 is not None else self.url
 metadata = {'PYODIDE_SOURCE': source, 'PYODIDE_URL': self._data.get('url', self.url), 'PYODIDE_SHA256': self._data['key'], 'INSTALLER': 'micropip'}
 if _safe_restoring:
  origin = _safe_record_by_name.origin(_safe_name(self.name))
  if origin is not None: metadata['direct_url.json'] = origin
 elif hasattr(self, '_safe_direct_url') and 'metadata' not in self._data:
  metadata['direct_url.json'] = read_source_origin({'source': self._safe_direct_url, 'directory': False})
 metadata.update(self._data.get('metadata', {}))
 if self._requires:
  metadata['PYODIDE_REQUIRES'] = _safe_json.dumps(sorted(x.name for x in self._requires))
 await _safe_package_wheel_install(_safe_json.dumps({'source': self._data, 'filename': self.filename, 'extract_dir': str(target), 'metadata': metadata}))
 setattr(compat_layer.loadedPackages, self._project_name, source)
_SafeWheelInfo.download = _safe_wheel_download
_SafeWheelInfo.install = _safe_wheel_install
_safe_manager = _SafePackageManager(_SafePackageCompatibility)
_safe_indexes = _safe_json.loads(_safe_package_indexes_json)
if _safe_indexes is not None:
 _safe_manager.index_urls = [url.rstrip('/') for url in _safe_indexes]
if _safe_indexes and len(_safe_indexes) > 1:
 from micropip import package_index as _safe_index
 from itertools import chain as _safe_chain
 _safe_query = _safe_index.query_package
 async def _safe_query_all(name, index_urls, **kwargs):
  releases = {}
  found = False
  last_error = None
  for url in index_urls:
   try:
    project = await _safe_query(name, [url], **kwargs)
   except ValueError as error:
    last_error = error
    continue
   found = True
   for version, wheels in project.releases.items():
    releases[version] = _safe_chain(releases.get(version, ()), wheels)
  if not found:
   raise last_error or ValueError('No package indexes configured')
  return _safe_index.ProjectInfo(name, dict(sorted(releases.items())))
 _safe_index.query_package = _safe_query_all
async def _safe_parse_sources(sources, download=True):
 roots = _SafeRequirements()
 for source in sources:
  try:
   root = _SafeRequirement(source)
   if root.name.endswith('.whl'):
    raise _SafeInvalidRequirement(source)
  except _SafeInvalidRequirement:
   wheel = _SafeWheelInfo.from_url(source)
   root = _SafeRequirement(wheel.name + ' @ ' + source)
  roots.put(str(len(roots)), str(root))
  if (not root.marker or root.marker.evaluate({'extra': ''})) and root.url:
   direct = _SafeWheelInfo.from_url(root.url)
   _safe_check_compatible(direct.filename)
   if download:
    await direct.download({}, _SafePackageCompatibility)
 return roots

def _safe_validate(roots):
 for root in roots:
  if root.marker and not root.marker.evaluate({'extra': ''}):
   continue
  version = _safe_metadata.version(root.name)
  if not root.specifier.contains(version, prereleases=True):
   raise ValueError('Python package version conflict: ' + str(root))
  if root.url:
   wheel = _SafeWheelInfo.from_url(root.url)
   pin = _SafeRequirement(wheel.name + '==' + str(wheel.version))
   if _safe_name(wheel.name) != _safe_name(root.name) or not pin.specifier.contains(version, prereleases=True):
    raise ValueError('Python package wheel version conflict: ' + str(root))
class _SafeRequirements(_SafeValues):
 def __init__(self, requirements=()):
  super().__init__()
  for requirement in requirements:self.put(str(len(self)), str(requirement))
 def __iter__(self):
  for key in super().__iter__():yield _SafeRequirement(self.get(key))

class _SafeResolutions(_SafeNames):
 files = ('entry', 'value')
 def __init__(self):
  super().__init__()
  self.maximum = self.width = 0
 def repeated(self, requirements):
  import hashlib, json
  digest = hashlib.sha256()
  self.maximum = max(self.maximum, len(requirements))
  for requirement in requirements:
   record = json.dumps(requirement) + '\n'
   self.width = max(self.width, len(record))
   digest.update(record.encode('ascii'))
  key = digest.hexdigest()
  if key in self:
   with open(self.path(key, 'value'), encoding='utf-8') as source:
    while True:
     header = source.readline(len(str(self.maximum)) + 2)
     if not header:break
     count = header[:-1]
     if not header.endswith('\n') or not count.isascii() or not count.isdecimal() or str(int(count)) != count or int(count) > self.maximum:
      raise ValueError('Invalid package resolution record')
     count = int(count)
     matches = count == len(requirements)
     for index in range(count):
      record = source.readline(self.width + 1)
      if not record.endswith('\n') or len(record) > self.width:
       raise ValueError('Invalid package resolution record')
      value = json.loads(record)
      if not isinstance(value, str):raise ValueError('Invalid package resolution record')
      if index >= len(requirements) or value != requirements[index]:matches = False
     if matches:return True
  else:self.add(key)
  with open(self.path(key, 'value'), 'a', encoding='utf-8') as output:
   output.write(str(len(requirements)) + '\n')
   for requirement in requirements:output.write(json.dumps(requirement) + '\n')
  return False

def _safe_header_values(headers, name):
 from email.message import Message
 from email.policy import compat32
 adapter = getattr(getattr(_safe_metadata, '_adapters', None), 'Message', Message)
 if type(headers) not in (Message, adapter) or headers.policy is not compat32 or type(headers).get_all is not Message.get_all or type(headers).raw_items is not Message.raw_items or any(key in vars(headers) for key in ('get_all', 'raw_items')):
  yield from headers.get_all(name, ())
  return
 name = name.lower()
 for key, value in headers.raw_items():
  if key.lower() == name:yield headers.policy.header_fetch_parse(key, value)
def _safe_distribution_requires(distribution):
 from contextlib import ExitStack
 from types import FunctionType
 from email.utils import _has_surrogates
 if type(distribution) is not _safe_metadata.PathDistribution or any(name in vars(distribution) for name in ('read_text', '_read_dist_info_reqs', '_read_egg_info_reqs', '_deps_from_requires_text', '_convert_egg_info_reqs_to_simple_reqs')):
  yield from distribution.requires or ()
  return
 headers = _safe_distribution_metadata(distribution)
 # Non-string headers retain the native object-valued compatibility path.
 if any(type(value) is not str or _has_surrogates(value) for key, value in headers.raw_items()):
  yield from distribution.requires or ()
  return
 with ExitStack() as lifetime:
  class Values(_SafeValues):
   def __iter__(self):
    for key in super().__iter__():yield self.get(key)
  def collect(values):
   if isinstance(values, Values):return values
   result = Values()
   lifetime.callback(result.close)
   for value in values:result.put(str(len(result)), value)
   return result
  view = _safe_metadata.PathDistribution(distribution._path)
  view._read_dist_info_reqs = lambda: collect(_safe_header_values(headers, 'Requires-Dist'))
  native = _safe_metadata.Distribution.requires.fget
  requires = FunctionType(native.__code__, dict(native.__globals__, list=collect), native.__name__, native.__defaults__, native.__closure__)
  values = requires(view)
  del headers, view
  yield from values or ()
async def _safe_resolve(_safe_roots, upgrade=False, force=False, constraints=(), no_deps=False):
 _safe_constraints = _SafeValues()
 for source in constraints:
  constraint = _SafeRequirement(source)
  if constraint.extras:
   raise ValueError('Constraints cannot have extras')
  if not constraint.marker or constraint.marker.evaluate({'extra': ''}):
   name = _safe_name(constraint.name)
   sources = _safe_constraints.get(name, [])
   sources.append(source)
   _safe_constraints.put(name, sources)
 def constrain(requirement):
  for source in _safe_constraints.get(_safe_name(requirement.name), ()):
   constraint = _SafeRequirement(source)
   requirement.specifier &= constraint.specifier
   if constraint.url:
    if requirement.url and requirement.url != constraint.url:
     raise ValueError('Conflicting package constraint URLs: ' + requirement.name)
    requirement.url = constraint.url
  if requirement.url and _safe_name(requirement.name) in _safe_constraints:
   wheel = _SafeWheelInfo.from_url(requirement.url)
   if not requirement.specifier.contains(wheel.version, prereleases=True):
    raise ValueError('Python package constraint conflict: ' + str(requirement))
   requirement.specifier = _SafeRequirement(requirement.name).specifier
  return requirement
 _safe_roots = _SafeRequirements(constrain(root) for root in _safe_roots if not root.marker or root.marker.evaluate({'extra': ''}))
 _safe_extras = _SafeValues()
 for _safe_root in _safe_roots:
  if not _safe_root.marker or _safe_root.marker.evaluate({'extra': ''}):
   name = _safe_name(_safe_root.name)
   _safe_extras.put(name, sorted(set(_safe_extras.get(name, ())) | _safe_root.extras))
 for index, _safe_root in enumerate(_safe_roots):
  _safe_root.extras.update(_safe_extras.get(_safe_name(_safe_root.name), set()))
  _safe_roots.put(str(index), str(_safe_root))
 _safe_requested_names = _SafeNames(_safe_extras)
 import micropip.package_manager as _safe_pm
 _SafeTransaction = _safe_pm.Transaction
 class _SafeReplacementTransaction(_SafeTransaction):
  async def add_requirement_inner(self, req):
   contexts = [{'extra': ''}] + self.ctx_extras + [{'extra': extra} for extra in req.extras] if req.marker else ()
   if req.marker and not any(req.marker.evaluate({**self.ctx, **context}) for context in contexts):
    return
   return await super().add_requirement_inner(constrain(req))
  def check_version_satisfied(self, req, *, allow_reinstall=False):
   if req.url:
    wheel = _SafeWheelInfo.from_url(req.url)
    if _safe_name(wheel.name) != req.name:
     raise ValueError('Python package wheel name conflict: ' + str(req))
    req = _SafeRequirement(req.name + '==' + str(wheel.version))
   if req.name in _safe_preloaded or req.name in self.locked:
    return super().check_version_satisfied(req)
   if force or (upgrade and req.name in _safe_requested_names):
    return False, ''
   return super().check_version_satisfied(req, allow_reinstall=allow_reinstall)
 async def _safe_install(requirements):
  _safe_pm.Transaction = _SafeReplacementTransaction
  try:
   await _safe_manager.install(requirements, deps=not no_deps, pre=_safe_package_pre, reinstall=True, **({'constraints': list(constraints)} if constraints else {}))
  finally:
   _safe_pm.Transaction = _SafeTransaction
 _safe_validate(root for root in _safe_roots if _safe_name(root.name) in _safe_preloaded)
 await _safe_install([str(root) for root in _safe_roots])
 _safe_managed = _SafeNames(_safe_requested_names)
 if no_deps:
  _safe_validate(_safe_roots)
  _safe_roots.close()
  _safe_constraints.close()
  _safe_extras.close()
  _safe_requested_names.close()
  return _safe_managed
 _safe_previous_pending = _SafeResolutions()
 _safe_versions = None
 def dependencies(versions=None):
  for distribution in _safe_metadata.distributions():
   name = _safe_distribution_metadata(distribution)['Name']
   if not name or _safe_name(name) not in _safe_managed:
    del distribution
    continue
   name = _safe_name(name)
   if versions is not None:
    versions.put(name, distribution.version)
   contexts = {''} | set(_safe_extras.get(name, ()))
   from contextlib import closing
   with closing(_safe_distribution_requires(distribution)) as declared:
    for dependency in declared:
     requirement = _SafeRequirement(dependency)
     if requirement.marker and not any(requirement.marker.evaluate({'extra': extra}) for extra in contexts):
      continue
     requirement = constrain(requirement)
     requirement.marker = None
     yield requirement
   del distribution
 while True:
  while True:
   _safe_changed = False
   if _safe_versions is not None:_safe_versions.close()
   _safe_versions = _SafeValues()
   for _safe_requirement in dependencies(_safe_versions):
    _safe_dependency_name = _safe_name(_safe_requirement.name)
    if _safe_dependency_name not in _safe_managed:
     _safe_managed.add(_safe_dependency_name)
     _safe_changed = True
    _safe_selected = set(_safe_extras.get(_safe_dependency_name, ()))
    if not _safe_requirement.extras.issubset(_safe_selected):
     _safe_selected.update(_safe_requirement.extras)
     _safe_extras.put(_safe_dependency_name, sorted(_safe_selected))
     _safe_changed = True
   if not _safe_changed:
    break
  _safe_pending = _SafeNames()
  # Revisit the stable graph instead of retaining all dependency objects. Keep
  # the completed version snapshot so native duplicate-distribution ordering
  # remains last-wins even when a dependency precedes its final distribution.
  for _safe_requirement in dependencies():
   _safe_version = _safe_versions.get(_safe_name(_safe_requirement.name))
   if _safe_version is None or not _safe_requirement.specifier.contains(_safe_version, prereleases=True):
    _safe_pending.add(str(_safe_requirement))
  _safe_install_requirements = sorted(_safe_pending)
  _safe_pending.close()
  if not _safe_install_requirements:
   break
  if _safe_previous_pending.repeated(_safe_install_requirements):
   raise ValueError('Python package dependencies remain missing: ' + ', '.join(_safe_install_requirements))
  await _safe_install(_safe_install_requirements)
  del _safe_install_requirements
 _safe_validate(_safe_roots)
 _safe_versions.close()
 _safe_previous_pending.close()
 _safe_roots.close()
 _safe_constraints.close()
 _safe_extras.close()
 _safe_requested_names.close()
 return _safe_managed
def _safe_metadata_files(directory):
 import os
 from pathlib import Path
 if not isinstance(directory, Path):
  yield from directory.glob('*')
  return
 names = _SafeNames()
 try:
  try:scan = os.scandir(directory)
  except OSError:return
  failed = False
  try:
   while True:
    try:entry = next(scan)
    except StopIteration:break
    except OSError:
     failed = True
     break
    names.add(entry.name)
  finally:
   try:scan.close()
   except OSError:failed = True
  if not failed:
   for name in names:yield directory / name
 finally:names.close()
def _safe_distribution_files(distribution):
 from contextlib import ExitStack, closing
 from types import FunctionType
 from micropip._utils import get_root, get_dist_info, get_files_in_distribution
 # Custom metadata providers retain their public calling conventions.
 if type(distribution) is not _safe_metadata.PathDistribution or any(name in vars(distribution) for name in ('read_text', 'locate_file', '_read_files_distinfo', '_read_files_egginfo', '_read_files_egginfo_installed', '_read_files_egginfo_sources')):
  yield from get_files_in_distribution(distribution)
  return
 with ExitStack() as lifetime:
  def collect(values):
   files = _SafeValues()
   lifetime.callback(files.close)
   for value in values:files.put(str(len(files)), str(value))
   return (files.get(key) for key in files)
  view = _safe_metadata.PathDistribution(distribution._path)
  view.read_text = lambda filename: _safe_read_metadata_text(distribution, filename, lifetime)
  native = _safe_metadata.Distribution.files.fget
  # Reuse native CSV, hash, size, fallback and existence semantics unchanged;
  # only its final list allocation and metadata text storage are substituted.
  files = FunctionType(native.__code__, dict(native.__globals__, list=collect), native.__name__, native.__defaults__, native.__closure__)
  root = get_root(distribution)
  with closing(files(view) or (path for path in ())) as paths:
   for path in paths:yield (root / path).resolve()
  with closing(_safe_metadata_files(get_dist_info(distribution))) as paths:
   yield from paths
def _safe_walk_files(root):
 from contextlib import ExitStack
 import os
 with ExitStack() as lifetime:
  pending = _SafeValues()
  lifetime.callback(pending.close)
  pending.put('0', root)
  count = 1
  initial = True
  while count:
   count -= 1
   directory = pending.get(str(count))
   if initial:initial = False
   elif os.path.islink(directory):continue
   with ExitStack() as scan_storage:
    directories = _SafeValues()
    scan_storage.callback(directories.close)
    files = _SafeNames()
    scan_storage.callback(files.close)
    try:scan = os.scandir(directory)
    except OSError:continue
    failed = False
    with scan:
     while True:
      try:entry = next(scan)
      except StopIteration:break
      except OSError:
       failed = True
       break
      try:is_directory = entry.is_dir()
      except OSError:is_directory = False
      if is_directory:directories.put(str(len(directories)), entry.name)
      else:files.add(entry.name)
    if failed:continue
    for name in files:yield os.path.join(directory, name)
    for ordinal in range(len(directories)-1, -1, -1):
     path = os.path.join(directory, directories.get(str(ordinal)))
     pending.put(str(count), path)
     count += 1
def _safe_removal_listing(_safe_dist):
 from contextlib import ExitStack, closing
 import os
 with ExitStack() as storage:
  def names(values=()):
   result = _SafeNames()
   storage.callback(result.close)
   for value in values:result.add(value)
   return result
  def compact(paths):
   result, prefixes = names(), names()
   with closing(paths.ordered(key=len)) as ordered:
    for path in ordered:
     if not any(path[:offset+1] in prefixes for offset, character in enumerate(path) if character == '/'):
      result.add(path)
      prefixes.add(path.rstrip('*').rstrip('/') + '/')
   return result
  files = names(str(path) for path in _safe_distribution_files(_safe_dist) if not str(path).endswith('.pyc'))
  folders = compact(names(os.path.dirname(path) for path in files if path.endswith('__init__.py') or '.dist-info' in path))
  skipped = names()
  for folder in folders:
   with closing(_safe_walk_files(folder)) as discovered:
    for path in discovered:
     if not path.endswith('.pyc') and os.path.isfile(path) and path not in files:skipped.add(path)
  listing = names(files)
  for folder in folders:listing.add(os.path.join(folder, '*'))
  for paths in (listing, skipped):
   with closing(compact(paths).ordered()) as ordered:yield ordered
_safe_uninstall = _safe_json.loads(_safe_package_uninstall_json)
from collections.abc import Mapping as _SafeMapping
class _SafeRecords(_SafeMapping):
 def __init__(self, count):self.count = count
 @staticmethod
 def chunks(operation, key, field=None):
  from pyodide.ffi import run_sync
  offset = 0
  while True:
   chunk = run_sync(_safe_package_record(operation, key, offset, *([] if field is None else [field])))
   if not chunk:
    if chunk is False:yield NotImplemented
    return
   yield chunk
   offset += len(chunk.encode('utf-16-le')) // 2
 @classmethod
 def decode(cls, operation, key, name_only=False, field=None):
  chunks = []
  for chunk in cls.chunks(operation, key, field):
   if chunk is NotImplemented:return NotImplemented
   chunks.append(chunk)
   if name_only:
    prefix = ''.join(chunks).lstrip()
    if not prefix:
     chunks.clear();continue
    if not prefix.startswith('['):raise ValueError('Invalid Python package metadata snapshot')
    try:return _safe_json.JSONDecoder().raw_decode(prefix[1:].lstrip())[0]
    except _safe_json.JSONDecodeError:pass
  if name_only:raise ValueError('Invalid Python package metadata snapshot')
  record = _safe_json.loads(''.join(chunks))
  return record if operation == 'field' or record is None or len(record) == 6 else record + [None]
 @classmethod
 async def prepare(cls):
  count = await _safe_package_record('start')
  for ordinal in range(max(count, 0)):
   name = cls.decode('read', ordinal, True)
   if _SafeRequirement(name).name != name or _safe_name(name) != name or await _safe_package_record('has', name):
    raise ValueError('Invalid Python package metadata snapshot')
   await _safe_package_record('add', name, ordinal)
  await _safe_package_record('seal')
  return cls(max(count, 0)), count >= 0
 def __len__(self):return self.count
 def __contains__(self, name):
  from pyodide.ffi import run_sync
  return run_sync(_safe_package_record('has', name))
 def __getitem__(self, name):
  record = self.decode('get', name)
  if record is None:raise KeyError(name)
  return record
 def items(self):
  for ordinal in range(self.count):
   record = self.decode('read', ordinal)
   yield record[0], record
 def __iter__(self):
  for ordinal in range(self.count):yield self.decode('read', ordinal, True)
 def field(self, name, index):
  value = self.decode('field', name, field=index)
  if value is not NotImplemented:return value
  record = self.get(name)
  return record[index] if record is not None else None
 def paths(self, name, field):
  decoder = _safe_json.JSONDecoder()
  buffer, state = '', 'start'
  failure = 'Invalid Python package removal list'
  for chunk in self.chunks('field', name, field):
   if chunk is NotImplemented:
    if state != 'start':raise ValueError(failure)
    yield from self[name][field]
    return
   buffer += chunk
   while True:
    buffer = buffer.lstrip(' \t\r\n')
    if not buffer:break
    if state == 'end':raise ValueError(failure)
    if state == 'start':
     if buffer[0] != '[':raise ValueError(failure)
     buffer, state = buffer[1:], 'first'
     continue
    if buffer[0] == ']' and state in ('first', 'separator'):
     buffer, state = buffer[1:], 'end'
     continue
    if state == 'separator':
     if buffer[0] != ',':raise ValueError(failure)
     buffer, state = buffer[1:], 'value'
     continue
    if buffer[0] != '"':raise ValueError(failure)
    try:value, end = decoder.raw_decode(buffer)
    except _safe_json.JSONDecodeError:break
    buffer, state = buffer[end:], 'separator'
    yield value
  if state != 'end':raise ValueError(failure)
 def origin(self, name):return self.field(name, 5)
_safe_record_by_name, _safe_records_present = await _SafeRecords.prepare()
_safe_metadata_only = _safe_uninstall is not None and _safe_records_present
_safe_snapshot_root = None
def _safe_snapshot_path(name):
 if _safe_snapshot_root is None or name in _safe_preloaded or name not in _safe_record_by_name:
  return None
 return str(_safe_snapshot_root / (name.replace('-', '_') + '-snapshot.dist-info'))
if _safe_metadata_only:
 from pathlib import Path as _SafePath
 import sysconfig as _safe_sysconfig
 _safe_snapshot_root = _SafePath(_safe_sysconfig.get_path('purelib')).resolve()
 for _safe_record_name in _safe_record_by_name:
  if _safe_record_name in _safe_preloaded:
   continue
  _safe_path = _safe_snapshot_root / (_safe_record_name.replace('-', '_') + '-snapshot.dist-info')
  _safe_path.mkdir()
  (_safe_path / 'METADATA').write_text(_safe_record_by_name.field(_safe_record_name, 1))
  (_safe_path / 'PYODIDE_URL').write_text(_safe_record_by_name.field(_safe_record_name, 2))
  (_safe_path / 'RECORD').write_text('')
  _safe_origin = _safe_record_by_name.origin(_safe_record_name)
  if _safe_origin is not None: (_safe_path / 'direct_url.json').write_text(_safe_origin)
  _safe_dist = _safe_metadata.Distribution.at(_safe_path)
  if _safe_name(_safe_distribution_metadata(_safe_dist)['Name']) != _safe_record_name:
   raise ValueError('Python package metadata name conflict: ' + _safe_record_name)
  _SafeRequirement(_safe_record_name + '==' + _safe_dist.version)
 _safe_metadata.MetadataPathFinder.invalidate_caches()
_safe_restoring = True
_safe_restore = _safe_json.loads(_safe_package_restore_json)
_safe_restored_roots = await _safe_parse_sources(_safe_restore, not _safe_metadata_only)
if _safe_package_legacy:
 _safe_restored_names = await _safe_resolve(_safe_restored_roots)
else:
 if not _safe_metadata_only:
  await _safe_manager.install(_safe_restore, deps=False)
 _safe_validate(_safe_restored_roots)
 _safe_restored_names = _SafeNames(_safe_name(root.name) for root in _safe_restored_roots if not root.marker or root.marker.evaluate({'extra': ''}))
if _safe_metadata_only and (len(_safe_record_by_name) != len(_safe_restored_names) or any(name not in _safe_record_by_name for name in _safe_restored_names)):
 raise ValueError('Python package metadata snapshot does not match installed requirements')
_safe_restored_roots.close()
_safe_restoring = False
_safe_roots = await _safe_parse_sources(_safe_json.loads(_safe_package_requirements_json), not _safe_metadata_only)
if _safe_metadata_only:
 for _safe_root_index, _safe_root in enumerate(_safe_roots):
  if _safe_root.url and _safe_snapshot_path(_safe_name(_safe_root.name)) is not None:
   _safe_wheel = _SafeWheelInfo.from_url(_safe_root.url)
   if _safe_name(_safe_wheel.name) == _safe_name(_safe_root.name) and str(_safe_wheel.version) == _safe_metadata.version(_safe_root.name):
    _safe_root.url = None
    _safe_root.specifier = _SafeRequirement(_safe_root.name + '==' + str(_safe_wheel.version)).specifier
    _safe_roots.put(str(_safe_root_index), str(_safe_root))
_safe_managed = await _safe_resolve(_safe_roots, _safe_package_upgrade, _safe_package_forceReinstall, _safe_json.loads(_safe_package_constraints_json), _safe_package_noDeps)
_safe_roots.close()
_safe_removed = _SafeValues() if _safe_uninstall else None
async def _safe_publish_uninstalled():
 try:
  for key in _safe_removed:
   await _safe_package_emit('stdout', '  Successfully uninstalled ' + _safe_removed.get(key) + '\n')
 finally:
  _safe_removed.close()
if _safe_uninstall:
 _safe_targets = _SafeNames(_safe_name(_SafeRequirement(source).name) for source in _safe_uninstall['packages'])
 _safe_versions = _SafeValues()
 try:
  for _safe_dist in _safe_metadata.distributions():
   if _safe_distribution_metadata(_safe_dist)['Name'] and _safe_name(_safe_distribution_metadata(_safe_dist)['Name']) in _safe_targets:
    _safe_versions.put(_safe_name(_safe_distribution_metadata(_safe_dist)['Name']), _safe_dist.version)
  for _safe_target in _safe_targets:
   if _safe_target in _safe_preloaded or _safe_target in _safe_managed:
    raise ValueError('Cannot uninstall host-required Python package: ' + _safe_target)
  for _safe_target in _safe_targets:
   if _safe_target not in _safe_versions:
    await _safe_package_emit('stderr', 'WARNING: Skipping ' + _safe_target + ' as it is not installed.\n')
    continue
   _safe_dist = _safe_metadata.distribution(_safe_target)
   _safe_version = _safe_dist.version
   await _safe_package_emit('stdout', 'Found existing installation: ' + _safe_target + ' ' + _safe_version + '\nUninstalling ' + _safe_target + '-' + _safe_version + ':\n')
   if not _safe_uninstall['yes']:
    _safe_lists = (_safe_record_by_name.paths(_safe_target, field) for field in (3,4)) if _safe_snapshot_path(_safe_target) == str(_safe_dist._path) else _safe_removal_listing(_safe_dist)
    try:
     for _safe_heading, _safe_paths in zip(['Would remove:', 'Would not remove (might be manually added):'], _safe_lists):
      _safe_first_path = True
      for _safe_path in _safe_paths:
       if _safe_first_path:
        await _safe_package_emit('stdout', '  ' + _safe_heading + '\n')
        _safe_first_path = False
       await _safe_package_emit('stdout', '    ' + _safe_path + '\n')
    finally:_safe_lists.close()
    while True:
     await _safe_package_emit('stdout', 'Proceed (Y/n)? ')
     _safe_answer = (await _safe_package_line()).strip().lower()
     if _safe_answer in ('y', 'n', ''):
      break
     await _safe_package_emit('stdout', 'Your response (' + repr(_safe_answer) + ') was not one of the expected responses: y, n, \n')
    if _safe_answer == 'n':
     continue
   import logging as _safe_logging
   _safe_logger = _safe_logging.getLogger('micropip')
   _safe_disabled = _safe_logger.disabled
   try:
    _safe_logger.disabled = True
    _safe_manager.uninstall([_safe_target])
   finally:
    _safe_logger.disabled = _safe_disabled
   _safe_metadata.MetadataPathFinder.invalidate_caches()
   try:
    _safe_metadata.distribution(_safe_target)
   except _safe_metadata.PackageNotFoundError:
    pass
   else:
    raise ValueError('Python package removal did not complete: ' + _safe_target)
   _safe_restored_names.discard(_safe_target)
   _safe_removed.put(str(len(_safe_removed)), _safe_target + '-' + _safe_version)
 finally:
  _safe_versions.close()
  _safe_targets.close()
_safe_managed.update(_safe_restored_names)
_safe_sources = _SafeValues()
_safe_versions = _SafeValues()
from contextlib import nullcontext as _safe_nullcontext
with (open(_safe_package_publication, 'x', encoding='utf-8') if _safe_package_publication else _safe_nullcontext()) as _safe_output:
 if _safe_output:_safe_output.write('{"version":3,"records":[')
 _safe_rows = 0
 def _safe_write_json_string(parts):
  _safe_output.write('"')
  for part in parts:
   for offset in range(0, len(part), 4096):
    _safe_output.write(_safe_json.dumps(part[offset:offset+4096])[1:-1])
  _safe_output.write('"')
 for _safe_dist in _safe_metadata.distributions():
  _safe_dist_name = _safe_distribution_metadata(_safe_dist)['Name']
  if not _safe_dist_name:
   continue
  _safe_dist_name = _safe_name(_safe_dist_name)
  if _safe_dist_name in _safe_managed:
   _safe_versions.put(_safe_dist_name, _safe_dist.version)
   _safe_origin = _safe_dist.read_text('PYODIDE_URL')
   if _safe_origin:
    _safe_sources.put(str(len(_safe_sources)), _safe_dist_name + ' @ ' + _safe_origin.strip())
   if _safe_snapshot_path(_safe_dist_name) == str(_safe_dist._path):
    if _safe_output:
     if _safe_rows:_safe_output.write(',')
     for _safe_chunk in _safe_record_by_name.chunks('get', _safe_dist_name):_safe_output.write(_safe_chunk)
     _safe_rows += 1
    else:await _safe_package_record('append', _safe_json.dumps(_safe_record_by_name[_safe_dist_name]))
   else:
    _safe_headers = _safe_distribution_metadata(_safe_dist)
    def _safe_metadata_parts():
     for key in ['Metadata-Version', 'Name', 'Version', 'Requires-Python', 'Requires-Dist', 'Provides-Extra']:
      for value in _safe_header_values(_safe_headers, key):
       yield key
       yield ': '
       yield value
       yield '\n'
    _safe_lists = _safe_removal_listing(_safe_dist)
    try:
     if _safe_output:
      if _safe_rows:_safe_output.write(',')
      _safe_output.write('[')
      for _safe_parts in ((_safe_dist_name,), _safe_metadata_parts(), ((_safe_origin or '').strip(),)):
       _safe_write_json_string(_safe_parts)
       _safe_output.write(',')
      for _safe_paths in _safe_lists:
       _safe_output.write('[')
       _safe_first = True
       for _safe_path in _safe_paths:
        if not _safe_first:_safe_output.write(',')
        _safe_write_json_string((_safe_path,))
        _safe_first = False
       _safe_output.write('],')
      _safe_direct_url = _safe_dist.read_text('direct_url.json')
      if _safe_direct_url is None:_safe_output.write('null')
      else:_safe_write_json_string((_safe_direct_url,))
      _safe_output.write(']')
      _safe_rows += 1
     else:
      _safe_row = [_safe_dist_name, ''.join(_safe_metadata_parts()), (_safe_origin or '').strip()]
      _safe_row.extend(list(paths) for paths in _safe_lists)
      _safe_row.append(_safe_dist.read_text('direct_url.json'))
      await _safe_package_record('append', _safe_json.dumps(_safe_row))
      del _safe_row
    finally:_safe_lists.close()
 def _safe_inventory():
  for key in _safe_sources:yield _safe_sources.get(key)
  for name in _safe_versions.ordered():
   if name in _safe_managed:yield name + '==' + _safe_versions.get(name)
 if _safe_output:_safe_output.write('],"installed":[')
 _safe_seen = _SafeNames() if _safe_output else None
 try:
  for _safe_source in _safe_inventory():
   if _safe_output:
    if _safe_source in _safe_seen:continue
    if _safe_seen:_safe_output.write(',')
    _safe_seen.add(_safe_source)
    _safe_write_json_string((_safe_source,))
   else:await _safe_package_record('pin', _safe_json.dumps(_safe_source))
  if _safe_output:_safe_output.write(']}')
 finally:
  if _safe_seen is not None:_safe_seen.close()
  _safe_sources.close()
  _safe_versions.close()
_safe_managed.close()
_safe_restored_names.close()
_safe_metadata.MetadataPathFinder.invalidate_caches()
import gc as _safe_gc
_safe_gc.collect()
