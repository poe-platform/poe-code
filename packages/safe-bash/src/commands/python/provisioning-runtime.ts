import type { PythonWorkerRuntime } from './worker.js';
import type { PythonPackageStart } from './provisioning.js';

interface InstallerRuntime extends PythonWorkerRuntime {
 readonly _api: {
  readonly lockfile_packages: Record<string,{file_name:string;sha256:string}>;
  readonly packageManager: {
   readonly defaultChannel:string;
   downloadPackage(metadata:{normalizedName:string;channel:string}):Promise<Uint8Array>;
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
 if(start.requirements.length===0)return;
 const runtime=supplied as InstallerRuntime;
 if(runtime.version!=='314.0.6'||!runtime._api?.packageManager||!runtime._api.lockfile_packages||typeof runtime.loadPackage!=='function'||typeof runtime.runPythonAsync!=='function')throw new Error('Python package installer ABI requires Pyodide 314.0.6');
 const fetch=(url:string,expected?:string):{bytes:Uint8Array;headers:readonly(readonly[string,string])[]}=>{
  const opened=request('package-open',start.session,url,expected) as {key:string;size:number;headers:readonly(readonly[string,string])[]};
  try {
  const bytes=new Uint8Array(opened.size);
  for(let offset=0;offset<bytes.length;){
   const chunk=request('package-read',start.session,opened.key,offset,Math.min(maxTransferBytes,65536,bytes.length-offset)) as number[];
   if(!Array.isArray(chunk)||chunk.length===0||offset+chunk.length>bytes.length)throw new Error('Invalid Python package chunk');
   bytes.set(chunk,offset);offset+=chunk.length;
  }
  return {bytes,headers:opened.headers};
  } finally {request('package-close',start.session,opened.key);}
 };
 // The pinned loader still owns dependency ordering, wheel extraction and dynamic linking.
 // Replacing only its download operation prevents implicit Node/CDN network fallbacks.
 runtime._api.packageManager.downloadPackage=async metadata=>{
  if(metadata.channel===runtime._api.packageManager.defaultChannel){
   const pkg=runtime._api.lockfile_packages[metadata.normalizedName];
   if(!pkg)throw new Error(`Missing matching Pyodide package: ${metadata.normalizedName}`);
   return fetch(new URL(pkg.file_name,'https://cdn.jsdelivr.net/pyodide/v314.0.6/full/').href,pkg.sha256).bytes;
  }
  return fetch(metadata.channel).bytes;
 };
 const loadPackages=async(names:string[])=>{
  const errors:string[]=[];
  await runtime.loadPackage(names,{messageCallback(){},errorCallback(message){errors.push(message);}});
  if(errors.length)throw new Error(errors.join('\n'));
 };
 const installedGlobals:string[]=[];
 try {
  await loadPackages(['micropip']);
  runtime.globals.set('_safe_package_native',loadPackages);
  installedGlobals.push('_safe_package_native');
  runtime.globals.set('_safe_package_bytes',(url:string,hash?:string)=>fetch(url,hash).bytes);
  installedGlobals.push('_safe_package_bytes');
  runtime.globals.set('_safe_package_metadata',(url:string)=>{
   const result=fetch(url);return JSON.stringify({text:new TextDecoder().decode(result.bytes),headers:Object.fromEntries(result.headers.map(([name,value])=>[name.toLowerCase(),value]))});
  });
  installedGlobals.push('_safe_package_metadata');
  runtime.globals.set('_safe_package_requirements_json',JSON.stringify(start.requirements));
  installedGlobals.push('_safe_package_requirements_json');
  await runtime.runPythonAsync(`
import json as _safe_json
import micropip as _safe_micropip
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
  return _safe_package_bytes(url).to_bytes()
 @staticmethod
 async def fetch_string_and_headers(url, kwargs):
  value = _safe_json.loads(_safe_package_metadata(url))
  return value['text'], value['headers']

# Require index/URL digests before publishing wheel bytes to the host cache.
# Local wheels are host-trusted inputs and receive a content digest on first read.
async def _safe_wheel_fetch(self, url, kwargs, compat):
 expected = self.sha256 if url == self.url else None
 if url == self.metadata_url and isinstance(self.core_metadata, dict):
  expected = self.core_metadata.get('sha256')
 return _safe_package_bytes(url, expected).to_bytes()
_SafeWheelInfo._fetch_bytes = _safe_wheel_fetch
_safe_manager = _SafePackageManager(_SafePackageCompatibility)
_safe_requirements = _safe_json.loads(_safe_package_requirements_json)
# A persisted base wheel may be visited before a newly requested extra. Micropip
# skips already locked names, so every occurrence must carry the requested extras.
_safe_roots = []
_safe_extras = {}
for _safe_source in _safe_requirements:
 try:
  _safe_root = _SafeRequirement(_safe_source)
  if _safe_root.name.endswith('.whl'):
   raise _SafeInvalidRequirement(_safe_source)
 except _SafeInvalidRequirement:
  _safe_wheel = _SafeWheelInfo.from_url(_safe_source)
  _safe_root = _SafeRequirement(_safe_wheel.name + ' @ ' + _safe_source)
 _safe_roots.append(_safe_root)
 if not _safe_root.marker or _safe_root.marker.evaluate({'extra': ''}):
  # Named requirements may be skipped when already locked. Validate direct
  # wheels even then, rather than letting an incompatible URL report success.
  if _safe_root.url:
   _safe_direct_wheel = _SafeWheelInfo.from_url(_safe_root.url)
   _safe_check_compatible(_safe_direct_wheel.filename)
   # Validate the actual archive and host-checked digest even if micropip's
   # satisfied-name fast path will skip installing this explicit operand.
   await _safe_direct_wheel.download({}, _SafePackageCompatibility)
  _safe_extras.setdefault(_safe_name(_safe_root.name), set()).update(_safe_root.extras)
for _safe_root in _safe_roots:
 _safe_root.extras.update(_safe_extras.get(_safe_name(_safe_root.name), set()))
await _safe_manager.install([str(root) for root in _safe_roots], deps=True)
# Resolve selected extras from distribution metadata, including extras added to
# an already satisfied transitive dependency. Micropip skips those names early.
# Keep its installer and conflict policy; do not infer dependencies from imports.
import importlib.metadata as _safe_metadata
_safe_previous_pending = None
while True:
 _safe_distributions = [d for d in _safe_metadata.distributions() if d.metadata['Name']]
 _safe_versions = {_safe_name(d.metadata['Name']): d.version for d in _safe_distributions}
 while True:
  _safe_changed = False
  _safe_dependencies = []
  for _safe_dist in _safe_distributions:
   _safe_contexts = {''} | _safe_extras.get(_safe_name(_safe_dist.metadata['Name']), set())
   for _safe_dep in _safe_dist.requires or []:
    _safe_requirement = _SafeRequirement(_safe_dep)
    if _safe_requirement.marker and not any(_safe_requirement.marker.evaluate({'extra': extra}) for extra in _safe_contexts):
     continue
    # The marker belongs to the requesting distribution's extra context, already
    # evaluated above; a separate installer transaction must not reinterpret it.
    _safe_requirement.marker = None
    _safe_dependencies.append(_safe_requirement)
    _safe_selected = _safe_extras.setdefault(_safe_name(_safe_requirement.name), set())
    if not _safe_requirement.extras.issubset(_safe_selected):
     _safe_selected.update(_safe_requirement.extras)
     _safe_changed = True
  if not _safe_changed:
   break
 _safe_pending = set()
 for _safe_requirement in _safe_dependencies:
  _safe_version = _safe_versions.get(_safe_name(_safe_requirement.name))
  if _safe_version is None:
   _safe_pending.add(str(_safe_requirement))
  elif not _safe_requirement.specifier.contains(_safe_version, prereleases=True):
   raise ValueError('Python package dependency conflict: ' + str(_safe_requirement))
 if not _safe_pending:
  break
 if _safe_pending == _safe_previous_pending:
  raise ValueError('Python package dependencies remain missing: ' + ', '.join(sorted(_safe_pending)))
 _safe_previous_pending = _safe_pending
 await _safe_manager.install(sorted(_safe_pending), deps=True)
# Explicit roots also constrain the result: direct URLs can bypass micropip's
# already-installed version check, including when another root pins that name.
for _safe_root in _safe_roots:
 if _safe_root.marker and not _safe_root.marker.evaluate({'extra': ''}):
  continue
 _safe_version = _safe_versions.get(_safe_name(_safe_root.name))
 if _safe_version is None or not _safe_root.specifier.contains(_safe_version, prereleases=True):
  raise ValueError('Python package version conflict: ' + str(_safe_root))
 if _safe_root.url:
  _safe_wheel = _SafeWheelInfo.from_url(_safe_root.url)
  _safe_wheel_pin = _SafeRequirement(_safe_wheel.name + '==' + str(_safe_wheel.version))
  if _safe_name(_safe_wheel.name) != _safe_name(_safe_root.name) or not _safe_wheel_pin.specifier.contains(_safe_version, prereleases=True):
   raise ValueError('Python package wheel version conflict: ' + str(_safe_root))
_safe_installed_json = _safe_json.dumps([name + '==' + version for name, version in sorted(_safe_versions.items())])
`);
  const pinned=JSON.parse(runtime.runPython('_safe_installed_json')) as string[];
  request('package-commit',start.session,pinned);
 }finally{
  runtime._api.packageManager.downloadPackage=async()=>{throw new Error('Python package transport is only available during installation');};
  // These bridge callbacks are not an application Python networking capability.
  for(const name of installedGlobals)runtime.globals.delete(name);
 }
}
