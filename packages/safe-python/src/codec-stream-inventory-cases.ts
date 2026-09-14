const modules:Readonly<Record<string,readonly string[]>>={
  codecs:['Codec','IncrementalEncoder','BufferedIncrementalEncoder','IncrementalDecoder','BufferedIncrementalDecoder','StreamReader','StreamWriter','StreamReaderWriter','StreamRecoder'],
  'encodings.ascii':['Codec','IncrementalEncoder','IncrementalDecoder','StreamReader','StreamWriter','StreamConverter'],
  'encodings.latin_1':['Codec','IncrementalEncoder','IncrementalDecoder','StreamReader','StreamWriter','StreamConverter'],
  'encodings.utf_8':['IncrementalEncoder','IncrementalDecoder','StreamReader','StreamWriter']
};

/** Complete own-member inventories, including non-callable members and
 * descriptors; function records retain signatures, annotations and locations. */
export const codecStreamInventoryCases=Object.entries(modules).flatMap(([module,names])=>names.map(name=>({
  name:`${module}.${name}`,
  source:`
module = __import__('${module}', fromlist=['*'])
cls = getattr(module, '${name}')
print(list(cls.__dict__))
print(cls.__module__, cls.__qualname__, cls.__firstlineno__, cls.__static_attributes__, cls.__doc__)
for name, member in cls.__dict__.items():
    print(name, type(member).__name__)
    if type(member).__name__ == 'function':
        code = member.__code__
        print(member.__name__, member.__qualname__, member.__module__, member.__doc__, member.__defaults__, member.__kwdefaults__, member.__annotations__)
        print(code.co_argcount, code.co_posonlyargcount, code.co_kwonlyargcount, code.co_varnames, code.co_firstlineno, code.co_filename, code.co_flags, member.__annotate__)
    elif type(member).__name__ == 'getset_descriptor':
        print(member.__name__, member.__qualname__, member.__objclass__ is cls, member.__doc__)
`
})));
