# Independent runtime R1 public-boundary verification

The exact handed-off runtime closes all five historical public premature-
settlement observations in the unchanged compiled and moved-package replays.
Registration passes17/17. The prepared runtime harness remains **7/8**, with its
original wrong-layer error assertion preserved, not rewritten or called8/8.
Thirteen separate contract triage/R1 controls pass. No genuine product bug was
identified in this bounded work. Root must adjudicate the retained oracle
mismatch before interpreting this as a benign gate; no risky execution is
authorized by this report.

## Immutable inputs

- Runtime: `1b133a8662a32ee84524794842074c9c98d5f6c3`, including `4c16d9c`
  invocation scopes and R1 queued-plugin-setup/disposal correction. Earlier
  author10/10 real-worker evidence at4c16d9c is not evidence for this freeze.
- Registration: `01aa1bffe0568cc6787d5ff8e0331e024a787385`; all four source
  files match byte-for-byte at the runtime commit.
- Canonical fixture: `10273352f8d65d929cbf5a23e69119414dacee60`; the exact
  messageerror fixture matches at runtime and is staged from git, not executed
  or migrated again here. Original99/100 and later101 remain separate history.
- Contract: `07acb1a4d30b7592cf247a0220250317be4e2038`; both command contract
  files match. The full216-file source/config closure comes from git, never
  live dirty source or dist. All704 emitted artifacts match across the three
  independent labels. No root export/package delta versus approved baseline.
- `runtime-r1-combination.json` binds eleven selected source/fixture identities,
  the prepared harness hashes, the static worker import graph and the six
  immutable native DATA files. The latter are existing ignored artifacts, not
  git-tracked source; all retain SHA256
  `74a02f560cc1d8e023280b5f08a1ee7266e4bec6cea61ca457dc1a758d080fc8`.

The root marker is retained verbatim in each freeze. Source/config/exports and
all emitted hashes are checked again by `runtime-r1-audit.mjs`. Concurrent live
root/config and other workers' changes are visible in status evidence but are
not consumed, staged, reverted or certified.

## Separate denominators

| Cohort | Result |
| --- | --- |
| Historical Phase A original five, compiled/packed | Archived0/5 each, untouched |
| Exact R1 unchanged original24 triples, compiled |24/24 status/stdout/stderr |
| Exact R1 unchanged original24 triples, moved npm package |24/24 |
| Exact R1 original five, each format |5/5 |
| Prepared registration groups |17/17,17 controlled workers retired |
| Prepared runtime groups, unchanged |7/8; one oracle-layer mismatch |
| Additive ordinary-result/rejection/abort triage |11/11 independent variants |
| Additive queued/async accepted setup-disposal R1 controls |2/2 |

The first uninstrumented original-five replay passes each format. The final
additive-observer replay repeats those same original assertions unchanged;
these repetitions are not new unique cases. Original24 includes pipe-early,
so the five boundary observations are not five additional command vectors.
There are28 exec settlements and29 real workers per format. The17 source/
controlled-transport groups are not17 public Shell cases. Runtime has exactly
eight named groups with bounded subvariants, not an invented larger count.

## Exact public settlement

The old harness's `publicSettlement` object is recorded after each callback's
`finally { await shell.dispose(); }`; its assertions and `activeAtExec` still
detect the historical premature worker settlements, but that object alone
cannot prove listener removal at exec settlement. No historical body was
modified. An additive static preload observes public exec promise continuations
before the original callback resumes or enters its finally/dispose.

`runtime-r1-verified-{compiled,packed}-old-five.json` retains each public
status/byte vector, typed rejection, exact caller-reason comparison, observed
command/caller abort-listener counts and native worker states at that instant.
Across all28 exec settlements in each format, all observed workers have exited,
termination was awaited exactly once, and message/messageerror/error/exit
listeners are zero. Caller and observed command-signal abort listeners are
also zero. This is settlement evidence, not eventual-zero substitution.

The prepared runtime isolation group correctly has sibling workers alive when
an unrelated invocation aborts; that is not a leak. AsyncLocalStorage records
constructor origin for these bounded controls, not a new universal ownership
API or proof about arbitrary shared-worker reuse. The owner-associated workers
are retired at their exec boundary; the other invocation/shell finishes with
correct bytes. Synthetic cleanup gates prove pending drains independently of
opaque middleware/input/FS/sink waits. Those tests do not claim the five
separate custom-pre-first-read opaque-I/O/lifecycle requirements are fixed.

## Preserved first failure and bounded triage

The first failure was immediately reported through
`/tmp/regex-runtime-lifecycle-findings.txt`, before proposing any source fix.
`runtime-r1-runtime.json` retains the original stack at runtime.mjs:104:
`AggregateError: Invocation cleanup failed` versus exact
`Error: selected execution failure`, for caller `none`. The other four caller
variants in that group did not run after its first assertion failed. The
observed repeats preserve the same7/8 result; none replaces it with8/8.

Frozen runtime.ts:494 converts an ordinary command Error to stderr/status1;
runtime.ts:499 preserves existing ShellLimitError rejection paths. This
ordinary-error conversion predates cleanup. Contract command.md:102-108
preserves the rejection selected by the existing execution path, while a
completed nonzero CommandResult does not hide a cleanup failure. Thus the
prepared ordinary Error is not an existing primary public rejection.

`runtime-r1-triage.mjs` separately records:

1. Ordinary Error without failing cleanup: exact empty stdout, diagnostic
   `shell: line 1: selected execution failure\n`, status1 and completed cleanup.
2. The same ordinary Error plus two failing cleanups: AggregateError containing
   those exact failures; and each caller reason0/false/empty-string/errno-shaped
   object, all winning by identity during a held drain.
3. An exported public ShellLimitError through the existing rejection path:
   original identity and unchanged properties without caller abort; the same
   four caller reasons each win by identity. Both cleanups start and are drained.
4. Accepted synchronous queued plugin setup immediately followed by disposal;
   admitted asynchronous setup under overlapping disposal with external
   admission still closed. Both retire their lease before disposal settles.

All13 additive controls pass under strict unhandled rejection handling; they
are not edits to the prepared semantic assertions. Root's independent
error-layer adjudication is another owner's scope, not certified by this report.

## Package and harness integrity

Final actual moved package:
`.temporary/runtime-r1-verified-packed-old-five/production-continuation-review/node_modules/virtual-bash`.
Its archive SHA256 is
`86c34e382c85563afbd9c760aa2e0f161308e8f43e14fe99dfec9ed96d77539b`.
The separate consumer has a different package name, preventing repository
self-reference. Public module resolution and all worker URLs point into that
moved package. All704 assets match the frozen build, the static worker graph
is present, the exported InvocationCleanup/optional registration consumer
strictly type-checks, and runtime dependencies remain empty.

Two verifier-only failures are preserved:

- Initial identity audit incorrectly looked for ignored native DATA via git
  ls-tree. It found0 instead of6. `runtime-r1-identity-attempt.json` records the
  error; retry reads/hashes but never changes those files, labeling provenance.
- The first additive packed preload used CommonJS `require.resolve` for an
  import-only package. Four children exit1 before any product control runs;
  `runtime-r1-observed-packed-old-five.json` retains every error. The final
  loader relocates the exact static ESM resolver beside the consumer, using
  `import.meta.resolve`. No exports or product paths were changed.

Earlier observer source variants are reconstructible by literal substitutions
recorded in the audit, including their hashes. No worker eval, product host
subprocess, dependency installation or altered semantic assertion was added.
Generated child transformations remain the historical scheduler selection and
owned fixture directory relocation; the supplemental preload is recorded
separately.

## Evidence, reproduction and limits

Run prepared `freeze.mjs LABEL FULL_SHA runtime-handoff`, `build.mjs LABEL`,
`guard.mjs LABEL registration`, `guard.mjs LABEL runtime`, and `old-five.mjs
LABEL compiled` / `packed`. A fresh label is mandatory: evidence is write-once.
For additive settlement observations use `runtime-r1-observed.mjs old-five
LABEL compiled`, then `packed`, and `runtime-r1-observed.mjs guard LABEL
runtime`. The new identity/triage/final-audit scripts bind the exact recorded
runtime-r1 labels; reconstruct missing snapshots from the same immutable git
source rather than overwriting existing evidence. Every command is run with
`node --unhandled-rejections=strict` from repository root.

`runtime-r1-settlement-audit.json` binds source/build/evidence/harness hashes,
per-job summaries and all29 exact child PIDs. All children have exited with
disconnected IPC and closed stdout/stderr; none required a watchdog kill.
The final exact-PID check finds none live, including the four loader-failure
children. Guards retain20-second/128MiB/64KiB-console/1MiB-IPC bounds. Product
defaults remain1s active request/3s startup/2 leases. Evidence timestamps
describe actual work on August27,2026, not72-hour completion.

No broad tests, original12, native oracle or performance suite ran here. The
separate leaf owns startup/equivalent32-file throughput. Original99/100,
migrated101 and unrelated old110/111 retain their own profiles. Global
typechecking is not claimed: six immutable DATA TS2304s remain an explicitly
qualified root/Faraday concern, while frozen production compilation and moved
public-consumer compilation pass. The six additional risky probes remain
UNUSED. Root must explicitly authorize any later allocation. This is not
default acceptance, full release readiness, broad superiority or full completion.
