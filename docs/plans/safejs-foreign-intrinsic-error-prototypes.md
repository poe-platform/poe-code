# Foreign intrinsic error prototypes

Baseline `0899c510f`: ten native differential cases failed for borrowed dynamic
constructors, eval, Array, Number.toFixed, Map.get, JSON.parse and Object.keys.
Three caller-error identity/realm controls passed.

Materialize newly raised errors with the foreign intrinsic's execution budget
before they reach caller-side catch conversion. Cover both immediate throws and
host promises used internally to implement async interpreter operations. Do
not re-convert captured errors or alter fatal-budget handling. Unregistered host
calls and same-realm calls keep their existing paths.

The first fix passed all 13 cases. The expanded 17-case file includes invalid
RegExp syntax and JSON.parse replay with ordinary/bound/Proxy calls and replaced
global bindings. Error stacks, source spans, host error causes, snapshot and
budget boundaries need verification before committing.
The expanded error/source-stack/host-boundary route passed 361 tests across
15 files. Scoped ESLint, TypeScript and diff checks passed.
The full snapshot route passed 1,700 tests across 127 files. The maintained
build passed 23 workspace builds and four fresh-import checks. Four built-SDK
probes passed for Function/Array/Object.keys/RegExp error prototype identity.

This does not resolve workload deadlines, host-Promise import policy or wider
JavaScript completeness. No push, release or issue closure.
