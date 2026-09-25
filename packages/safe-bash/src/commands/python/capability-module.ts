/** Bind a native Python function, never a host JavaScript object proxy. */
export function installPythonCapabilityModule(runtime: { runPython(source: string): unknown }): void {
  runtime.runPython(`
import sys as _cap_sys, types as _cap_types, json as _cap_json
from _safe_native_fs import request as _cap_request
class _NativeCapability:
 def __init__(self, prefix, request, encode, decode):
  self.prefix, self.request, self.encode, self.decode = prefix, request, encode, decode
 def call(self, operation, payload):
  encoded = self.encode(['capability', self.prefix + '.' + operation, payload], allow_nan=False)
  if len(encoded.encode('utf-8')) >= 16384:
   raise ValueError('Native Python capability request exceeds 16 KiB')
  result = self.decode(self.request(encoded))
  if 'errno' in result:
   raise RuntimeError('Host capability request failed')
  if 'value' not in result:
   raise RuntimeError('Invalid host capability response')
  return result['value']
 async def stream(self, payload):
  result = self.call('stream.open', payload)
  handle = result['handle']
  try:
   while True:
    item = self.call('stream.next', {'handle': handle})
    if item.get('error'):
     from poe_llm import LlmError
     raise LlmError(item['error']['code'], item['error']['message'])
    if item['done']:
     break
    yield item['value']
  finally:
   self.call('stream.close', {'handle': handle})
class _AsyncNativeCapability:
 def __init__(self, native):
  self.native = native
  self.stream = native.stream
 async def call(self, operation, payload):
  try:
   value = self.native.call(operation, payload)
  except RuntimeError as error:
   from poe_llm import LlmError
   raise LlmError('capability', str(error)) from error
  if isinstance(value, dict) and value.get('error'):
   from poe_llm import LlmError
   error = value['error']
   raise LlmError(error.get('code', 'service'), error.get('message', 'LLM service failed'))
  return value
for _cap_name, _cap_prefix in [('_poe_llm_capability', 'llm'), ('_poe_shell_capability', 'shell')]:
 _cap_module = _cap_types.ModuleType(_cap_name)
 _cap_native = _NativeCapability(_cap_prefix, _cap_request, _cap_json.dumps, _cap_json.loads)
 _cap_module.bridge = _AsyncNativeCapability(_cap_native) if _cap_prefix == 'llm' else _cap_native
 _cap_sys.modules[_cap_name] = _cap_module
del _cap_sys, _cap_types, _cap_json, _cap_request, _cap_name, _cap_prefix, _cap_module, _cap_native, _NativeCapability, _AsyncNativeCapability
`);
}
