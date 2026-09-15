/** Public programs replayed unchanged against the pinned external oracle. */
export const codecSearchLifecycleUserCases = ["remove_self", "remove_next", "remove_previous", "append", "replace", "clear", "nested"].flatMap(action =>
  ["miss", "success", "invalid", "failure"].flatMap(outcome =>
    [false, true].map(duplicate => ({
      name: `${action}; ${outcome}; duplicate=${duplicate}`,
      source: `import codecs
import encodings
codecs.unregister(encodings.search_function)
events = []
outer = (1, None, None, None)
inner = (2, None, None, None)
failure = ValueError('guest search failure')
active = False
mutated = False
def previous(name):
    events.append(('previous', name))
    return None
def next_search(name):
    events.append(('next', name))
    return inner
def search(name):
    global active, mutated
    events.append(('search', name, active))
    if active:
        return inner
    if not mutated:
        mutated = True
        ${action === "remove_self" ? "codecs.unregister(search)" : action === "remove_next" ? "codecs.unregister(next_search)" : action === "remove_previous" ? "codecs.unregister(previous)" : action === "append" ? "codecs.register(next_search)" : action === "replace" ? "codecs.unregister(search)\n        codecs.register(next_search)" : action === "clear" ? "codecs.unregister(previous)\n        codecs.unregister(search)\n        codecs.unregister(search)\n        codecs.unregister(next_search)" : "active = True\n        print('nested', codecs.lookup(name) is inner)\n        active = False"}
    ${outcome === "miss" ? "return None" : outcome === "success" ? "return outer" : outcome === "invalid" ? "return (1, 2, 3)" : "raise failure"}
codecs.register(previous)
codecs.register(search)
${duplicate ? "codecs.register(search)" : ""}
codecs.register(next_search)
def probe(spelling):
    try:
        result = codecs.lookup(spelling)
    except BaseException as caught:
        print(type(caught).__name__, caught.args, caught is failure)
    else:
        print('codec', result is outer, result is inner)
    print(events)
    events.clear()
probe('Lifecycle-User')
probe('LIFECYCLE USER')
codecs.unregister(object())
probe('lifecycle_user')
codecs.register(next_search)
probe('Lifecycle_User')
codecs.unregister(next_search)
probe('LIFECYCLE-USER')
codecs.unregister(previous)
codecs.unregister(search)
codecs.unregister(search)
codecs.unregister(next_search)
codecs.unregister(next_search)
probe('lifecycle user')
`,
    })),
  ),
);
