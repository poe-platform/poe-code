# Independent encounter-order v2 baseline receipt

Freeze commit: **30dda5b930c6e5ea29a54348926fc02b81f9d8e6**.
The requested `/tmp/expr-sequencing-freeze-v2-20260827-candidate.txt` handoff was
published immediately after that commit, before baseline replay. This task is
complete as an independent freeze/baseline task, **not final-candidate approval**.
No delegation, product edits, old-fixture edits, root-file edits, native-oracle
changes, or private runtime integration occurred. Final replay is separately
assigned; no waiting for the author candidate.

## Exact immutable binding

- Original file SHA-256:
  `d1892a748a9437fa253735636abf6f8d349c00d4898579d7a8b92bf0a2598314`.
- Exact 61-case JSON array SHA-256:
  `d4bb6baf0109a8f5ba2e6752a1bb5d56c492cbdde43495883f68a4a2ea124a47`.
- Baseline Git source: `1b2ddea9e38b25cc91134a2f35a318e27f4d7c29`.
- Minimal gzip archive SHA-256:
  `89a2f8f41e8edda3cf2fe3352c263e2d48333d1506470f08167020aff3f27509`.
  40 source/build-input files; 87,870 compressed bytes. Static import closure
  includes the actual worker and historical Shell driver dependencies, not a
  full repository archive. Source is compressed data outside TypeScript discovery.
- All original argv/env/options/expected bytes/status/job assertions are retained.
  `freeze/manifest.json` expands implicit environments without mutating originals.
  Historical accepted and qualified captures preserve their actual event traces.
- The committed source, not dirty live overlays, was built. At freeze, only
  `src/shell/runtime.ts` and `src/shell/shell.ts` differed within the selected
  closure; both committed versions were used. Their distinct live/committed hashes
  are explicit. No expr source within the closure differed at freeze. A later
  quota-only index change would be a different source binding, not this baseline.

The old parser contract was inspected before the freeze; no forthcoming parser
implementation was read or imported. New nearby expectations and instrumentation
were committed before the handoff. Historical canonical inspection thereafter
used the original committed cutoff, not author code.

## Baseline results

| Cohort | Passed / total | Qualification |
| --- | ---: | --- |
| Original unchanged 61 | **42/61** | Same 19 failure IDs as qualified `cf5caabe` |
| Original GNU semantic portion | **25/44** | Compared to frozen expectations only |
| Original project controls | **17/17** | Includes inactive-prefix fixes, cancellation, shared work |
| Independent nearby controls | **12/16** | New project-policy controls, separate denominator |
| Historical selected actual Shell workflows | **3/5** | Overlap with original 61, not extra unique cases |
| Historical original old-cap assumption | **0/1** | Separate unchanged RED, not a sequencing waiver |

The preserved earlier accepted-source baseline remains **40/61** (21 failures),
not relabeled as 42/61. Qualified `cf5caabe` evidence remains **42/61**, with its
source/profile qualifications intact. This replay independently reproduces the
latter failure set against the newly bound old-parser source archive.

The unchanged 19 failures are recorded individually in `baseline-01/summary.json`:
11 arithmetic/noninteger ordering failures and eight regex ordering/submission
failures. The full observed and expected tuples, encodes, budget counts and worker
events are in `baseline-01/original-results.json`. Matching final diagnostics do
not erase missing required submissions.

Four new nearby controls are RED, preserved without expectation changes:

| ID | Baseline failure |
| --- | --- |
| `nested-runtime-before-late-token` | Reports trailing `junk` syntax instead of the earlier division by zero. |
| `prefix-regex-before-late-token` | Final syntax bytes match, but submits zero regex jobs instead of one. |
| `abort-result-before-late-close` | Performs no required regex job, so the after-result caller abort is never triggered; reports syntax instead of rejecting with the exact caller reason. |
| `stderr-failure-after-regex` | Preserves the sink exception identity, but submits zero regex jobs instead of one before the diagnostic sink. |

Passing nearby controls cover skipped nested encoding/value work, retained
syntax/arity and structural node/depth limits, three ordered once-only regex
submissions with decreasing shared work allowance, active/skipped/active order,
caller abort from stdout, awaited delayed stdout, and output failure without
regex replay. All instrumented invocations use at most one matcher and one Budget.
No inactive encoding/job assertion was relaxed. Cleanup registration precedes
observed worker acquisition; workers have exited before observed execution
settlement; overlapping repeated cleanup calls are awaited. Both drivers report
**zero remaining workers**. These observations are schedule-bounded, not a claim
of preemption of opaque host work or general transaction/rollback guarantees.

The separate old-cap input remains `["1","x"]`, `maxOutputBytes:1`, expecting
status 2/full syntax output. Actual remains status 3 and
`expr: output bytes limit exceeded\n`. Parallel quota work is not imported.

## Canonical audit and native qualifications

`CANONICAL-AUDIT.md` identifies exact old input/assertion paths and a separate
expectation-version approach. Twelve canonical expr test files and three fixture
files were inventoried at the source cutoff. No blanket parse-all-before-active-
regex assertion was found: the nearest zero-job assertions exercise genuinely
inactive branches and must remain zero. Their scopes must not be silently
broadened or rewritten. The third-checkpoint inactive exhaustion/cancellation
family is implementation-sensitive and needs explicit later candidate replay,
not an assumed waiver. No old canonical test was modified or rerun here.

Normative native runtime profile: existing frozen official **GNU coreutils 9.7
on Darwin 25.4.0 arm64**, `LC_ALL=C`, binary SHA-256
`e8a4e2b58a33d2ad6bfa9eb8a4ed5f62775ab9ceac4b9421680c98973fd9109c`.
The preserved native capture has **44/44** expected semantic tuples and three
executable prerequisite controls. **No fresh native execution or prerequisite
availability claim** is made. No Linux, BSD substitution, or new native semantics
were assumed. The sixteen new controls are project-policy controls only.

## Validation, integrity and cleanup

The extracted 40-file closure builds with the existing local TypeScript tool,
`--skipLibCheck false`, on Node v22.22.2/Darwin 25.4.0 arm64. No dependency install,
shared dist build, global test suite, package export or deployed-service acceptance
was performed. Tooling is not independently reproduced; package/lock inputs and
the exact executable arguments are preserved in the capture.

`node --check` validates the owned execution scripts. Original and nearby replay
children exit successfully as harnesses while retaining their product REDs.
Capture `baseline-01` is the only baseline attempt; it had no infrastructure
failure. The unique-output refusal prevents rerunning into existing captures.

Before/after checks cover every extracted source entry and every compiled entry,
including new entries. Frozen original inputs are rehashed against the freeze
commit, with added-entry checks in `freeze` and `historical`. `SEAL.json` covers
the complete final owned directory, including new files/directories. These are
observation-time checks, not a defense against transient malicious mutation.

All owned children were awaited. The one task-owned extraction and its newly
created parent were removed; `baseline-01/cleanup.json` proves absence. No other
worker's temporary files or native artifacts were removed. The requested `/tmp`
handoff remains intentionally available. Evidence commits include only this
owned directory; the repository has unrelated concurrent edits and is not claimed
globally clean. No 72-hour duration, superiority, full parity or completion of
the larger project is claimed.

Read-only verification:
`node tests/commands/expr-stress/encounter-independent-v2-20260827/seal.mjs --verify`.
Do not append a replay to the sealed directory; use a separately authorized new
evidence location/binding for final-candidate work.
