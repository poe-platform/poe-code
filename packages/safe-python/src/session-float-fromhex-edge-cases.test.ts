import { expect, it } from "vitest";
import { PythonSession } from "./index.js";
import reference from "./runtime/__snapshots__/float-fromhex-edge-cases-3.14.7.json";

it.each(reference.rows)("matches hexadecimal conversion edge cases: $group $literal", ({ literal, expected }) => {
  const session = new PythonSession({ limits: { maxSteps: 400000, maxAllocatedBytes: 4000000, maxDepth: 100 }, hashSeed: [1n, 2n] });
  const result = session.exec(`
events = []
class Text(str):
    def __str__(self):
        raise AssertionError('text conversion override')
class Number(float):
    def __new__(cls, value):
        events.append('new')
        return float.__new__(cls, value)
    def __init__(self, value):
        events.append('init')
text = ${literal}
for mode in ('base', 'subclass', 'descriptor'):
    events.clear()
    try:
        if mode == 'base':
            value = float.fromhex(text)
        elif mode == 'subclass':
            value = Number.fromhex(Text(text))
        else:
            value = float.__dict__['fromhex'].__get__(None, Number)(Text(text))
        actual = ('ok', float.hex(value))
        assert type(value) is (float if mode == 'base' else Number)
        assert events == ([] if mode == 'base' else ['new', 'init'])
    except (ValueError, OverflowError, UnicodeEncodeError) as error:
        actual = (type(error).__name__, str(error), error.args)
        assert events == []
    assert actual == ${expected}, (mode, actual)
`);
  let diagnostic: unknown = result;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    diagnostic = session.eval("repr(failure)");
  }
  expect(result.status, JSON.stringify(diagnostic, (_key, value) => typeof value === "bigint" ? String(value) : value)).toBe("ok");
});
