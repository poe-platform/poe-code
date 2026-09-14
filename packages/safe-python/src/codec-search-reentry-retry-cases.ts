/** Complete programs for direct replay on the pinned external reference. */
export const codecSearchReentryRetryCases = ["miss", "malformed", "failure", "invalidate"].map(mode => ({
  mode,
  source: `import codecs
import encodings
codecs.unregister(encodings.search_function)
events = []
inner = (None, None, None, None)
failure = ValueError('outer search failed')
active = False
def search(name):
    global active
    events.append(name)
    if active:
        return inner
    active = True
    assert codecs.lookup('REENTRY PROBE') is inner
    assert input() == 'continue'
    ${mode === "invalidate" ? "codecs.unregister(search)" : "pass"}
    ${mode === "failure" ? "raise failure" : mode === "malformed" ? "return [None, None, None, None]" : "return None"}
codecs.register(search)
try:
    codecs.lookup('reentry-probe')
except ${mode === "failure" ? "ValueError" : mode === "malformed" ? "TypeError" : "LookupError"} as error:
    ${mode === "failure" ? "assert error is failure" : `assert error.args == (${JSON.stringify(mode === "malformed" ? "codec search functions must return 4-tuples" : "unknown encoding: reentry-probe")},)`}
else:
    assert False
assert events == ['reentry_probe', 'reentry_probe']
${mode === "invalidate" ? `try:
    codecs.lookup('reentry_probe')
except LookupError as error:
    assert error.args == ("no codec search functions registered: can't find encoding",)
else:
    assert False
codecs.register(search)` : "assert codecs.lookup('reentry_probe') is inner"}
assert codecs.lookup('reentry_probe') is inner
assert events == ${mode === "invalidate" ? "['reentry_probe', 'reentry_probe', 'reentry_probe']" : "['reentry_probe', 'reentry_probe']"}
codecs.unregister(search)
codecs.register(search)
assert codecs.lookup('REENTRY PROBE') is inner
assert events[-1] == 'reentry_probe'
print(${JSON.stringify(mode)}, events)
`
}));
