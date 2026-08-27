# Independent HTML repair review — source3ef5811f

## Decision

**HOLD: F03 and F04 remain genuine source bugs.** The original minimal examples
are repaired, but seven small, default-limit neighboring inputs still create
ordered lists or visible emphasis markers. Every counterexample reproduces in
both the immutable-source isolated build and the actual packed/installed/moved
closure. F01, F02, F05 and F06 close within the explicitly measured scope below.
No product code was repaired. No public/root/default, full-package, global-gate,
superiority, deployed-service or 72-hour acceptance is claimed.

## Exact bindings and chronology

- Product source: `3ef5811f98d61800b6d4c6f16be046d4f539eeef`.
- Author frozen verification: `2c5178caaa90f687cfedd127879bf88e9f2b8f87`.
- Author evidence: `cbed49318f91db0be47a9e6638092452b448a0c1`.
- Independent expectation/protocol freeze:
  `9a386630d12e79de0b1a2e53f819068fe6846f92`.
- This freeze is **post-candidate and post-narrow-source-inspection**, before
  independent compilation/product execution. It is not blind/preimplementation
  attestation. FREEZE.md records prior exposure. All substantive work was done by
  this reviewer without delegation.
- Accepted setup PRE-RUN: August27,2026 20:09:31.592UTC; actual pack/install/move
  complete20:09:33.642UTC. Main replay completed20:10:59.738UTC. Targeted source
  audit, independently predicted empty-node counterexamples, retained original
  AST replay, and sealing followed. Receipt timestamps delimit actual work.

Author handoff hashes, read from the immutable evidence commit, not mutable HEAD:

| File below `tests/commands/html-to-markdown/fix-review/` | SHA256 |
| --- | --- |
| README.md | `f37df550b265f0a6e757bdc2926941059eec737a267481dab7e430bf71ad29ad` |
| RAW_REPORT.json | `e1c9ad7c158371c502d8783021026620676d36da10f415bd7b07b1a2fd9740cb` |
| ORIGINAL_FOLLOWUP.json | `88a64550244108012172ad5375bb0b0602e7e1e6e73db85c773f965892d9fd2d` |
| SOURCE_RECEIPT.json | `ff3ec5f75190ed33d6fd764eac37540a110f9f321ab3eb791851e4d8697ff3be` |

All23 author compiler-source hashes match the selected product source; all46
overlapping executable/declaration outputs match this independent build. The46
source-map files differ with output location; their independent hashes are
retained, not silently called identical. The author154 tests (119old+35new),55
product probes,22 parser checks, types and denials are authenticated **author
evidence**, not counted as independent execution. The four original119-test
files are unchanged from21ca7b8c, not from the earlier117-test source2272feb9.

## Six-finding closure

| Finding | Scoped result | Independent evidence and remaining boundary |
| --- | --- | --- |
| F01 whitespace retry scan | CLOSED for reviewed defect | Original four sizes settle, exact complete output; default-limit131072-space conversion succeeds; charged trim/normalization refusals and controlled scan/render aborts pass. Native copies remain nonpreemptible. |
| F02 unresolved-reference retry scan | CLOSED for reviewed defect | Original four sizes settle with exact full destinations at unchanged1048576 token cap; charged destination scan refuses EFBIG and yields to exact-reason abort. No universal time/RSS guarantee. |
| F03 accidental Markdown structure | OPEN | Original period/paren/strike cases and initial32 AST checks pass; empty em/code/anchor between numeral and punctuation still produces OrderedList. Three independent counterexamples per layout. |
| F04 adjacent emphasis markers | OPEN | Original adjacent-em case and author22 AST cases pass; empty differently styled or inline-atom siblings defeat visible adjacency. Four counterexamples per layout insert literal `**` or `____`. |
| F05 token-dependent entity corruption | CLOSED under approved refusal policy | Original R04/R05 status0 assertions remain raw failures. Exactly frozen v2 status1/empty-output/token-bytes-EFBIG passes;10 nearby valid-cap cases preserve bytes at every two-chunk boundary. No cap increase in old inputs. |
| F06 controls trimmed before rejection | CLOSED for reviewed defect | Old edge-control repros pass;130 direct edge checks and256 full-module numeric-reference checks per layout reject controls; ASCII spaces remain allowed. Numeric NUL replacement is qualified separately. |

### F03 residual (Medium): empty nodes interrupt punctuation context

At immutable `src/commands/html-to-markdown/render.ts:116`, `precedingDigit`
consults only the immediately preceding AST child. Empty em/code/anchor nodes
survive `inlineChildren` but render no characters. They therefore sever the
numeric-prefix check while leaving numeral and punctuation adjacent in output.

| Input | Actual status0 Markdown | Parsed wrong structure |
| --- | --- | --- |
| `<p>1<em></em>. ordinary</p>` | `1. ordinary\n` | OrderedList |
| `<p>1<code></code>) ordinary</p>` | `1) ordinary\n` | OrderedList |
| `<p>1<a></a>. ordinary</p>` | `1. ordinary\n` | OrderedList |

All use defaults, empty stderr, natural settlement and uninstrumented candidate
code. Empty transparent span and genuinely emphasized numeral controls pass.
The literal paragraph must not become a list merely because an empty inline node
appears in its source. This is the same F03 semantic requirement, not new syntax.

### F04 residual (Medium): AST adjacency differs from rendered adjacency

`render.ts:50` coalesces equivalent styles only when they are neighboring retained
AST children. `render.ts:237` can then erase an intervening empty style, while
`render.ts:245` can erase an empty inactive anchor. The delimiter choice at
`render.ts:108` likewise uses those nonvisible neighbors rather than emitted text.

| Input | Actual Markdown | Visible corruption in pinned AST |
| --- | --- | --- |
| `<em>a</em><b></b><em>b</em>` | `*a**b*\n` | `a**b` inside Emph |
| `<em>a</em><a></a><em>b</em>` | `*a**b*\n` | `a**b` inside Emph |
| `<em>a</em><span><strong></strong></span><em>b</em>` | `*a**b*\n` | `a**b` inside Emph |
| `<b>a</b><em></em><b>b</b>` | `__a____b__\n` | `a____b` inside Strong |

The nonempty whitespace separator control passes. NEIGHBORS.json pins the10
independently predicted inputs/character-style expectations before their run;
followup/PRE-RUN.json binds them. All20 conversions and20 native parses succeed
as processes; **AST assertions are6pass/14fail across two layouts**, not20passes.

## Policy delta and unchanged failures

EXPECTATION-v2 changes **only R04/R05 success criteria**, using the documented
author bytes and explicit user authorization. Both original inputs/caps are
unchanged. Each returns status1, stdout zero bytes, and exactly:

```text
html-to-markdown: EFBIG: html-to-markdown token bytes limit exceeded
```

This ends with one LF. Per layout, both ordinary invocations and24 split-boundary
invocations match. The10 separate valid-cap cases add152 split-boundary checks
plus10 unsplit checks. They cover amp5/6, numeric10/11, prefixed/suffixed text,
textarea16 and title8. These are nearby **new** cases, not larger old caps.

Original125 is again119pass/6fail, but **not the same six failures**. Five old
fixture defects remain L02-heading-paragraph, L06-raw-ordinary-text, B10-files,
B11-args and P11-shell-middleware. U-title-alt-injection now passes the original
invariant; L18-malformed-tail newly fails its exact literal because `=` becomes
`\=`. Six frozen fixture corrections are5pass/1fail: U-title-alt-injection-v2
also differs only in equals escaping. Their original assertions were not edited
or waived. Separate exact visible-character/native-AST checks preserve malformed
text and alt text, safe destinations and no raw HTML. These observations do not
rescore those raw byte assertions or extend the entity-policy delta.

Supplemental shared-counters now fails its original individual `x` conversion
at `maxWorkUnits:20`, status1 with work-limit EFBIG. Expanded charging consumes
the old threshold. No raised budget or replacement assertion is applied. The
other five supplemental receipts pass. This is a disclosed work-accounting
compatibility change, not a successful replay of the old six assertions.

## Exact execution counts

These rows are **per layout**; isolated and moved each ran the complete table.
PASS refers to that frozen assertion/observation, not general product acceptance.

| Main phase | Receipts | PASS | FAIL | Qualification |
| --- | ---: | ---: | ---: | --- |
| Original frozen |125|119|6| Includes unchanged protocol/observation rows |
| Frozen corrections-v2 |6|5|1| No expectation rewrite |
| Original semantic repros |9|7|2| R06 status-only; R04/R05 superseded separately |
| Exact policy-v2 |2|2|0| Includes24 two-chunk boundaries |
| New valid boundaries |10|10|0| Includes152 two-chunk boundaries |
| Original seven-form/four-size stress |28|28|0| All status0/natural;8 additionally exact full output |
| Original supplemental |6|5|1| Old20-work-unit threshold fails |
| Original100ms abort assertion |1|0|1| Missing rejection after fast completion |
| Abort observation/controls |3|3|0| Fast completion, pre-abort, no-trigger kept distinct |
| Render-stage in-flight abort |6|6|0| Three repetitions of each of two inputs |
| Adjacent work refusals |8|8|0| Direct actual module operations, EFBIG |
| Slash-attribute low-work neighbor |3|3|0| Status1/work EFBIG, not successful conversions |
| Host-denial controls |4|4|0| File, fetch, child, net |
| Entry/dependency/expectation denials |5|5|0| Actual missing files, wrong literal, tiny budget, source denial |
| Strict declaration consumers |4|4|0|1positive;3expected TS2322/TS2353 failures |
| Intentional supervisor negative |1|—|—| Expected synthetic kill; never a product pass |
| Initial semantic conversions |32|32|0| Author22 unchanged plus10 independent neighbors |
| Initial pinned parser/AST |32|32|0| Character/style assertions pass for those32 only |

Main totals:570 subprocess receipts =546PASS,22FAIL,2intentional supervisor kills.
Followup adds50 naturally settled subprocess receipts:20conversions,20parses,
2edge-control children and8direct scan-abort children. Seven of10 semantic cases
fail in **each** layout despite their conversion/parse processes succeeding.
Each edge child asserts389 observations:130direct controls,256public encoded
controls,2allowed-space cases and1numeric-NUL replacement/inactive-scheme case.

Unchanged old semantic-audit.mjs is also actually executed: the final versioned
adapter runs5/5 original AST assertions per layout using the old commonmark_x
reader. It adds14subprocess receipts (12native parses+2audit processes), including
separate preserved-text observations. The initial adapter adds7retained receipts
before its reviewer-only smart-punctuation oracle defect stopped it; see below.

Accepted run05 archive totals **644 subprocess receipts**, including3 successful
build/pack/install children:642naturally settled,2intentional nonproduct kills,
**zero forced product terminations**, all groups gone at receipt. It contains
2934files,15934verified product-load records and874verified harness-load records.
Semantic assertions are reported separately from subprocess exits. Earlier failed
setup attempts add5supervised receipts (3natural successes,2natural failures),
not product execution. Total recorded supervised receipts across attempts:649.

## Cancellation evidence

Both unchanged100ms assertions fail honestly with missing rejection, and both
controlled100ms observations record natural-fast-completion with no timer fire.
They provide **no exercised abort coverage**. Their original receipts remain.

The12 new render-stage runs observe actual input admission, EOF and generator
finally, then actual Renderer.document entry, then a charged checkpoint with
positive rendering work while signal is un-aborted. A queued setImmediate fires
while execute remains unsettled; the original checkpoint implementation yields.
All reject with identical frozen reason objects, no stdout/stderr, one registered
cleanup and one input finalization. Observed trigger-to-completed-cleanup settlement
is0.1715–0.392875ms, below the frozen1000ms observation bound and5000ms containment.
These are controlled internal observation wrappers, **not uninstrumented public
stage APIs**. They do not replace rendering/checkpoint code or guarantee timer
races. Eight further direct trim/normalize/destination/entity scan runs trigger
only after4096–8192charged work units and preserve the exact reason naturally.
No-trigger full output and pre-abort/no-admission controls remain separate.

## Adjacent work audit

The source review covers every module implementation file. Its import closure
is authenticated and executed, not claimed individually re-audited in full.
`text.ts:5` replaces quadratic trim retry with edge indexes and charged
copies. `entities.ts:53` is a single destination state machine, charging/yielding
per character before space trimming; recognition windows in entities/language
remain bounded34/41characters. `parser.ts:85` charges tag envelopes before the
bounded native regex; attribute whitespace/name/value scans and slash-tail
handling are explicit traversals. `input.ts:76` charges/adopts owned byte chunks
before4096-byte parser slices. Render traversal, normalization, fence scans,
boundary inspection and cell escaping check/charge/yield; Builder accounts for
retained pieces, joins and output bytes. The eight direct low-work controls cover
trim, normalization, entities, escaping, destinations, language, fences and tags.

Remaining synchronous operations include bounded tokenizer suffix searches,
native URL parsing, case conversion, string copies/joins/splits/includes,
child-array copies and table row/header scans. They are not each preemptible or
separately charged as CPU instructions; surrounding charged traversals and token,
node, depth, cell, output and input caps bound their inputs. This audit did not
reproduce another F01/F02 retry-scan defect. It does **not** establish hard
wall-time, RSS, total-host-work or universal cooperative-cancellation bounds.
All seven stress recipes retain original input/limit recipes; no benchmark or
head-to-head superiority inference follows from these single-run times.

## Packaging, authentication and denials

The exact source commit supplies36TS files; TypeScript emits144files. An actual
offline npm pack produces SHA256
`c71dc31a785791707c40d6906d59874f4218a550e019bd5c18a96ce71e2f0986`.
It is actually installed into a separate private fixture, then moved to the
consumer's normal `node_modules/virtual-bash` directory. Tar parsing independently
matches all145regular installed files, including package.json; no symlink or
runtime dependency is accepted. The old source location is poisoned and the
build is renamed. Both emitted layouts execute under source/ambient-file denial;
every loaded product byte matches the selected inventory. Missing actual entry
or parser dependency fails resolution rather than falling back. Wrong literals,
tiny budgets, prohibited host operations and erroneous declaration types fail
as intended. In-memory verification negatives reject a false load hash and a
missing packed entry without mutating retained evidence.

PRE-RUN binds Node22.22.2, copied compiler/types tooling, the npm CLI's complete
tool inventory (including authenticated internal tool symlinks), Pandoc3.10.1,
source/config/lock inputs and all main supervisors/consumers/loaders. Per-child
pre receipts bind actual generated fixtures/harness bytes and executable hashes.
The targeted followup and versioned AST adapters have their own pre attestations.
Post-run inventory checks compare names as well as hashes, detecting added,
removed and changed entries. This is not merely a tracked-path check. Git blob
identities/bytes are rechecked by verify-evidence; the initial Git extraction
executable itself was not separately prehashed. No retroactive attestation of
that executable or OS shared libraries is claimed. Node/npm/compiler/Pandoc and
actual child supervisors **were** bound before their relevant executions.

This is a **scoped module-local dependency closure**, not a complete public
package: unbuilt unrelated declared exports and the unexported HTML subpath are
not accepted. Runtime tests use the real emitted leaf inside the moved package,
not a fabricated new public export. Native Pandoc is only a pinned Markdown
parsing oracle; no general network install or runtime product dependency occurs.

## Retained deviations and old history

Four setup-only attempts remain in SETUP-ATTEMPTS:

1. Wrong117-test baseline for the author's119-test assertion; corrected to21ca7b8c.
2. Strict regular-file inventory rejected npm's internal `.bin/arborist` symlink;
   a distinct bounded tool-inventory function was added, without weakening the
   product/package regular-file check.
3. npm rejected using `/dev/null` as both user and global configuration. Both
   were replaced by distinct absent paths within the new fixture.
4. Without its own manifest, nested npm install walked to the repository root
   and failed offline with ENOTCACHED for development types. A private installation
   fixture manifest prevents that traversal. Existing tracked root files were
   not modified; no network dependency was installed.

Attempts1/2 stopped before PRE-RUN/compilation; their top-level tool exception was
not independently captured as a raw stderr file. Their materialized inputs and
original script bytes are retained; this limitation is not backfilled. Attempts3/4
retain actual bounded compile/npm stdout/stderr/pre/receipt files. No product
child ran in these attempts. Nothing is called a passing installation untilrun05.

The first new legacy-AST adapter incorrectly compared a straight quote to the
old `commonmark_x` reader's smart-quote output for an **additional** L18 check.
All five original AST assertions had passed. Its failed driver, traceback and
7receipts remain under legacy-ast. The separate legacy-ast-v2 output changes only
that additional check's reader to the declared commonmark+strikeout profile;
the original five assertions retain their original reader and bytes. No fixture
or product was repaired to follow the oracle mistake.

Historical source2272feb9/freezee761af2ed973e07b9b8cf09aae68ccbfbd475ca1/evidence
6177f88d08e42e111822abefe105ad39de6f647b remain untouched. Its125rows119pass/6fail,
sixcorrectionpasses,stress28=24pass/4fail,semantic9=2pass/7fail,AST5=1pass/4fail,
controls10pass,supplemental6pass,229receipts,576capturedfiles,6350productloadrecords
and **five forced product terminations** retain their original meanings. Its
intentional supervisor kill remains separate. The original16 comparative rows
(5exact/11different) and43comparative receipts are not rerun or rescored here.
The old34source/136emitted closure tarball remains
`cee898a7392f1c69b5730b836ebc15db7c1bc8debb423a221f191ea15bc45a14`.
The old historical supervisor versions were not preattested and its npm CLI hash
was post-run; these limitations are neither erased nor retroactively repaired.

## Reproduction and evidence

`run05.json.gz.base64` is a lossless base64-file-map gzip, SHA256 of compressed
bytes `a327e0b58695067aa26d3e9b6d47d8f84f3755ab650ceef11c99566a7b4650c6`.
run05.MANIFEST.json enumerates every archived file. VERIFIED.json gives the
cross-checked counts, exact counterexample ASTs and source/tool/package bindings.
SUMMARY.json intentionally summarizes the main570receipts only, not later phases.
Archived absolute paths are historical receipts, not paths required for replay.

From this repository with the pinned cached development tools and existing
Pandoc binary, use a unique new capture name:

```sh
node tests/commands/html-to-markdown-independent-20260827/fix-review-3ef5811f/setup.mjs fresh-review
node tests/commands/html-to-markdown-independent-20260827/fix-review-3ef5811f/run.mjs fresh-review
node tests/commands/html-to-markdown-independent-20260827/fix-review-3ef5811f/followup.mjs fresh-review
node tests/commands/html-to-markdown-independent-20260827/fix-review-3ef5811f/legacy-ast.mjs fresh-review
```

The final legacy adapter emits only its separate v2 directory on a fresh replay;
the historical first-attempt failure is retained evidence, not intentionally
recreated as a current success requirement. Read-only sealing/authentication:

```sh
node tests/commands/html-to-markdown-independent-20260827/fix-review-3ef5811f/seal.mjs run05 verify
node tests/commands/html-to-markdown-independent-20260827/fix-review-3ef5811f/verify-evidence.mjs run05
node tests/commands/html-to-markdown-independent-20260827/fix-review-3ef5811f/archive-attempts.mjs verify
```

Original repros and all existing committed files are unchanged. Working trees of
other owners, their staging and native artifacts are not part of this candidate
and are not touched. New evidence commits enumerate only this additive directory.
