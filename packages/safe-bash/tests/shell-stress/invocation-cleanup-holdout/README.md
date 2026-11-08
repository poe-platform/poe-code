# Independent invocation-cleanup holdout preparation

**PREPARATION ONLY — 22 frozen compound cases, zero product executions.**
Twenty-one cases use the real public Shell API; H21 is a distinct direct-custom-host
optional-capability control. Named cases are not worker counts, syntax rows or
individual assertion counts. H18 contains four bounded budget executions; H20
contains two existing errexit forms. These subdivisions are not extra passes.

The source author is a different thread. No author candidate, implementation
patch, `9dccc4c` tests, or live source was inspected. Source reads were exclusively
Git revision `07acb1a4d30b7592cf247a0220250317be4e2038`, including its exact
`src/contracts/command.md`. The source hashes and complete contract text are frozen
in contract-source.json. This preparation does not change those contracts.
The prior investigation `274b7c47eea01a72db61c39775a97c882983cc7b` remains sealed;
its three-case worker baseline is neither rerun nor relabeled as holdout evidence.
Arch's separate real-worker five-case compiled/packed replay is complementary and
must never be pooled with these host controls. No native Bash oracle is applicable.

## Frozen controls

| IDs | Required distinction |
| --- | --- |
| H01 | Middleware-before-next and command acquisition register first; both delayed hooks finish before exact BOM/binary byte/sink result. |
| H02 | Invalid callback throws TypeError; duplicate registrations each run once; abort overlaps finally and drain sharing one delayed owner close; repeated disposal. |
| H03–H04 | Undefined sole failure is a rejection, including nonzero command results; multiple failures retain exact members; every hook starts while another is pending. |
| H05–H07 | Ordinary error retains frozen status/diagnostic after cleanup; existing ShellLimitError rejection retains identity; falsy caller abort during drain beats execution and cleanup failures. |
| H08–H09 | Never-resolving handler/input cannot block cooperative drain; exec/dispose wait controlled hooks; overlapping disposal and new-admission rejection. |
| H10–H11 | Early downstream close is not caller abort: exact stdout `row\n`, default status 0 and pipefail status 141, with delayed producer cleanup despite opaque producer completion. |
| H12 | Returning parent closes a transitive admitted child tree, starts all hooks, blocks late child work and joins cooperative cleanup rather than never-resolving handlers. |
| H13–H14 | Saved normal/caller-aborted contexts reject registration and invoke before iterator, middleware or FS effects; preserve caller reason 0. |
| H15 | Losing handler can reject later without changing the caller outcome or causing an unhandled rejection. |
| H16–H17 | Shared host resource leases survive other-exec abort and other-Shell disposal; no sibling cancellation or wait for global resource zero. |
| H18–H20 | Shared byte/command/source budgets; exact output byte effects; stdinIsDefault/replacement environment/parent context; closed child admission before parent returns; existing errexit and tested failure. |
| H21 | Direct custom host may omit registration and retain its own finally; not a Shell settlement-barrier pass. |
| H22 | Registered owner closes acquisition before queued opaque continuation resumes; late registration cannot reopen it. |

Each case's executable assertions and source hash are frozen in inventory.json.
All successes/failures above are **expected obligations, not measured results**.
The cases use actual Shell dispatch, middleware, context.invoke, byte pipes and
MemoryFileSystem. Shared resource leases are explicit host Set ownership, not
proxy workers or a substitute for Arch's real worker evidence. The late-admission
FS counter subclasses the real MemoryFileSystem only to record calls.

## Protocol and failure criteria

After ROOT supplies an authorized frozen candidate commit, the ready-stage command
is `node tests/shell-stress/invocation-cleanup-holdout/run.mjs FULL_COMMIT NEW_OWNED_OUTPUT.json`.
It is **not run during preparation**. The output must be a new JSON path in this
directory; frozen preparation files cannot be overwritten.

The runner verifies freeze.json, creates a full committed src/package/tsconfig
archive outside the repository, verifies every copied source against its Git
blob, and links existing development tooling only. It performs one source build
with the frozen public barrel, not a narrow API shim. It records emitted hashes
and launches each case in a separate bounded Node child importing the archived
public `dist/index.js`. The same frozen helpers are copied into the archive and
hash-checked; actual loader source hashes must resolve inside its canonical
realpath, avoiding the prior `/tmp` versus `/private/tmp` lexical mismatch.
There is no live product overlay or implicit current-HEAD selection.

Build deadline: 45 seconds. Case child deadline: at most 12 seconds. Aggregate
child schedule deadline: 120 seconds. A deadline/provenance failure stops the
schedule and leaves unexecuted cases explicitly unexecuted. There are no retries.
These are harness containment limits, not product cleanup timeouts. A timeout or
missing report never becomes a status waiver or a passing assertion.

Controlled gates are released only by their fixture after the required hooks have
started and pending-settlement assertions have run. The harness never releases a
gate to rescue a failed case or invokes cleanup on the product's behalf. Pending
checks allow two event-loop turns; this finite schedule detects premature
settlement in the exercised trace, not every imaginable longer timeout policy.
Cleanup itself is privileged cooperative work and remains awaited without a
production timeout. Opaque handler/input promises deliberately never resolve;
the parent bounds the child rather than treating those promises as cleanup.

Child unhandled rejections are recorded and fail the case after explicit late
handler rejection and observation turns. Identity comparisons happen inside the
child, preserving undefined, falsy primitives, symbols and object identity; JSON
is a report, not the identity oracle. Exact status/stdout/stderr assertions remain
where the frozen API defines an outcome. All hooks must start despite failures;
AggregateError member order is deliberately not asserted because ordering is not
contractual. Duplicate registrations are not deduplicated by callback identity.

The future runner writes full proof before deleting its exact owned scratch tree,
never follows the tooling symlink, records cleanup separately, and retains scratch
on forced child termination. It does not touch existing independent artifacts.
Preparation itself creates no scratch directories and launches no product child.

## Mutation rejection targets

These are requirements on a future real candidate replay, not executed mutation
testing or checker-only pass claims:

- Missing/unrun hooks or ownership created after middleware: H01–H05.
- Early public settlement or abandoning another hook after failure: H01, H04,
  H05, H07–H12.
- Sequential all-hook startup deadlock: H01/H04; transitive omission: H12.
- Lost undefined failure, wrapped/wrong primary reason, caller/internal abort
  conflation: H03/H04/H06/H07/H08/H10/H11/H14.
- Late registration/invoke acquiring iterator/FS/resources: H12–H14/H19/H22.
- Joining opaque command/input promises: H08–H12/H15/H22.
- Cancelling a sibling lease or waiting for global resource zero: H16/H17.
- Cleanup-path budget reset, lost byte fields/provenance/environment/errexit:
  H01/H18–H20.

## Explicit ambiguity boundaries

The contract requires disposal admission closure and cleanup barriers but does not
specify the selected status or exact rejection class for an already-running exec
cancelled solely by Shell.dispose. H09/H17 require that exec settle only after
cleanup and without joining opaque work, but log that particular outcome without
inventing one. This is a disclosed dimension requiring ROOT policy review, not an
accept-either rule for any case whose outcome is defined. New exec after disposal
must reject; no error message or subclass is invented beyond generic Error.

Cleanup-only failure on exec is tested exactly. Whether a subsequent fresh
Shell.dispose re-reports a failure from an already-drained exec is not specified
here, so H03/H04/H06/H07 do not use that later disposal result as an oracle.
No public channel for secondary cleanup failure telemetry is invented. Drain-all,
completion and no unhandled rejection are observable; internal retention has no
additional test-only API.

H06 uses the existing exported ShellLimitError because frozen runtime explicitly
preserves that execution rejection. It does not require arbitrary command Errors
to reject public exec: H05 preserves their existing exact diagnostic/status path.
H22 tests cooperative owner closure, not impossible hard preemption of arbitrary
host JavaScript. No callbacks depend on registration order.

## Preparation validation and limits

Only Node syntax checks and independent metadata consistency checks are executed
now. Product baseline/candidate case counts are **0 executed, 22 unexecuted**.
The old runtime lacks hook exposure, so preparation does not waste a baseline
replay establishing unsupported capability again. Existing worker failure evidence
remains separately authoritative, with its own guard qualifications.

No source/core/FS/contracts/root export/manifest edits, runtime dependencies,
packed-package duplication, hidden fixture reads, full gates, kernel/OLD9/env-S
or old errexit/cohort replay. Five custom pre-first-read 1200ms requirements remain
**OPEN and UNRERUN**; no firstread/beginOutput API is proposed. Stop after the
preparation commit and await ROOT's candidate freeze.
