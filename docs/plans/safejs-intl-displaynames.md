# Intl.DisplayNames

The current built runtime has no Intl.DisplayNames. Add differential tests
before implementation for all six code types, required type, fallback,
style, languageDisplay, getter order, guest ToString, invalid codes, receiver
branding, construction, subclassing and descriptors.

Use private native formatter state, never passing guest objects to host Intl.
Perform guest option and code coercion in the interpreter. Support Node 18
without changing host globals. Add strict snapshot reconstruction, identity
and custom-prototype restoration, memory accounting and bounded output.

Deliver only after focused lint/tests, maintained selected workspace build
and built supported-Node probes. Track release publication independently.
This does not resolve remaining Intl services, weak collections, dynamic
functions, Proxy or other broader language gaps.

## Verification

- All 22 initial tests failed on the absent API before implementation.
- Seven private-state accounting and snapshot tests failed before integration,
  then passed with strict guest-displaynames serialization and reconstruction.
- Final focused file: 34 passing tests, including language-only resolved state,
  rejected forged snapshots, repeated custom-prototype restoration and budgets.
- Nearby RelativeTimeFormat and unchanged legacy-graph comparisons: 105 passed
  with one existing skip before the final language-state test was added.
  Explicit intrinsic addition maps include DisplayNames; saved fixtures and
  their comparison helper were not loosened.
- Selected workspace build: all 23 builds plus four fresh export import checks
  passed. An intermediate cleanup syntax error was caught and corrected before
  that build completed; the subsequent four-file tests passed.
- Node 18.18.0 and Node 24.14.0 each matched native DisplayNames in 540 built
  comparisons covering all six types, five locales, three styles, two fallback
  settings, and three codes per type. Resolved options were compared too.

Grouping previously published as @poe-platform/safe-js@0.1.454. This change
has its own commit/push and publication verification; do not infer publication
from local build success.
