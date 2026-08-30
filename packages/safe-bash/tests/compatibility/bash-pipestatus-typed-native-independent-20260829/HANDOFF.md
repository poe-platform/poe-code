# Typed-six independent review: DATA qualification HOLD
+
Date2026-08-29. No native/product/Worker/compiler/build/install execution or
production changes. This packet does NOT accept the six observations. The
first two allowed PURE helpers retired with reviewer-side admission failures;
there was no third helper and no framing/tamper outcome is credited.

## Preserved actual failures and exact remaining fix

1. Original audit authenticated the author seal
   `7a043c0bdc645e6c45d3a193d686e1741fcdb9662a5951dac141a41018937201`,
   traversed its evidence rows and progressed through source records, then
   rejected missing selected Git membership for APPROVAL-PROPOSAL.template.json.
   That exact template had not been included in my scoped ls-tree request.
   The content/hash check preceding membership passed. This was an incomplete
   reviewer metadata inventory, not an author artifact contradiction.
2. V2 added only that exact path at the same61913871 commit. Its Node stdout/
   stderr were redirected to audit.stdout.v2/audit.stderr.v2, but the helper's
   connected-FD assertion still named audit.stdout/audit.stderr. It rejected
   inode189613913 versus189610817 before DATA admission. No check was bypassed;
   the correction requires an explicitly versioned collector locator and fresh
   authority, not changing expected inode values or using dummy open files.

The six controls remain UNRUN: magic, terminal NUL, duplicate field, declared
length, changed stderr and changed effects. Tool4 stream verification, complete
slot/request/approval crosschecks and final raw-frame observations have no
completed independent result. Do not promote partial loop progress into a
source19/tools4/full-artifact acceptance. Author counts remain author counts.

Additional ordinary administrative failures are retained: five source-blob
requests were accidentally printed on one line; Git returned one `missing`
record. A source excerpt helper stopped when zsh arithmetic reached zero under
set-e; a later read-only excerpt succeeded. An evidence-copy command used
multiple destination arguments and failed; no author file was modified. Raw
stderr is included. The complete untouched temporary records remain under
`/private/tmp/safe-bash-typed6-independent-20260829`. No old PID/group probing,
retry of native programs or cleanup of foreign staging occurred.

## Exact six scripts and author-visible claims, not independently accepted

| ID | Exact program | Author captured claim |
| --- | --- | --- |
| P19 | `declare -p PIPESTATUS` | status1, stdout empty, not-found stderr |
| P20 | `readonly PIPESTATUS; false; declare -p PIPESTATUS` | status1, stdout empty, not-found stderr |
| P21 | `false; readonly PIPESTATUS; true; declare -p PIPESTATUS` | readonly indexed `[0]="0"` |
| P22 | `f() { local PIPESTATUS; false \| true; declare -p PIPESTATUS; }; false; f; declare -p PIPESTATUS` | local scalar empty, outer indexed0 |
| P23 | `f() { local -a PIPESTATUS; false \| true; declare -p PIPESTATUS; }; false; f; declare -p PIPESTATUS` | local indexed1,0, outer indexed0 |
| P24 | `PIPESTATUS=seed; false; declare -p PIPESTATUS` | scalar seed preserved |

The backslashes before table pipes are Markdown escaping, not program bytes;
actual exact bytes remain COHORT.json and the literal strings in audit.mjs.
P19 is exactly the first command with no script prologue. REQUESTS uses
`--noprofile --norc -c PROGRAM pipestatus-typed-case`, empty stdin, per-case
owned cwd/HOME/TMP/empty PATH, LC_ALL=C/LANG=C/TZ=UTC. No new native observation
was made. Only local Bash3.2.57 is claimed by the author, never GNU5.3/full Bash.
The exact not-found stderr claim is
`pipestatus-typed-case: line 0: declare: PIPESTATUS: not found\n`.

Author61913871d5851b466e6dfba10ec173987a0a44fb reports25569 raw bytes, six case
retirements, seven managed starts and18 administrative starts. Four source-fork
reservations remain UNOBSERVED. The persisted results ledger has active1 at
owner pre-exit serialization. Reported tool75018f exit0 is separate author
retirement evidence, not an independently attested OS-exit/approval-service
record in this incomplete audit. `receiptPublished:false` in per-case JSON
must be reconciled to later journal credit, not called an unpublished final
result or silently changed. No universal OS census/containment claim follows.

## Conditional policy recommendation for ROOT — not implementation authority

These recommendations combine already accepted native26 ROOTcf6c47b8 with the
six still-unaccepted typed claims. They must remain conditional until this
artifact audit is completed. They correct the older PLAN4afc868d proposal where
it overreached the earlier visible-only evidence.

| State at an eligible completion | Recommended internal updater behavior |
| --- | --- |
| Initially absent, not readonly | No eager initial `[0]`; prepare creation only at the first eligible completed command. P19 distinguishes visible absence, not hidden storage. |
| Absent but readonly name | Do NOT force-create. Preserve the readonly marker and absent visible binding. P20 does not authorize bypassing this distinction. |
| Existing indexed binding, readonly or writable | Atomically replace the complete admitted status vector; a narrowly internal readonly-index exemption only, not a general assignment bypass. P21 is the dedicated typed evidence pending audit. |
| Existing scalar, including empty | Preserve scalar value/type rather than coercing into an indexed array. P22/P24 distinguish this from ordinary absent state. |
| Current local indexed binding | Publish into that visible local binding; preserve full saved outer binding/flags and existing local restoration. P23 does not justify global hidden storage. |
| Current local scalar/tombstone | Respect the local scalar/absence distinction, never fall through to the outer indexed binding. |
| Unset completion | Keep native26 P17's visible0 observation; recreation rules must still distinguish ordinary absence from readonly absence. No unseen-binding theorem. |

The source representation is not a single scalar-or-array tagged class:
`arrays/bindings.ts:176` BindingStore stores named indexed bindings and
`get` returns IndexedBinding or undefined. Scalar values, readonly names and
exports remain in shell State maps/sets; `arrays/state.ts:170` monitors those
separately. Therefore `store.get(name) === undefined` alone cannot distinguish
absent, scalar, local tombstone or readonly-absent. That is the key implementation
hazard; the updater must inspect the existing visible state and local bookkeeping.

The successful read-only excerpts came from the retained accepted e013/da4e
source directory, not live HEAD. Relevant inherited blob identities from
PLAN/SOURCE-BINDINGS are bindings c686048897bbd7fa797ba6982a255a543afbe6a3 and
state021459790e7aa5d03b6cac2d786a77643fa2f2aa. Fresh independent byte-hash
verification of these excerpts was not completed; these are source-alignment
observations and inherited identities, not a newly authenticated composition.

## Narrow proposed write plan

Propose `src/shell/runtime.ts` only at command/pipeline completion, typed
publication and existing local-state selection sites; `src/shell/shell.ts`
only if a lazy invocation-root owner/lifetime hook is actually required.
No eager public PIPESTATUS initialization is recommended. New focused tests
should cover absent/readonly-absent/indexed/scalar/local transitions and full
source/installed/moved behavior. Root must select the exact accepted core/ERE
base before implementation; no mutable HEAD or automatic arithmetic overlay.

Reuse read-only `BindingStore.prepareName`/watch/publish,
`StateMonitor.prepareTypedPublication` and existing ArrayOwner/ledger admission.
The viewed `bindings.ts:243` publication can displace and release the prior
binding; `state.ts:110` stages scalar-overlay supersession, and `state.ts:153`
advances publication epoch. Reserve the complete vector and publication tickets
before changing state. Retain caller/stale/cleanup checks even for an internal
readonly-index exemption. If existing private APIs cannot express this, propose
an exact additional private-file delta before edits; do not weaken them globally.

ROOT's host policy remains authoritative: qualifying numeric results publish
before errexit; full vectors are atomic; no ledger reset; rejected completion
cannot fabricate a vector or roll back genuine nested publication; preserve
caller > execution/control > cleanup and exact raw reason provenance. Do not
translate arbitrary abort reasons into128+signal. Compound/negation/pipefail
behavior needs explicit existing-vector versus final-status tests, not a broad
inference from six typed declarations.

Faraday owns only the arithmetic callsites currently1699/3709 and new
arithmetic-parameters.ts. Proposed PIPESTATUS sites are separate, but require
root-coordinated runtime ownership/content rebinding before implementation.
No arithmetic, parser, public API, transport or filesystem edit is proposed here.

## Fresh audit resource record

Original phase1788014066783–1788014966783 (15min including publication).
Two PURE Node processes were actually started and retired with exit1; zero
native/product/Worker processes. The known invocation-local role log reaches
36 including final publication shell/apply_patch/Git; the Git batch `missing`
record is not a native Git oracle. No universal/transitive census claim.
The historical NUL/prelaunch locator refusals and author outcomes remain literal.
This is an actionable HOLD, not independent acceptance or a policy decision.
