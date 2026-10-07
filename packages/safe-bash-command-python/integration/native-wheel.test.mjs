import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
assert.ok(process.env.SAFE_BASH_PYTHON_RUNTIME_ROOT,'Set SAFE_BASH_PYTHON_RUNTIME_ROOT to pinned Pyodide 314.0.6');
const runtimeRoot=resolve(process.env.SAFE_BASH_PYTHON_RUNTIME_ROOT);
const {loadPyodide}=await import(pathToFileURL(resolve(runtimeRoot,'pyodide.mjs')).href);
const {MemoryFileSystem}=await import('@poe-code/safe-fs/core');
const {createPythonPackageEnvironment}=await import('../src/provisioning.ts');
const {pythonNativeWheel}=await import(new URL('../src/native-wheel.ts',import.meta.url).href);
test('retained native wheels match the pinned buffer installer with bounded short reads', {timeout:30000},async()=>{
const runtime=await loadPyodide({indexURL:runtimeRoot+'/'});
assert.equal(runtime.version,'314.0.6');
runtime.runPython(`
import io, zipfile, json, hashlib, shutil
from pathlib import Path
from pyodide import _package_loader
class ObservedWheelBuffer(bytearray):
 maximum = 0
 def extend(self, value):
  super().extend(value)
  ObservedWheelBuffer.maximum = max(ObservedWheelBuffer.maximum, len(self))
bytearray = ObservedWheelBuffer
_original_zip_info_init = zipfile.ZipInfo.__init__
_zip_info_count = 0
_zip_live = _zip_peak = 0
def _observe_new_info(cls, *args, **kwargs):
 global _zip_live, _zip_peak
 result = object.__new__(cls)
 _zip_live += 1
 _zip_peak = max(_zip_peak, _zip_live)
 return result
def _observe_del_info(self):
 global _zip_live
 _zip_live -= 1
zipfile.ZipInfo.__new__ = staticmethod(_observe_new_info)
zipfile.ZipInfo.__del__ = _observe_del_info
def _observe_zip_info(self, *args, **kwargs):
 global _zip_info_count
 _original_zip_info_init(self, *args, **kwargs)
 if self.filename.startswith('fixture'):_zip_info_count += 1
zipfile.ZipInfo.__init__ = _observe_zip_info
_original_directory_parser = zipfile.ZipFile._RealGetContents
_package_loader.TARGETS['actual'] = Path('/actual')
_unrelated = io.BytesIO()
with zipfile.ZipFile(_unrelated, 'w') as archive:archive.writestr('other.txt', 'unrelated archive')
_unrelated_bytes = _unrelated.getvalue()
_original_set_metadata = _package_loader.set_wheel_metadata
def _set_metadata(filename, archive, target, metadata):
 with zipfile.ZipFile(io.BytesIO(_unrelated_bytes)) as other:
  assert other.read('other.txt') == b'unrelated archive'
 return _original_set_metadata(filename, archive, target, metadata)
_package_loader.set_wheel_metadata = _set_metadata
def snapshot(root):
 return {str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(root).rglob('*') if p.is_file()}
def fixture(compression, count=0):
 output=io.BytesIO()
 with zipfile.ZipFile(output,'w',compression=compression) as z:
  z.writestr('fixture/__init__.py','answer = 42\\n')
  for index in range(count):z.writestr('fixture/data/%08d.dat'%index,b'')
  z.writestr('fixture/payload',b'x'*(2*1024*1024+7))
  z.writestr('fixture-1.0.dist-info/METADATA','Name: fixture\\nVersion: 1.0\\n')
  z.writestr('fixture-1.0.data/data/native-wheel-data','hello data')
 return output.getvalue()
`);
const rows=JSON.parse(readFileSync(new URL('../../safe-bash-zip-engine/src/fixtures/python-wheel-layouts.json',import.meta.url))).rows.filter(row=>row.entries.length);
for(const compression of [0,8]){const proxy=runtime.runPython(`fixture(${compression})`);rows.push({layout:'large-'+compression,bytes:Buffer.from(proxy.toJs()).toString('hex')});proxy.destroy();}
{const proxy=runtime.runPython('fixture(0,4096)');rows.push({layout:'large-directory',bytes:Buffer.from(proxy.toJs()).toString('hex')});proxy.destroy();}
const corrupt=Buffer.from(rows.find(row=>row.layout==='large-0').bytes,'hex');
corrupt[49]^=128;
rows.push({layout:'bad-crc',bytes:corrupt.toString('hex'),error:'BadZipFile'});
rows.push({layout:'truncated',bytes:'504b0304',error:'ReadError'});
for(const row of rows){
 runtime.runPython("shutil.rmtree('/reference',ignore_errors=True); shutil.rmtree('/actual',ignore_errors=True)");
 const bytes=Buffer.from(row.bytes,'hex');
 const original=runtime._api.install(Uint8Array.from(bytes),'fixture-1.0-py3-none-any.whl','/reference',new Map([['INSTALLER','fixture'],['PYODIDE_SOURCE','fixture']]));
 if(row.error)await assert.rejects(original,error=>error.type===row.error);else await original;
 const baseline=JSON.parse(runtime.runPython("json.dumps(snapshot('/reference'))"));
 const reads=[];
 const storage=new MemoryFileSystem(),signal=new AbortController().signal;
 const environment=createPythonPackageEnvironment(),context={fs:storage,cwd:'/',signal};
 const start=await environment.prepare(context);
 runtime.globals.set('_safe_native_wheel_index',(operation,...args)=>environment.dispatch('package-index',[start.session,operation,...args],context));
 runtime.globals.set('_safe_native_wheel_read',(offset,length)=>{assert.ok(length<=65536);reads.push([offset,length]);return Uint8Array.from(bytes.subarray(offset,offset+Math.min(length,997)));});
 runtime.globals.set('_safe_native_wheel_config',JSON.stringify({filename:'fixture-1.0-py3-none-any.whl',target:'actual',size:bytes.length,metadata:{INSTALLER:'fixture',PYODIDE_SOURCE:'fixture'}}));
 runtime.runPython('import gc; gc.collect(); ObservedWheelBuffer.maximum = 0; _zip_info_count = 0; _zip_peak = _zip_live');
 const retained=runtime.runPythonAsync(pythonNativeWheel);
 if(row.error)await assert.rejects(retained,error=>error.type===row.error);else assert.equal(await retained,'[]');
 assert.deepEqual(JSON.parse(runtime.runPython("json.dumps(snapshot('/actual'))")),baseline);
 if(row.layout==='large-directory'){
  assert.equal(runtime.runPython('_zip_info_count'),4100,'one native ZIP index per retained wheel');
  assert.ok(reads.length<5000,'bounded read-ahead must coalesce native header probes: '+reads.length);
  assert.ok(runtime.runPython('_zip_peak')<10,'bounded live native entry objects: '+runtime.runPython('_zip_peak'));
 }
 assert.equal(runtime.runPython('zipfile.ZipFile._RealGetContents is _original_directory_parser'),true,'native parser restored after '+row.layout);
 assert.ok(runtime.runPython('ObservedWheelBuffer.maximum')<=65558,'interpreter buffer '+runtime.runPython('ObservedWheelBuffer.maximum')+': '+row.layout);
 if(row.layout==='truncated')assert.equal(reads.length,0);else assert.ok(reads.length);
 await environment.finish(start);await environment.dispose();
 assert.deepEqual(await storage.readdir('/'),[],'retire caller index '+row.layout);
 if(row.layout.startsWith('large'))assert.equal(runtime.runPython("Path('/native-wheel-data').read_text()"),'hello data');
 assert.ok(reads.every(([,length])=>length<=65536),row.layout);
}
});
