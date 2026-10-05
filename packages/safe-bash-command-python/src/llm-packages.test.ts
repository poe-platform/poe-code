import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { installPythonLlmPackages, pythonLlmPackages } from './llm-packages.js';
import { pythonLlmProvider } from './llm-provider.js';

function installationSource(): string {
  const globals = new Map<string, unknown>();
  let source = '';
  installPythonLlmPackages({
    version: pythonLlmPackages.pyodide,
    FS: { mkdirTree() {}, writeFile() {} },
    globals,
    unpackArchive() {},
    runPython(value) { source = value; },
  }, pythonLlmPackages.distributions.map(distribution => ({
    file: distribution.file,
    bytes: { byteLength: distribution.bytes } as Uint8Array,
  })));
  assert.equal(globals.size, 0);
  return source;
}

test('package installation defers LLM imports and locks provider discovery on first import', () => {
  const source = installationSource();
  const result = spawnSync('python3', ['-B', '-c', String.raw`
import sys, json, importlib.abc, importlib.util, types
source = json.load(sys.stdin)
loaded = []
class Fixture(importlib.abc.MetaPathFinder, importlib.abc.Loader):
 def find_spec(self, fullname, path=None, target=None):
  if fullname in ('llm', 'llm.plugins', 'llm_safe_host'):
   return importlib.util.spec_from_loader(fullname, self, is_package=fullname == 'llm')
 def create_module(self, spec): return None
 def exec_module(self, module):
  loaded.append(module.__name__)
  if module.__name__ == 'llm':
   exec('from . import plugins', module.__dict__)
  elif module.__name__ == 'llm.plugins':
   module.DEFAULT_PLUGINS = ('unsafe',)
   module.LLM_LOAD_PLUGINS = 'unsafe'
   def load_plugins():
    assert module.DEFAULT_PLUGINS == ()
    assert module.LLM_LOAD_PLUGINS == 'llm-safe-host'
    loaded.append('configured')
   module.load_plugins = load_plugins
  else:
   def restrict_providers(): loaded.append('restricted')
   module.restrict_providers = restrict_providers
sys.meta_path.append(Fixture())
_safe_llm_wheel_paths = '[]'
exec(source)
exec(source)
assert loaded == [], loaded
import llm
assert loaded == ['llm', 'llm.plugins', 'configured', 'llm_safe_host', 'restricted'], loaded
import llm
assert loaded.count('restricted') == 1
`], { input: JSON.stringify(source), encoding: 'utf8', timeout: 5000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});


test('lazy installation retains genuine reference prompting and provider restrictions', {
  skip: process.env.LLM_REFERENCE_PYTHON ? false : 'Requires LLM_REFERENCE_PYTHON with llm==0.27.1',
}, () => {
  const result = spawnSync(process.env.LLM_REFERENCE_PYTHON!, ['-B', '-c', String.raw`
import sys, json, types, importlib.abc, importlib.util
from importlib import metadata
from contextlib import contextmanager
assert metadata.version('llm') == '0.27.1'
bundle = json.load(sys.stdin)
original_distribution = metadata.distribution
class Distribution:
 entry_points = [metadata.EntryPoint(name='safe_host', value='llm_safe_host', group='llm')]
metadata.distribution = lambda name: Distribution() if name == 'llm-safe-host' else original_distribution(name)
class ProviderLoader(importlib.abc.MetaPathFinder, importlib.abc.Loader):
 def find_spec(self, fullname, path=None, target=None):
  if fullname == 'llm_safe_host': return importlib.util.spec_from_loader(fullname, self)
 def create_module(self, spec): return None
 def exec_module(self, module): exec(bundle['provider'], module.__dict__)
sys.meta_path.append(ProviderLoader())
_safe_llm_wheel_paths = '[]'
exec(bundle['source'])
assert 'llm' not in sys.modules
assert 'pydantic' not in sys.modules
import os
os.environ['LLM_LOAD_PLUGINS'] = 'untrusted-plugin'
import llm
assert llm.plugins.pm.get_plugin('safe_host') is not None
assert 'llm.default_plugins.openai_models' not in sys.modules
assert 'llm.default_plugins.default_tools' not in sys.modules
for operation in (lambda: llm.plugins.pm.register(object()), lambda: llm.plugins.pm.load_setuptools_entrypoints('llm')):
 try: operation()
 except llm.ModelError: pass
 else: raise AssertionError('provider registration allowed')
class HostError(Exception): pass
def call(service, request):
 if request['operation'] == 'models':
  return [{'id':'fixture', 'aliases':[], 'capabilities':[], 'metadata':{'outputType':'text/plain', 'options':{}, 'attachmentTypes':[]}}]
 if request['operation'] == 'resolve_model': return 'fixture'
 raise AssertionError(request)
@contextmanager
def stream(service, payload):
 assert payload['prompt'] == 'hello'
 yield iter([{'type':'text', 'text':'ok'}])
sys.modules['safe_host'] = types.SimpleNamespace(call=call, stream=stream, HostError=HostError)
assert llm.get_model('fixture').prompt('hello').text() == 'ok'
`], {
    input: JSON.stringify({ source: installationSource(), provider: pythonLlmProvider }),
    encoding: 'utf8', timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
