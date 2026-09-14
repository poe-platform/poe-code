/** Run unchanged through CPython and the real session import machinery. */
export const codecParentPublicationCases = ["store", "discard", "failure", "attribute", "reenter", "service"].map(mode => ({
  name: mode,
  source: `
import encodings
events = []
failure = ValueError('publication failed')
class Package(type(encodings)):
    def __setattr__(self, name, value):
        events.append(name)
        assert value.__name__ == 'encodings.cp037'
        ${mode === "service" ? "assert input() == 'continue'" : "pass"}
        ${mode === "failure" ? "raise failure" : mode === "attribute" ? "raise AttributeError('publication refused')" : mode === "reenter" ? "assert __import__('encodings.cp037', fromlist=['getregentry']) is value" : "pass"}
        ${mode === "discard" ? "pass" : "super().__setattr__(name, value)"}
encodings.__class__ = Package
try:
    import encodings.cp037
except ValueError as error:
    assert ${mode === "failure" ? "error is failure" : "False"}
else:
    assert ${mode === "failure" ? "False" : "True"}
assert events == ['cp037'], events
child = __import__('encodings.cp037', fromlist=['getregentry'])
assert child.getregentry().name == 'cp037'
assert events == ['cp037'], events
assert ('cp037' in encodings.__dict__) is ${["store", "reenter", "service"].includes(mode) ? "True" : "False"}
print('verified')
`
}));
