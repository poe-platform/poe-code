# Stage2 policy supplement v2 — August 27, 2026

## Authority, acceptance and supersession

Authority: the root's explicit acceptance and D01–D03 decisions supplied to this
bounded documentation leaf. This is a versioned policy/invariant supplement, not
new measurement, a fixture, an implementation or runtime authorization.

Root **ACCEPTS Phase1 scoped `157d78c9` / `4f84fdfd`**: exact P03 is an
out-of-range expectation error; R01–R03 remain three separate supplemental passes;
T20 is corrected with the restricted TS2740 diagnostic. Keep **237/238** and the
original **27/28** history, not an all-green rescore. Earlier failed expectations,
followups and their corrections remain separately preserved.

This supplement supersedes conflicting preliminary native-equality expectations
only for the new fail-fast, failed-assignment and prefix-restoration decisions.
In particular, I03's earlier ordinary prefix-restore synchronization proposal
does not override D01's exact snapshot restoration. D01's policy is resolved;
D02/D03 policy is accepted with the precise author-inspection items below pending.
Original policy files, freezes, evidence, manifests and verifiers are unchanged.

## D01 — resolved fail-fast and restoration policy

- Use existing checked-write **FAIL-FAST** semantics at the first readonly/name
  write failure. Preserve all already committed scanner/OPTIND actions, stop
  later writes and perform no rollback.
- For readonly OPTARG, attempt checked set/unset; never remove its value or
  attribute. The result-name binding is not reached after that failure.
  Status/error follows existing readonly builtin mapping, including EOF.
- Normal nonfailure ordering remains measured. This is an intentional native
  failure-path divergence, not a new native-equality expectation.
- Failed external assignment/export/read/prefix installation does **not** reset
  hidden state. The reset hook fires only after successful installation.
- Same-scope temporary-prefix restoration restores the **EXACT saved visible
  binding and hidden state** on success, failure or abort. Restoration is not an
  additional ordinary assignment/reset and is not general transactional rollback.

Relevant existing references: I03, I05, I12; N04 prefix restoration and N14 failed
origins. Native N12–N15 partial effects/statuses remain observations, not authority.

## D02 — accepted policy; exact existing mapping pending

- Preserve the existing Shell budget object and normal builtin command/expansion
  charges. Do not invent a global work counter or charge each byte as a command.
  A helper-internal work limit may be per-invocation if clearly documented;
  global shared command/expansion/time limits must not reset.
- Shared `ShellLimitError`, sink errors and caller reasons propagate with identity
  and existing mapping, not as usage errors. Do not invent statuses or limits.
- Await diagnostics; silence mode performs **zero writes**. On a blocked/rejected
  diagnostic, only earlier published scanner state persists; later OPTIND,
  OPTARG and name writes remain unperformed. There is no undo.
- **Pending author inspection:** identify the exact existing budget/checkpoint
  APIs and cadence, mapping normal builtin command/expansion charges and any
  clearly documented helper-internal work limit to shared command/expansion/time
  accounting before freezing numeric exhaustion expectations. No guessed API,
  counter, cadence or typed fixture substitutes for that inspection.

Relevant existing references: I07–I09, I12; N16 diagnostic emission/suppression.

## D03 — accepted ownership policy; exact binding effects pending

- Follow existing child-visible environment/ownership rules and deep-clone the
  hidden cursor. Mere unchanged environment/middleware forwarding is not an
  assignment, even if the environment object is copied.
- An effective OPTIND change/removal through an overlay reconciles only child
  state. Script assignment `OPTIND=1` can reset even when the value is equal;
  host environment forwarding gains no imperative parent-reset channel.
- Parent and siblings remain unchanged on all settlements.
- **Pending author inspection:** derive exact merge/`replaceEnv` visible-binding
  effects, including omitted/explicit environments and effective OPTIND
  change/removal, from the existing runtime's child/invoke lifecycle. Fixtures
  must not invent replacement effects or equate forwarding with script assignment.

Relevant existing references: I04 and I10. Existing invocation contracts remain
authority; this supplement supplies no new public API or guessed `replaceEnv` effect.

## Preserved authority, evidence and stop boundary

ASCII options only; Unicode argument values are allowed (I06). Readonly OPTARG
value/attribute must never be bypassed or deleted (I05), including native EOF
deletion. These and D01's failure paths are intentional native divergences;
normal nonfailure measured ordering remains. Original N05/N13 oracle errors and
all original cohorts stay intact: Stage2 Darwin Bash5.3 remains 14/16 matched,
Bash3.2 remains 9/16 against the selected5.3 expectations, not rescored passes.
The twelve host/profile controls remain definitions with zero executions.

Runtime integration remains **WITHHELD until explicit Sagan release of
`runtime.ts`/`shell.ts` PLUS root Stage2 authorization**; concurrent commits are
not release. Unsupported `builtin`, `declare` and `typeset` are not newly
authorized. No new public APIs, limits, status codes, counter or cadence; no
runtime/source inspection, implementation, tests, native cohorts, candidate
execution or fixture expansion is authorized by this record.

Validation is metadata/content integrity only: authenticate original Phase1
bytes/membership against `4f84fdfd`, excluding only `stage2`; authenticate original
Stage2 bytes/membership against `592c864e`, excluding only `POLICY-v2.md`,
`policy-invariants-v2.json` and `policy-v2-manifest.json`. Unexpected other entries
must fail. The old unchanged exact-tree verifier invocations are **not run or
claimed to pass** with these append files. The new manifest binds both documents,
the prior seals and exact append allowlist; its own bytes are bound by the final
commit, with no circular self-hash. Preserve foreign work/staging and commit only
these three new paths. **Checkpoint, then STOP until root Stage2 resume.**
