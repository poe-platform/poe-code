# Legacy errexit policy: independent preparation only

**August 27, 2026. No existing tests or product source edited.** Native proof
supports narrowly retiring five stale logical rows under the user's real `-e`
requirement. This is not product acceptance or an applied revision. Await an
explicit root resumption after the author's first READY; do not poll or change
tests merely because READY appears.

## Three reported failures, not three individual inputs

| File and test | Group contents | Reported first failure | Affected rows |
| --- | --- | --- | --- |
| `tests/shell/invocation-modes.test.ts:36` — `unimplemented invocation flags reject explicitly before source consumption` | 9 flags × bash/sh = 18 invocations | actual 0, expected 2 | `bash -e` and `sh -e`, stdin `say bad` |
| `tests/shell/unsupported-options.test.ts:6` — `unsupported errexit requests fail closed before subsequent commands` | 3 source strings | actual 1, expected 2 | `set -e; false; say bad >after` and `set -o errexit; false; say bad >after` |
| `tests/shell/script-entrypoint.test.ts:179` — `direct script rejection has status 126 and no body effects: options` | one generated row of the rejection table | actual 0, expected 126 | mode0755 `#!/bin/bash -e\nsay bad`, invoked as `./options` |

The author reports **348/349 invocation tests** and **78/80 file-entry tests**.
These are reused author observations, not runs performed by this leaf. Exact
raw logs are preserved as base64 in `evidence.json`, with hashes, metadata,
failure blocks and actual imported shell hashes from the author's validation.
Grouped assertions stop at the first failure: neither log establishes the
result of every later row or supplies unreported command stdout/file effects.
No missing product byte observation is fabricated.

Original full text, SHA-256 and Git blob IDs of all three legacy files and
relevant helpers are frozen in the same evidence. All remained byte-identical.
The author's recorded runtime hash was
`5589f60a1db983538d37168e3b9276555ef71a2bc67446783535e47789f9d6eb`;
that is an author-run provenance value, not this leaf's product acceptance.

## Fresh native cohort and role boundaries

Both actual pinned profiles ran the whole small affected cohort, not a selected
oracle per row: GNU5.3 at
`/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash` and historical `/bin/bash`
3.2. Binary hashes and fresh versions are recorded. There are **16 observations**:
10 affected-row observations, plus six separately labeled neighbor/reference/
interpreter-bridge controls. Two version calls are not semantic observations.

| Input | Status | stdout hex | stderr hex / effects |
| --- | --- | --- | --- |
| bash `-e`, stdin `say bad` | 0 | `6261640a` | empty; no files |
| sh `-e`, same stdin | 0 | `6261640a` | empty; no files |
| `set -e; false; say bad >after` | 1 | empty | empty; no `after` |
| `set -o errexit; false; say bad >after` | 1 | empty | empty; no `after` |
| literal `#!/bin/bash -e` file | 0 | `6261640a` | empty; source bytes/mode/namespace unchanged |
| retained neighbor `set -eu || say unsafe >after` | 0 | empty | empty; no files; **not authorized as a product expectation** |
| existing `printf` reference | 1 | empty | empty; no `after` |
| explicit profile `-e ./options` bridge | 0 | `6261640a` | empty; source unchanged; supplemental, not literal kernel dispatch |

All tuples/effects matched across the two launcher profiles, with this crucial
qualification: the **literal** `#!/bin/bash -e` row always invokes actual
`/bin/bash` 3.2 through the kernel, including beneath a GNU5.3 parent. It is not
a GNU kernel-child result. The separately named explicit interpreter bridge
proves real GNU5.3 file `-e` behavior without relabeling the literal fixture.
The sh invocation uses a `sh`-named link to the pinned executable, preserving
the actual interpreter mode. No `/usr/bin/env` behavior is inferred here.

Legacy `say` is a custom registered command, not native Bash syntax. The native
sandbox maps it to a pinned `/bin/bash` helper emitting the same single-argument
line via `printf`; full helper/hash/launcher mapping is recorded. The original
source strings, body bytes, names, stdin and modes remain exact. Native process
stdin does not prove JavaScript `ByteSource` callback counts; those require a
later authorized post-READY product test.

The existing isolated process-group helper imposes a 2.5-second deadline and
64KiB capture limit for every native child, kills remaining owned group members,
and records signals/errors. Environments are scrubbed, startup files disabled,
PATH contains only isolated role links/helper, and scratch is confined to this
new subtree and removed in finally. Each row records full before/after file
bytes and modes. The initial AST empty-array extraction mistake occurred before
any native execution and is retained as preparation history.

## Proposed minimal revision, NOT applied

`proposal.json` records exact old/new tuples and per-file boundaries:

1. **Invocation:** remove only `-e` from the unsupported flag array. Keep the
   remaining 16 bash/sh invocations, exact exit2/diagnostic and zero-read guard.
   Add one separate positive group for the same two `-e` inputs with exact
   status0, stdout bytes `6261640a`, empty stderr, unchanged namespace and one
   stream acquisition per invocation. Do not drop the negative stream guard.
2. **Set:** split the first two strings into an exact failure-by-errexit group:
   status1, empty stdout/stderr bytes and no `after`. Keep the `set -eu` OR-list
   intact as a separately named unsupported-combination policy control with its
   original status2/diagnostic/no-file assertions. Native accepts `-u`; this
   batch does not authorize that product feature. Keep the existing `printf`
   reference and supported-set test unchanged.
3. **Shebang:** move only the `options` row to a positive case. Preserve its
   source/mode/invocation, assert exact status/output bytes and unchanged source
   and namespace. Keep all remaining negative rows and unrelated tests intact.

This proposal changes **five logical rows across three failing test groups**.
Separating mixed positive/negative lists would add two test groups in total,
without adding/removing original inputs. No denominator change has been applied.
Actual corrected cohort counts and acceptance require later authorized runs.

The single optional interpreter-argument contract remains intact. Do not split
literal env `bash -e`, approve env `-S`, green the historical Darwin env-single
row, or extend this proof to arbitrary options/interpreters. Direct allowlisted
bash/sh `-e`/`+e` support does not erase those protocol boundaries.

## Limits and handoff

No dirty product was executed/imported, and no source bug is established or
hidden by this preparation. Native evidence demonstrates stale requirements;
the author log statuses are consistent with them, but do not prove all new
semantics. Source authoring continued uninterrupted. No READY polling, source
stop, global/kernel/accounting/lifecycle/head0/custom5 runs or new dependencies.
Neither hidden `errexit-holdout` nor `errexit-consumer` contents were read. The
original36/72 stress fixtures/oracles and all existing tests stay untouched.

Reproduction: `node --import tsx tests/shell-stress/errexit-legacy-policy/capture.mjs`.
The helper refuses to overwrite existing evidence; a future capture must use
an explicitly separate artifact. All owned children and native scratch trees
are gone. This leaf stops after its proof commit and root handoff.
