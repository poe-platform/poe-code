/* global self */
import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v314.0.6/full/pyodide.mjs';
self.onmessage = async ({ data: workerData }) => {
// eslint-disable-next-line no-unused-vars -- Used by BRIDGE_SOURCE injected by server.mjs.
const parentPort = { postMessage: message => self.postMessage(message) };
const progress = message => self.postMessage({ op: 'progress', message });
try {
  const pyodide = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v314.0.6/full/' });
  const indexBytes = await (await fetch('https://cdn.jsdelivr.net/pyodide/v314.0.6/full/pyodide-lock.json')).arrayBuffer();
  const indexSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', indexBytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (pyodide.version !== '314.0.6') throw new Error(`Unexpected runtime ${pyodide.version}`);
  const stdout = [], stderr = [];
  pyodide.setStdout({ batched: text => stdout.push(text) });
  pyodide.setStderr({ batched: text => stderr.push(text) });
  progress(`runtime ${pyodide.version}; installing native index packages`);
  await pyodide.loadPackage(['micropip', 'lxml', 'pillow']);
  let pymupdfLoadFailure;
  try { await pyodide.loadPackage('pymupdf'); }
  catch (error) { pymupdfLoadFailure = String(error); }
  await pyodide.runPythonAsync(`import micropip\nawait micropip.install(['python-docx==1.2.0', 'openpyxl==3.1.5', 'XlsxWriter==3.2.9', 'pypdf==6.18.1', 'fpdf2==2.8.8', 'fonttools==4.65.0', 'defusedxml==0.7.1', 'et-xmlfile==2.0.0', 'typing-extensions==4.16.0'], deps=True)`);
  progress('packages installed; mounting filesystem');
  if (workerData.profile !== 'memfs') {
    /* BRIDGE_SOURCE */
  } else {
    pyodide.FS.mkdir('/work');
    pyodide.FS.writeFile('/work/documents.py', workerData.script);
    pyodide.FS.writeFile('/work/font.ttf', workerData.font);
  }
  if (workerData.rootMount) {
    // Pinned-runtime experiment: relocating sys.path alone reloads native
    // libraries under new names and leaves already-imported packages stale.
    const libraries = pyodide._module.LDSO.loadedLibsByName;
    for (const [name, library] of Object.entries(libraries)) {
      if (name.startsWith('/lib/')) libraries[`/.pyodide-runtime${name}`] = library;
    }
    pyodide.runPython(`
import sys, zipimport, importlib.machinery
def _rebase_runtime_path(value):
    return '/.pyodide-runtime' + value if isinstance(value, str) and (value == '/lib' or value.startswith('/lib/')) else value
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
`);
  }
  pyodide.runPython(`import os\nos.environ['PROBE_ROOT']='/work'\nos.environ['PROBE_FONT']='/work/font.ttf'`);
  pyodide.globals.set('_probe_profile', workerData.profile);
  pyodide.runPython("os.environ['PROBE_PROFILE'] = _probe_profile");
  let failure;
  try { pyodide.runPython("import runpy; runpy.run_path('/work/documents.py', run_name='__main__')"); }
  catch (error) { failure = String(error); }
  let report, reportCollectionError;
  try { report = JSON.parse(pyodide.FS.readFile('/work/report.json', { encoding: 'utf8' })); }
  catch (error) { reportCollectionError = String(error); }
  const artifacts = [];
  function collect(path) {
    for (const name of pyodide.FS.readdir(path)) {
      if (name === '.' || name === '..' || name === 'documents.py' || name === 'font.ttf') continue;
      const next = `${path}/${name}`;
      const mode = pyodide.FS.lstat(next).mode;
      if (pyodide.FS.isLink(mode)) continue;
      if (pyodide.FS.isDir(mode)) collect(next);
      else {
        pyodide.globals.set('_artifact_path', next);
        const payload = pyodide.runPython('__import__("pathlib").Path(_artifact_path).read_bytes()');
        artifacts.push({ name: next.slice(6), bytes: [...payload.toJs()] });
        payload.destroy();
      }
    }
  }
  let artifactCollectionError;
  try { collect('/work'); }
  catch (error) { artifactCollectionError = String(error); }
  self.postMessage({ op: 'done', report, artifacts, error: failure, reportCollectionError, artifactCollectionError, stdout, stderr, pymupdfLoadFailure, indexSha256, version: pyodide.version, workerCrossOriginIsolated: self.crossOriginIsolated, python: pyodide.runPython('__import__("sys").version') });
} catch (error) { self.postMessage({ op: 'done', error: String(error), stack: error.stack }); }
};
