# Final independent HTML normalization review

## Verdict

**ACCEPT the scoped F03/F04 normalization repair at immutable 9ae34a06 with the
exact supplied moved module-closure package.** Both findings close for the frozen
repros, all seven independent counterexamples and the bounded neighboring controls.
F01/F02/F05-under-v2/F06 remain scoped CLOSED. No new product defect was reproduced.
This is not an all-green assertion claim: all raw failures below remain failures.
No product changes, expectation waivers, public exports or registration changes
were made. This review does not certify the full public package or remove its
separate integration HOLD. Gate7 and lifecycle-wide review remain separate.

Candidate: `9ae34a06662db27897043d77d6145700c109b22c`.
Declared immediate parent: `d09a87e6558a4c7a4f927fe6d258a19a6656c3af`.
Author evidence: `309f6be38cd5c07d3991fc625a1481c28cd798eb`.
Independent freeze: `c10642866846d83a8a1f61e9712a30aab0ed0cd7`.
Only new files below this final-review directory were written; no delegation.

## Independent chronology

Twelve HOLDOUTS.json cases were committed before reading the candidate source or
detailed author handoff. This was post-candidate-commit and after exposure to the
user's author-claim summary and prior independent evidence, not blind/precommit.
Expectations are visible text, style, hard-break, code, node and destination
assertions under pinned Pandoc commonmark+strikeout. The precise implementation
of the three bounded normalization work/abort probes followed source inspection;
their protocol was frozen earlier and their bytes were hashed before execution.

The authenticated setup PRE-RUN starts 2026-08-27T21:12:12.574Z. Main replay ends
21:15:30.707Z; final live/Git/load audit completes at 21:16:31.065Z. These are actual
logged intervals, not a 72-hour work or full-project completion claim.

## Findings and meaningful nodes

| Finding | Actual evidence in each layout | Decision |
| --- | --- | --- |
| F01 charged trim/scanning | 28 unchanged stress recipes; adjacent work refusal and scan abort | remains CLOSED, bounded scope |
| F02 destination/entity scanning | unchanged adversarial destination stress, refusal and exact-reason abort | remains CLOSED, bounded scope |
| F03 accidental list/strike structure | actual R01/R02/R03 AST plus three old empty-wrapper counterexamples; new multi-empty numeral case | CLOSED |
| F04 visible emphasis-marker insertion | actual R06 AST; four old style-adjacency counterexamples; new strike/whitespace controls | CLOSED |
| F05 token-dependent entities | exact two approved v2 refusals; ten valid-cap inputs and every two-chunk boundary | remains CLOSED under v2 only |
| F06 controls removed before rejection | original R07/R08/R09; 389 edge observations per layout | remains CLOSED |

All ten NEIGHBORS pass strict AST assertions in both layouts: the seven formerly
failing inputs and all three original controls. The unchanged old five-assertion
semantic-audit actually executes and passes 5/5 in each layout, retaining its
original commonmark_x profile. The separate additional malformed-text check uses
commonmark+strikeout, as in the prior corrected adapter; no old audit was edited.
The initial 32 semantic assertions also pass per layout.

New holdouts pass **11/12 per layout**, not 12/12. Both hard-break cases preserve
LineBreak, both images preserve Image (including an empty alt), code preserves a
literal space and punctuation, and whitespace-only formatting remains a real
separator. Escaped literal HTML never becomes RawInline/RawBlock; unsafe-link text
remains visible without an active Link. The valid-link observation contains its
exact destination, visible label and surrounding emphasis without dropping Link.

**Reviewer fixture defect, retained FAIL:** `link-between-em` additionally froze
preservation of `title='title'`. I incorrectly extended the declared profile:
both the parent README and candidate README explicitly exclude arbitrary titles.
Actual output is `*a*[x](<https://safe.test/l>)*b*\n`; its AST has the correct Link
destination/label but an empty title. Both raw AST failures remain, with no edited
holdout, replacement test, product retry, policy expansion or passing rescore.
This is not evidence of a new source regression or node-loss bug.

## Work, growth and cancellation

The product delta contains only `render.ts` and its subtree README under `src`.
Module factory/plugin APIs, options/limits, parser, escaping, contracts, package
manifest and root exports are unchanged relative to the declared parent.
The rest of the source commit contains author-owned tests/harnesses, not more
product paths; these were not silently represented as a two-file whole commit.

Source inspection of renderer lines 40–122 finds charged visits, classification
and cache insertion; reference pushes occur after `work`/checkpoint admission.
Transparent chains recurse without allocating a flattened result for each wrapper.
Equivalent-style merging appends children rather than concatenating accumulated
prefixes. Cached per-container sequences and whitespace classifications avoid the
old repeated normalization pass. Meaningful br/block/code/link/image boundaries
remain. Destination selection still uses the unchanged policy and cached result;
escaping and raw-content suppression are not widened.

Actual bounded normalization rendering at 256/1024/4096 empty groups costs
**2894/11342/45134 work units** in each layout, with exact `*ab*\n` output.
The separate 64-work-unit probe refuses EFBIG at workUsed=64. This supports linear
behavior for this cohort and the audited append-only implementation, not universal
linear complexity, constant memory, RSS guarantees or arbitrary host preemption.
Nonempty nested formatting still costs depth-dependent work under the same cap.

There are **22 meaningful exact-reason aborts**, all naturally settled:
12 after actual input EOF and positive Renderer.document work (two inputs, three
repetitions, two layouts), eight direct trim/normalize/destination/entities scans,
and two direct normalization-render probes. Instrumentation queues setImmediate
at an actual original checkpoint with positive work and sinceYield >=4096, records
not-yet-aborted/not-yet-settled state, and calls the original checkpoint unchanged.
Unique reason object identity is preserved. Measured trigger-to-settlement is
0.170375–0.751542 ms on this host. This is internal observation, not a public stage
API or a portable deadline guarantee. Pre-abort and no-trigger controls are distinct.
The old 100ms attempt completes naturally in both layouts and **is not abort proof**;
its original missing-rejection assertion remains FAIL.

## Actual counts

Counts below are **per layout**, and are identical for isolated and moved.
Subprocess success does not substitute for a semantic assertion.

| Main cohort | Receipts | PASS | FAIL | Separate |
| --- | ---: | ---: | ---: | --- |
| Original frozen |125|119|6| unchanged assertions |
| Frozen corrections |6|5|1| no rescore |
| Original semantic repros |9|7|2| superseded policy failures retained |
| Approved policy-v2 |2|2|0| 24 split observations |
| Valid entity boundaries |10|10|0| 152 split observations |
| Original stress |28|28|0| eight also exact-output checked |
| Supplemental original |6|4|2| shared-work threshold plus poison-launch issue |
| Old100ms abort assertion |1|0|1| natural fast completion |
| Abort controls/observations |3|3|0| not three in-flight aborts |
| Render-stage in-flight abort |6|6|0| exact reasons |
| Direct work refusals |8|8|0| unchanged work caps |
| Slash-attribute low-work |3|3|0| refusals |
| Host denial |4|4|0| file/fetch/child/net |
| Missing files/assertion/source denials |5|5|0| expected failures |
| Strict declaration consumers |4|4|0| one valid, three invalid |
| Supervisor busy-loop |1|0|0| one intentional nonproduct kill |
| Initial semantic conversion/parser |64|64|0| separately 32/32 AST |

Main: **570 receipts = 544 PASS + 24 FAIL + 2 intentional kills**.
Followup: 50 naturally settled PASS receipts, separately 20/20 neighbor AST.
New holdouts/work: 54 naturally settled PASS receipts, separately 22/24 AST.
Old-five adapter: 14 naturally settled PASS receipts, separately 10/10 old AST
and preserved malformed/alt visible-text observations.
Setup: three natural PASS receipts (compile/pack/install), with the subsequent
parent-process exact-map assertion failure separately retained.
Total: **691 receipts = 665 PASS + 24 FAIL + 2 intentional kills; 689 natural**.
Zero forced product terminations. All process groups are gone at receipt.
Final audit checks **16,546 product loads and 904 harness loads**, not just entries.

## Failures and policy accounting

The original 125-row cohort still has six failures: L02/L06 overescaping fixture
expectations, B10/B11 CLI-status expectations, the P11 middleware fixture that does
not return next(), and L18's extra escaped equals. U-title-alt-injection-v2 also
retains its exact-byte failure from extra equals escaping. Separate AST observations
do not waive either byte failure. Shared-counters still refuses the single `x`
at maxWorkUnits20; the threshold is neither raised nor called a successful replay.

R04 `<p>&#1114112;</p>` at maxTokenBytes8 and R05 `&amp;` at maxTokenBytes4 still
FAIL their original status0 assertions. Only the separately frozen authorized v2
expects status1, empty stdout and exactly
`html-to-markdown: EFBIG: html-to-markdown token bytes limit exceeded\n`.
Both pass at every original split. Exact and greater valid caps preserve semantics.

Two additional raw failures versus the prior main cohort are reviewer harness
failures: `poison-sentinel-live` attempts to launch a `.ts` under node_modules.
Node 22.22.2 refuses with ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING before executing
the throwing sentinel. Neither is rerun or rescored. This limits direct sentinel
liveness evidence in this capture. The sentinel bytes are present and hashed;
actual permission denial, missing-entry/dependency failures and load audit all
pass independently, so there is still no observed source fallback.

## Source, package and tool attestation

The committed author archive is authenticated against its manifest, all **4237**
members and the supplied fixed package bytes before compilation/probes. The actual
supplied tarball is offline-installed and its regular package directory physically
moved to a consumer. It is not replaced by an independently assembled tarball.

- Supplied and executed pack: `aed5586e0e11880d3734fb788f124ccc55cae905b57d01a24bc754da107c325d`.
- Independent source-built pack: `7bc2640666e828b6b2bea8322d6390277d04f80c54192c67bdbe63208f32695f`.
- Renderer TS: `a624213e0289a441f1cacbf128dbac0861d23aee0ca3d7a2ad2f98a1d5da6378`.
- Actually loaded renderer JS: `0a896b93afea9240e3616d1eccc0cf8df5f8b88305b4f157a700f991af241727`.

The independent build uses 36 immutable transitive source files, including the
actual Shell consumer closure: 144 emissions; installed package has 145 files.
All 72 JS/declaration files match the supplied package byte-for-byte. All 72 maps
differ only in the explicitly checked `sources` location prefix: independent src
versus author candidate/src. Every other map field, mappings and source identity
matches. Source-map locations are not silently normalized in stored artifacts.
This is not a claim that the two complete tarballs are byte-identical.

PRE-RUN binds 65 Git inputs, sources/config/lock, all copied compiler/type inputs,
Node/npm tool inventories, Pandoc, supervisor, old consumers/loader, new drivers
and fixtures. Each subprocess has its own pre-receipt. The 202 actual compiler
inputs are cross-checked to pre-run inventories. Node22.22.2, TS5.9.3,
@types/node22.20.1 and undici-types6.21.0 use available local pinned tools; no network
install or runtime dependency was added. Pandoc hash is the prior pinned
`61574e53a089110eae07817b91510ff150e826807ac020aa744e0ade23025e0d`.
Post inventories compare complete membership including newly added/deleted paths,
not just hashes of originally listed files. Git inputs, tools and runtime loads
are all reauthenticated. Node permission boundaries exclude source/live trees.

## Setup deviations and retained history

SETUP-FAILURE-01.md preserves the initial missing capture-parent failure, which
occurred before PRE-RUN/compilation/product execution. Creating that owned parent
was an explicit narrow correction. Run02 then built/packed/installed successfully,
but its inherited universal byte-comparison assertion rejected the map locations.
The full top-level stderr is retained as setup-original-failure.log. No compilation,
installation or product test was retried. complete-setup.mjs explicitly checks the
location-only difference and finishes setup; MAP-COMPARISON-PRE records its hash and
rationale. The original setup driver is not rewritten to hide the failure.

All original2272/3ef evidence, fixtures, failures, initial five forced product
terminations, original attestation limits (historical supervisor prehash and npm
posthash), setup mistakes and old parser-profile mistake remain read-only.
The historical Pandoc comparison remains **5/16 exact, 11 classified differences**;
it is not rerun or relabeled. The prior 644-receipt archive and its 14 neighbor AST
failures are historical, not evidence against these newly loaded bytes or certified
passes for this candidate. No mass benchmark, new command names or superiority claim.

## Evidence and bounded replay

EVIDENCE.json.gz.base64 and MANIFEST.json contain the lossless sealed run02 capture,
source inputs, supplied tarball and raw receipts. FINAL-AUDIT.json gives current
counts, source/tool checks, per-layout failures, load totals and abort observations.
The seal authenticates 3137 files; compressed SHA256 is
`6c9bf18783b84dca80a5733ce079ce5a2d71465554cb6435a47c453f2c40d110`.
SUMMARY.json summarizes the main phase only; it is not the complete 691 count.
Tool binaries are inventoried, not vendored. Working captures remain under this
directory's ignored node_modules tree, outside canonical TypeScript discovery.

Read-only verification: `node verify-archive.mjs` from this directory.
The scripts are explicit version-specific audit drivers, not canonical tests.
For a fresh opt-in replay, choose a unique capture under an existing node_modules
parent, run setup.mjs and retain its expected map-path assertion log; use the
documented complete-setup.mjs transition rather than retrying tests or substituting
the pack. Its captured top-level log path is historical run02-specific. Then run
holdouts.mjs, run.mjs, followup.mjs, legacy-ast.mjs and final-audit.mjs with that
capture argument. Reproduction requires the pinned local tools/Pandoc. Archived
absolute paths are historical receipts, not promises of portable path identity.
