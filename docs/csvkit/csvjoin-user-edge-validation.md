# csvjoin user edge validation, September 18 2026

Forty-five additional original csvkit 2.2.0 observations are frozen in
`csvjoin-user-edge-reference.json`. The CPython 3.9.6 environment replayed the
hash-locked requirements; the venv interpreter launcher SHA-256 is
`5c5950c62eee5fd227a67e4bdfcde81c9add59799bba0949635f3d5ba9661c26`, matching
the secondary reference profile. Installed csvjoin source SHA-256 is
`197d34b3ebb611a6ac38cdbac60bb4e62df2ed16d8844d375554faf5ca7affd1`, matching
the authenticated source. Captures use the exact environment recorded in the
JSON, with non-TTY pipes. Native Python is development reference tooling only.
Canonical tests use injected in-memory inputs and forbid input writes.

The first complete differential run reproduced eleven mismatches. Ten arose
from Agate locating the omitted right key column through value-sequence
equality: in an empty table it removes the first column even when a later key
was selected. The remaining mismatch was repeated stdin operands: the original
closes its wrapper after the first table, then errors on the second operand.
Both fixes are local to csvjoin. Additional equal-valued nonempty columns and
independently inferred Boolean/Decimal columns now match original omission
behavior. Work accounting bounds the column-equality scan. Full outer retains
all right columns; matching still uses the selected key.

Validation covers empty sides in every mode, outer precedence, keys outside
the first column, multi-input traversal, invalid selectors, header collisions,
stdin reuse, singleton numeric headers, BOM and line numbers. All 45 new cases
and 28 previous csvjoin tests pass. The maintained csvkit workspace test passes
1,962 tests across 43 files; one skip and six TODOs remain explicit blockers.
Maintained csvkit lint and source/test TypeScript checks pass. The selected
safe-bash maintained build closure passes ten declared workspace builds and
suffix stages. Actual safe-bash focused tests pass 34 cases, including nine
new independent-agent cases. Discovery checks pass 109 tests; the changed
literal registration assertion is also checked separately.
Maintained safe-bash typecheck passes source/tests and its declared consumer
profiles; this is compile acceptance rather than runtime-provider qualification.
The required guarded root `npm run lint:eslint` completes with exit 0, zero
errors and two unrelated unused-variable warnings. Its receipt reports 15,878
configured inputs linted; exclusions retain the guard's declared scope.

The independent agent verified argv clusters, quoted paths, option terminators,
redirection effects, stdin/file ownership, early-parser no-acquisition, aggregate
input bounds, backpressure, cancellation reason identity and disposal cleanup.
Both bugs also reproduced red and then green through actual Shell invocation.
The maintained screenshot route rendered the changed empty-table left/right
headers and repeated-stdin error; visual inspection confirmed legible output,
correct headers and status without clipping.

This is scoped csvjoin qualification. Exhaustive dialect, locale and temporal
grammars, native signals/TTY and uncooperative host capabilities remain
unmeasured; unsupported shared reader quoting and deployment identities retain
their existing blockers. Materialization remains intentional and bounded, with
no streaming or measured RSS claim. No README additions, staging, commits,
pushes or publication were performed; unrelated changes remain untouched.
