# Independent grep-alias holdout: prepared, not executed

This directory belongs exclusively to the independent verifier. The author owns
`src/commands/grep-aliases/**` and `tests/commands/grep-aliases/**`; neither tree,
including its tests/goldens, was read to construct these oracles. No product module
was imported or invoked. No `.test.ts` file exists here. Product and shared files
remain read-only. This is a prepared holdout, not candidate acceptance, parity,
performance, service acceptance, or a superiority result.

## Frozen denominator and data classes

- 38 top-level holdouts: 26 native semantic rows (`N01`–`N26`) and 12 safety/Shell
  specifications (`S01`–`S12`). Subcases are enumerated within the safety rows, not
  counted as separate passes. All 12 safety rows are unexecuted.
- `../data/corpus.json` is the independent native input corpus, with 17 named byte
  fixtures and exact literal argv. UTF-8 and hex encodings are explicit. No newline
  is implicit. Invalid UTF-8 and NUL cases use hex; never decode their output for
  equality. A rendered replacement character is not the captured byte value.
- `../data/native-captures.json` is raw native observation data: exact executable,
  argv, stdin, stdout, stderr, status, signal, launch error, and before/after files.
  Two serial runs per row retained, plus two version invocations: 54 children.
- `../data/native-goldens.json` retains the first complete native result for each
  of all 26 rows, so later tests need no native tools installed. Both repeats stay
  available; repeat agreement is a native observation, not a candidate pass.
- `../data/candidate-profiles.json` states the pre-candidate acceptance boundary:
  16 byte-exact ordinary rows, four explicit conflicting-matcher contract rows,
  and six diagnostic/option profile rows. No row disappears from the 26-row native
  comparison. Native differences must still be reported alongside bounded-profile
  acceptance. Profile rows cannot be silently counted as native-equivalence passes.
- `../data/safety-holdouts.json` is an independent specification, not executable
  tests. It freezes inputs, schedules, bounds and required observations. Actual
  public API wiring and source transfer are deferred until handoff.
- JSON and the proposal TXT are explicit input/capture/specification data, not
  canonical TypeScript sources or tests. `native-capture-recipe.md` preserves the
  exact temporary capture-helper source. No test/typecheck exclusion was added.

## Reference identities and profiles

The actual references are Apple's `/usr/bin/egrep` and `/usr/bin/fgrep`, each
reporting `BSD grep, GNU compatible` version `2.6.0-FreeBSD`. They are not GNU grep.
Their separate executable SHA-256 pins, raw version streams, exact environment,
Darwin/macOS/Node identity, and bounded GNU search scope are in `provenance.json`.
Their differing executable hashes are retained rather than treating the names as
one binary. Hashes were checked before and after the 52 semantic child invocations.

The capture environment is explicit: `LC_ALL=C`, `LANG=C`, `TZ=UTC`, a fixed system
PATH, and owned HOME/TMPDIR. No ambient grep options, color settings, credentials,
or locale variables are inherited. These are Darwin C-locale observations, not
GNU/Linux or universal BSD semantics. Two serial identical repeats are a stability
check, not timing evidence. No output or filesystem normalization occurred.

No GNU grep was found in the inspected existing isolated tool locations. That is
a bounded availability statement, not proof that the machine has no GNU grep.
There is no GNU native capture, fabricated version, synthetic GNU warning, install,
or dependency change. If root supplies genuine pinned GNU executables, add a new
profile and raw capture cohort without replacing these BSD observations or the
original input seal. Do not substitute `grep -E/-F` for actual alias executables
when claiming native `egrep`/`fgrep` observations.

GNU's primary Usage manual, headed GNU Grep 3.12 when consulted on 2026-08-27,
documents these names as obsolete spellings and describes warnings introduced in
GNU Grep 3.8. Reference: https://www.gnu.org/software/grep/manual/html_node/Usage.html
(question 17). This documentary statement neither supplies native GNU output nor
establishes a particular vendor build's warning behavior. It is not a latest-version
claim. The BSD captured rows have no obsolescence warning; their error stderr is
still kept byte-for-byte. The proposed product profile intentionally emits no GNU
obsolescence warning. No stderr warning line is stripped from any native result.

BSD accepts explicit `-E`, `-F` or `-G` choices in the six matcher-profile rows.
The existing shared bounded grep contract accepts E and F but rejects their joint
use, and does not list G. Those observations must not be conflated. Missing-file,
invalid-expression and missing-argument diagnostics also have separate native and
bounded profiles: require status, alias, error meaning and offending operand,
retain complete stderr, and report textual differences rather than deleting or
rewriting diagnostic assertions globally.

## Preparation and native safety

The corpus and safety specification were hashed before native semantic execution.
The helper checks that input pin and both executable pins before spawning. Each
child has a two-second timeout, SIGKILL on timeout, 64-KiB capture bound and one
child at a time; no native shell strings or background processes are involved.
Each case has an exact owned temporary working directory, explicit fixtures and
closed stdin. Both captures include all post-command file bytes. Only the owned
native root is removed, in finally, including failure paths. No recursive cleanup
targets shared `/tmp`, another worker's native directories or repository files.

`native-capture-recipe.md` records how the temporary helper was run and its exact
source. It is evidence, not a new test framework. `SHA256SUMS` seals the complete
prepared payload, excluding only itself. Its own SHA-256 is the external seal
reported with the preparation commit. Later additions must preserve these frozen
files or retain this original revision explicitly with any correction.

## Handoff gate and later standalone execution

STOP after the preparation-only commit. Candidate runs, product imports, builds,
whole gates, comparisons against older candidates and test implementation are not
authorized in this phase. Root must provide the author's frozen commit plus source
transfer and explicitly resume this verifier. Do not seek author expected outputs.

After that handoff, make a separate offline packed standalone consumer outside the
author's working tree. Authenticate transferred source, actual candidate commit,
tarball hash, built declarations, dirty/frozen state and consumer inventory. Import
`Shell` from the inspected public package root. Until Curie actually adds verified
exports, access aliases through the installed package's packed internal module URL
only after confirming the module exists in that archive. Do not assert that public
alias symbols or a `commands/grep-aliases` subpath are published already. Do not
import the author's live source tree or tests, and do not fetch runtime dependencies.

Wire these frozen rows to actual public APIs then. Unsupported/unavailable rows
remain explicit and unpassed. Enforce source bounds and exact byte comparisons;
keep native-profile disagreements distinct from safety violations. Observe
cooperative invocation-owned cleanup before public settlement without pretending
that arbitrary host work is forcibly stopped or that all shared workers must be
globally zero. Route shared grep, regex, Shell and runtime-owned-output defects to
root, with reproductions, without editing them. Future alias fixes require a fresh
ownership assignment. This preparation contains no product fix or candidate result.
