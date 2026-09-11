# Intrinsic symbol accounting audit

This investigation arose while checking the camera symbol-scan optimization.
It is not a validated public data-budget bypass and has no runtime repair.

The current low-level `measureSandboxData([intrinsicFunction])` path uses
`intrinsicFunctionDataDescriptors`, whose Object.entries descriptor list omits
symbol keys. A focused isolated test confirms that changing a symbol payload
from `abc` to `abcdef` leaves this direct measurement at one unit. The control
using `budget.retainedValues()` correctly grows by three units (259182).

A public two-run probe exports Math.abs with a 20,000-character symbol payload,
then attempts to bind it into a new run with a 10,000-unit data budget. This does
not reproduce a bypass: replay-input admission rejects the binding with
`TypeError: Guest function properties and prototype links cannot be serialized.`
(d17b3a). The failure is admission, not the expected data-budget failure. Do not
change accounting policy merely to satisfy that speculative test.

The temporary failing tests were removed from the camera candidate; they must
not contaminate its broader qualification. Reproduction is preserved as a
standalone diagnostic at `/tmp/safejs-intrinsic-symbol-accounting-probe.mts`.
No existing project tests or runtime files were changed by this audit.

Further work, if pursued: establish a supported execution/replay path that
retains such a function after its intrinsic registry roots are released, or
confirm direct-root omission is intentional under all maintained callers.
Any repair must account for combined-root deduplication and callback ordering,
not simply append another symbol scan that double-charges live registry roots.
