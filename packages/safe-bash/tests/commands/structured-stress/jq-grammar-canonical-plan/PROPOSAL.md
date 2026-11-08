# Corrected executable TEST-ONLY proposal v3

**NOT APPLIED. NOT INDEPENDENTLY APPROVED. August 27, 2026 UTC.**

The user supplied source handoff `b9187c0` and structured hash
`120a10c34d96b26f584c6e4349ef9098c0537d76952078e70e9ce6ab5c3f0176`.
Another leaf owns source acceptance. This proposal does not certify those
identities, execute/import that source, or claim a green canonical suite.
Review rejection `f84b8e229063847833fff24bab55c890a318e715` is checked byte-for-byte against Git for
REPORT.md, audit.json and native-review.json; see `pinned-review-v3.json`.
Both prior proposals, canonical snapshots and the independent red inventory
were read; their original trees remain endpoint-hash-identical.

## Application artifacts and ownership

- `native-v3.patch` SHA-256: `c83cd9adabd99925007bb79332899913829166ac21a6a25353dcfd199196627d`.
- `host-conditional-v3.patch` SHA-256: `18abf8765ce8474b30b0704063743f2e93217a19810a568160b4c30736187f0b`.
- Complete originals are under `before/<canonical-path>.txt`; complete
  proposed snapshots are under `after-native/` or `after-host/`, with the
  same canonical path plus `.txt`. The extension avoids registering evidence
  snapshots as real tests. New canonical artifacts have no original snapshot.
- The unified patches reconstruct those snapshots exactly in memory and pass
  `git apply --check` against current originals. They are precise patches,
  not prose replacement templates. No `git apply` without `--check` was run.
- Only the following explicit targets are permitted. No source, frozen old
  fixture, inventory, audit/report tree, or neighboring suite is a target.
  The host author safety test is an explicitly requested conditional canonical
  target, not permission to alter that subtree's other artifacts.

| Canonical target | Patch | Original SHA-256 | Proposed SHA-256 |
| --- | --- | --- | --- |
| `tests/commands/structured-stress/jq-grammar-native-v3.json` | native | `NEW; must not exist` | `62ca039b1fb3bb517d21d5499e4cd8467a80349f597a1231e8380368530e9e62` |
| `tests/commands/structured-stress/jq-grammar-native-v3.ts` | native | `NEW; must not exist` | `6882ecf1406ab085718b7da9cd1d90e448522c66039a3784c14a21f45fd1de2a` |
| `tests/commands/structured-stress/jq-grammar-byte-assertions-v3.test.ts` | native | `NEW; must not exist` | `0a97ec591a786bc68cee14168cc7d09af312faa50cc6ab259e6fced471fac4d7` |
| `tests/commands/structured-stress/harness.ts` | native | `dabc50c83133b6927d987f4763b594e793a4374cec79e5a1eead9a2612a6d482` | `47007ff2be4249e70a250084ca10f40ac2fe9108918326041169e658b7d26e1e` |
| `tests/commands/structured/helpers.ts` | native | `85810c3e66de2b343284ee9cc2bfc03a48cfb76125b4605fb797898f4dfe258c` | `58f64bcaaedc766a7b13a77195a93dd0886770ea20f6b9c57fbe032d642950b2` |
| `tests/commands/structured-stress/independent-increment/safety.test.ts` | native | `e46cdc464d16acdc1c6841d86dbb9b02274f7f22b2149751dcf1e8c44a8afcd1` | `93337441d16dfe84004576b8ce7ee07f7cd4851715fd164cf18c2eb791b5161b` |
| `tests/commands/structured-stress/raw-input.test.ts` | native | `bdd6aa8c1aa330be5b161c5dc86e2ffa91a5efb1ee0e8748f2ebd131d09544bf` | `11ada84fe790a81b335d43b9776c2f0ec6fe08ebe0e9fa2558695f3444ac268f` |
| `tests/commands/structured-stress/safety.test.ts` | native | `e50489b15c9d3fc232ef20bbd00701d507870ca5e95189caac07f156e9617611` | `ba9c576a8173a9aa5ff8545f88b7288faa4fee9fe2919648861a5286326b3fee` |
| `tests/commands/structured/cli.test.ts` | native | `61b291a521f4059b52dd7db90fedb82674bbf0046c2fbab4371b7d9478b30e5c` | `b755f4d240d7c95f001e3a4aac6aeb8270242d694fb5db96ddbc4f7568e4afe2` |
| `tests/commands/structured/resources.test.ts` | native | `18301807f1031dc0fd53bf0785730dbca3aff8608d646176d0f8509506371099` | `c61d9f482fc8c76a432d962a134c7834e4fb381a9a501e94b92dc27f79012061` |
| `tests/commands/structured-stress/join.test.ts` | native | `4e5ec178e0d35818f27d062af5343dc0df8acba45ca35225555d0835aee81f1d` | `91c700cc536e17fffcaa2818fe43639a0c4108ebf6d515fbff30afed18e48146` |
| `tests/commands/structured-stress/split-increment/command.test.ts` | native | `04c05dd3e9f65303ac9ba0d8962c7af1d29342b62282f163e53229f85e7225d3` | `5c4d39cfff9622dd5712da540a278343f1262090753ea623ba336a21bb19c8f5` |
| `tests/commands/structured-stress/jq-42-author-20260827/safety.test.ts` | host | `34d4a0d819eb5bcbdd7bf65b6d7daa370fe975545b960976e95f8f14086a8528` | `6e5b793461e41c8b392c84db81bebb49340b7d3baea4946c68f8142d830157be` |

## R1–R4 corrections

**R1 — bounded spans.** The native and host proposals have 36 exact,
nonoverlapping original-text edit spans total, with byte offsets and hashes.
Shared loops are changed once, not once per row. The entire safety suffix
starting at `const preflight:` remains byte-identical: 7,017 bytes, SHA-256
`8b1f26fa92b33bf83dee716cf778d7bfd5572a62e64b825751465fbbeaa0bf32`.
There are 93 untouched top-level statements checked bytewise, including the
unrelated safety/resource controls. No signals, limits, timeouts, counters,
cleanup assertions, source arrays, split endpoints or empty chunks are removed.

**R2 — actual bytes.** The two proposed test helpers expose opt-in
`executeWithBytes`/`runWithBytes` results with copied `stdoutBytes` and
`stderrBytes`. Legacy `execute` and `run` retain their existing fields,
including `run`'s context/command-result fields; no product API changes.
Structured capture uses `Buffer.from(chunk)`, not a potentially shared Buffer
slice. Raw bytes are collected before decoding; decoded strings are retained
only for existing tests. The stress helper's 128 KiB per-stream cap, all command
limits, input defaults and overrides remain intact. The structured helper gets
no new arbitrary budget. Both helper diffs require independent review.

`assertNative` compares exact status and hex derived from these raw arrays,
not from decoded strings. All 14 documented invalid-byte/U+FFFD mutants still
produce equal decoded text but fail both the byte assertion and their actual
proposed canonical callbacks. A proposed 15-test assertion suite covers the
14 mutants plus exact lookup controls. Validation also checks missing/duplicate
keys, forbids undefined input, and injects reusable output Buffers into the two
helpers to verify copies, legacy return fields, default input, override identity
and the existing stress capture cap. These are test-harness checks, not product
sink/cancellation or quota acceptance.

**R3 — concrete invocation binding.** The four incremental cases retain the
baseline `input` and every `source()` call, inclusive cuts and empty middle
chunks. CLI captures `result`, `single` and `slurp` independently, including
exact stderr and slurp's empty stdout. The resource test retains all 29 calls:
15 JSON inputs, four byte inputs, three division/modulo filters, three large
decimals, three arithmetic/conversion filters and the explicit surrogate call.
Its six omitted-input filters still receive helper-default `null`, with lookup
inputHex `6e756c6c`, not empty input or undefined. The independently captured
six corrected controls are referenced, and this leaf reran those actual inputs.
All 36 CLI mode/input pairs and 297 CLI schedules remain represented.

Only the 13 raw IDs listed in the patch are overridden. Their original virtual
file setup and four chunk sizes remain intact. Original fixture bytes are not
overwritten. The old raw tests do not contain post-run VFS namespace/content
assertions; retaining setup does not invent such coverage.

**R4 — six selected malformed indices.** Only `{5,14,15,16,21,22}` receive
exact native acceptance overrides and corrected names. Index20 remains the
existing successful large-exponent case with its original assertions. All
other 17 original loop branches, including that success, are left intact.
There is no blanket-failure rewrite and no gratuitous strengthening of the
16 neighboring malformed rejections. The separate three native compiler rows
are join/0, join/2 and split/0. Split/2 regex flags retain their existing name,
unsupported diagnostic branch, status, empty stdout and no-acquisition guard.
Split/0 retains a throwing iterator; empty native stdin is only the compiler
control, never a claim that the iterator is empty or acquired.

## Exact names and schedules

The authoritative structured `row-map-final-v3.json` has all 29 rows and each
constituent's argv, actual inputHex, file bytes, exact status/stdoutHex/stderrHex,
immutable proof identity and schedule. `proof-links-v3.json` maps each to
this leaf's native observation or explicit unavailable-file result.
`invocation-schedules-v3.json` records all actual original/proposed callback
inputs and chunks from the test-only simulation: **464 selected invocations**
(461 original26 + three compiler diagnostics), not 464 product executions.

| Row | Original name | Proposed name | Retained calls |
| --- | --- | --- | ---: |
| 1 | strict UTF-8 rejection remains chunk invariant (not native parity): raw-lone-continuation | native UTF-8 replacement remains chunk invariant: raw-lone-continuation | 12 |
| 2 | strict UTF-8 rejection remains chunk invariant (not native parity): raw-truncated | native UTF-8 replacement remains chunk invariant: raw-truncated | 7 |
| 3 | strict UTF-8 rejection remains chunk invariant (not native parity): raw-bad-continuation | native UTF-8 replacement remains chunk invariant: raw-bad-continuation | 6 |
| 4 | strict UTF-8 rejection remains chunk invariant (not native parity): json-bad-string | native UTF-8 replacement remains chunk invariant: json-bad-string | 19 |
| 5 | raw native: record-error-prefix | raw native: record-error-prefix | 4 |
| 6 | raw native: file-unicode:-Rc | raw native: file-unicode:-Rc | 4 |
| 7 | raw native: file-unicode:-Rsc | raw native: file-unicode:-Rsc | 4 |
| 8 | raw native: invalid:0:-Rc | raw native: invalid:0:-Rc | 4 |
| 9 | raw native: invalid:0:-Rsc | raw native: invalid:0:-Rsc | 4 |
| 10 | raw native: invalid:1:-Rc | raw native: invalid:1:-Rc | 4 |
| 11 | raw native: invalid:1:-Rsc | raw native: invalid:1:-Rsc | 4 |
| 12 | raw native: invalid:2:-Rc | raw native: invalid:2:-Rc | 4 |
| 13 | raw native: invalid:2:-Rsc | raw native: invalid:2:-Rsc | 4 |
| 14 | raw native: invalid:3:-Rc | raw native: invalid:3:-Rc | 4 |
| 15 | raw native: invalid:3:-Rsc | raw native: invalid:3:-Rsc | 4 |
| 16 | raw native: invalid:4:-Rc | raw native: invalid:4:-Rc | 4 |
| 17 | raw native: invalid:4:-Rsc | raw native: invalid:4:-Rsc | 4 |
| 18 | strict malformed JSON 14 across chunk boundaries | native JSON acceptance 14 across chunk boundaries | 4 |
| 19 | strict malformed JSON 16 across chunk boundaries | native JSON acceptance 16 across chunk boundaries | 4 |
| 20 | invalid UTF-8 never becomes replacement text | invalid UTF-8 JSON tokens preserve prefix and native diagnostics | 15 |
| 21 | malformed UTF-8 preserves completed JSON prefix across every chunk split | malformed UTF-8 preserves completed JSON prefix across every chunk split | 297 |
| 22 | valid large decimals survive while malformed JSON and division by zero fail | native JSON grammar, large decimals and division diagnostics | 29 |
| 23 | strict malformed JSON 5 across chunk boundaries | native JSON acceptance 5 across chunk boundaries | 4 |
| 24 | strict malformed JSON 15 across chunk boundaries | native JSON acceptance 15 across chunk boundaries | 4 |
| 25 | strict malformed JSON 21 across chunk boundaries | native JSON acceptance 21 across chunk boundaries | 4 |
| 26 | strict malformed JSON 22 across chunk boundaries | native JSON acceptance 22 across chunk boundaries | 4 |
| 27 | join native: join-zero-arity | join native: join-zero-arity | 1 |
| 28 | join native: join-two-arity | join native: join-two-arity | 1 |
| 29 | split rejects out-of-scope arity: split | split rejects undefined native arity: split | 1 |

Final preservation validation registers 373 unselected tests alongside the
selected rows: 167 callbacks remain byte-identical after transpilation and 206
shared-loop callbacks retain identical simulated call/assertion traces. All 69
split-native fixtures are included as unchanged registrations. Synthetic traces
are not utility results; the independent byte-span/static-statement checks are
the source-preservation evidence. A first report omitted these 69 registrations
via an empty fixture stub: `verification-v3.json` and
`unrelated-preservation-v3.json` remain as recorded. The authoritative final
files explicitly supersede that accounting; the selected464, mutant14 and
static93 observations are unchanged, checked against their first artifacts.

## Native evidence and literal-file limitation

This leaf ran only local `/usr/bin/jq` as the native oracle, without a host
shell, inherited environment, network or product execution. Capture began
`2026-08-27T02:15:14.003Z` and ended `2026-08-27T02:15:14.917Z`. Native reports
`jq-1.7.1-apple`, build `--with-oniguruma=builtin`; executable SHA-256
`1625910a3f99fbd11c3ad58cc16ebc359507e6e19c21e91d8ab7da2116c8429f`. Full environment:
`PATH=/usr/bin:/bin LC_ALL=C LANG=C TZ=UTC NO_COLOR=1`. Every process used a
5-second timeout and 256 KiB capture bound in this owned isolated cwd.

The 96 row constituents deduplicate to 90 exact input keys; 88 were rerun
twice, with equal status/stdout/stderr both times and exact frozen matches.
Including version/build queries, that is **178 processes**. Two file keys were
not executed. Full raw tuples, argv, cwd, environment, executable hash, both
repetitions and before/after cwd hashes are in `native-v3.json`.

For both file-unicode cases the required argv contains literal
`unicode-start`, whose required bytes are `f09f`; stdin is `98800a`.
The existing immutable author `native-files/` inventory has 11 regular files,
no `unicode-start`, and no exact `f09f` candidate. The inspected
`freeze-files.mjs` creates its listed text fixtures through
`artifacts.mjs`/apply_patch; it does not create the missing binary fixture.
`native-v3.json` records all existing file hex/size/mode/hash entries, hashes
both provenance scripts, and preserves namespace/content hashes before/after.
There was therefore no honest available literal-file invocation to make.
No bytes were scripted into old files, no binary fixture was created, and no
fd rerun was substituted. Historical literal-file expectations remain frozen;
prior review fd variants remain separately labeled, NOT literal-path evidence.
**Independent literal-file verification remains an open gate.**

## Conditional host proposal — separate one-row decision

`host-row-v3.json` and `host-conditional-v3.patch` concern only
`host stdout failure is never a recoverable filter error: host sink failure`.
The source reviewer, not this leaf, decides whether that host-thrown JqError
must reject with identical object identity rather than become status5. The
patch is explicitly conditional, has no native proof, and is not described as
retiring a stale native expectation. It retains writes===1, reads===1, cleanup
and the existing EPIPE identity control; only JqError gets a stderr-write probe
requiring zero. A synthetic identity stub passes; converting to status, adding
diagnostic writes or extra input reads makes the proposed callback reject.
This proves assertion wiring only, not the product's host contract.

## Validation and handoff boundaries

- Both unified patches pass non-applying `git apply --check`; an independent
  in-memory hunk parser reconstructs every complete after snapshot.
- No product imports. In-memory TypeScript checking of proposed files reports
  zero proposed or transitive diagnostics at capture time, with no emit. This
  is not the repository's global type/build gate or a stable source certificate.
- Original snapshots, old raw JSON and five immutable evidence trees remain
  endpoint-hash-identical. This is not a transient-ABA guarantee.
- Authoring attempts initially stopped on a duplicate proof-input lookup, two
  ambiguous/escaped edit anchors, and VM cross-realm object prototypes. Each
  was fixed in owned scripts before successful artifacts; none was a product
  failure or silently normalized byte result. The first validation registration
  omission is preserved and corrected separately as described above.
- Historical original42 accepted790, legacy94 45 exact/49 differences,
  original22 red, and author-current1550/1580 remain historical. No denominator,
  fixture, result or snapshot is rebaselined; these observations are not added
  to accepted790 or represented as canonical green.
- Reviewer must inspect both helper changes and the exact native diff, resolve
  or explicitly route the unavailable literal-file gate, and independently
  authorize a later TEST-ONLY application. Source/build acceptance is separate.
  The host patch additionally requires an explicit contract ruling and must not
  be bundled into a native delta. This leaf applies neither patch.
- Later authorized validation must run the changed canonical files, retained
  neighboring controls and independent source cohorts, including the prepared
  35/178 + 256/790 + 94/376 exact executions and failure-boundary repetitions.
  This bounded proposal does not establish quotas, cancellation, VFS safety,
  complete jq/Bash support, 72 hours of work or superiority over just-bash.
