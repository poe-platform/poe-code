# Array accounting capture order and sparse traversal

Validated on remote-main f7de7bffe while its releases run. Unmanaged arrays are
measured by looping from zero to length and visiting each descriptor immediately.
Two regressions failed: a 2048-slot array with one element required 2048 descriptor
reads rather than one, and a retained-value callback in element zero erased a
400-character string in element one before it was measured (4 units rather than
404). Managed arrays and ordinary records already capture before invoking these
callbacks; unmanaged arrays should provide the same protection.

Candidate: enumerate own array-index keys, capture data values, then visit them.
Preserve length charging, non-enumerable indices, holes, no accessor invocation,
and existing named-property policy. Do not silently change managed-array charges.
Proxy arrays retain index-by-index descriptor lookup: an added regression showed
that ownKeys may omit a configurable index whose descriptor still exposes data.
The candidate initially undercounted that case (2 instead of 5); the fallback
restores its charge while retaining capture-before-visit behavior.

Verification so far: 55 focused tests pass, including all three complete native
camera comparisons, hidden indices, accessors, managed named properties, deletion,
cycles and the proxy case. The selected maintained build completed its 23-workspace
closure and all four built-import checks passed.

Four first-camera-case executions with complete native/fixture comparisons took
2586, 1984, 2187, 1921 ms on the preexisting build and 2429, 2337, 2229, 2411 ms on
the candidate build. The former was bundled and the selected workspace build is
unbundled, so these are not a controlled performance comparison. They do not show
a camera improvement. Sparse descriptor reads are demonstrably reduced from 2048
to one; this is not a verified camera CI fix. No timeout or comparison is changed.

An additional seven-file selection passed 97 tests covering managed arrays,
retained roots, budget ownership, accessor accounting and typed-array symbol
accounting (six array regressions overlap the first selection). Changed-file
ESLint passed. This internal accounting change has no visual CLI changes.
