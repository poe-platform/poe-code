/** These programs run unchanged on the pinned reference and public session. */
export const codecModuleCacheCases = [
  ...["encodings", "encodings.aliases", "encodings.ascii", "encodings.latin_1", "encodings.utf_8", "encodings.charmap"].map(name => ({
    name: `${name} cache metadata and import identity`,
    source: `
import ${name} as module
root = '/opt/homebrew/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/lib/python3.14/encodings/'
assert module.__cached__ == root + '__pycache__/${name === "encodings" ? "__init__" : name.slice(name.lastIndexOf(".") + 1)}.cpython-314.pyc'
assert type(module.__cached__) is str
assert module.__package__ == 'encodings'
marker = object()
module.__cached__ = marker
import ${name} as again
assert again is module and again.__cached__ is marker
del module.__cached__
import ${name} as third
assert third is module and not hasattr(third, '__cached__')
`
  })),
  {
    name: "native and frozen codec modules omit cache metadata",
    source: `
import codecs
import _codecs
assert not hasattr(codecs, '__cached__')
assert not hasattr(_codecs, '__cached__')
`
  }
];
