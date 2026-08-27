# READY — bounded Stage2 freeze/native sidecar, not runtime acceptance

## Commits and chronology

Freeze commit: **51f14914a0e7de15c3a23961424f232853bf5c33**, committed at
2026-08-27T20:13:22Z. First native identity invocation began at
2026-08-27T20:13:31.160Z, after committed-freeze verification. The exact evidence
commit is the commit adding `evidence-manifest.json`; no circular self-hash is
claimed. Initial read-only HEAD was f8fdae7289162494d09f887bed4846edfd6575cf;
actual freeze-time source baseline is **d6814492a9de79c4f11b16956293afa14acc6fc0**.
All eleven relevant read hashes matched that baseline, and were unchanged through
native capture. Concurrent unrelated work continued; no whole-live-tree freeze
is claimed. Source familiarity from Phase1 and historical author native findings
was disclosed before this freeze. No candidate Stage2 implementation was executed
or unexpectedly encountered; no new Phase1 source/test/type/native run occurred.

## Exact denominators

| Cohort | Result |
| --- | --- |
| Frozen integration scripts |16 distinct scripts, not their output rows counted as tests|
| Frozen host/profile controls |12 definitions, **0 executed**, not passes|
| Explicit frozen VFS/native fixture bodies |2|
| Pending root decisions |3: D01,D02,D03|
| Darwin Bash5.3.0(1)-release |16 invocations; **14 matched,2 mismatched** frozen selected-profile expectations|
| Darwin Bash3.2.57(1)-release |16 invocations; **9 matched,7 mismatched** against the separately identified selected5.3 expectations|
| Total new native scenario executions |32, plus2 version/identity invocations;34 direct harness children awaited|
| Candidate Stage2 / new Phase1 executions |**0 / 0**|

Native match counts are not product passes. All captures completed within the
five-second/128-KiB per-process bounds without signal, timeout or spawn failure.
Both supplied binary SHA256s authenticated before/after; versions/platform,
sanitized C-locale environment, literal argv, closed stdin, exact UTF-8/Base64
stdout/stderr and process closure are captured separately. No Linux claim.
The diagnostics predicates are deliberately labeled partial semantic predicates;
raw exact diagnostics remain available, not advertised as universal byte parity.
The capture's `cleanup.nativeProcessCount=34` means direct harness launches, not
all OS descendants; native subshell/pipeline children are not separately counted.

## Preserved discrepancies and intentional policies

Primary mismatches **N05,N13** are reviewer oracle assumptions, not candidate
defects: repeated bare local yielded a, not expected b; readonly OPTARG remained
old after the no-argument option and was deleted at EOF, not at the earlier step.
See `CORRECTIONS.md:8` and `CORRECTIONS.md:23`; no expectation or capture was
rewritten, and no corrected/native rerun occurred. Bash3.2's additional differences
remain separately listed there. Do not replace14/16 with a retroactive16/16.

Stronger readonly always preserves readonly OPTARG value/attribute despite native
EOF deletion. ASCII options only, Unicode values allowed: native byte-option
behavior is not equality. D01 awaits root decisions on exact readonly/late-name/
diagnostic/hidden-cursor partial ordering and statuses, including failed setters.
D02 awaits actual shared-budget/work accounting and failure-publication mapping.
D03 awaits actual invoke/middleware state ownership and changed OPTIND overlay
semantics. No guessed typed API, new public limit, blanket error status or
transactional rollback has been introduced; host fixtures remain definitions.

## Baseline and ownership

Baseline **notregistered**, confirmed by existing routing metadata and read hashes,
not repeated exit127 executions. Current routes support direct/type/command;
`builtin` dispatcher, `declare` and `typeset` are absent and explicitly excluded,
not silently treated as failed getopts. Native-only declare preludes are separate
from required supported product scripts. Function/local/read/for/parameter/
arithmetic/prefix syntax and explicit source fixture sharing are grounded in the
inspected existing grammar. No usable getopts or default test-count change.

Runtime Stage2 remains **WITHHELD to Poincare until explicit Sagan release of
runtime.ts/shell.ts**. Concurrent commits are not release. READY means the bounded
independent inputs, native observations and host-invariant catalog are available
for future released implementation and policy decisions, not accepted runtime,
full native parity, whole-product success or completed72-hour work.

## Integrity and preservation

The sidecar verifier authenticates **179 original Phase1 files /182 entries**,
including the unchanged original manifest, against original commit
4f84fdfd41134710cdb68fab3f5970cb14e54da3. Old exact membership excludes **only**
the authorized stage2 subtree; additions elsewhere are detected. Separate complete
sidecar/capture seals also detect new entries, not just modifications to originals.
Twelve frozen input files plus their manifest bind the16 scripts/12 invariants.

The original Phase1 exact-parent-tree verifier is unchanged and not rerun: its
unmodified invocation would reject this append. No claim that it passes now.
Only new stage2 paths are authored/staged/committed, using explicit path lists and
`git commit --only`. No product, Phase1, AGENTS, package/root-export or private-repo
file is changed by this worker; no foreign staging is changed, no reset/stash,
branch creation or foreign-lock deletion. Hooks are disabled for the owned commits
to prevent accidental shared gates. Initial/freeze/capture index snapshots were
empty; unrelated concurrent edits/untracked paths were preserved, not removed.

Validation is bounded: syntax-check sidecar MJS, commit-bound freeze integrity,
32 native scripts and2 identity calls, source/hash and original/sidecar membership
checks. No npm test/typecheck/build, canonical test addition or candidate execution.
`completion.json` records final preservation; `evidence-manifest.json` seals the
complete sidecar, and the post-commit verifier checks it against its evidence commit.
