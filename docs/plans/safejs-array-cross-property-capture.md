# Array cross-property capture

On main 3c63e719a, a retained callback stored under a symbol property can truncate
an array before its length and indexed values are measured. A focused test failed
with 4 units rather than 405. The earlier indexed-sibling fix does not cover this
order: common symbol/private/prototype traversal precedes the array branch.

Capture the array length and its applicable own descriptors/data values before
traversing retained children. Keep unmanaged arrays' index-only policy and their
proxy index lookup fallback. Keep managed descriptor key and accessor charges.
Use compact value capture for unmanaged arrays, not per-index descriptor tuples.

Tests cover ordinary and managed indexed data, managed named data deleted by a
symbol callback, and symbols deleted by indexed callbacks. Existing sparse,
proxy, getter, cycle and managed-accounting tests remain unchanged.

The first candidate passed its accounting tests but one camera case timed out at
the existing 5000 ms. A subsequent run passed 27 tests including all camera cases.
This is not proof the intermittent camera timeout is fixed. The current candidate
also avoids descriptor-pair allocation for unmanaged indices; its verification is
complete: 77 tests across eight focused files pass, including the camera native
and fixture comparisons. Changed-file ESLint and TypeScript checks pass. The full
repository suite was not run for this focused internal change.
Do not raise timeouts, remove native comparisons or claim publication
from a push alone. This internal change has no visual CLI impact.
