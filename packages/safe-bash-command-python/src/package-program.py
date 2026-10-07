
import json as _safe_json
_safe_restoring = False
import importlib.metadata as _safe_metadata
from micropip._vendored.packaging.src.packaging.utils import canonicalize_name as _safe_name
class _SafePreloaded:
 @classmethod
 async def snapshot(cls):
  await _safe_package_preloaded('start')
  for distribution in _safe_metadata.distributions():
   name = distribution.metadata['Name']
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
 roots = []
 for source in sources:
  try:
   root = _SafeRequirement(source)
   if root.name.endswith('.whl'):
    raise _SafeInvalidRequirement(source)
  except _SafeInvalidRequirement:
   wheel = _SafeWheelInfo.from_url(source)
   root = _SafeRequirement(wheel.name + ' @ ' + source)
  roots.append(root)
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
async def _safe_resolve(_safe_roots, upgrade=False, force=False, constraints=(), no_deps=False):
 _safe_constraints = {}
 for source in constraints:
  constraint = _SafeRequirement(source)
  if constraint.extras:
   raise ValueError('Constraints cannot have extras')
  if not constraint.marker or constraint.marker.evaluate({'extra': ''}):
   _safe_constraints.setdefault(_safe_name(constraint.name), []).append(constraint)
 def constrain(requirement):
  for constraint in _safe_constraints.get(_safe_name(requirement.name), ()):
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
 _safe_roots = [constrain(root) for root in _safe_roots if not root.marker or root.marker.evaluate({'extra': ''})]
 _safe_extras = {}
 for _safe_root in _safe_roots:
  if not _safe_root.marker or _safe_root.marker.evaluate({'extra': ''}):
   _safe_extras.setdefault(_safe_name(_safe_root.name), set()).update(_safe_root.extras)
 for _safe_root in _safe_roots:
  _safe_root.extras.update(_safe_extras.get(_safe_name(_safe_root.name), set()))
 _safe_requested_names = set(_safe_extras)
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
 _safe_validate([root for root in _safe_roots if _safe_name(root.name) in _safe_preloaded])
 await _safe_install([str(root) for root in _safe_roots])
 _safe_managed = set(_safe_requested_names)
 if no_deps:
  _safe_validate(_safe_roots)
  return _safe_managed
 _safe_previous_pending = set()
 while True:
  while True:
   _safe_changed = False
   _safe_dependencies = []
   _safe_versions = {}
   for _safe_dist in _safe_metadata.distributions():
    _safe_dist_name = _safe_dist.metadata['Name']
    if not _safe_dist_name:
     continue
    _safe_dist_name = _safe_name(_safe_dist_name)
    if _safe_dist_name not in _safe_managed:
     continue
    _safe_versions[_safe_dist_name] = _safe_dist.version
    _safe_contexts = {''} | _safe_extras.get(_safe_dist_name, set())
    for _safe_dep in _safe_dist.requires or []:
     _safe_requirement = _SafeRequirement(_safe_dep)
     if _safe_requirement.marker and not any(_safe_requirement.marker.evaluate({'extra': extra}) for extra in _safe_contexts):
      continue
     _safe_requirement = constrain(_safe_requirement)
     _safe_requirement.marker = None
     _safe_dependencies.append(_safe_requirement)
     _safe_dependency_name = _safe_name(_safe_requirement.name)
     if _safe_dependency_name not in _safe_managed:
      _safe_managed.add(_safe_dependency_name)
      _safe_changed = True
     _safe_selected = _safe_extras.setdefault(_safe_name(_safe_requirement.name), set())
     if not _safe_requirement.extras.issubset(_safe_selected):
      _safe_selected.update(_safe_requirement.extras)
      _safe_changed = True
   if not _safe_changed:
    break
  _safe_pending = set()
  for _safe_requirement in _safe_dependencies:
   _safe_version = _safe_versions.get(_safe_name(_safe_requirement.name))
   if _safe_version is None or not _safe_requirement.specifier.contains(_safe_version, prereleases=True):
    _safe_pending.add(str(_safe_requirement))
  if not _safe_pending:
   break
  if frozenset(_safe_pending) in _safe_previous_pending:
   raise ValueError('Python package dependencies remain missing: ' + ', '.join(sorted(_safe_pending)))
  _safe_previous_pending.add(frozenset(_safe_pending))
  await _safe_install(sorted(_safe_pending))
 _safe_validate(_safe_roots)
 return _safe_managed
def _safe_removal_listing(_safe_dist):
 from micropip._utils import get_files_in_distribution as _safe_distribution_files
 import os as _safe_os
 def _safe_compact(paths):
  compact = []
  for path in sorted(paths, key=len):
   if not any(path.startswith(parent.rstrip('*').rstrip('/') + '/') for parent in compact):
    compact.append(path)
  return compact
 _safe_files = {str(path) for path in _safe_distribution_files(_safe_dist) if not str(path).endswith('.pyc')}
 _safe_folders = _safe_compact({_safe_os.path.dirname(path) for path in _safe_files if path.endswith('__init__.py') or '.dist-info' in path})
 _safe_skipped = set()
 for _safe_folder in _safe_folders:
  for _safe_dir, _, _safe_names in _safe_os.walk(_safe_folder):
   for _safe_name_ in _safe_names:
    _safe_path = _safe_os.path.join(_safe_dir, _safe_name_)
    if not _safe_name_.endswith('.pyc') and _safe_os.path.isfile(_safe_path) and _safe_path not in _safe_files:
     _safe_skipped.add(_safe_path)
 _safe_listing = set(_safe_files) | {_safe_os.path.join(folder, '*') for folder in _safe_folders}
 return [sorted(_safe_compact(_safe_listing)), sorted(_safe_compact(_safe_skipped))]
_safe_uninstall = _safe_json.loads(_safe_package_uninstall_json)
from collections.abc import Mapping as _SafeMapping
class _SafeRecords(_SafeMapping):
 def __init__(self, count):self.count = count
 @staticmethod
 def decode(payload):
  record = _safe_json.loads(payload)
  return record if record is None or len(record) == 6 else record + [None]
 @classmethod
 async def prepare(cls):
  count = await _safe_package_record('start')
  for ordinal in range(max(count, 0)):
   record = cls.decode(await _safe_package_record('read', ordinal))
   name = record[0]
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
  from pyodide.ffi import run_sync
  record = self.decode(run_sync(_safe_package_record('get', name)))
  if record is None:raise KeyError(name)
  return record
 def items(self):
  from pyodide.ffi import run_sync
  for ordinal in range(self.count):
   record = self.decode(run_sync(_safe_package_record('read', ordinal)))
   yield record[0], record
 def __iter__(self):
  for name, record in self.items():yield name
 def origin(self, name):
  record = self.get(name)
  return record[5] if record is not None else None
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
 for _safe_record_name, _safe_record in _safe_record_by_name.items():
  if _safe_record_name in _safe_preloaded:
   continue
  _safe_path = _safe_snapshot_root / (_safe_record_name.replace('-', '_') + '-snapshot.dist-info')
  _safe_path.mkdir()
  (_safe_path / 'METADATA').write_text(_safe_record[1])
  (_safe_path / 'PYODIDE_URL').write_text(_safe_record[2])
  (_safe_path / 'RECORD').write_text('')
  _safe_origin = _safe_record[5]
  if _safe_origin is not None: (_safe_path / 'direct_url.json').write_text(_safe_origin)
  _safe_dist = _safe_metadata.Distribution.at(_safe_path)
  if _safe_name(_safe_dist.metadata['Name']) != _safe_record_name:
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
 _safe_restored_names = {_safe_name(root.name) for root in _safe_restored_roots if not root.marker or root.marker.evaluate({'extra': ''})}
if _safe_metadata_only and (len(_safe_record_by_name) != len(_safe_restored_names) or any(name not in _safe_record_by_name for name in _safe_restored_names)):
 raise ValueError('Python package metadata snapshot does not match installed requirements')
_safe_restoring = False
_safe_roots = await _safe_parse_sources(_safe_json.loads(_safe_package_requirements_json), not _safe_metadata_only)
if _safe_metadata_only:
 for _safe_root in _safe_roots:
  if _safe_root.url and _safe_snapshot_path(_safe_name(_safe_root.name)) is not None:
   _safe_wheel = _SafeWheelInfo.from_url(_safe_root.url)
   if _safe_name(_safe_wheel.name) == _safe_name(_safe_root.name) and str(_safe_wheel.version) == _safe_metadata.version(_safe_root.name):
    _safe_root.url = None
    _safe_root.specifier = _SafeRequirement(_safe_root.name + '==' + str(_safe_wheel.version)).specifier
_safe_managed = await _safe_resolve(_safe_roots, _safe_package_upgrade, _safe_package_forceReinstall, _safe_json.loads(_safe_package_constraints_json), _safe_package_noDeps)
_safe_removed = []
if _safe_uninstall:
 _safe_targets = list(dict.fromkeys(_safe_name(_SafeRequirement(source).name) for source in _safe_uninstall['packages']))
 _safe_versions = {_safe_name(d.metadata['Name']): d.version for d in _safe_metadata.distributions() if d.metadata['Name'] and _safe_name(d.metadata['Name']) in _safe_targets}
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
   _safe_record = _safe_record_by_name.get(_safe_target)
   _safe_lists = _safe_record[3:5] if _safe_snapshot_path(_safe_target) == str(_safe_dist._path) else _safe_removal_listing(_safe_dist)
   for _safe_heading, _safe_paths in zip(['Would remove:', 'Would not remove (might be manually added):'], _safe_lists):
    if _safe_paths:
     await _safe_package_emit('stdout', '  ' + _safe_heading + '\n')
     for _safe_path in _safe_paths:
      await _safe_package_emit('stdout', '    ' + _safe_path + '\n')
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
  _safe_removed.append(_safe_target + '-' + _safe_version)
_safe_uninstalled_json = _safe_json.dumps(_safe_removed)
_safe_managed.update(_safe_restored_names)
_safe_sources = []
_safe_versions = {}
for _safe_dist in _safe_metadata.distributions():
 _safe_dist_name = _safe_dist.metadata['Name']
 if not _safe_dist_name:
  continue
 _safe_dist_name = _safe_name(_safe_dist_name)
 if _safe_dist_name in _safe_managed:
  _safe_versions[_safe_dist_name] = _safe_dist.version
  _safe_origin = _safe_dist.read_text('PYODIDE_URL')
  if _safe_origin:
   _safe_sources.append(_safe_dist_name + ' @ ' + _safe_origin.strip())
  if _safe_snapshot_path(_safe_dist_name) == str(_safe_dist._path):
   await _safe_package_record('append', _safe_json.dumps(_safe_record_by_name[_safe_dist_name]))
  else:
   _safe_headers = _safe_dist.metadata
   _safe_metadata_text = ''.join(key + ': ' + value + '\n' for key in ['Metadata-Version', 'Name', 'Version', 'Requires-Python', 'Requires-Dist', 'Provides-Extra'] for value in _safe_headers.get_all(key, []))
   await _safe_package_record('append', _safe_json.dumps([_safe_dist_name, _safe_metadata_text, (_safe_origin or '').strip(), *_safe_removal_listing(_safe_dist), _safe_dist.read_text('direct_url.json')]))
_safe_installed_json = _safe_json.dumps(_safe_sources + [name + '==' + version for name, version in sorted(_safe_versions.items()) if name in _safe_managed])
_safe_metadata.MetadataPathFinder.invalidate_caches()
import gc as _safe_gc
_safe_gc.collect()
