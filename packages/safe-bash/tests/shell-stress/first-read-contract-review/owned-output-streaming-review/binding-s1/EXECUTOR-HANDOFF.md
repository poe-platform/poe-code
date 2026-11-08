# Private S1 binding handoff

## Scope and result

Finite preparation, not candidate execution or readiness. Exactly **12 logical
acceptance cases (5 opt-in positives + 7 controls), 20 records, all UNRUN**.
There are 13 declaration-bound record paths and 7 explicitly blocked public-profile
bindings; even the 13 remain globally blocked on the new source gate. No passes,
candidate qualification, product promotion, universal streaming guarantee, or
claim of 72 hours of work follows. Source identity is **UNBOUND**.

`BINDING-DELTAS.md` predeclares differences from the original-five historical
replay. `expected-observations.json` gives all 20 exact parameter bindings and
expected observations. `binding-map.json` combines them with the immutable parent
plan without changing IDs, order, denominator, or original deadlines.

## What is actually executable

`driver.mjs.data` is an inert capture of a complete Node ESM driver, not a pass
generator or a preparation refusal stub. Once reconstructed into unique task TMP,
it has a supervised `--execute` path for the 20 records and a **separate**
`--historical-five` path. Each run uses a directly owned detached Node child with
the original outer 3000ms/1MiB cap; acceptance gates use 1200ms. A timeout, oversized
output, residual child group, missing observation, cleanup failure, or unexpected
termination cannot count as PASS. Each logical case passes only when every one
of its frozen parameter records passes. BLOCKED/UNRUN/TIMEOUT are not passes.

The driver is syntax-checked only here. Its product integration, actual fixture
semantics, public export availability, TS-loader reconstruction, shutdown paths,
and assertions have **not** been runtime-tested. This is a material limitation,
not public-consumer evidence. A fresh executor must diagnose harness defects
separately and preserve failures; it must not rewrite acceptance to fit behavior.

## Reconstruct without running product

From the repository root:

```sh
node tests/shell-stress/first-read-contract-review/owned-output-streaming-review/binding-s1/prepare.mjs --check
node tests/shell-stress/first-read-contract-review/owned-output-streaming-review/binding-s1/prepare.mjs --reconstruct
```

The second command returns a new
`/tmp/safe-bash-owned-output-streaming-binding-XXXXXX` directory. Syntax-check its
`driver.mjs` with `node --check` only. Neither helper command imports or executes
the driver, candidate, historical TS, or public declarations. `prepare.mjs` uses
Node builtins only; it makes no servers, polling loops, candidate facades, or ready
markers. `--capture`, `--bind`, and `--seal` are maintainer preparation commands,
not executor instructions to refresh the frozen evidence.

All 19 baseline input archives are byte-identical. Reconstruction removes only
the archive suffix to restore their original relative paths under TMP/historical;
it never rewrites commands, barriers, or deadlines. `remote-close.test.ts` remains
unchanged, including its original broader scenario list; the separate replay
runner selects exactly the five original first-read identities. Their original
stage-abort assertions remain unchanged and distinct from new operation assertions.

## Mandatory fresh-executor inputs, all UNBOUND here

Root must authenticate **actual author process closure** and the new immutable
`/tmp/safe-bash-owned-output-streaming-prototype.ready`, then launch a new executor.
Old v1/v2 readiness and author self-reports are not closure evidence. This binder
does not read any ready marker, wait for readiness, or claim its own future exit.

`execution-inputs.UNBOUND.json` is only a schema. Every artifact reference has
`path` and `sha256`. The future populated config needs:

- `rootFreshExecutorAuthorization`: a hashed root attestation containing
  `freshExecutorAuthorized: true`, `sourceIdentity`, `streamingReadySha256`,
  `bindingDriverSha256`, `bindingMapSha256`, and the exact S1 `declarationSha256`.
- `authorActualClosedEvidence`: root-observed `actualExitObservedByRoot: true`,
  `exitCode: 0`, actual `sessionId`, and `closedAt`; root independently authenticates
  the observation. A worker-written claim does not satisfy the operational gate.
- `streamingReady`: exact new marker path and immutable byte hash, bound by root
  to the same `sourceIdentity` as the source manifest and execution authorization.
- `sourceManifest`: hashed JSON with `sourceIdentity`, complete explicit `files`
  with path/hash pairs, and `completeImportClosureAuthenticatedByRoot: true`.
  Include copied source/patch/tests/helpers, build evidence, compiled import closure,
  historical fixtures and facade. `sourceTestsBuildPrerequisitesAuthenticated`
  must be true only after actual qualification, not because an inventory exists.
- `candidateEntry`: immutable public ESM entry copied within this task's unique
  TMP; never live repository source or root dist. `historicalHelper` and
  `historicalProbe` must retain their pinned baseline hashes and live in the
  reconstructed historical tree. `historicalFacade` goes at the original public
  import location under `historical/src/`, re-exporting that same candidate entry;
  root/executor must create and qualify it **after** the source gate. No facade
  is made during preparation, and no other historical fixture import is guessed.
- `toolManifest`: exact existing TS-loader/tool closure path/hash identities;
  `tsxImport` must belong to it. No installation, global typings, dependency
  additions, or root build outputs are authorized by this preparation.
- Optional `publicProfiles`: hashed, source-independent authoritative binding
  supplement with `frozenBeforeCandidateExecution: true`,
  `derivedFromCandidateImplementation: false`, hashed `authoritativeContractEvidence`,
  and `profiles` keyed by the existing `Sxx/parameter` identities. It cannot change
  commands or criteria or retroactively derive expectations from candidate output.

These checks authenticate content against root-supplied identities. They are not
cryptographic authentication of the human attestor and do not independently prove
source/build completeness, actual process closure, or readiness truthfulness.
Root owns those gates and must not treat this configuration as their substitute.

After root supplies and authenticates all required inputs, the future commands are
`node <TMP>/driver.mjs --execute <TMP>/execution-inputs.json` and, separately,
`node <TMP>/driver.mjs --historical-five <TMP>/execution-inputs.json`. Never run the
internal `--record` worker standalone: the supervisor supplies its hard process cap.

## Seven blocked bindings, no hidden scope reduction

- S07's two parameters and S08's three parameters lack exact declared nested curl
  public status/rejection/stderr profiles. S1 only says existing public behavior
  stays unchanged. Supply exact `nestedPublicResult` and `diagnostic`, not guessed
  status 0/141 or permissive alternatives. Profiles describe the normalized
  observation `{kind: 'value', value: ...}` or `{kind: 'error', error: ...}`; Error
  normalization retains name/message/code.
- S08's first and third parameters additionally lack a precise observable positive
  retained-stdout-writeout binding after stdout closes. The prepared driver records
  attempted and delivered stdout bytes; it can only use a positive `code=200\n`
  write attempt when root authenticates that observation as meeting the original
  criterion. Required fields are `stdoutWriteoutRetentionBindingAuthenticated`
  and exact `stdoutWriteout: {attempted, delivered}`. Empty observations cannot be
  certified as retained work. If the correct public contract needs another witness,
  these records remain BLOCKED for a fresh, separately frozen binding supplement.
  No stderr reroute or mandatory delivery to a closed consumer is imposed.
- S11's two IO interleavings lack exact public/pipefail/first-operation-reason
  profiles. Their frozen script is `set -o pipefail; precedence-probe | cat`.
  Profiles need exact `command`, `publicResult`, and `operationSignal`. The freeze's
  established-failure language versus S1's explicit-finally cleanup-error replacement
  caveat must not be silently reconciled using implementation behavior. No new
  universal cleanup precedence is invented. Caller-zero remains separately bound
  to the historical caller-public rejection-identity contract.

## Resource accounting and chronology

Future children own all loopbacks, sockets and fixtures. The driver tracks awaited
deadlines, direct children/process groups, server tasks/sockets, cleanup callbacks,
external producer-release gates, and late rejections. Supervisor SIGINT/SIGTERM
kills only its active owned child groups and awaits direct-child close before
continuing to report remaining records UNRUN. Residual groups fail the run; a
direct-child reap is not claimed as proof of arbitrary descendant cooperation.
HTTP internal timers end with owned server shutdown; immediate barriers are awaited.

Opaque input gates are explicitly resolved/rejected after the nonpreemption
observation, with a separate teardown fallback. Fixture release can never open a
streaming acceptance gate after a timeout or be labeled product preemption. Input
owner liveness is measured inside a legitimate parent invocation; normal later
top-level return is allowed. Known-command operation state unavailable publicly is
left null and distinguished from observed transfer closure, not fabricated.

This leaf read the frozen four review files, the forwarded S1 declaration, permitted
v1 public index/contracts declarations, and immutable historical input bodies for
the original probe/wrapper/helpers. All 19 historical archives were hashed/copied;
other bodies were not inspected for design. A historical prior-review pathname
listing was metadata only; no old16 harness body or new author source/test/private
notes were read. Initial metadata reading had a zsh PATH-variable collision and
was rerun successfully without edits. No live product implementation was inspected.

## Separate cohorts, never merged

- Same-source **57 + 9**: planned only. Exact suite inventory, selection/filter
  identities, source hashes and authenticated tool prerequisites remain UNBOUND.
  Historical input files are preserved but do not by themselves prove this cohort
  or certify the current candidate. Root must supply the frozen exact inventory.
- Original **5**: executable separate replay path, still UNRUN; historical baseline
  0/5 and previous 1/5 remain untouched. Same candidate identity must be recorded.
- Optional rejected-v2 streaming negative control: separate and UNRUN, immutable
  historical source `9b65787d4d6805aa182ff138996bf4ab7bacd764`; no acceptance credit.
- Prior new-seven **3/7**, native **0/7/141**, old16 initial **15/16** and corrected
  **16/16**, and all failed profiles remain historical, not new acceptance. D01 is
  not a universal framing/handback requirement. D02/D03/D07 are not bugs under
  unchanged top-level ownership. No prebuffer promotion or new borrowed/lease API.
