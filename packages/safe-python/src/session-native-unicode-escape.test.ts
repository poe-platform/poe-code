import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {nativeUnicodeEscapeCases} from "./codec-native-unicode-escape-cases.js";
import warningReference from "./runtime/__snapshots__/source-literal-native-warning-position-3.14.7.json" with {type: "json"};

it.each(nativeUnicodeEscapeCases)("native Unicode escape: $name", ({source}) => {
  const session = new PythonSession({limits: {maxSteps: 500000, maxAllocatedBytes: 8000000, maxDepth: 100}, hashSeed: [1n, 2n]});
  const result = session.exec(source);
  let detail: string | undefined;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const diagnostic = session.eval("str(failure)");
    if (diagnostic.status === "ok") detail = String(diagnostic.value.primitive);
  }
  expect(result.status, detail).toBe("ok");
});

it.each(["unicode_escape", "raw_unicode_escape"])("%s cancellation escapes handlers and final flags", name => {
  for (const stage of ["handler", "final"]) {
    const controller = new AbortController();
    let reads = 0;
    const session = new PythonSession({
      limits: {maxSteps: 200000, maxAllocatedBytes: 4000000, maxDepth: 100}, hashSeed: [1n, 2n], signal: controller.signal,
      input: {readLine() {reads++; controller.abort(); return "cancelled\n";}}, output: {write() {}, flush() {}}
    });
    const result = session.exec(String.raw`
import _codecs
def handler(error):
    input()
    raise ValueError('handler failure')
class Final:
    def __bool__(self):
        input()
        return True
_codecs.register_error('cancel_escape', handler)
try:
    _codecs.${name}_decode(br'\uQ', 'cancel_escape', ${stage === "final" ? "Final()" : "True"})
except BaseException:
    raise AssertionError('caught cancellation')
`);
    expect(reads).toBe(1);
    expect(result).toMatchObject({status: "terminated", reason: "cancelled"});
  }
});

it.each(["success", "cancel"])("delivers native escape warnings through the explicit service: %s", mode => {
  const controller = new AbortController();
  const warnings: unknown[] = [];
  const session = new PythonSession({
    limits: {maxSteps: 200000, maxAllocatedBytes: 4000000, maxDepth: 100}, hashSeed: [1n, 2n], signal: controller.signal,
    warning(warning) {warnings.push(warning); if (mode === "cancel") controller.abort();}
  });
  const source = String.raw`
import _codecs
assert _codecs.unicode_escape_decode(br'\q\777') == ('\\q\u01ff', 6)
`;
  expect(source).toBe(warningReference.source);
  expect(warningReference.version.startsWith("3.14.7 ")).toBe(true);
  expect(warningReference.unicode).toBe("16.0.0");
  const result = session.exec(source, {filename: "native-escape.py"});
  // CPython 3.14.7 attributes this warning to line 3. The explicit service
  // additionally retains the interpreter's code-point call-site position.
  const {line, ...warning} = warningReference.warnings[0];
  expect(warnings).toEqual([{...warning, position: {offset: 23, line, column: 7}}]);
  expect(result).toMatchObject(mode === "cancel" ? {status: "terminated", reason: "cancelled"} : {status: "ok"});
});
