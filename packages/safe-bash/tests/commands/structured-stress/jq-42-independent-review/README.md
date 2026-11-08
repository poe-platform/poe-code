# Independent jq original42 review — preparation and REVIEW checkpoint

## Final independent checkpoint: FAIL, August 27, 2026 UTC

See `REVIEW.md` and `review.json` for the separate post-handoff review of
`d1f78d43880c94300c0019b07a88110e9b3e8f08`:

- Unchanged main harness: **788/790 exact executions**, 255/256 vectors;
  original42 **42/42**, historical **155/155 + 81/81**, reviewer **19/20**.
  The existing `review-fromjson-two-error-records` diagnostic mismatch persists
  on direct and public-shell routes. The five all-boundary cases pass 288/288.
- All **22/22 original red tests reproduce unchanged**. Independent native proof
  distinguishes non-native policy retirement from remaining diagnostic and
  input-acceptance gaps; it does not declare the broad owned gate green.
- Existing author safety: **10/10 on three runs**. Seven new independent failure
  boundary controls: **4 pass / 3 fail on each of three runs**, exposing typed
  stderr retry and successful-diagnostic replay. These are not native vectors
  and are not folded into 790.
- Four author-reported supplementary gaps are independently reproduced, not
  excluded. Scoped/global TypeScript pass after the new tests. All 170 historical
  files and all 15 non-README prep files match their immutable commits.
- Structured source matches the handoff hash throughout. Other source and HEAD
  move between cohorts; this is **not clean committed-HEAD/product validation**.

The new `legacy-*.json`, `bounded-validation.json`, and
`failure-boundaries-results.json` are separate immutable observation cohorts.
Capture scripts intentionally refuse artifact overwrites. Replay the original
main harness with a fresh `--report` name; replay the new boundary tests directly
with `node --unhandled-rejections=strict --import tsx --test
tests/commands/structured-stress/jq-42-independent-review/failure-boundaries.test.ts`.
An expected nonzero test/report exit remains a failure, never a passing gate.

## Historical preparation phase (unchanged evidence follows)

This leaf owns only this new subtree. No production, author, historical oracle,
original matrix, root configuration or frozen audit files were changed. No
subagents, dependency installation, uploads or product host-jq integration were
used. The author is actively changing structured source; no stable author
handoff has been received. This is not final-source validation.

## Exact immutable audit and whole cohorts

The resolved audit commit is
`96db59ac7d355d1a94422634b4c4f53d00932ad9`, and the actual repository paths are:

- `benchmarks/reports/current-integration/HANDOFF.md`
  SHA-256 `d5db673d469c8ce266caf09a85850b85deca31d2b172fcdc29c896d9d1fe929f`.
- `benchmarks/reports/current-integration/jq-delta-classification.json`
  SHA-256 `e407a10118eb3de2abb6c35f7891842c451b82fb47b0c48997d8a0e647524855`.

The original audit remains the dirty `57d9d9860bd51fabd910814efeea4efbca0e4c26`
checkpoint described in that handoff: 42 jq failures, comprising 30 status/output
differences and 12 stderr-only differences. Neither this preparation nor a later
passing replay changes that historical result. `manifest.json.original42`
records every exact original ID, audit test name, group and containing cohort.
The 42 are a subset of the 236 below, not an additional denominator.

All six vector files are under
`tests/commands/structured-stress/independent-increment/`. Every read is checked
against both its frozen SHA-256 and its actual blob at the audit commit; no
author test/harness is imported to obtain expectations or execute commands.

| File | Cohort | Cases | SHA-256 |
| --- | --- | ---: | --- |
| `native-vectors.json` | independent | 140 | `924634ea7933a6b14be1295f65cd0f68485133975961572acab41fc307595a66` |
| `supplement-vectors.json` | independent | 15 | `3989c0678c2e87a6efff2bee562438fc0d03dfdbf167c2329cfebf296e3f4ba2` |
| `phase2-vectors.json` | additive | 62 | `afcfae94201a04a4455e7410371bfbdcfbe35823939569cc13786779dfaca101` |
| `phase2-extra-vectors.json` | additive | 6 | `230ac4fa5531e104b541b1e65f177c27c5efc9267125977a112df54dc7e743ac` |
| `exponent-vectors.json` | additive | 9 | `e90ececb9f163080873975c46063245df6200b7316edd682a401e33c07f9039d` |
| `overflow-comparison-vectors.json` | additive | 4 | `86808210a4d14d5c5e5ad86db2a0803875e6143047a3f8dbf256378635891789` |

Thus the whole containing cohorts are **155 independent + 81 additive = 236**.
Other historical jq suites, final-increment vectors, native profiles, author
regressions and integration matrices remain untouched and are not claimed as
executed here. Four historically erroneous author probe expressions in the
additive cohort are retained as their actual native error vectors, not repaired,
excluded or substituted with their intended expressions.

## Native freeze

`freeze.mjs` completed at **2026-08-27T00:40:22.471Z**. It first rechecked all
236 unchanged historical vectors, including individual pipeline stages, against
the same pinned native executable; **236/236 matched status/stdout/stderr**.
This is native-to-native evidence, not a production result.

- Executable: `/usr/bin/jq`; version: `jq-1.7.1-apple`.
- Build configuration: `--with-oniguruma=builtin`.
- Executable SHA-256:
  `1625910a3f99fbd11c3ad58cc16ebc359507e6e19c21e91d8ab7da2116c8429f`.
- Profile: Darwin arm64, Node v22.22.2; `LC_ALL=C`, `LANG=C`, `TZ=UTC`,
  `NO_COLOR=1`, `PATH=/usr/bin:/bin`; fresh isolated HOME/cwd per invocation.
- Only argv spawning with `shell:false`; 2-second native timeout and 65,536-byte
  output cap. Generated temporary fixture bytes were local to this owned subtree
  and cleaned up. No network or host mutation outside test fixtures.
- **20 new native cases**, 22 native stage invocations; 241 historical stage
  invocations and two metadata invocations: **265 native invocations total**.
- `native-frozen.json` SHA-256:
  `29dacce53a85733f524a2175ff6f1e21d1f2eafc0346de1a821834f581debbcc`.
- `manifest.json` SHA-256:
  `f4636b95d52c78b118c5eebc4a802ccf13d63a8a43c460f55da91e9f4e6ceacb`.

The new cases are native-derived, not authored from virtual output. They target
generator output before errors, abandonment of the remaining current generator,
continuation to later input/file records, `-e` last-false/empty/truthy statuses,
multiple diagnostics, ordered duplicate object keys, exact decimal and large
number copying, exponent/zero sorting and uniqueness, object quantifier
short-circuit order, and a public jq-to-jq number/object pipeline.

Five malformed UTF-8/surrogate cases include whole-input, every possible interior
two-chunk cut, and bytewise delivery. This covers invalid leads, lone/broken
continuations, overlong/surrogate/out-of-range sequences, truncation, BOM and
CR/LF in raw/slurp/JSON modes, plus high/low escaped surrogates. A separate
three-file fixture checks UTF-8 reset at file boundaries. Virtual byte cuts are
controlled; native OS pipe read coalescing is not. Native expectations were
captured with whole writes and do not prove arbitrary native read partitioning.

These cases use already implemented grammar; they do not expand the feature
request or establish universal UTF-8/number/jq parity. No official-docs claim
was needed: the evidence is the pinned local executable's actual bytes.

## Reviewer harness and post-handoff command

`harness.ts` uses only public root exports for the command factory and shell,
literal argv for direct invocation, and quoted arguments for public virtual-shell
scripts. Both routes capture raw byte sinks, never decoded shell result strings.
Files live only in a fresh MemoryFileSystem. Direct pipelines chain actual
outputs and check every stage; public-shell pipelines run through the real shell
pipe implementation. Native pipeline expectations concatenate stage stderr and
use the last stage's status; this is not a native concurrent-stream timing oracle.

The full run contains **256 distinct vectors** and **790 route/transport
executions**: 472 historical plus 318 reviewer executions. Original42, 155,
81 and 20 denominators are reported separately, with no normalization, skips,
changed expectations or pass inflation from counting transports as new cases.

Run from `/Users/kjopek/Workspace/safe-bash`. First, the author/root should obtain
the handoff hash from `inspect.mjs` and attest it belongs to the stable source:

```sh
node tests/commands/structured-stress/jq-42-independent-review/inspect.mjs
```

Then the independent verifier executes the complete containing cohorts and the
new corpus, replacing the placeholder with that **author-attested** hash:

```sh
node --import tsx tests/commands/structured-stress/jq-42-independent-review/review.ts --post-handoff --structured-sha256 <AUTHOR_ATTESTED_STRUCTURED_SHA256> --report post-handoff-01
```

Do not silently generate a fresh hash and treat it as an author handoff. Hashing
sorts source paths lexically and hashes `path + NUL + fileSHA256 + LF` for every
regular file under `src/commands/structured/`, including its README. The report
also records every `src/**` file hash, the entire source digest, HEAD, dirty
status and tooling hashes before/after. Source/tooling movement invalidates the
run (exit 2); comparison failures exit 1; an entirely matching run exits 0.
Pre/post equality cannot rule out transient ABA edits, and HEAD alone is not the
tested state. `--post-handoff` refuses an independent-only slice. Reports are
new, non-overwriting files in this subtree, created with `apply_patch`.

Preparation-only harness checks, without product execution:

```sh
node --import tsx --test tests/commands/structured-stress/jq-42-independent-review/evidence.test.ts
node node_modules/typescript/bin/tsc -p tests/commands/structured-stress/jq-42-independent-review/tsconfig.json --noEmit
```

The evidence tests passed **4/4**, and the scoped typecheck exited **0**. Three
pre-execution CLI guards were checked: missing handoff hash, excluded historical
cohorts, and attempted report overwrite all fail before product execution. The
790-execution full plan and novelty of all 20 fixture tuples against the frozen
historical cohorts were also checked. The tests check immutable provenance, complete
cohorts, specification correspondence, every explicit byte partition, and
binary-safe bounded collectors. This is not a root test-suite result. A whole
root test run was not performed; the scoped typecheck follows public source
imports but does not establish clean whole-repository validation.

## Moving-source advisory — not final validation

One bounded independent-only product probe ran at
**2026-08-27T00:43:09.812Z**, while source was still author-owned and dirty.
The structured digest had already changed since the native freeze; native
expectations were not recaptured or adjusted. The advisory's pre/post source
hashes agreed, but it has no author handoff and does not validate final source.

- Dirty HEAD: `b910096cfe614b36c78793124bfa9e1ad69aa933`.
- Structured-tree SHA-256:
  `91c3f8759041c5dee7e46070849f03766aba952b2653ae5e9add99e4e301f518`.
- Entire `src/**` SHA-256:
  `5d40928eca8cf04a0a2d1bf703915cc844a86c85245fb1c8b6e971705683e813`.
- `src/commands/structured/input.ts` SHA-256:
  `9227e29c2fbba19ebb6533048797612da5f220411b71fdd1fe2e79c2bf96d03b`.
- `prep-advisory-20260827.json` SHA-256:
  `5efd349e0a63f07a446693b17fd1d84a053b9e871d7fb35e835bd94cc53692cd`.
- **19/20 vectors passed both routes/all transports; 316/318 executions passed**.
  The full historical cohorts were **not run against product source** in PREP.

The sole new divergence is `review-fromjson-two-error-records`, on both direct
and public-shell routes. Literal argv: `['-c', 'fromjson']`. Exact input JSONL:

```text
"[4]"
"["
"{\"a\":}"
"false"
```

Both native and virtual return status 0 and stdout bytes `[4]\nfalse\n`, and
their first diagnostic agrees. The second diagnostic differs:

```text
native:  jq: error (at <stdin>:3): Unmatched '}' at line 1, column 6 (while parsing '{"a":}')
virtual: jq: error (at <stdin>:3): Invalid numeric literal at line 1, column 5 (while parsing '{"a":}')
```

This is an exact stderr-only advisory for root to route to the author, not a
production fix, relaxed expectation, historical reclassification or assertion
that later moving source still has the defect. Resume after stable handoff;
fix only reviewer-harness defects locally and report genuine product failures
to root. A passing independent corpus never replaces whole-cohort checks or
proves full jq parity, product superiority or completion of the 72-hour request.
