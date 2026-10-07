import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
assert.ok(process.env.SAFE_BASH_PYTHON_RUNTIME_ROOT,'Set SAFE_BASH_PYTHON_RUNTIME_ROOT to pinned Pyodide 314.0.6');
const runtimeRoot=resolve(process.env.SAFE_BASH_PYTHON_RUNTIME_ROOT);
const {loadPyodide}=await import(pathToFileURL(resolve(runtimeRoot,'pyodide.mjs')).href);
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
_package_loader.TARGETS['actual'] = Path('/actual')
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
 runtime.globals.set('_safe_native_wheel_read',(offset,length)=>{assert.ok(length<=65536);reads.push([offset,length]);return Uint8Array.from(bytes.subarray(offset,offset+Math.min(length,997)));});
 runtime.globals.set('_safe_native_wheel_config',JSON.stringify({filename:'fixture-1.0-py3-none-any.whl',target:'actual',size:bytes.length,metadata:{INSTALLER:'fixture',PYODIDE_SOURCE:'fixture'}}));
 runtime.runPython('ObservedWheelBuffer.maximum = 0');
 const retained=runtime.runPythonAsync(pythonNativeWheel);
 if(row.error)await assert.rejects(retained,error=>error.type===row.error);else assert.equal(await retained,'[]');
 assert.deepEqual(JSON.parse(runtime.runPython("json.dumps(snapshot('/actual'))")),baseline);
 assert.ok(runtime.runPython('ObservedWheelBuffer.maximum')<=65558,'interpreter buffer '+runtime.runPython('ObservedWheelBuffer.maximum')+': '+row.layout);
 if(row.layout==='truncated')assert.equal(reads.length,0);else assert.ok(reads.length);
 if(row.layout.startsWith('large'))assert.equal(runtime.runPython("Path('/native-wheel-data').read_text()"),'hello data');
 assert.ok(reads.every(([,length])=>length<=65536),row.layout);
}
});
