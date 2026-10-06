import { pythonNativeWheel } from './native-wheel.js';
import type { PythonWorkerRuntime } from './worker.js';
import type { PythonPackageStart } from './provisioning.js';

interface NativePackage { normalizedName:string;channel:string;packageData?:NativePackageData }
interface NativePackageData {file_name:string;sha256:string;install_dir?:string}
interface PackageSource {url:string;expected?:string}
interface WheelReceipt {token:string;key:string;size:number}

interface InstallerRuntime extends PythonWorkerRuntime {
 readonly _api: {
  readonly lockfile_packages: Record<string,NativePackageData>;
  loadDynlib(path:string):Promise<unknown>;
  readonly packageManager: {
   readonly defaultChannel:string;
   downloadPackage(metadata:NativePackage):Promise<PackageSource>;
   installPackage(metadata:NativePackage,source:PackageSource|Uint8Array):Promise<unknown>;
  };
 };
 loadPackage(names:string[], options:{messageCallback:(message:string)=>void;errorCallback:(message:string)=>void}):Promise<unknown>;
 runPythonAsync(source:string):Promise<unknown>;
}

/** Pinned installer ABI; all package transport is serviced by the host, before user execution. */
export async function installPythonPackages(
 supplied: PythonWorkerRuntime,
 start: PythonPackageStart,
 request:(operation:string,...args:any[])=>any,
 maxTransferBytes:number,
):Promise<void> {
 if(!start.requirements.length&&!start.uninstall&&!start.bootstrap)return;
 const runtime=supplied as InstallerRuntime;
 if(runtime.version!=='314.0.6'||!runtime._api?.packageManager||!runtime._api.lockfile_packages||typeof runtime._api.packageManager.installPackage!=='function'||typeof runtime.loadPackage!=='function'||typeof runtime.runPythonAsync!=='function')throw new Error('Python package installer ABI requires Pyodide 314.0.6');
 let transportFailure:{error:unknown}|undefined;
 let accepting=true;
 let pending=Promise.resolve();
 let installing:Promise<unknown>=Promise.resolve();
 const manager=runtime._api.packageManager;

 // A host session owns one open artifact. Serialize entire transfers, including
 // closure, even when micropip or the native loader requests dependencies together.
 const transfer=<T>(consume:()=>Promise<T>):Promise<T>=>{
  if(!accepting)return Promise.reject(new Error('Python package transport is only available during installation'));
  const work=pending.then(async()=>{
   if(transportFailure)throw transportFailure.error;
   try{return await consume();}catch(error){transportFailure??={error};throw error;}
  });
  pending=work.then(()=>{},()=>{});
  return work;
 };
 const readArtifact=(operation:string,key:string,offset:number,length:number)=>{
  const failed=(error:unknown):never=>{transportFailure??={error};throw error;};
  try {
   const result=request(operation,start.session,key,offset,Math.min(length,maxTransferBytes,65536));
   // Keep the worker callback synchronous; JSPI awaits the asynchronous host.
   return result instanceof Promise?result.catch(failed):result;
  }catch(error){return failed(error);}
 };
 const withArtifact=<T>(url:string,expected:string|undefined,metadata:'metadata'|undefined,consume:(opened:{key:string;size:number;headers:readonly(readonly[string,string])[]},read:(offset:number,length:number)=>any)=>Promise<T>):Promise<T>=>transfer(async()=>{
  const opened=await request('package-open',start.session,url,expected,...metadata?[metadata]:[]) as {key:string;size:number;headers:readonly(readonly[string,string])[]};
  try{return await consume(opened,(offset,length)=>readArtifact('package-read',opened.key,offset,length));}
  finally{await request('package-close',start.session,opened.key);}
 });
 const wheel=async(size:number,read:(offset:number,length:number)=>any,configuration:Record<string,unknown>)=>{
  const globals=['_safe_native_wheel_read','_safe_native_wheel_config','_safe_extract_native_wheel'];
  try {
   runtime.globals.set(globals[0]!,read);
   runtime.globals.set(globals[1]!,JSON.stringify({...configuration,size}));
   const result=JSON.parse(await runtime.runPythonAsync(pythonNativeWheel) as string) as string|string[];
   if(Array.isArray(result))for(const path of result)await runtime._api.loadDynlib(path);
   return result;
  }finally{for(const name of globals)runtime.globals.delete(name);}
 };
 const fetch=(url:string,expected?:string,metadata?:'metadata')=>withArtifact(url,expected,metadata,async(opened,read)=>{
  const bytes=new Uint8Array(opened.size);
  for(let offset=0;offset<bytes.length;){
   const chunk=await read(offset,bytes.length-offset) as number[];
   if(!Array.isArray(chunk)||chunk.length===0||offset+chunk.length>bytes.length)throw new Error('Invalid Python package chunk');
   bytes.set(chunk,offset);offset+=chunk.length;
  }
  return {bytes,headers:opened.headers};
 });
 // Native dependency ordering retains source descriptors, not complete wheel buffers.
 // The pinned installer still owns extraction and dynamic linking. Serialize the
 // entire fetch/install lifetime so dependency downloads cannot accumulate payloads.
 manager.downloadPackage=async metadata=>{
  if(!accepting)throw new Error('Python package transport is only available during installation');
  if(metadata.channel===manager.defaultChannel){
   const pkg=runtime._api.lockfile_packages[metadata.normalizedName];
   if(!pkg)throw new Error(`Missing matching Pyodide package: ${metadata.normalizedName}`);
   return {url:new URL(pkg.file_name,'https://cdn.jsdelivr.net/pyodide/v314.0.6/full/').href,expected:pkg.sha256};
  }
  return {url:metadata.channel};
 };
 manager.installPackage=(metadata,source)=>{
  if(!accepting)return Promise.reject(new Error('Python package transport is only available during installation'));
  const work=installing.then(async()=>{
   if(source instanceof Uint8Array)throw new Error('Expected retained Python package source');
   const pkg=runtime._api.lockfile_packages[metadata.normalizedName]??metadata.packageData;
   if(!pkg)throw new Error(`Missing matching Pyodide package: ${metadata.normalizedName}`);
   return withArtifact(source.url,source.expected,undefined,(opened,read)=>wheel(opened.size,read,{filename:pkg.file_name,target:pkg.install_dir??null,
    metadata:{INSTALLER:'pyodide.loadPackage',PYODIDE_SOURCE:metadata.channel===manager.defaultChannel?'pyodide':metadata.channel}}));
  });
  installing=work.then(()=>{},()=>{});
  return work;
 };
 const loadPackages=async(names:string[])=>{
  const errors:string[]=[];
  await runtime.loadPackage(names,{messageCallback(){},errorCallback(message){errors.push(message);}});
  if(errors.length)throw new Error(errors.join('\n'));
 };
 const installedGlobals:string[]=[];
 const bind=(name:string,value:unknown)=>{runtime.globals.set(name,value);installedGlobals.push(name);};
 try {
  await loadPackages(['micropip']);
  bind('_safe_package_native',loadPackages);
  bind('_safe_package_bytes',async(url:string,hash?:string)=>(await fetch(url,hash)).bytes);
  bind('_safe_package_metadata',async(url:string)=>{
   const result=await fetch(url,undefined,'metadata');return JSON.stringify({text:new TextDecoder().decode(result.bytes),headers:Object.fromEntries(result.headers.map(([name,value])=>[name.toLowerCase(),value]))});
  });
  bind('_safe_package_wheel_download',async(url:string,expected:string|undefined)=>withArtifact(url,expected,undefined,async opened=>{
   return JSON.stringify(await request('package-retain',start.session,opened.key));
  }));
  bind('_safe_package_wheel_metadata',async(serialized:string)=>transfer(async()=>{
   const {source,name}=JSON.parse(serialized) as {source:WheelReceipt;name:string};
   return wheel(source.size,(offset,length)=>readArtifact('package-read-retained',source.token,offset,length),{metadata_name:name});
  }));
  bind('_safe_package_wheel_install',async(serialized:string)=>transfer(async()=>{
   const {source,...configuration}=JSON.parse(serialized) as {source:WheelReceipt;filename:string;extract_dir:string;metadata:Record<string,string>};
   await wheel(source.size,(offset,length)=>readArtifact('package-read-retained',source.token,offset,length),configuration);
  }));
  bind('_safe_package_requirements_json',JSON.stringify(start.requested ?? start.requirements));
  for(const key of ['pre','upgrade','forceReinstall','legacy'] as const){
   bind('_safe_package_'+key,!!start[key]);
  }
  bind('_safe_package_restore_json',JSON.stringify(start.restore ?? []));
  bind('_safe_package_records_json',JSON.stringify(start.records ?? null));
  bind('_safe_package_uninstall_json',JSON.stringify(start.uninstall ?? null));
  bind('_safe_package_emit',async(stream:string,message:string)=>{
   if(stream!=='stdout'&&stream!=='stderr')throw new Error('Invalid package output stream');
   const bytes=new TextEncoder().encode(message);
   for(let offset=0;offset<bytes.length;offset+=maxTransferBytes)await request(stream,Array.from(bytes.subarray(offset,offset+maxTransferBytes)));
  });
  bind('_safe_package_line',async()=>{
   const bytes:number[]=[];
   while(true){
    const chunk=await request('stdin',1) as number[];
    if(!chunk.length){if(!bytes.length)throw new Error('EOF when reading package confirmation');break;}
    if(chunk[0]===10)break;
    bytes.push(chunk[0]!);
   }
   return new TextDecoder().decode(Uint8Array.from(bytes));
  });
  // The pinned installer owns candidate selection, dependency traversal and wheel
  // extraction. Its scoped transaction adapter changes only installed satisfaction:
  // upgrade targets roots; force-reinstall targets the selected dependency graph.
  // Preloaded/transaction-locked versions stay protected, and the original class
  // is restored before guest execution, including when resolution fails.
  // Validate exact restoration before replacement and requested pins afterward.
  // Preserve wheel origins, extra contexts and unrelated installed distributions;
  // publish the resulting inventory only after successful resolution/removal.
  // Native metadata discovery holds bootstrap ZIPs; invalidate and collect them
  // before relocation and canonical filesystem syscall admission.
  await runtime.runPythonAsync(`
import json as _safe_json
import importlib.metadata as _safe_metadata
_safe_preloaded = [d.metadata['Name'] for d in _safe_metadata.distributions() if d.metadata['Name']]
from micropip._compat import compatibility_layer as _safe_compat
from micropip.package_manager import PackageManager as _SafePackageManager
from micropip.wheelinfo import WheelInfo as _SafeWheelInfo
from micropip._utils import check_compatible as _safe_check_compatible
from micropip._vendored.packaging.src.packaging.requirements import Requirement as _SafeRequirement, InvalidRequirement as _SafeInvalidRequirement
from micropip._vendored.packaging.src.packaging.utils import canonicalize_name as _safe_name

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
 metadata = {'PYODIDE_SOURCE': source, 'PYODIDE_URL': self.url, 'PYODIDE_SHA256': self._data['key'], 'INSTALLER': 'micropip'}
 if self._requires:
  metadata['PYODIDE_REQUIRES'] = _safe_json.dumps(sorted(x.name for x in self._requires))
 await _safe_package_wheel_install(_safe_json.dumps({'source': self._data, 'filename': self.filename, 'extract_dir': str(target), 'metadata': metadata}))
 setattr(compat_layer.loadedPackages, self._project_name, source)
_SafeWheelInfo.download = _safe_wheel_download
_SafeWheelInfo.install = _safe_wheel_install
_safe_preloaded = {_safe_name(name) for name in _safe_preloaded}
_safe_manager = _SafePackageManager(_SafePackageCompatibility)
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
async def _safe_resolve(_safe_roots, upgrade=False, force=False):
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
   await _safe_manager.install(requirements, deps=True, pre=_safe_package_pre, reinstall=True)
  finally:
   _safe_pm.Transaction = _SafeTransaction
 _safe_validate([root for root in _safe_roots if _safe_name(root.name) in _safe_preloaded])
 await _safe_install([str(root) for root in _safe_roots])
 _safe_managed = set(_safe_requested_names)
 _safe_previous_pending = set()
 while True:
  _safe_distributions = [d for d in _safe_metadata.distributions() if d.metadata['Name']]
  _safe_versions = {_safe_name(d.metadata['Name']): d.version for d in _safe_distributions}
  while True:
   _safe_changed = False
   _safe_dependencies = []
   for _safe_dist in _safe_distributions:
    if _safe_name(_safe_dist.metadata['Name']) not in _safe_managed:
     continue
    _safe_contexts = {''} | _safe_extras.get(_safe_name(_safe_dist.metadata['Name']), set())
    for _safe_dep in _safe_dist.requires or []:
     _safe_requirement = _SafeRequirement(_safe_dep)
     if _safe_requirement.marker and not any(_safe_requirement.marker.evaluate({'extra': extra}) for extra in _safe_contexts):
      continue
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
_safe_records = _safe_json.loads(_safe_package_records_json)
_safe_metadata_only = _safe_uninstall is not None and _safe_records is not None
_safe_record_by_name = {}
_safe_snapshot_paths = {}
if _safe_records is not None:
 for _safe_record in _safe_records:
  _safe_record_name = _safe_record[0]
  if _SafeRequirement(_safe_record_name).name != _safe_record_name or _safe_name(_safe_record_name) != _safe_record_name or _safe_record_name in _safe_record_by_name:
   raise ValueError('Invalid Python package metadata snapshot')
  _safe_record_by_name[_safe_record_name] = _safe_record
if _safe_metadata_only:
 from pathlib import Path as _SafePath
 import sysconfig as _safe_sysconfig
 for _safe_record_name, _safe_record in _safe_record_by_name.items():
  if _safe_record_name in _safe_preloaded:
   continue
  _safe_path = (_SafePath(_safe_sysconfig.get_path('purelib')) / (_safe_record_name.replace('-', '_') + '-snapshot.dist-info')).resolve()
  _safe_path.mkdir()
  (_safe_path / 'METADATA').write_text(_safe_record[1])
  (_safe_path / 'PYODIDE_URL').write_text(_safe_record[2])
  (_safe_path / 'RECORD').write_text('')
  _safe_dist = _safe_metadata.Distribution.at(_safe_path)
  if _safe_name(_safe_dist.metadata['Name']) != _safe_record_name:
   raise ValueError('Python package metadata name conflict: ' + _safe_record_name)
  _SafeRequirement(_safe_record_name + '==' + _safe_dist.version)
  _safe_snapshot_paths[_safe_record_name] = str(_safe_path)
 _safe_metadata.MetadataPathFinder.invalidate_caches()
_safe_restore = _safe_json.loads(_safe_package_restore_json)
_safe_restored_roots = await _safe_parse_sources(_safe_restore, not _safe_metadata_only)
if _safe_package_legacy:
 _safe_restored_names = await _safe_resolve(_safe_restored_roots)
else:
 if not _safe_metadata_only:
  await _safe_manager.install(_safe_restore, deps=False)
 _safe_validate(_safe_restored_roots)
 _safe_restored_names = {_safe_name(root.name) for root in _safe_restored_roots if not root.marker or root.marker.evaluate({'extra': ''})}
if _safe_metadata_only and set(_safe_record_by_name) != _safe_restored_names:
 raise ValueError('Python package metadata snapshot does not match installed requirements')
_safe_roots = await _safe_parse_sources(_safe_json.loads(_safe_package_requirements_json), not _safe_metadata_only)
if _safe_metadata_only:
 for _safe_root in _safe_roots:
  if _safe_root.url and _safe_name(_safe_root.name) in _safe_snapshot_paths:
   _safe_wheel = _SafeWheelInfo.from_url(_safe_root.url)
   if _safe_name(_safe_wheel.name) == _safe_name(_safe_root.name) and str(_safe_wheel.version) == _safe_metadata.version(_safe_root.name):
    _safe_root.url = None
    _safe_root.specifier = _SafeRequirement(_safe_root.name + '==' + str(_safe_wheel.version)).specifier
_safe_managed = await _safe_resolve(_safe_roots, _safe_package_upgrade, _safe_package_forceReinstall)
_safe_distributions = [d for d in _safe_metadata.distributions() if d.metadata['Name']]
_safe_versions = {_safe_name(d.metadata['Name']): d.version for d in _safe_distributions}
_safe_removed = []
if _safe_uninstall:
 _safe_targets = list(dict.fromkeys(_safe_name(_SafeRequirement(source).name) for source in _safe_uninstall['packages']))
 for _safe_target in _safe_targets:
  if _safe_target in _safe_preloaded or _safe_target in _safe_managed:
   raise ValueError('Cannot uninstall host-required Python package: ' + _safe_target)
 for _safe_target in _safe_targets:
  if _safe_target not in _safe_versions:
   await _safe_package_emit('stderr', 'WARNING: Skipping ' + _safe_target + ' as it is not installed.\\n')
   continue
  _safe_dist = _safe_metadata.distribution(_safe_target)
  _safe_version = _safe_dist.version
  await _safe_package_emit('stdout', 'Found existing installation: ' + _safe_target + ' ' + _safe_version + '\\nUninstalling ' + _safe_target + '-' + _safe_version + ':\\n')
  if not _safe_uninstall['yes']:
   _safe_record = _safe_record_by_name.get(_safe_target)
   _safe_lists = _safe_record[3:] if _safe_snapshot_paths.get(_safe_target) == str(_safe_dist._path) else _safe_removal_listing(_safe_dist)
   for _safe_heading, _safe_paths in zip(['Would remove:', 'Would not remove (might be manually added):'], _safe_lists):
    if _safe_paths:
     await _safe_package_emit('stdout', '  ' + _safe_heading + '\\n')
     for _safe_path in _safe_paths:
      await _safe_package_emit('stdout', '    ' + _safe_path + '\\n')
   while True:
    await _safe_package_emit('stdout', 'Proceed (Y/n)? ')
    _safe_answer = (await _safe_package_line()).strip().lower()
    if _safe_answer in ('y', 'n', ''):
     break
    await _safe_package_emit('stdout', 'Your response (' + repr(_safe_answer) + ') was not one of the expected responses: y, n, \\n')
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
 _safe_distributions = [d for d in _safe_metadata.distributions() if d.metadata['Name']]
 _safe_versions = {_safe_name(d.metadata['Name']): d.version for d in _safe_distributions}
_safe_uninstalled_json = _safe_json.dumps(_safe_removed)
_safe_managed.update(_safe_restored_names)
_safe_sources = []
_safe_final_records = []
for _safe_dist in _safe_distributions:
 _safe_dist_name = _safe_name(_safe_dist.metadata['Name'])
 if _safe_dist_name in _safe_managed:
  _safe_origin = _safe_dist.read_text('PYODIDE_URL')
  if _safe_origin:
   _safe_sources.append(_safe_dist_name + ' @ ' + _safe_origin.strip())
  if _safe_snapshot_paths.get(_safe_dist_name) == str(_safe_dist._path):
   _safe_final_records.append(_safe_record_by_name[_safe_dist_name])
  else:
   _safe_headers = _safe_dist.metadata
   _safe_metadata_text = ''.join(key + ': ' + value + '\\n' for key in ['Metadata-Version', 'Name', 'Version', 'Requires-Python', 'Requires-Dist', 'Provides-Extra'] for value in _safe_headers.get_all(key, []))
   _safe_final_records.append([_safe_dist_name, _safe_metadata_text, (_safe_origin or '').strip(), *_safe_removal_listing(_safe_dist)])
_safe_installed_json = _safe_json.dumps(_safe_sources + [name + '==' + version for name, version in sorted(_safe_versions.items()) if name in _safe_managed])
_safe_records_json = _safe_json.dumps(_safe_final_records)
_safe_metadata.MetadataPathFinder.invalidate_caches()
import gc as _safe_gc
_safe_gc.collect()
`);
  await installing;
  accepting=false;
  await pending;
  if(transportFailure)throw transportFailure.error;
  const pinned=JSON.parse(runtime.runPython('_safe_installed_json')) as string[];
  await request('package-commit',start.session,start.restore === undefined ? pinned : {version:2,installed:pinned,records:JSON.parse(runtime.runPython('_safe_records_json'))});
  if(start.uninstall){
   const removed=JSON.parse(runtime.runPython('_safe_uninstalled_json')) as string[];
   for(const name of removed){
    const bytes=new TextEncoder().encode('  Successfully uninstalled '+name+'\n');
    for(let offset=0;offset<bytes.length;offset+=maxTransferBytes)await request('stdout',Array.from(bytes.subarray(offset,offset+maxTransferBytes)));
   }
  }
 }catch(error){
  await installing;
  accepting=false;
  await pending;
  throw transportFailure ? transportFailure.error : error;
 }finally{
  await installing;
  accepting=false;
  await pending;
  manager.downloadPackage=manager.installPackage=async()=>{throw new Error('Python package transport is only available during installation');};
  // These bridge callbacks are not an application Python networking capability.
  for(const name of installedGlobals)runtime.globals.delete(name);
 }
}
