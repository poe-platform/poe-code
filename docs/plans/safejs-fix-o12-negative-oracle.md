# O12 modern negative-oracle repair

Date: August 29, 2026. Role: delegated test/procedure author.
Workspace: `/Users/kjopek/Workspace/poe-code-safejs-o12-negative-oracle-repair`.
This is an O12 validation successor, not a production repair, publication
authorization, or final all-stack verdict.

## Baseline and immutable inputs

The new single-branch main clone successfully ran
`git -c pull.rebase=false pull --ff-only` before any edits. Its base is
`b06e79ab841765f06d0a577230f10db28f98c457`.

- Curie public-receipt handoff:
  `5080142b0411bd0f27381271451b7caaa724620f0ac30fcd254f372aede86220`.
- Laplace negative-oracle adjudication:
  `0cfc3025ef3708f8308c17aafde9b15de9889232c46e2d860efdcaef736b2cf3`.
- Final PPR2 packaging publication:
  `31d14e25974bf910ec253539458085d903d1c38a6ccd3551b2f4992b1dd136b0`.
  Those files are already on main.
- Final PPR1:
  `cabdebcc481a7371d373000c4990a9bc36c233808f796b692dff76ed1fe9d94b`.
- Root-approved H5 final 17-file handoff:
  `7f35f5565452ca9985b6f7eca3a05f0c0475cbc0e2e0d5e4afe26c023b226d67`.
  Its two production postimages exactly match the original
  `6f58c7ec1dbcd579f9132be1819290bb47d046e75ae7ed6c25249b870f91ee74`
  source handoff.

Prerequisites are separate from the O12 delta. The newer main interpreter
bookkeeping/receiver behavior is preserved; historical whole-file prerequisites
are not overlaid onto it. No other clone, original audit input, README, version
marker, historical fixture, production function, or public bundle is edited by
this O12 repair. There are no commits, pushes, branches, or skill synchronization.
The copied guard retains all 38 excluded audit paths and the entire `security/`
directory, with an empty payload allowlist.

Root's separately assigned PPR2 release-smoke repair and paused publication queue
do not authorize runtime rollback or work in this lane. Map and HOST findings
remain open scopes; this report makes no disposition of either.

## Reproduced RED and native adjudication

The unchanged Curie test has SHA-256
`88cc5e1fec7f211e2901f79a7ad322fd39fc389fd23bac79db98d5dcc2965ae8`.
It reproduces **6 pass / 2 fail** against both the current public source entry
and the freshly built standard public package. The failing selectors are exactly:

- `classifies minimal proof 1 against the same capture and request`
- `classifies minimal proof 2 against the same capture and request`

The same unmodified test and the SHA-verified historical standard public package
from Laplace's capsule still pass **8/8**. These old test bytes, old successful
results, and the modern failing captures are retained independently. None is
rewritten or relabeled as a repaired historical run.

The revised test passes **8/8** against both current source and the freshly built
standard package. All eight selectors, both repetitions of every projection,
the original guest source, and the original expectation fixture remain present.

The native procedure is copied unchanged from the frozen Laplace Markdown
control. Fresh author executions use the current built capture/request and the
actual native Error or each of the two genuine minimal proof objects. All three
controls produce `true` for `inputOutcomes[0].same` and `trace[2][4]`; repeated
rejection reason identity also remains true. The full value, calls, host trace,
and acknowledgements equal the original fixture. All three controls use capture
SHA-256 `e67ba237d4782c578f487b43aaceb4f5d4ab3574fefbf7c040ca52af4e41bc6f`.
These are author reruns of an adjudicated procedure, not a new independent review.

## Authorized assertion change

The sole changed executable publication file is
`packages/safejs/test/integration/input-error-projection.test.ts`.

Remove only the branch that synthesized two false fields in a cloned native
expected value. Do not add a runtime/version switch or accept whichever identity
happens to appear. The modern full value is required to equal the unchanged
native expected value, and the minimal branch explicitly requires both identities
to be true.

The minimal projection remains a **negative modeled-receipt control**:

- `modeledReasonIdentity` is false and the supplied reason is not the publicly
  recovered modeled receipt.
- Its complete own-property list is exactly `message` and `name`; no own `stack`
  exists.
- Its entire encoded graph is asserted, including root, node count, null
  prototype, extensibility, property values, and descriptors. `errorType` and
  `properties.stack` are absent.
- A separate expected journal is cloned from the complete captured five-row
  journal. Only the rejected outcome's `errorType` and stack descriptor are
  removed. The resulting outcome must equal the explicit minimal graph, and the
  **entire** actual journal must equal that expected negative journal and differ
  from the original complete journal.

This expected negative journal is not an edited actual capture, proof, or receipt.
Existing capture/receipt immutability assertions remain in force. Any additional
metadata, descriptor, lifecycle, ID, outcome, or journal difference fails.

All existing complete-proof assertions remain: genuine public completed-replay
receipt recovery, Error tag, exact modeled stack, reason aliases, exact encoded
outcome and whole journal, request/call identity, accepted outcome, zero
callbacks, five consumed calls, input graph and settlement-prefix preservation,
and exact fresh completed replay with zero host calls/proof requests. The
native-fields projection and generic raw Error rejection qualification are
unchanged. Equal full returned values do not make a minimal proof complete.

## Public artifact and fixture closure

The test child imports only the public SafeJS API. Source mode builds an in-memory
bundle of public exports; built mode resolves the ordinary `@poe-code/safejs`
package. No private codec, private export, bundle instrumentation, brand forging,
snapshot metadata replacement, or native Error reinterpretation is added.
Complete receipts come from genuine public completed replay. H5's independently
approved context converter remains an allowed public path, not a new O12 bridge.

The two runtime fixtures are package-relative and immutable:

- `packages/safejs/test/fixtures/input-error-projection/01-input-batch-scan.ajs`:
  `8344978a75b367325409f07193a28977225c5c833a65e5a14537f2fd9b5cb005`.
- `packages/safejs/test/fixtures/input-error-projection/expectations.fixture`:
  `00513a4fddf25e46365c7cd51e981fda86b785f3fdedf8cf85983e6cdc56505c`.

No O12 test/fixture depends on an original audit path, old clone, or ignored
`out` file. Historical runtime projections and typed observations under `out`
are verification artifacts only. They are not dependencies of the published
eight-case suite. The final PPR2 packaged history fixtures, rather than the old
ignored evidence paths, are used by the default composed test tree.

## Publication scope

Carry Curie's five publication paths forward: its historical report, test,
configuration, and two fixtures. Only the test changes. Add this successor plan
and the unchanged, uniquely named Laplace adjudication report. The resulting O12
publication contains **seven paths**, with **zero O12 production paths**.
The repair-only delta against the two frozen handoffs contains one modified test
and this new plan. Their preimages/postimages and the larger prerequisite stack
are recorded separately in the final manifest.

## Validation procedure

Install the lockfile with `SKIP_SYNC_SKILLS=1 npm ci` and a clone-local npm cache.
Run source and built modes without altering the standard bundle. Record all
eight outcomes and the native same-capture/request controls as full V8 evidence,
not scalar-only summaries. Keep the old historical 8/8 and modern 6/8 records.

```sh
env -u TERM SKIP_SYNC_SKILLS=1 npm run build
env -u TERM ./node_modules/.bin/vitest run --config packages/safejs/test/input-error-projection.vitest.config.ts
env -u TERM SAFEJS_O12_API=built ./node_modules/.bin/vitest run --config packages/safejs/test/input-error-projection.vitest.config.ts
env -u TERM npm run lint:types
env -u TERM ./node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit
env -u TERM npm run lint:eslint
env -u TERM npm run lint:packages
env -u TERM ./node_modules/.bin/vitest run
git diff --check
```

The clean projection consists of main's tracked tree plus only the explicit
prerequisite and O12 publication paths, with a fresh pinned dependency install
and standard build. Do not copy ignored evidence into it to make tests pass.
Run the full root suite with its default configuration and timeouts; the
unchanged dedicated O12 configuration is not a full-root timeout override.
Run configured types and explicit introduced-test roots, preserving any exact
inherited diagnostic comparison rather than repairing unrelated legacy types.
Check all supported publication formats and strict whitespace; the two exact
opaque fixtures are hash-checked, not reformatted.

## Fresh author gate results

The clean projection uses `git archive` of the pinned main base plus 107 explicit
composite publication paths. It has its own successful lockfile install and full
standard build. It contains no ignored `out` support directory, either before
installation or after the default full suite. Its package resolution stays inside
the clean projection; no dependency points into another worker's clone.

- Unchanged historical public package and unchanged Curie test: **8/8**.
- Unchanged Curie test on current source and current built package: **6/8** each,
  preserving the two genuine RED failures.
- Repaired current source and standard built package: **8/8** each, repeated
  successfully in the independently installed clean projection.
- Fresh native actual-Error and minimal-1/minimal-2 controls: **3/3**. Both disputed
  identities are true in every control; full values and native call traces match.
- Default clean full-root suite: **25,860 passed, 41 skipped, zero failed**.
  No timeout, exclusion, root configuration, or runtime version changes are used.
- All 32 explicitly composed regression test files pass in that full-root run,
  totaling **784 assertions**. This includes the 23 shadow-array controls,
  PPR1/H5/CBI/AR controls, six working v6 cases, genuine historical raw-v6
  TypeError qualifications, and the 36 preserved v6 generations. None is relabeled
  as a newly repaired historical snapshot.
- Configured root lint (ESLint, types, workflows), package lint, SafeJS types,
  and the H5 test-type configuration pass. Explicit strict typing of all
  **38 introduced/clean roots** passes with zero diagnostics.
- The broader matching **42-root** baseline/candidate type comparison retains
  **56/56 identical diagnostic signatures**, including file, line, column, code,
  message, span, source line, and source hash. The baseline substitutes only the
  frozen Curie test through an in-memory compiler host. Both programs use the
  clean projection's actual working directory. There are zero added or removed
  signatures. This expanded legacy gate is **qualified RED, not passed**; no
  unrelated type cleanup is included.
- All **102 format-supported composite files** pass Prettier. The two opaque O12
  fixtures, `.prettierignore`, and two intentionally ignored historical PPR2 JSON
  fixtures retain their exact hashes. All **107 composite files** have empty
  whole-file whitespace diagnostic streams; `git diff --check` also passes.
- All **386 production/public-build files** match the pre-oracle-edit hashes in
  both the author tree and clean projection. The unchanged child program, Curie
  configuration, source fixture, expectation fixture, and historical reports
  retain their recorded preimage hashes.

The expanded diagnostics remain confined to four inherited files: nine in
`interp/methods/function.test.ts`, two in `run.references.test.ts`, sixteen in
`runner/signal-dump.test.ts`, and twenty-nine in `snapshot/restore.test.ts`, all
under `packages/safejs/src`. The agent-harness results test is included in both
matching 42-root programs. The initial compiler-host comparison was rerun after
correcting its working-directory metadata; its earlier receipts remain preserved
and the final exact diagnostic signatures are unchanged.

The handoff retains 108 full typed V8 observations across historical, RED,
GREEN, clean-source, clean-built, and default-root runs, plus the native control
stdin/stdout capsules. Its complete-value comparison receipt shows four fresh
minimal-proof observations with native full-value equality, false modeled-reason
identity, five journal rows, and whole-journal equality only after removing the
Error tag and stack. The raw observations preserve graph identity and prototypes;
plain-data value equality is not substituted for the typed metadata assertions.

The immutable handoff is under
`out/safejs-remediation/o12-negative-oracle/candidate/manifest.json`. Seven O12
publication paths and their patch are separate from the two-path repair-only
delta, 100 effective prerequisite paths, base/ordered preimages, input manifests,
and raw validation evidence. No production file belongs to the O12 delta.
Independent validation follows; root publication, the separately assigned release
smoke repair, and eventual all-stack gates remain separate. This is ready for an
independent validator, not publication approval or Map/HOST closure.
