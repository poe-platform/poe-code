/** Static Python source, installed without ambient imports or runtime downloads. */
export const pythonHostModule = `
import types as _safe_host_types
_safe_host_module = _safe_host_types.ModuleType('safe_host')
exec('''
import json
from _safe_native_fs import request as _request

class HostError(RuntimeError):
 pass

def _send(operation, **fields):
 payload = dict(version=1, operation=operation, **fields)
 response = json.loads(_request(json.dumps(['host', payload], allow_nan=False)))
 if 'error' in response:
  raise HostError(response['error'])
 return response['value']

def call(capability, value=None):
 """Call an explicitly granted host operation using JSPI suspension."""
 return _send('call', capability=capability, value=value)

class Stream:
 def __init__(self, capability, value=None):
  self._handle = _send('stream', capability=capability, value=value)
 def __iter__(self):
  return self
 def __next__(self):
  if self._handle is None:
   raise StopIteration
  try:
   item = _send('next', handle=self._handle)
  except BaseException:
   self.close()
   raise
  if item['done']:
   self._handle = None
   raise StopIteration
  event = item['value']
  if event['type'] == 'bytes':
   return bytes(event['bytes'])
  if event['type'] == 'text':
   return event['text']
  return event['value']
 def close(self):
  handle, self._handle = self._handle, None
  if handle is not None:
   _send('release', handle=handle)
 def __enter__(self):
  return self
 def __exit__(self, *_):
  self.close()

def stream(capability, value=None):
 return Stream(capability, value)

class CalledProcessError(HostError):
 def __init__(self, result):
  self.returncode, self.cmd = result.returncode, result.args
  self.output, self.stderr = result.stdout, result.stderr
  super().__init__('Safe Bash command exited with status ' + str(self.returncode))

class CompletedProcess:
 def __init__(self, args, result, text):
  self.args, self.returncode = args, result['exitCode']
  self.stdout, self.stderr = bytes(result['stdout']), bytes(result['stderr'])
  if text:
   self.stdout, self.stderr = self.stdout.decode('utf-8'), self.stderr.decode('utf-8')
 def check_returncode(self):
  if self.returncode:
   raise CalledProcessError(self)

def run(args, *, shell=False, input=None, cwd=None, env=None, text=False, check=False, timeout=None):
 """Run a configured Safe Bash command; capture is bounded by the host."""
 if shell:
  if not isinstance(args, str):
   raise TypeError('script mode requires a string')
  request = dict(script=args)
 else:
  if isinstance(args, str):
   raise TypeError('literal execution requires an argv sequence')
  request = dict(argv=list(args))
 if input is not None:
  request['stdin'] = input if isinstance(input, str) else list(input)
 if cwd is not None:
  request['cwd'] = cwd
 if env is not None:
  request['env'] = env
 if timeout is not None:
  request['timeoutMs'] = max(1, int(timeout * 1000))
 result = CompletedProcess(args, call('shell', request), text)
 if check:
  result.check_returncode()
 return result

def check_output(args, **options):
 return run(args, check=True, **options).stdout
''', _safe_host_module.__dict__)
sys.modules['safe_host'] = _safe_host_module
`;
