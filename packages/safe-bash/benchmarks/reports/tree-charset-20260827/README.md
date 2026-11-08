# Tree virtual charset author handoff

August 27, 2026. Source candidate:
**`f1a90436c45208ca248e058a039893233c608daa`**.
Frozen baseline: `45baf7647124282bf52cd843656b6e190746580a`.
Actual source parent: `643439ad70b0ada46eef2c073aceeba3246866ad`; the two
intervening commits change other workers' evidence only, not any selected source,
tree test, package or compiler input. `checks.json` verifies that distinction.
This is author implementation/regression evidence; **different-verifier
acceptance and packed/default holdouts remain pending**. No whole gate,
comparison score, root registry change or general native-parity claim.

## Scope and selection

The source commit changes only `src/commands/tree/charset.ts`, `arguments.ts`,
the subtree README, and adds `tests/commands/tree/charset-selection.test.ts` /
`report-counts.test.ts`. The walker, counts, output emitter, name escaping,
patterns, limits, traversal, FS, contracts, root exports and manifests are
unchanged. Original tree tests/captures and the original strict recipe remain
byte-identical. `checks.json` records these comparisons against the source parent.

Selection: last explicit `--charset` > present `TREE_CHARSET` > first nonempty
own `LC_ALL` / `LC_CTYPE` / `LANG` > ASCII. Explicit names support ASCII,
US-ASCII, UTF-8 and UTF8, case-insensitively. Unknown/empty explicit values remain
usage errors; a later good flag does not erase an earlier invalid flag.
Empty/unknown environment TREE_CHARSET selects ASCII; values are not trimmed.
No inherited or ambient environment keys are used. Explicit charset skips
environment lookups; a chosen environment value skips lower-precedence keys.
Visited strings receive existing length/metadata/work admission before scans.

The approved deterministic virtual locale table is C.UTF-8, C.utf8,
en_US.UTF-8 and en_US.utf8. Other names select ASCII. Fresh native evidence
revealed a platform distinction, relayed to ROOT before implementation:
**Darwin accepts C.UTF-8/en_US.UTF-8 but falls back to ASCII for C.utf8 and
en_US.utf8**. The latter remain explicitly documented virtual aliases, not
native-Darwin passes. We did not add further locale names or infer installed
locale validity from arbitrary suffixes. Other native character sets, locale
collation and raw Unicode filename rendering are outside this change.

## Results, with denominators preserved

| Check | Before | Candidate |
| --- | --- | --- |
| Existing unchanged tree tests, pinned optional native enabled | 77/77 | 77/77 |
| New author tests | Not present | 62/62 |
| Combined scoped tree tests | 77/77 | **139/139**, zero skips/cancellations |
| Scoped strict TypeScript, skipLibCheck=false | pass | pass |
| Full source build in isolated archive | pass | pass |
| Original 34 investigative native/VFS pairs | **26 matches / 8 differences** | **31 matches / 3 differences** |
| Count totals in original count probes | 15/15 agree | 15/15 agree |

The test counts include existing divergence-characterization checks and a new
assertion that the old strict recipe still differs. They are not 139 native
compatibility claims. The 34-pair byte/status comparison is the compatibility
denominator. Original pre-change `RESULT.json` stays under
`../tree-breadth-proposal-20260827/` unchanged.

Exactly five old connector differences close: UTF-8 LC_ALL; UTF-8 LANG;
LC_CTYPE precedence; empty LC_ALL fallthrough; TREE_CHARSET under C. The three
retained differences are:

1. `count-mixed-roots`: an explicit file operand gets native `[error opening
   dir]` decoration but not virtual decoration. Counts still agree.
2. `names-utf8`: native Darwin filename collation and escaping differ. Branches
   now agree; filename semantics still do not.
3. `names-utf8-ascii-branches`: explicit ASCII branches already agreed; native
   Unicode-name collation/escaping remains different.

The old strict recipe still expects UTF-8 branches and **1 directory** under C;
the command still emits native-C ASCII branches and **2 directories**. No root
decrement, legacy switch, altered expected bytes or score relabeling was made.

`NATIVE-EDGES.json` preserves 34 extra native calls: aliases, empty/unknown/
whitespace values, override order and virtual-locale neighbors. All completed,
but not all are virtual parity cases: the lowercase locale aliases and unknown
explicit charset handling are the declared distinctions above. Native empty
explicit charset returns 1 while virtual usage status remains 2. No silent
native-status adoption or unsupported-as-pass classification.

## Binding and execution

`frozen-checks.mjs` archives only explicitly committed source/config/tree tests
at each revision into fresh regular-file scratch copies. It copies and verifies
314 pinned tool files from the earlier loader review; no dependency installs,
private repositories, live source overlays or stale dist reuse. All test/runtime
children use the recorded Node binary and explicit C/UTC environment. Actual
scoped test argv uses `--test-reporter=tap --test-concurrency=2` with a 120-second
per-process ceiling; no wider gate launch. The source build happens in each
copy, not in the live repository. `FROZEN.json` retains full phase argv/status/
TAP, source and tool manifests and emitted artifact hashes.

Installed Node22.22.2 binary SHA256:
`5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.
Native unix-tree2.2.1 Darwin arm64 binary SHA256:
`34a794e5737d4b09a20a58dc0b7231e6300a3d229be5065c3a549969d205f10a`.
Native source/archive provenance and original versioned count evidence remain
in the proposal; these are fresh invocations of that same pinned binary, not a
new native build or Linux qualification.

`replay-breadth.mjs` is the previously sealed probe with **only its candidate
literal changed** from 8b89c0e7 to f1a90436. All 34 inputs and comparisons are
unchanged. It uses committed-source bundling, an isolated native fixture and an
actual default Shell call; no packed-package claim. Before/after source/host
fixture censuses detect new entries. Virtual input contents are checked, not
full namespace/mode census. `checks.json` proves reversible driver rebinding,
unchanged row inputs/native outputs and the exact five closed differences.

The scoped test-copy census allows only generated `dist` and pinned node_modules
as new top-level outputs; other additions are rejected. Existing source and tool
bytes are verified before/after. No retained child or scratch directory remains.

## Initial author corrections retained

`initial-focused.tap` preserves the first **61/62** new-test run. The pipeline
test redirected into the directory being listed; the new output file correctly
appeared in the listing. Its final script explicitly filters `listing` in both
invocations. No product change or original fixture rewrite was needed.
`initial-types.txt` preserves four TS2550 errors: the test used ES2024
Promise.withResolvers despite the project's ES2023 lib. Replaced with a local
typed deferred helper, without tsconfig/type suppression changes.
The failed TAP diff contains four whitespace-only lines; they are retained as
raw output, not trimmed to satisfy `git diff --check`. Authored source and
evidence files pass whitespace checks separately from that exact raw capture.
`focused-02.tap` and `types-02.txt` retain the passing local rerun; the subsequent
frozen run, not those mutable local checks, supplies the candidate counts above.

`initial-verifier.stderr` retains an evidence-validator failure: it incorrectly
assumed the frozen baseline was also the immediate source parent. Concurrent
commits 3e6044ff/643439ad add two unrelated evidence-file changes. The corrected
validator checks the actual single-commit write set and separately verifies zero
selected-input changes between baseline and parent. No test result or product
source changed to address that metadata error.

## Independent review request

Freeze literal/native holdouts independently. Verify moved packed root/subpath
and default registry behavior, option forwarding, explicit/env priority and
host/prototype isolation; UTF-8 output byte caps, filename escaping, cumulative
metadata/work admission before scans, backpressure, sink rejection, abort reason
and no writes after abort. Keep count and alias/traversal tests unchanged.
Suggested guard mutants: always-ASCII, always-UTF8, ignored explicit flag,
unknown/empty fallthrough, host-env lookup, inherited-key lookup, uncharged
UTF-8 bytes, root decrement and per-root count reset. Author tests are not a
substitute for those independently selected controls.
