import {pythonBuildBackendProgramGzip} from './build-backend.generated.js';
import {pythonSourceOriginProgram} from './source-origin-program.generated.js';
import {pythonDownloadFilenameProgram} from './source-filename-program.js';
import {toByteSource, type CommandContext} from 'safe-bash-contracts';
import {createPythonExecutorCommands, type PythonCommandsOptions, type PythonPackageEnvironment} from './executor.js';
import type {PythonHostCapability,PythonHostValue} from './host-capabilities.js';
import {PythonInstallationError} from './installation.js';

export type PythonBuildHookRequest = {
 readonly source:string;
 readonly backend:string;
 readonly backendPath?:readonly string[];
 readonly configSettings?:Readonly<Record<string,string|readonly string[]>>;
} & ({readonly hook:'get_requires_for_build_wheel'}|{readonly hook:'build_wheel';readonly wheelDirectory:string;readonly metadataDirectory?:string});
export interface PythonLegacyRequirementsRequest {
 readonly hook:'get_requires_for_legacy_wheel';
 readonly source:string;
}
export interface PythonLegacyBuildRequest {
 readonly hook:'build_legacy_wheel';
 /** Build a native setuptools compatibility-mode editable wheel. */
 readonly editable?:boolean;
 readonly source:string;
 readonly wheelDirectory:string;
}
export interface PythonBuildSystemRequest {
 readonly hook:'read_build_system';
 readonly source:string;
 readonly name?:string;
 readonly usePep517?:boolean;
 /** Apply pip installation admission in addition to low-level backend selection. */
 readonly installation?:'directory'|'archive';
}
export interface PythonBuildSystemDetails {
 readonly requires:readonly string[];
 readonly backend:string;
 readonly check:readonly string[];
 readonly backendPath:readonly string[];
}
export interface PythonBuildRequirementsRequest {
 readonly hook:'check_build_requirements';
 readonly source:string;
 readonly requirements:readonly string[];
 /** Distribution names from the build environment's installed manifest. */
 readonly installed:readonly string[];
}
export interface PythonBuildRequirementsStatus {
 readonly conflicting:readonly (readonly [installed:string,wanted:string])[];
 readonly missing:readonly string[];
}
export interface PythonSourceOriginRequest {
 readonly hook:'read_source_origin';
 readonly source:string;
 readonly directory:boolean;
}
export interface PythonDownloadFilenameRequest {
 readonly hook:'read_download_filename';
 readonly source:string;
 readonly responseUrl:string;
 readonly headers:readonly (readonly [string,string])[];
}
export interface PythonSourceRequirementRequest {
 readonly hook:'read_source_requirement';
 readonly source:string;
}
export interface PythonEditableRequirementRequest {
 readonly hook:'read_editable_requirement';
 readonly source:string;
 /** Parse a requirements-file option line before resolving the editable source. */
 readonly requirementLine?:boolean;
}
export interface PythonSourceRequirement {
 /** Empty when an editable source has no explicit egg name. */
 readonly name:string;
 readonly extras:readonly string[];
 readonly url:string;
 readonly marker:string|null;
 readonly active:boolean;
}
type BuildRequest=PythonSourceOriginRequest|PythonDownloadFilenameRequest|PythonEditableRequirementRequest|PythonLegacyRequirementsRequest|PythonSourceRequirementRequest|PythonLegacyBuildRequest|PythonBuildHookRequest|PythonBuildSystemRequest|PythonBuildRequirementsRequest;
type BuildResult<T extends BuildRequest>=T extends PythonDownloadFilenameRequest|PythonSourceOriginRequest?string:T extends PythonSourceRequirementRequest|PythonEditableRequirementRequest?PythonSourceRequirement|null:T extends PythonBuildSystemRequest?PythonBuildSystemDetails|null:T extends PythonBuildRequirementsRequest?PythonBuildRequirementsStatus:T extends {readonly hook:'build_wheel'|'build_legacy_wheel'}?string:string[];
export interface PythonBuildHookContext extends Pick<CommandContext,'fs'|'cwd'|'env'|'signal'|'stdout'|'stderr'> {
 /** Total UTF-8 result metadata allowance; wheel bytes stay in caller storage. */
 readonly maxBytes:number;
}

/** Run PEP 517 hooks against a caller-prepared source tree and package environment. */
export function createPythonBuildBackend(options:PythonCommandsOptions & {readonly environment:PythonPackageEnvironment}) {
 if(!options.createExecutor||!options.environment||options.provisioning)throw new TypeError('Python build hooks require an asynchronous executor and explicit environment');
 const capabilities=new WeakMap<readonly string[],PythonHostCapability>();
 const environment=options.environment,legacy=new WeakSet<readonly string[]>();
 const command=createPythonExecutorCommands({...options,environment:{...environment,async prepare(context){return {...await environment.prepare(context),bootstrap:true,...context.args&&legacy.has(context.args)?{bootstrapPackages:['setuptools']}: {}};}},createCapabilities(context){
  const provided=options.createCapabilities?.(context)??{};
  if(provided.python_build)throw new Error('Python build capability is reserved');
  const capability=capabilities.get(context.args);
  if(!capability)throw new Error('Unknown Python build invocation');
  return {...provided,python_build:capability};
 }})[0]!;
 return async function run<T extends BuildRequest>(input:T,context:PythonBuildHookContext):Promise<BuildResult<T>> {
  context.signal.throwIfAborted();
  const {maxBytes}=context;
  if(maxBytes!==Infinity&&(!Number.isSafeInteger(maxBytes)||maxBytes<0))throw new RangeError('Invalid Python build metadata limit');
  if(!input||!['read_source_origin','read_download_filename','read_editable_requirement','get_requires_for_legacy_wheel','read_source_requirement','read_build_system','check_build_requirements','get_requires_for_build_wheel','build_wheel','build_legacy_wheel'].includes(input.hook)||typeof input.source!=='string'||!input.source)throw new TypeError('Invalid Python build hook request');
  if(input.hook==='read_editable_requirement'&&input.requirementLine!==undefined&&typeof input.requirementLine!=='boolean')throw new TypeError('Invalid editable requirement line');
  if(input.hook==='read_source_origin'){
   if(typeof input.directory!=='boolean')throw new TypeError('Invalid Python source origin');
  }else if(input.hook==='read_download_filename'){
   if(typeof input.responseUrl!=='string'||!Array.isArray(input.headers)||input.headers.some(pair=>!Array.isArray(pair)||pair.length!==2||pair.some(value=>typeof value!=='string')))throw new TypeError('Invalid Python download metadata');
  }else if(input.hook==='build_legacy_wheel'){
   if(typeof input.wheelDirectory!=='string'||!input.wheelDirectory||input.editable!==undefined&&typeof input.editable!=='boolean')throw new TypeError('Invalid Python legacy wheel directory');
  }else if(input.hook==='check_build_requirements'){
   if([input.requirements,input.installed].some(values=>!Array.isArray(values)||values.some(value=>typeof value!=='string')))throw new TypeError('Invalid Python build requirements request');
  }else if(input.hook==='read_build_system'){
   if(input.installation!==undefined&&!['directory','archive'].includes(input.installation))throw new TypeError('Invalid Python source installation');
   if(input.name!==undefined&&typeof input.name!=='string'||input.usePep517!==undefined&&typeof input.usePep517!=='boolean')throw new TypeError('Invalid Python build system request');
  }else if(input.hook!=='read_source_requirement'&&input.hook!=='read_editable_requirement'&&input.hook!=='get_requires_for_legacy_wheel'){
  if(typeof input.backend!=='string'||!input.backend
   ||input.backendPath!==undefined&&(!Array.isArray(input.backendPath)||input.backendPath.some(path=>typeof path!=='string'))
   ||input.hook==='build_wheel'&&(typeof input.wheelDirectory!=='string'||!input.wheelDirectory||input.metadataDirectory!==undefined&&typeof input.metadataDirectory!=='string'))throw new TypeError('Invalid Python build hook request');
  if(input.configSettings!==undefined&&(!input.configSettings||typeof input.configSettings!=='object'||Array.isArray(input.configSettings)||Object.values(input.configSettings).some(value=>typeof value!=='string'&&(!Array.isArray(value)||value.some(item=>typeof item!=='string')))))throw new TypeError('Invalid Python build configuration');
  }
  const request=structuredClone(input.hook==='read_build_system'?{...input,maxBytes:maxBytes===Infinity?null:maxBytes}:input);
  let done=false,size=0,failure:unknown;
  const chunks:string[]=[];
  const program=await loadPythonBuildBackendProgram();
  context.signal.throwIfAborted();
  const invocation:CommandContext={...context,command:'python',args:['-c',program],stdin:toByteSource('')};
  if(request.hook==='build_legacy_wheel'||request.hook==='get_requires_for_legacy_wheel')legacy.add(invocation.args);
  capabilities.set(invocation.args,{async call(value){
   try{
    context.signal.throwIfAborted();
    if(!value||typeof value!=='object'||Array.isArray(value)||done)throw new TypeError('Invalid Python build message');
    const message=value as Record<string,PythonHostValue>;
    if(message.op==='request')return request as unknown as PythonHostValue;
    if(message.op==='error'){
     if(typeof message.type!=='string'||typeof message.message!=='string')throw new TypeError('Invalid Python build failure');
     failure??=Object.assign(message.type==='InstallationError'?new PythonInstallationError(message.message):new Error(message.message),{name:message.type});done=true;return null;
    }
    if(message.op==='done'){done=true;return null;}
    if(message.op!=='text'||typeof message.text!=='string'||message.text.length>8192)throw new TypeError('Invalid Python build metadata window');
    const bytes=new TextEncoder().encode(message.text).length;
    if(bytes>16384||bytes>maxBytes-size)throw new RangeError('Python build metadata limit exceeded');
    size+=bytes;if(bytes)chunks.push(message.text);return null;
   }catch(error){failure??=error;throw error;}
  }});
  try{
   const result=await command.execute(invocation);
   context.signal.throwIfAborted();
   if(failure)throw failure;
   if(result.exitCode)throw new Error(`Python build interpreter exited with status ${result.exitCode}`);
   if(!done)throw new Error('Python build interpreter returned no result');
   const value:unknown=JSON.parse(chunks.join(''));
   if(request.hook==='read_source_origin'||request.hook==='read_download_filename'){
    if(typeof value!=='string')throw new TypeError('Invalid Python download filename');
   }else if(request.hook==='read_source_requirement'||request.hook==='read_editable_requirement'){
    const result=value as PythonSourceRequirement|null;
    if(result!==null&&(!result||typeof result.name!=='string'||typeof result.url!=='string'||typeof result.active!=='boolean'||result.marker!==null&&typeof result.marker!=='string'||!Array.isArray(result.extras)||result.extras.some(extra=>typeof extra!=='string')))throw new TypeError('Invalid Python source requirement');
   }else if(request.hook==='check_build_requirements'){
    const result=value as PythonBuildRequirementsStatus|null;
    if(!result||!Array.isArray(result.missing)||result.missing.some(value=>typeof value!=='string')||!Array.isArray(result.conflicting)||result.conflicting.some(pair=>!Array.isArray(pair)||pair.length!==2||pair.some(value=>typeof value!=='string')))throw new TypeError('Invalid Python build requirement status');
   }else if(request.hook==='read_build_system'){
    if(value!==null){
     if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('Invalid Python build system');
     const details=value as Record<string,unknown>;
     if(typeof details.backend!=='string'||!details.backend||['requires','check','backendPath'].some(key=>!Array.isArray(details[key])||(details[key] as unknown[]).some(item=>typeof item!=='string')))throw new TypeError('Invalid Python build system');
    }
   }else if(request.hook==='build_wheel'||request.hook==='build_legacy_wheel'){
    if(typeof value!=='string'||!value.endsWith('.whl')||value.includes('/')||value.includes('\\')||value.includes('\0'))throw new TypeError('Invalid Python build wheel filename');
   }else if(!Array.isArray(value)||value.some(item=>typeof item!=='string'))throw new TypeError('Invalid Python build requirements');
   return value as BuildResult<T>;
  }finally{capabilities.delete(invocation.args);legacy.delete(invocation.args);}
 };
}

let decodedBuildProgram:Promise<string>|undefined;
/** Decode trusted static source once, preserving native tracebacks and program text. */
export function loadPythonBuildBackendProgram():Promise<string>{
 return decodedBuildProgram??=new Response(new Blob([Uint8Array.from(atob(pythonBuildBackendProgramGzip),character=>character.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

export const pythonBuildBackendProgram=/* @__PURE__ */ (()=>String.raw`
import importlib, json, os, sys, safe_host
${pythonDownloadFilenameProgram}

def send(op, **fields):
 return safe_host.call('python_build', dict(op=op, **fields))


${pythonSourceOriginProgram}

def parse_build_requirement(value):
 from urllib.parse import urlparse, urlunparse
 from micropip._vendored.packaging.src.packaging.requirements import Requirement, InvalidRequirement
 requirement = Requirement(value)
 if requirement.url:
  url = urlparse(requirement.url)
  if (url.scheme == 'file' and urlunparse(url) != requirement.url) or (url.scheme != 'file' and not (url.scheme and url.netloc)): raise InvalidRequirement(value)
 return requirement

def check_build_requirements(request):
 from importlib.metadata import distribution, PackageNotFoundError
 from micropip._vendored.packaging.src.packaging.utils import canonicalize_name
 from micropip._vendored.packaging.src.packaging.version import Version
 installed = {canonicalize_name(name) for name in request['installed']}
 conflicting, missing = set(), set()
 for value in request['requirements']:
  requirement = parse_build_requirement(value)
  if canonicalize_name(requirement.name) not in installed:
   missing.add(value)
   continue
  try: version = Version(distribution(requirement.name).version)
  except PackageNotFoundError:
   missing.add(value)
   continue
  if version not in requirement.specifier: conflicting.add((requirement.name + '==' + str(version), value))
 return dict(conflicting=sorted(conflicting), missing=sorted(missing))

def read_build_system(request):
 import tomllib
 from micropip._vendored.packaging.src.packaging.requirements import InvalidRequirement
 class InstallationError(Exception): pass
 source = request['source']
 filename = os.path.join(source, 'pyproject.toml')
 has_project, has_setup = os.path.isfile(filename), os.path.isfile(os.path.join(source, 'setup.py'))
 if request.get('installation') == 'directory' and not has_project and not has_setup:
  raise InstallationError("Directory {!r} is not installable. Neither 'setup.py' nor 'pyproject.toml' found.".format(request.get('name', source)))
 system = None
 if has_project:
  limit = request['maxBytes']
  with open(filename, 'rb') as stream: raw = stream.read() if limit is None else stream.read(limit + 1)
  if limit is not None and len(raw) > limit: raise ValueError('Python build configuration limit exceeded')
  system = tomllib.loads(raw.decode('utf-8')).get('build-system')
 selected = request.get('usePep517')
 if has_project and not has_setup:
  if selected is False: raise InstallationError('Disabling PEP 517 processing is invalid: project does not have a setup.py')
  selected = True
 elif system and 'build-backend' in system:
  if selected is False: raise InstallationError('Disabling PEP 517 processing is invalid: project specifies a build backend of {} in pyproject.toml'.format(system['build-backend']))
  selected = True
 elif selected is None: selected = has_project
 if not selected:
  if request.get('installation') and not os.path.exists(os.path.join(source, 'setup.py')):
   raise InstallationError('File "setup.py" not found for legacy project {}.'.format(request.get('name', source)))
  return None
 defaults = ['setuptools>=40.8.0', 'wheel']
 if system is None: system = {'requires': defaults, 'build-backend': 'setuptools.build_meta:__legacy__'}
 def invalid(reason):
  raise InstallationError('{} has a pyproject.toml file that does not comply with PEP 518: {}'.format(request.get('name', source), reason))
 if 'requires' not in system: invalid("it has a 'build-system' table but not 'build-system.requires' which is mandatory in the table")
 requirements = system['requires']
 if not isinstance(requirements, list) or not all(isinstance(value, str) for value in requirements): invalid("'build-system.requires' is not a list of strings.")
 for value in requirements:
  try:
   parse_build_requirement(value)
  except InvalidRequirement: invalid("'build-system.requires' contains an invalid requirement: {!r}".format(value))
 backend = system.get('build-backend')
 return dict(requires=requirements, backend=backend if backend is not None else 'setuptools.build_meta:__legacy__', check=defaults if backend is None else [], backendPath=system.get('backend-path', []))

def build_legacy_wheel(request):
 source = os.path.realpath(request['source'])
 directory = os.path.abspath(request['wheelDirectory'])
 filename = os.path.join(source, 'setup.py')
 os.chdir(source)
 sys.path.insert(0, '')
 sys.argv = [filename, 'bdist_wheel', '-d', directory]
 namespace = dict(__name__='__main__', __file__=filename)
 try:
  exec("import io, os, sys, setuptools, tokenize\nsys.argv[0] = __file__\nf = getattr(tokenize, 'open', open)(__file__) if os.path.exists(__file__) else io.StringIO('from setuptools import setup; setup()')\ncode = f.read().replace('\\r\\n', '\\n')\nf.close()\nexec(compile(code, __file__, 'exec'))", namespace)
 except SystemExit as error:
  if error.code not in (None, 0): raise
 first = None
 with os.scandir(directory) as entries:
  for entry in entries:
   if first is None or entry.name < first: first = entry.name
 if first is None: raise RuntimeError('Legacy wheel build created no files')
 return first

def read_source_requirement(request):
 from micropip._vendored.packaging.src.packaging.requirements import InvalidRequirement
 try: requirement = parse_build_requirement(request['source'])
 except InvalidRequirement: return None
 if not requirement.url: return None
 marker = requirement.marker
 return dict(name=requirement.name, extras=sorted({'_'.join(part for part in extra.lower().split('_') if part) for extra in requirement.extras}), url=requirement.url, marker=str(marker) if marker else None, active=not marker or marker.evaluate({'extra': ''}))

def read_editable_requirement(request):
 from pathlib import Path
 from micropip._vendored.packaging.src.packaging.requirements import Requirement
 class InstallationError(Exception): pass
 source, extras = request['source'], None
 if request.get('requirementLine'):
  import shlex, optparse
  class OptionParsingError(Exception): pass
  class Parser(optparse.OptionParser):
   def exit(self, status=0, message=None): raise OptionParsingError(message)
  parser = Parser(add_help_option=False)
  parser.add_option('-e', '--editable', action='append', dest='editables')
  options, _ = parser.parse_args(shlex.split(source))
  if not options.editables: raise InstallationError('Editable requirement line requires -e')
  source = options.editables[0]
 start = source.rfind('[')
 if start > 0 and source.endswith(']') and start < len(source) - 2 and ']' not in source[start + 1:-1]:
  source, extras = source[:start], source[start:]
 if os.path.isdir(source):
  if not any(os.path.exists(os.path.join(source, name)) for name in ('setup.py', 'setup.cfg')):
   message = 'File "setup.py" or "setup.cfg" not found. Directory cannot be installed in editable mode: {}'.format(os.path.abspath(source))
   if os.path.isfile(os.path.join(source, 'pyproject.toml')): message += '\n(A "pyproject.toml" file was found, but editable mode currently requires a setuptools-based build.)'
   raise InstallationError(message)
  source = Path(os.path.abspath(source)).as_uri()
 if not source.lower().startswith('file:'): raise InstallationError('Editable source requires a local directory')
 name = ''
 for index, character in enumerate(source):
  if character in '#&' and source.startswith('egg=', index + 1):
   name = source[index + 5:].split('&', 1)[0]
   break
 return dict(name=name, url=source, extras=sorted(Requirement('placeholder' + extras.lower()).extras) if extras else [], marker=None, active=True)

def main():
 request = send('request')
 if request['hook'] == 'get_requires_for_legacy_wheel': request.update(hook='get_requires_for_build_wheel', backend='setuptools.build_meta:__legacy__')
 if request['hook'] == 'read_source_origin': return read_source_origin(request)
 if request['hook'] == 'read_download_filename': return read_download_filename(request)
 if request['hook'] == 'read_source_requirement': return read_source_requirement(request)
 if request['hook'] == 'read_editable_requirement': return read_editable_requirement(request)
 if request['hook'] == 'build_legacy_wheel':
  if not request.get('editable'): return build_legacy_wheel(request)
  request.update(hook='build_wheel', backend='setuptools.build_meta:__legacy__')
 if request['hook'] == 'read_build_system': return read_build_system(request)
 if request['hook'] == 'check_build_requirements': return check_build_requirements(request)
 source = os.path.realpath(request['source'])
 wheel_directory = os.path.abspath(request['wheelDirectory']) if request['hook'] == 'build_wheel' else None
 metadata_directory = os.path.abspath(request['metadataDirectory']) if request.get('metadataDirectory') is not None else None
 os.chdir(source)
 paths = []
 for entry in request.get('backendPath', []):
  if os.path.isabs(entry): raise ValueError('paths must be relative')
  path = os.path.realpath(os.path.join(source, entry))
  if os.path.commonpath([source, path]) != source: raise ValueError('paths must be inside source tree')
  paths.append(path)
 sys.path[:0] = paths
 module, _, attributes = request['backend'].partition(':')
 backend = importlib.import_module(module)
 if paths and not any(os.path.commonpath([os.path.realpath(backend.__file__), path]) == path for path in paths):
  raise ValueError('Backend was not loaded from backend-path')
 if attributes:
  for name in attributes.split('.'): backend = getattr(backend, name)
 settings = request.get('configSettings')
 if request['hook'] == 'get_requires_for_build_wheel':
  try: hook = backend.get_requires_for_build_wheel
  except AttributeError: result = []
  else: result = hook(settings)
 else:
  if request.get('editable'): result = backend.build_editable(wheel_directory, {'editable_mode': 'compat'}, metadata_directory)
  else: result = backend.build_wheel(wheel_directory, settings, metadata_directory)
 return result

try:
 result = main()
 encoder = json.JSONEncoder(ensure_ascii=False, separators=(',', ':'))
 for part in encoder.iterencode(result):
  for offset in range(0, len(part), 4096): send('text', text=part[offset:offset + 4096])
 send('done')
except Exception as error:
 send('error', type=type(error).__name__, message=str(error))
`)();
