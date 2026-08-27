# HTML repair author handoff — 2026-08-27

**Author candidate, not independent acceptance.** Meitner remains the different
reviewer. No root barrel, package export, aggregate registration, dependency or
lifecycle source was changed. This is not a public/full-package acceptance run.

## Exact source and execution

- Production/regressions/module-profile commit:
  `3ef5811f98d61800b6d4c6f16be046d4f539eeef`.
- Supervised harness and frozen execution candidate:
  `2c5178caaa90f687cfedd127879bf88e9f2b8f87`.
- A fresh committed archive authenticated all271 selected files against that
  candidate's Git blobs. It included `src`, package/config inputs and the owned
  HTML tests, not a dirty product overlay. Source/test inventories detected added,
  missing or changed entries; all original bytes remained unchanged after runs.
- The scoped compiler used23 product-source inputs and emitted92 files. Their
  pre/post SHA256 maps are in `RAW_REPORT.json`; complete archive admission is
  in `SOURCE_RECEIPT.json`. Cached development dependencies were linked for tools
  only. Runtime imports used the isolated emitted module closure, not repo source.
- Runtime: Node22.22.2, SHA256
  `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.
- Pandoc3.10.1, SHA256
  `61574e53a089110eae07817b91510ff150e826807ac020aa744e0ade23025e0d`,
  parsed generated Markdown using `commonmark+strikeout`. It is a qualified
  rendering reference, not an identical conversion CLI or HTML5/browser oracle.

The public module-local factories/options are unchanged. This scoped build is a
dependency closure, **not a complete packed public package** or default integration.

## Six findings and repairs

| Finding | Root-cause repair | Evidence / qualification |
| --- | --- | --- |
| F01 whitespace retry scans | Explicit edge indexes; charged copies; yielding normalization/rendering loops | Original two large trim sizes settle naturally with exact full output; direct scan work/abort tests |
| F02 unresolved-reference retry scan | Single charged state machine, with cooperative checkpoints and bounded per-character checks | Original two large reference sizes settle naturally with exact full output; work exhaustion is EFBIG |
| F03 accidental lists/strike | Escape numeric period/parenthesis prefixes across text fragments, tildes and equals signs; leave code literal | Exact strings plus separate paragraph/character/style assertions |
| F04 adjacent emphasis | Coalesce equivalent neighboring styles, flatten redundant styles, disambiguate mixed delimiters and punctuation-sensitive boundaries | Adjacent/nested/Unicode/punctuation native-parser controls preserve characters and style nesting; no raw HTML added |
| F05 token-dependent entities | Preserve incomplete references across forced text flushes; reject an unrepresentable token bound | Cap below reference length fails EFBIG; exact/greater caps decode identically across byte splits |
| F06 control trimming order | Validate original decoded destination before removing ASCII edge spaces | Leading/trailing C0/C1 controls refused; ASCII space still allowed; active-scheme refusal retained |

F05 deliberately takes the explicitly permitted **limit-refusal** option.
`&amp;` at cap4 and `&#1114112;` at cap8 no longer succeed with changed text;
they return status1/EFBIG with no output. The historical status0 expectations are
not reported as passing. No test input or old independent oracle was rewritten.

### Adjacent scan audit

Attribute whitespace/name/value traversal now charges work and yields; the
previous repeated suffix-trim test for `/` is replaced by one trailing-boundary
scan. Entity recognition uses an anchored, at-most34-character window. Language
class recognition uses at-most41-character windows. Remaining character-class
tests see one character or fixed-width prefixes; URL-scheme checks are anchored.
The tag-envelope expression is charged against the bounded token and is called
only after the tokenizer supplies its closing `>`. Code-fence and Markdown
boundary traversals charge work and yield. Fixed joins/copies and bounded native
URL/string operations are not individually preemptible: no hard wall-time or
RSS guarantee is claimed.

## Executed cohorts, not an additive parity score

| Cohort | Result | Boundary |
| --- | --- | --- |
| Original author tests |119/119| Four original test files are byte-unchanged |
| New repair tests |35/35| Includes literal/chunk cases, all edge C0/C1 controls, exact-limit cases and reason identity |
| Scoped types | exit0 | Actual frozen source and tests |
| Scaled forms |28 naturally completed| Same seven form recipes/four sizes; eight trim/destination rows additionally assert exact output |
| Slash-attribute neighbors |3 naturally completed with EFBIG| Completion observations, not successful conversions or stronger capability claims |
| EOF cancellation profiles |2 bounded observations| Old100ms schedule completes before timer; immediate callback aborts with exact reason, no output and iterator-finally count1 |
| Markdown semantic neighbors |22/22| Exact visible characters/style nesting from22 separate pinned Pandoc parses |
| Strict compiled consumer |1 positive| Actual emitted declarations |
| Negative declaration consumers |3 expected failures| Wrong limit/replace type and unknown limit report TS2322/TS2353 |
| Missing entry/dependency |2 expected failures| Actual isolated copies fail ERR_MODULE_NOT_FOUND rather than falling back |
| Supervisor negative |1 expected kill| Synthetic infinite-loop child only; no product child was killed |

The55 supervised product children (28+3+2+22) all settled naturally under the
unchanged5-second supervisor. The slowest recorded product duration was784.34ms
(an observation, not a promised deadline). At131072/524288 characters, trim
conversion took36.08/117.95ms and unresolved-reference conversion86.10/267.65ms
in this single run. These are not a general performance or scaling benchmark.

The old100ms-at-EOF abort recipe now finishes in42.64ms total, before its callback;
its old `assert.rejects` would therefore not pass. This is **not** counted as an
exercised cancellation. The separate immediate-at-EOF recipe exercises and
asserts cancellation; four direct scan tests also assert cooperative yielding and
exact reason identity. No time limit was inflated to disguise a hang.

`ORIGINAL_FOLLOWUP.json` replays the nine unchanged independent inputs against
the same emitted closure: six unchanged literal expectations match, R06 remains
an original status-only observation (now strengthened separately by AST tests),
and R04/R05 are the two explicit token-limit refusals. Do not call this9/9 of the
old status0 oracle. Its original input-file hash is authenticated to6177f88d.

## Preserved history and remaining review

Independent source2272feb9 was rejected in6177f88d:125 rows were119 pass/6 fail,
the separate six fixture corrections were6 pass, scaled stress24 completion/4
timeouts, and followup2 observations/7 failures. Those records and their inputs
are unchanged. The original16 Pandoc conversions (5 exact/11 different) remain
in the old COMPARATIVE.md; this repair does not rescore or replace that cohort.

No sanitizer, complete HTML5/Markdown parity, universal cancellation, hard RSS,
full package, global suite or superiority claim follows. Current lifecycle
production changes belong to Sagan and were not edited. The owned-output
preparatory freeze remains07bb6a79 with0/36 product cases executed there; no
active cleanup or child was abandoned for this repair.

## Reproduction and retained artifacts

From a fresh2c5178ca archive with authenticated cached development tools:

```sh
node node_modules/typescript/bin/tsc -p tests/commands/html-to-markdown/tsconfig.json
node --import tsx --test --test-reporter=tap \
  tests/commands/html-to-markdown/{render,io,limits,adversarial,repair}.test.ts
HTML_REPAIR_SOURCE_COMMIT=2c5178caaa90f687cfedd127879bf88e9f2b8f87 \
  node tests/commands/html-to-markdown/fix-review/verify.mjs
```

The driver creates only unique OS-temporary build/evidence directories. The
environment field records the externally authenticated candidate; it is not an
independent archive-authentication mechanism. SOURCE_RECEIPT records the actual
Git-blob admission performed for this capture. RAW_LOGS retains every compiled
probe, type/denial diagnostic and native parse output. canonical.tap.data retains
all154 author test outcomes. All product/supervisor processes exited; temporary
regular-file evidence remains available, not a running service.
