/** Public programs also executed unchanged by the pinned external oracle. */
export const codecRegistryBindingCases = ["encode", "decode"].flatMap(operation =>
  ["obj", "encoding", "errors"].flatMap(parameter =>
    ["false", "true", "equality-failure", "render-failure"].map(mode => ({
      name: `${operation} repeated ${parameter} keyword (${mode})`,
      source: `
import _codecs
events = []
failure = ValueError('keyword callback failed')
class Key(str):
    def __hash__(self):
        return id(self)
    def __eq__(self, other):
        events.append(other)
        ${mode === "equality-failure" ? "raise failure" : `return ${mode === "true" ? "True" : "False"}`}
    def __str__(self):
        events.append('str')
        ${mode === "render-failure" ? "raise failure" : "return 'visible'"}
def search(name):
    raise AssertionError('lookup before keyword validation')
_codecs.register(search)
keywords = {Key('${parameter}'): 'first', Key('${parameter}'): 'second'}
assert len(keywords) == 2
try:
    _codecs.${operation}(${parameter === "obj" ? "" : "b'x', "}**keywords)
except ValueError as error:
    assert ${mode.endsWith("failure") ? "True" : "False"}
    assert error is failure
except TypeError as error:
    assert error.args == (${JSON.stringify(mode === "true" ? `invalid keyword argument for ${operation}()` : `${operation}() got an unexpected keyword argument 'visible'`)},)
else:
    assert False
assert events == ${JSON.stringify(mode === "true" ? ["obj", "obj"] : mode === "equality-failure" ? ["obj"] : ["obj", "encoding", "errors", "str"])}, events
`
    }))
  )
);
