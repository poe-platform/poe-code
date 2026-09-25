/** Portable Python shell workflows; transport is supplied by the parent invocation. */
const pythonShellModule = String.raw`
from __future__ import annotations
import asyncio
import math
import inspect
import subprocess
from dataclasses import dataclass

class ShellError(RuntimeError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code

def _bridge():
    try:
        from _poe_shell_capability import bridge
        return bridge
    except ImportError as error:
        raise ShellError('capability', 'This Python invocation has no shell capability') from error

def _bytes(value):
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value)
    if isinstance(value, list) and all(type(item) is int and 0 <= item <= 255 for item in value):
        return bytes(value)
    raise ShellError('protocol', 'Invalid shell result bytes')

def _payload(args, *, shell=False, input=None, cwd=None, env=None, timeout=None,
             max_output_bytes=8388608, text=False, encoding=None, errors=None):
    if shell:
        if not isinstance(args, str):
            raise TypeError('shell=True requires an explicit Safe Bash script string')
        result = {'script': args}
    else:
        if isinstance(args, (str, bytes)):
            raise TypeError('Literal execution requires an argv sequence')
        args = list(args)
        if not args or any(not isinstance(value, str) or '\0' in value for value in args):
            raise TypeError('argv must contain nonempty command and literal strings without NUL')
        if not args[0]:
            raise ValueError('Command must not be empty')
        result = {'argv': args}
    if cwd is not None and (not isinstance(cwd, str) or '\0' in cwd):
        raise TypeError('cwd must be a canonical filesystem path')
    if env is not None and (not isinstance(env, dict) or any(not isinstance(key, str) or not isinstance(value, str) or '\0' in key + value or '=' in key for key, value in env.items())):
        raise TypeError('env must map strings to strings')
    if timeout is not None and (type(timeout) not in (int, float) or not math.isfinite(timeout) or timeout <= 0):
        raise ValueError('timeout must be positive and finite')
    if type(max_output_bytes) is not int or max_output_bytes < 0:
        raise ValueError('max_output_bytes must be a nonnegative integer')
    if input is not None:
        if text or encoding or errors:
            if not isinstance(input, str):
                raise TypeError('Text input must be a string')
            input = input.encode(encoding or 'utf-8', errors or 'strict')
        elif not isinstance(input, (bytes, bytearray, memoryview)):
            raise TypeError('Binary input must be bytes')
        result['input'] = list(input)
    result.update(cwd=cwd, env=env, timeout=timeout, max_output_bytes=max_output_bytes)
    return result

def _result(args, payload, value, *, check=False, text=False, encoding=None, errors=None, stdout=True, stderr=True):
    if not isinstance(value, dict):
        raise ShellError('protocol', 'Invalid shell result')
    failure = value.get('error')
    if failure:
        if failure.get('code') == 'timeout':
            raise subprocess.TimeoutExpired(args, payload['timeout'], output=_bytes(failure.get('stdout', [])), stderr=_bytes(failure.get('stderr', [])))
        raise ShellError(failure.get('code', 'shell'), failure.get('message', 'Shell execution failed'))
    code = value.get('returncode')
    if type(code) is not int:
        raise ShellError('protocol', 'Invalid shell return code')
    output, diagnostic = _bytes(value.get('stdout', [])), _bytes(value.get('stderr', []))
    if len(output) + len(diagnostic) > payload['max_output_bytes']:
        raise ShellError('limit', 'Shell captured output limit exceeded')
    if text or encoding or errors:
        output = output.decode(encoding or 'utf-8', errors or 'strict').replace('\r\n', '\n').replace('\r', '\n')
        diagnostic = diagnostic.decode(encoding or 'utf-8', errors or 'strict').replace('\r\n', '\n').replace('\r', '\n')
    result = subprocess.CompletedProcess(args, code, output if stdout else None, diagnostic if stderr else None)
    if check:
        result.check_returncode()
    return result

@dataclass(frozen=True)
class Event:
    type: str
    data: bytes = b''
    returncode: int | None = None

class Stream:
    def __init__(self, client, payload):
        self.client, self.payload = client, payload
        self.iterator = None
        self.pending = None
        self.closed = False
        self.count = 0
    async def __aenter__(self):
        self.client._check()
        self.client.streams.add(self)
        self.iterator = self.client.bridge.stream(self.payload).__aiter__()
        return self
    async def __aexit__(self, *ignored):
        await self.aclose()
    def __aiter__(self):
        return self
    async def __anext__(self):
        if self.closed or self.iterator is None:
            raise StopAsyncIteration
        if self.pending is not None:
            raise ShellError('concurrent', 'Only one shell stream read is allowed')
        task = self.pending = asyncio.create_task(self.iterator.__anext__())
        try:
            value = await task
            if value.get('error'):
                error = value['error']
                raise ShellError(error.get('code', 'shell'), error.get('message', 'Shell stream failed'))
            data = _bytes(value.get('data', []))
            self.count += len(data)
            if self.count > self.payload['max_output_bytes']:
                raise ShellError('limit', 'Shell streamed output limit exceeded')
            return Event(value['type'], data, value.get('returncode'))
        except BaseException:
            self.pending = None
            await self.aclose()
            raise
        finally:
            if self.pending is task:
                self.pending = None
    async def aclose(self):
        if self.closed:
            return
        self.closed = True
        if self.pending:
            self.pending.cancel()
            await asyncio.gather(self.pending, return_exceptions=True)
        if self.iterator and hasattr(self.iterator, 'aclose'):
            await self.iterator.aclose()
        self.client.streams.discard(self)

class Client:
    def __init__(self, *, bridge=None):
        self.bridge = bridge if bridge is not None else _bridge()
        self.closed = False
        self.tasks = set()
        self.streams = set()
    def _check(self):
        if self.closed:
            raise ShellError('closed', 'Shell client is closed')
    async def __aenter__(self):
        self._check()
        return self
    async def __aexit__(self, *ignored):
        await self.aclose()
    async def aclose(self):
        if self.closed:
            return
        self.closed = True
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        await asyncio.gather(*(stream.aclose() for stream in tuple(self.streams)))
    async def run(self, args, *, check=False, text=False, encoding=None, errors=None, **options):
        self._check()
        payload = _payload(args, text=text, encoding=encoding, errors=errors, **options)
        async def operation():
            value = self.bridge.call('run', payload)
            if inspect.isawaitable(value):
                value = await value
            return _result(args, payload, value, check=check, text=text, encoding=encoding, errors=errors)
        task = asyncio.create_task(operation())
        self.tasks.add(task)
        try:
            return await task
        finally:
            self.tasks.discard(task)
    async def script(self, source, **options):
        return await self.run(source, shell=True, **options)
    def stream(self, args, **options):
        self._check()
        return Stream(self, _payload(args, **options))

def _subprocess_run(args, *, stdin=None, stdout=None, stderr=None, input=None,
                    capture_output=False, shell=False, cwd=None, env=None, timeout=None,
                    check=False, text=False, encoding=None, errors=None, universal_newlines=None, **unsupported):
    if unsupported:
        raise NotImplementedError('Unsupported subprocess options: ' + ', '.join(sorted(unsupported)))
    if stdin not in (None, subprocess.PIPE, subprocess.DEVNULL) or stdout not in (None, subprocess.PIPE, subprocess.DEVNULL) or stderr not in (None, subprocess.PIPE, subprocess.DEVNULL):
        raise NotImplementedError('Only inherited, PIPE and DEVNULL standard streams are supported')
    if input is not None and stdin is not None:
        raise ValueError('stdin and input cannot both be supplied')
    if capture_output:
        if stdout is not None or stderr is not None:
            raise ValueError('capture_output cannot be combined with stdout or stderr')
        stdout = stderr = subprocess.PIPE
    if universal_newlines is not None:
        if text and not universal_newlines:
            raise ValueError('text and universal_newlines disagree')
        text = text or universal_newlines
    payload = _payload(args, shell=shell, input=input, cwd=cwd, env=env, timeout=timeout, text=text, encoding=encoding, errors=errors)
    payload.update(stdin='empty' if stdin in (subprocess.PIPE, subprocess.DEVNULL) else 'inherit',
                   stdout='capture' if stdout == subprocess.PIPE else 'discard' if stdout == subprocess.DEVNULL else 'inherit',
                   stderr='capture' if stderr == subprocess.PIPE else 'discard' if stderr == subprocess.DEVNULL else 'inherit')
    value = _bridge().call('run', payload)
    return _result(args, payload, value, check=check, text=text, encoding=encoding, errors=errors,
                   stdout=stdout == subprocess.PIPE, stderr=stderr == subprocess.PIPE)

def _check_output(args, **options):
    if 'stdout' in options:
        raise ValueError('stdout is not allowed with check_output')
    return _subprocess_run(args, stdout=subprocess.PIPE, check=True, **options).stdout

def _unsupported_popen(*args, **kwargs):
    raise NotImplementedError('Safe Bash does not expose OS processes; use run or check_output')
`;

export function installPythonShellModule(runtime: {
  readonly globals: { set(name: string, value: unknown): void; delete(name: string): unknown };
  runPython(source: string): unknown;
}): void {
  runtime.globals.set('_safe_shell_source', pythonShellModule);
  try {
    runtime.runPython(`
import sys as _safe_shell_sys, importlib.machinery as _safe_shell_imports
class _SafeShellLoader:
 def __init__(self, source, spec):
  self.source, self.spec = source, spec
 def find_spec(self, fullname, path=None, target=None):
  if fullname == 'poe_shell':
   return self.spec(fullname, self, origin='poe_shell.py')
 def create_module(self, spec):
  return None
 def exec_module(self, module):
  module.__file__ = 'poe_shell.py'
  exec(compile(self.source, 'poe_shell.py', 'exec'), module.__dict__)
_safe_shell_sys.meta_path.insert(0, _SafeShellLoader(_safe_shell_source, _safe_shell_imports.ModuleSpec))
import subprocess as _safe_subprocess
def _safe_subprocess_getattr(name):
 if name not in ('run', 'check_output', 'Popen'):
  raise AttributeError(name)
 from poe_shell import _subprocess_run, _check_output, _unsupported_popen
 import subprocess
 subprocess.run = _subprocess_run
 subprocess.check_output = _check_output
 subprocess.Popen = _unsupported_popen
 return getattr(subprocess, name)
del _safe_subprocess.run, _safe_subprocess.check_output, _safe_subprocess.Popen
_safe_subprocess.__getattr__ = _safe_subprocess_getattr
del _SafeShellLoader, _safe_shell_sys, _safe_shell_imports, _safe_subprocess
`);
  } finally {
    runtime.globals.delete('_safe_shell_source');
  }
}
