/** Executed by CPython after canonical storage and byte streams are installed. */
export const pythonExecution = `
import sys, os, json, runpy, traceback, types, warnings, textwrap, io, struct, linecache
_safe_invocation = json.loads(_safe_invocation_json)
os.environ.clear()
os.environ.update(_safe_invocation['env'])
_safe_args = list(_safe_invocation['args'])
sys.orig_argv = [_safe_invocation.get('command', 'python')] + _safe_args
_safe_exit = 0

class _SafeOptionError(ValueError):
 pass

def _safe_system_exit(_error):
 if isinstance(_error.code, int):
  _status = int.__index__(_error.code)
  _long_bound = 1 << (8 * struct.calcsize('@l') - 1)
  status = (_status & 255) if -_long_bound <= _status < _long_bound else 255
 else:
  status = 0 if _error.code is None else 1
 if _error.code is not None and not isinstance(_error.code, int):
  print(_error.code, file=sys.stderr)
 return status

def _safe_launch():
 args = list(_safe_args)
 unbuffered = False
 ignore_env = bool(sys.flags.ignore_environment)
 safe_path = bool(sys.flags.safe_path)
 native_warning_options = list(sys.warnoptions)
 # Pyodide adds a bootstrap cwd entry even when CPython safe-path mode is set.
 # Each execution mode below supplies its own entry after explicit PYTHONPATH.
 sys.path[:] = [entry for entry in sys.path if entry != '']
 warning_options = []
 version_count = 0
 options_terminated = False
 while args and args[0].startswith('-') and args[0] != '-':
  option = args.pop(0)
  if option == '--':
   options_terminated = True
   break
  if option in ('--help', '-h', '-?'):
   print('usage: python [-uBEPOsSIbdvqR] [-W filter] [-X option] [-c code | -m module | file | -] [args ...]')
   print('Dedicated Pyodide interpreter; stdin is noninteractive.')
   print('-u: unbuffered binary output; -B: disable bytecode writes; -E: ignore PYTHON* settings')
   print('-P: omit automatic unsafe sys.path entry; -W: Python warning filter')
   print('-O/-OO, -S/-s/-I, -b/-bb, -d/-v/-q/-R: CPython startup flags')
   print('-X: utf8, dev, warn_default_encoding, int_max_str_digits; interactive flags are unsupported.')
   return
  if option == '--version':
   version_count += 1
   continue
  if option.startswith('--'):
   raise _SafeOptionError('unsupported option ' + option)
  index = 1
  while index < len(option):
   flag = option[index]
   if flag in ('h', '?'):
    args = ['--help']
    break
   if flag == 'V':
    version_count += 1
    index += 1
    continue
   if flag in ('c', 'm', 'W', 'X'):
    operand = option[index + 1:] if index + 1 < len(option) else args.pop(0) if args else None
    if operand is None:
     raise _SafeOptionError('argument expected for -' + flag)
    if flag in ('W', 'X'):
     if flag == 'W': warning_options.append(operand)
     break
    args = ['-' + flag, operand] + args
    break
   elif flag in ('O', 'S', 's', 'I', 'b', 'd', 'v', 'q', 'R'):
    pass # Applied by CPython startup configuration before bootstrap.
   elif flag == 'u':
    unbuffered = True
   elif flag == 'B':
    sys.dont_write_bytecode = True
   elif flag == 'E':
    ignore_env = True
   elif flag == 'P':
    safe_path = True
   else:
    raise _SafeOptionError('unsupported option -' + flag)
   index += 1
  if args and args[0] in ('-c', '-m'):
   break
 if version_count:
  print('Python ' + (sys.version if version_count > 1 else sys.version.split()[0]))
  return
 if not ignore_env:
  unbuffered = unbuffered or bool(os.environ.get('PYTHONUNBUFFERED'))
  sys.dont_write_bytecode = sys.dont_write_bytecode or bool(os.environ.get('PYTHONDONTWRITEBYTECODE'))
  safe_path = safe_path or bool(os.environ.get('PYTHONSAFEPATH'))
  path = os.environ.get('PYTHONPATH')
  if path:
   sys.path[0:0] = [os.path.abspath(entry) for entry in path.split(os.pathsep)]
  if os.environ.get('PYTHONWARNINGS'):
   warning_options[0:0] = os.environ['PYTHONWARNINGS'].split(',')
  encoding = os.environ.get('PYTHONIOENCODING')
  if encoding:
   name, separator, errors = encoding.partition(':')
   for stream in (sys.stdin, sys.stdout):
    stream.reconfigure(encoding=name or None, errors=(errors or 'strict'))
   sys.stderr.reconfigure(encoding=name or None, errors='backslashreplace')
 # CPython's -b/-bb filter follows environment and command-line -W filters.
 byte_warning = ('error' if sys.flags.bytes_warning > 1 else 'default') + '::BytesWarning'
 native_before = [value for value in native_warning_options if not (sys.flags.bytes_warning and value == byte_warning)]
 warning_options = native_before + warning_options + ([byte_warning] if sys.flags.bytes_warning else [])
 warnings._processoptions(warning_options)
 sys.warnoptions[:] = warning_options
 if unbuffered:
  for name in ('stdout', 'stderr'):
   stream = getattr(sys, name)
   stream.flush()
   encoding, errors = stream.encoding, stream.errors
   binary = stream.detach()
   raw = binary.detach() if hasattr(binary, 'detach') else binary
   replacement = io.TextIOWrapper(raw, encoding=encoding, errors=errors, write_through=True)
   setattr(sys, name, replacement)
   setattr(sys, '__' + name + '__', replacement)
 main = types.ModuleType('__main__')
 main.__dict__.update(__package__=None, __spec__=None, __loader__=__import__('importlib.machinery', fromlist=['BuiltinImporter']).BuiltinImporter, __builtins__=__builtins__)
 sys.modules['__main__'] = main
 if not options_terminated and args and args[0] == '-c':
  sys.argv = ['-c'] + args[2:]
  if not safe_path: sys.path.insert(0, '')
  source = textwrap.dedent(args[1])
  code = compile(source, '<string>', 'exec')
  # CPython 3.14 retains -c source for both top-level and nested tracebacks.
  linecache._register_code(code, source, '<string>')
  exec(code, main.__dict__)
 elif not options_terminated and args and args[0] == '-m':
  sys.argv = args[1:]
  if not safe_path: sys.path.insert(0, os.getcwd())
  runpy._run_module_as_main(args[1], alter_argv=True)
 elif not args or args[0] == '-':
  sys.argv = (['-'] + args[1:]) if args else ['']
  if not safe_path: sys.path.insert(0, '')
  main.__file__ = '<stdin>'
  exec(compile(sys.stdin.buffer.read(), '<stdin>', 'exec'), main.__dict__)
 else:
  sys.argv = args
  # CPython makes __file__ absolute without collapsing ./ or ../ components.
  path = args[0] if os.path.isabs(args[0]) else os.path.join(os.getcwd(), args[0])
  importer = __import__('pkgutil').get_importer(path)
  if importer is not None:
   sys.path.insert(0, path)
   runpy._run_module_as_main('__main__', alter_argv=False)
  else:
   if not safe_path: sys.path.insert(0, os.path.dirname(os.path.realpath(path)))
   try:
    with open(path, 'rb') as source:
     code = source.read()
   except OSError as error:
    print("python: can't open file " + repr(path) + ': [Errno ' + str(error.errno) + '] ' + error.strerror, file=sys.stderr)
    return 2
   main.__file__ = path
   main.__loader__ = __import__('importlib.machinery', fromlist=['SourceFileLoader']).SourceFileLoader('__main__', path)
   exec(compile(code, path, 'exec'), main.__dict__)
 return 0

try:
 _safe_exit = _safe_launch() or 0
except SystemExit as _error:
 _safe_exit = _safe_system_exit(_error)
except _SafeOptionError as _error:
 print('python: ' + str(_error), file=sys.stderr)
 _safe_exit = 2
except BaseException as _error:
 # Hide bridge frames while preserving actual Python frames and chained errors.
 _trace = _error.__traceback__
 while _trace is not None and _trace.tb_frame.f_code.co_filename == '<exec>':
  _trace = _trace.tb_next
 _error.__traceback__ = _trace
 sys.last_exc = _error
 _safe_exit = 130 if isinstance(_error, KeyboardInterrupt) else 1
 try:
  sys.excepthook(type(_error), _error, _trace)
 except SystemExit as _hook_error:
  _safe_exit = _safe_system_exit(_hook_error)
 except BaseException as _hook_error:
  print('Error in sys.excepthook:', file=sys.stderr)
  traceback.print_exception(type(_hook_error), _hook_error, _hook_error.__traceback__.tb_next)
  print('\\nOriginal exception was:', file=sys.stderr)
  sys.__excepthook__(type(_error), _error, _trace)
finally:
 for _stream in (sys.stdout, sys.stderr):
  if _stream is not None and not getattr(_stream, 'closed', False):
   try:
    _stream.flush()
   except BaseException:
    _safe_exit = 120
_safe_exit
`;
