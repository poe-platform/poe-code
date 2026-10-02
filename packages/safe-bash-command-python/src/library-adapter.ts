/** The customizable Python libraries share one bounded, data-only protocol. */
export const pythonLibraryAdapter = /* @__PURE__ */ (() => String.raw`
import sys as _safe_library_sys, types as _safe_library_types
import safe_host as _safe_library_host

class _SafeLibraryBridge:
 def __init__(self, name, host):
  self.name, self.host = name, host
 def call(self, operation, payload):
  if self.name != 'shell' or operation != 'run':
   raise NotImplementedError('Unsupported synchronous library operation')
  request = self.shell_request(payload)
  try:
   result = self.host.call('shell', request)
  except self.host.HostError as error:
   return dict(error=dict(code=error.code, message=str(error), stdout=[], stderr=[]))
  if result.get('error'):
   return result
  for name in ('stdout', 'stderr'):
   if payload.get(name) == 'inherit':
    import sys
    getattr(sys, name).buffer.write(bytes(result[name]))
  return dict(returncode=result['exitCode'], stdout=result['stdout'], stderr=result['stderr'])
 async def async_call(self, operation, payload):
  if self.name != 'shell' or operation != 'run':
   raise NotImplementedError('Unsupported asynchronous shell operation')
  try:
   result = await self.wait('begin', capability='shell', value=self.shell_request(payload))
  except self.host.HostError as error:
   return dict(error=dict(code=error.code, message=str(error), stdout=[], stderr=[]))
  if result.get('error'):
   return result
  return dict(returncode=result['exitCode'], stdout=result['stdout'], stderr=result['stderr'])
 def shell_request(self, payload):
  request = {key: payload[key] for key in ('argv', 'script', 'cwd', 'env') if payload.get(key) is not None}
  if 'input' in payload:
   request['stdin'] = payload['input']
  elif payload.get('stdin') == 'inherit':
   request['stdinMode'] = 'inherit'
  if payload.get('max_output_bytes') is not None:
   request['maxOutputBytes'] = payload['max_output_bytes']
  if payload.get('timeout') is not None:
   request['timeoutMs'] = max(1, int(payload['timeout'] * 1000))
  return request
 def fail(self, error):
  code, message = error.get('code', 'service'), error.get('message', 'Host service failed')
  if self.name == 'llm':
   from poe_llm import LlmError, LimitError, CapabilityError
   if code == 'limit':
    raise LimitError(message)
   if code == 'timeout':
    import asyncio
    raise asyncio.TimeoutError(message)
   if code == 'capability':
    raise CapabilityError(message)
   raise LlmError(code, message)
  from poe_shell import ShellError
  raise ShellError(code, message)
 async def wait(self, operation, **fields):
  import asyncio
  handle = self.host._send(operation, **fields)
  delay = 0.001
  try:
   while True:
    result = self.host._send('poll', handle=handle)
    if result['done']:
     handle = None
     if result.get('error'):
      raise self.host.HostError(result['error'], result.get('errorCode', 'service'))
     return result['value']
    await asyncio.sleep(delay)
    delay = min(0.016, delay * 2)
  finally:
   if handle is not None:
    self.host._send('cancel', handle=handle)
 async def stream(self, payload):
  if self.name == 'shell':
   payload = self.shell_request(payload)
  handle = self.host._send('stream', capability=self.name, value=payload)
  cancelled = False
  try:
   while True:
    result = await self.wait('begin-next', handle=handle)
    if result['done']:
     handle = None
     break
    event = result['value']
    if event['type'] == 'bytes':
     yield dict(type='bytes', data=event['bytes'])
    elif event['type'] == 'text':
     yield dict(type='text', text=event['text'])
    else:
     value = event['value']
     if isinstance(value, dict) and value.get('error'):
      self.fail(value['error'])
     yield value
  except self.host.HostError as error:
   cancelled = True
   self.fail(dict(code=error.code, message=str(error)))
  except BaseException:
   cancelled = True
   raise
  finally:
   if handle is not None:
    try:
     self.host._send('release', handle=handle)
    except self.host.HostError:
     if not cancelled:
      raise

class _SafeAsyncLibraryBridge(_SafeLibraryBridge):
 async def call(self, operation, payload):
  try:
   value = await self.wait('begin', capability=self.name, value=dict(operation=operation, payload=payload))
  except self.host.HostError as error:
   self.fail(dict(code=error.code if error.code != 'service' else 'capability', message=str(error)))
  if isinstance(value, dict) and value.get('error'):
   self.fail(value['error'])
  return value

for _safe_library_name in ('llm', 'shell'):
 _safe_library_module = _safe_library_types.ModuleType('_poe_' + _safe_library_name + '_capability')
 _safe_library_type = _SafeAsyncLibraryBridge if _safe_library_name == 'llm' else _SafeLibraryBridge
 _safe_library_module.bridge = _safe_library_type(_safe_library_name, _safe_library_host)
 _safe_library_sys.modules[_safe_library_module.__name__] = _safe_library_module

del _safe_library_sys, _safe_library_types, _safe_library_host, _safe_library_name, _safe_library_module, _safe_library_type
`)();
