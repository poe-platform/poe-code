# Opt-in independent review driver

Run from this repository with an unused capture name:

```sh
node tests/shell/getopts-independent-20260827/run-review.mjs capture-01
```

Requires the existing Node/tsx/TypeScript development installation and the two
explicitly authenticated Darwin Bash paths in the frozen procedures. Installs
nothing, runs no shared build/default tests, and never imports live product code.
The eight acknowledged freeze files remain byte-identical. This driver commit
precedes evidence execution. Author tests are not rerun.

The candidate module has no imports, so its complete implementation closure is
`src/shell/getopts.ts`. The immutable Git tar contains that file and the actual
unchanged candidate `package.json`; a complete candidate tracked-entry inventory
is separately captured. This is a scoped committed-module archive, not extraction
or execution of the entire product. The package metadata is copied unchanged into
a staging package, declarations/ESM are built directly, the package is physically
moved, and the consumer imports the private emitted module by file URL. Its other
package exports are not built or certified. A loader records resolutions and
denies foreign product/source fallback. Source and package before/after inventories
include new entries, directories and symlink targets.

Each of 85 frozen scan projections is a result row; policy controls expand into
separately identified subcases. Some policy rows contain multiple boundary
assertions, not multiple invented tests. P27 includes a nested-microtask abort at
the final remainder callback to distinguish the final abort check from the abort
listener; this concretizes the frozen final-check expectation. P11 uses unknown
intents for reserved ASCII characters. The candidate's declared absent active
cursor and typed malformed-signal rejection resolve the freeze's representation
questions without rewriting it. Runtime rejection reasons use an explicit tagged
outcome, so false/zero/empty/null cannot masquerade as successful settlement.

Strict probes are materialized as individual unchanged prelude-plus-probe `.mts`
modules. One compiler program checks the two positives first; a second checks the
26 separate negative modules, attributing every diagnostic to its own probe.
This shares library parsing, not namespaces or expected failures. Diagnostics
outside a probe, prelude errors, missing modules and compiler failures cannot pass
a negative. Source and moved-declaration inventories identify actual compiler
inputs. Numeric safe-integer restrictions remain runtime checks.

Mutants patch only isolated copies of the authenticated source using apply_patch.
Each has a separate load check, exact patch, original/mutant hash and named-control
run. Meaningful assertion or in-harness cancellation-watchdog failures are kills;
process/load failures are not. Source and moved controls repeat after mutations.

Captures are immutable, opt-in candidate-version evidence: JSON/JSONL/TXT, tar,
`.ts.data`, `.d.ts.data`, `.js.data`, and `.patch.data`. No `.test.ts` is created.
Temporary compilation inputs live only under a uniquely named owned scratch
directory; successful completion verifies its parent/ownership marker and removes
that directory. Captured source/emitted bytes remain in classified data files.
Partial captures and scratch from failures must be retained for diagnosis and
cleaned only after an ownership check. Never rerun into an existing capture or
rewrite a failure; commit corrections separately and use a new capture name.

The final artifact manifest authenticates every prior entry; it cannot hash
itself and is instead bound by the evidence commit. All subprocesses use closed
stdin, capped capture and deadlines, and their exit is awaited. Product scanner
IO, public exports, builtin functionality and all Stage 2 wiring remain outside
acceptance.
