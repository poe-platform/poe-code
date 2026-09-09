# Function prototype lifetime

Baseline `524d913bd`: the initial 12-case native differential found eight
ordinary/arrow/async prototype failures with four generator controls passing.
Expanding to classes, built-in constructors and methods, object methods and bound
functions yielded 19 failures and five passes across 24 cases. Initially bound
functions passed, but binding a function after cleanup lost its prototype.

The function-default branch of `getSandboxPrototype` now uses the closure's
recorded realm to select Function or AsyncFunction prototypes. Explicit links
remain authoritative, including null and custom object prototypes. Unregistered
host closures and disabled legacy function-source mode keep their previous
fallback behavior. This does not retain released prototype accounting roots.

All 188 tests passed across seven focused function, class, snapshot, intrinsic
retention and data-accounting files. The new file includes 31 cases covering
the original matrix, replay after replacing Function, explicit overrides, and
inherited properties from the owning realm. Scoped lint and TypeScript passed.
The maintained build completed 23 workspaces and four fresh-process import
checks. All 1,700 tests in the 127-file snapshot suite passed. Eight built-SDK
probes verified functions created or retrieved after cleanup.

The separate `promise-foreign-newtarget.test.ts` audit validated two remaining
Promise default-prototype failures, with the custom-object prototype control
passing. Promise settlement remained correct in all three cases. This red audit
is not part of the function-prototype fix or its passing counts.

No full package gate, push, release, or issue closure.
