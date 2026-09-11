# Foreign RegExp compilation ownership

Baseline `b4f9d23ef`: six native differential cases fail with fatal reentry:
valid/invalid RegExp calls, new, bound and Proxy calls, and borrowed compile.

The intrinsic dispatcher passed the caller's compilation to a constructor
whose captured budget and compile owner belong to another realm. Select the
registered callee realm's saved compilation context for foreign calls. Leave
same-realm and unregistered-host dispatch unchanged. Do not change RegExp's
explicit foreign/stale-owner rejection or acquireCompileOwner checks.

The first fixed route passed 155 cases across five files, including ownership
admission and reentry tests. The expanded ten-case regression file adds replay
with replaced global bindings and bound/Proxy targets, plus caller coercion
error identity. Verification results follow when complete.
The broader regex/compiler-ownership, dynamic/eval and reentry route passed
430 tests across 22 files. Scoped lint, TypeScript and diff checks passed.
The full snapshot route passed 1,700 tests across 127 files. The maintained
build passed 23 workspace builds and four fresh-import checks. Four built-SDK
probes passed for ordinary, new, bound and Proxy calls.

Foreign intrinsic error prototypes remain a separate known defect. This change
does not claim a whole-package green result or resolve the workload deadlines
and native Promise import policy. No push, release or issue closure.
