/** Unchanged guest programs for the pinned external differential oracle. */
export const sourceCoreHandlerCases = [
  ...["ascii", "utf8"].flatMap(encoding => ["compile", "exec", "eval"].map(operation => ({
    name: `${encoding} ${operation} strict recovery`,
    source: `import codecs
events = []
def handler(error):
    events.append((error.encoding, error.object, error.start, error.end, error.reason))
    return ('#', error.end - len(error.object))
codecs.register_error('strict', handler)
source = b'# coding: ${encoding}\\r\\n#\\xff\\r\\n42'
${operation === "compile" ? "code = compile(source, 'source.py', 'eval')\nprint(eval(code))" : operation === "eval" ? "print(eval(source))" : "exec(source)"}
print(events)
`
  }))),
  {name: "canonical UTF-8 keeps tokenizer validation", source: `import codecs
def handler(error):
    raise AssertionError('must not call handler')
codecs.register_error('strict', handler)
try:
    compile(b'# coding: utf-8\\n#\\xff\\n', 'source.py', 'exec')
except SyntaxError as error:
    print(error.msg, error.filename, error.lineno)
`},
  {name: "native source recovery output is validated and translated", source: `import codecs
replacement = ''
def handler(error):
    if isinstance(error, UnicodeEncodeError):
        raise error
    error.object = b''
    return (replacement, 0)
codecs.register_error('strict', handler)
for replacement in ('\\rvalue = 42\\r', '\\x00ignored', '\\ud800', '\\ud800\\udc00'):
    try:
        exec(b'# coding: ascii\\n#\\xff')
        print('ok', globals().get('value'))
    except SyntaxError as error:
        print(error.msg, error.lineno, error.offset)
`},
  {name: "source strict callback services and failures", source: `import codecs
failure = None
def handler(error):
    print('recover', error.encoding)
    assert input() == 'ready'
    if failure is not None:
        raise failure
    return ('#', error.end)
codecs.register_error('strict', handler)
for failure in (None, ValueError('bad value'), TypeError('bad type')):
    try:
        exec(b'# coding: ascii\\n#\\xff\\n')
        print('ok')
    except BaseException as error:
        print(type(error).__name__, error is failure, str(error))
`}
] as const;
