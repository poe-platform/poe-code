# SDK builtin input lifetime

At 882c1524f, three new native-backed tests fail after run completes:
Iterator.from with an array or Uint8Array produces a wrapper whose next is not
callable; a string input throws Expected a sandbox object or function.
The reproducer exports Iterator.from and the input together before calling the
SDK closure, then calls the resulting iterator's next closure.

Evidence from current implementation:

- getSandboxPrototype uses per-budget fallback tables for default arrays and
  concrete typed arrays.
- setSandboxPrototype returns without storing an explicit link when the requested
  prototype already equals the budget fallback, except for null.
- releaseObjectPrototype removes fallback tables when run finishes.
- Iterator.from's fallback guest-property reader does not box primitive strings.

This connects the earlier internal-adapter observation to a supported exported
SDK call, but does not establish a single safe implementation yet. Retaining all
run state or substituting native iteration would evade rather than resolve the
required guest prototype/mutation semantics.

Implementation must preserve originating-realm prototype mutations, own/custom
iterator methods and explicit null prototypes, correct primitive boxing, and
memory-accounting/cleanup invariants. Review intrinsic-prototype-retention,
intrinsic-shared-retention, empty-retained-values, prototype-realm-free, and SDK
iterator tests before changing lifetime behavior. Do not revive another realm's
prototypes or retain a completed run indiscriminately.

Three regression cases are in iterator-sdk-builtin-input.test.ts. A follow-up
explicit-prototype-link repair makes the typed-array case pass; array and string
cases still fail. See safejs-explicit-prototype-lifetime.md for that atomic change
and its verification. This broader SDK-input issue is not complete. Pushes and
releases remain paused.

Further source inspection: evaluateArrayExpression creates an ordinary internal
array without storing an originating prototype. createArrayGlobal also skips
setSandboxPrototype when constructing with the default prototype, and its call
path delegates directly to createArrayFromConstructorArgs. The latter allocates
arrays without an explicit link. A fix limited to Iterator.from would miss these
creation paths and other SDK operations. Primitive reads need originating-realm
boxing support; sandboxGetProperty deliberately starts with objectProperties,
so passing strings directly to that object-only helper cannot work.

The array-literal follow-up now makes the array input case pass too. It keeps
the originating array fallback for live SDK closures and attaches literal
prototype links at creation. See safejs-array-literal-prototype-lifetime.md for
the generator override case, regression findings, and verification. Only the
primitive-string case remains failing in this three-case reproducer; this does
not establish coverage of all other array creation paths.

A read-only built-SDK probe supplied an explicit getProperty hook that resolves
string Symbol.iterator through the exported originating String.prototype.
Empty strings, "ab", an emoji followed by z, and a lone high surrogate followed
by x then produced the same first iterator result as native Iterator.from.
This isolates the default SDK property reader as the basic-string failure;
it does not validate accessor receivers, Proxy ancestors, later mutations, or
memory accounting. The eventual implementation must retain those semantics,
not substitute host-native string iteration. Source/test inputs were unchanged
while the full package run was active.

## String repair

At fb23739dd, five native-backed string cases fail before implementation:
ordinary, empty, emoji, lone-surrogate, and a post-cleanup prototype getter with
a strict primitive receiver. Array and typed-array controls pass. Capture the
originating String.prototype when installing Iterator.from. Its default SDK
property reader boxes a string only for lookup, links the box to that prototype,
and passes the original primitive as the receiver through shared guest reads.
Caller-supplied property hooks remain authoritative. No native iterator shortcut
or global host prototype is used.

All 11 focused tests pass after repair. They include the five prior failures,
array and typed-array controls, invalid undefined/null/non-callable iterator
methods, and a Proxy ancestor with native-matching trap and primitive-receiver
observations. The originating prototype remains observable after a second realm
has run. Broader iterator/string/boxed/Proxy/retention checks pass 4,454 tests
across 157 files (96.31 seconds). Scoped ESLint and package TypeScript pass.
The maintained workspace build closure passes 23 builds and four fresh-process
import checks. A built-ESM SDK smoke check iterates an emoji followed by z through
both characters and completion without a caller-supplied property hook.

The original three-case SDK input reproducer is now passing. Other creation
paths remain covered by the separate SDK creation-realm audit; this does not
claim complete JavaScript or SDK conformance. Pushes and releases remain paused.
