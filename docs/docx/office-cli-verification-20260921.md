# DOCX CLI task verification — 2026-09-21

Executed the numbered [agent QA procedure](../plans/office-cli-qa.md) against built
DOCX commands at source revision `0535eaaf2ad267358d2aae4689eba61fbd64ebcc` plus
the owned diagnostic correction below. Interactive imports retain the baseline;
only the correction probe uses a fresh process after rebuilding. Root AGENTS.md applies; no narrower DOCX
instructions exist. The shared [CLI](../specs/office-cli.md) and
[SDK](../specs/office-sdk.md) contracts govern the [DOCX](../specs/docx.md) contract.
The [structured receipt](office-cli-verification-20260921.json) retains exact
commands, separate stdout/stderr, exits, hashes and independent observations.

The adapter is the built public safe-bash DOCX plugin with an explicit in-memory
filesystem rooted at `/work`. Its build was not rerun or certified by this task;
the maintained DOCX dependency closure was built. Document engines receive only
explicit byte/VFS/stream capabilities and finite limits, never ambient document
host I/O, identity, fonts, clock, network or a native Office runtime. Creation
context time is `2026-09-21T12:00:00Z`. Inputs are tiny original authored documents,
a tagged DOTX and CRC-authenticated PNGs. Nothing was downloaded or cloned.
Host writes are limited to owned research evidence and disposable output.

## Bounded observations

Every numbered recipe received a probe; this table describes its actual subset,
not a complete recipe/variant pass. JSON observations have exactly the eight
shared version-1 fields; failed prepublication results have null data and zero
affected. Help/version aliases agree. Reads leave document packages unchanged.

| Cases   | Observed subset                                                                                                                                                                                                                                                                                                                                       |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q01–Q03 | Minimal creation, inspect and partial core-v1 validate succeed; explicit DOTX template retains its kind; plain Unicode body text reads correctly.                                                                                                                                                                                                     |
| Q04–Q05 | Two literal replacements retain bold/italic formatting; all unaffected original parts are byte-identical. Occurrence 2 changes only the second match. Matching SDK replacement produces identical package bytes. First-only replacement also ran in Q30; header/hyperlink isolation variants did not run.                                             |
| Q06–Q09 | Three occurrences group into two resources with owner counts 2/1. Ordinary replacement changes one hash; shared replacement changes two. All stored extents and the distinct resource remain unchanged.                                                                                                                                               |
| Q10     | Missing transaction/consent rejects with exit 3 and null data. Explicit partial-output consent succeeds in a precreated directory; every extracted entry and manifest matches its reported hash. Missing recovery guidance was reduced and corrected below.                                                                                           |
| Q11–Q12 | B2 reads and accepts ordinary `--text` flags. Independent SDK reload returns A1, B1, A2 and Harbor 🌊; other cells remain intact.                                                                                                                                                                                                                     |
| Q13–Q16 | Property list/get, Unicode title set, declared custom boolean false and removal succeed without JSON input.                                                                                                                                                                                                                                           |
| Q17–Q18 | Original tagged plain-text binding fills correctly; file/stdin template results match and retain DOTX. File/inline property batches match bytes. A subsequent absent-table operation fails at index 1 and publishes nothing.                                                                                                                          |
| Q19–Q22 | Explicit package diff reports equal 0 or successful difference 1. Global and document-aware capabilities return conservative support/subset data. This does not execute every advertised subset.                                                                                                                                                      |
| Q23–Q27 | Leading-dash Unicode filename after `--`, document stdin and operations stdin work. Competing consumers reject usage 2. Create-to-text pipeline succeeds; individual pipeline statuses were not captured.                                                                                                                                             |
| Q28–Q30 | Dry-run reports effects without destination; proposed stdout plus JSON works. Existing sentinel destination rejects conflict 1 during dry-run without changing sentinel/input hashes. Explicit in-place first replacement succeeds.                                                                                                                   |
| Q31–Q35 | Fresh image token succeeds; mixed token/ordinal rejects 2. Intervening metadata mutation makes old token fail 1; re-list and fresh-token dry-run succeed, preserving intervened bytes. Missing match rejects 1, allow-empty returns 0. Conflicting cardinalities reject 2. Merged B2 rejects ambiguous selection 1; no substitute coordinate is used. |
| Q36–Q42 | Root/nested/cell help, text/table schemas and version aliases work. Legacy image/table/metadata/replace paths reject 2 with plural/text-replace guidance. Missing diff input gives trouble 2. All 1,518 declarations occur in structured help; maximum root-help line is 129 characters. Discovery is not behavioral coverage.                        |
| Q43–Q49 | Missing destructive image selection rejects 2 with selector/help guidance. Template stdin has one owner; competing owners reject 2. Force cannot authorize input/output alias (conflict 1). Invalid scope rejects 2 with nested help. Lowered XML depth gives 4; repeated, unknown or raised limits reject 2.                                         |

## Validated correction and red/green evidence

Q10 originally emitted only `Document operation failed: unsupported-publication`,
with no recovery requirement. Retrying the same built intent with explicit
`--allow-partial-output` succeeded. The existing independently authored memfs
`image-extraction-failure-envelope.test.ts` was extended to require transaction,
consent-flag and nested-help guidance in both JSON and stderr, while retaining
the unchanged-volume, null-data, empty-location and exit-3 assertions.

Before code changed, its focused run failed at line 24: expected the message to
contain `transaction`, received the generic code-only message. The image command
now supplies bounded guidance for unsupported prepublication extraction without
consent and reserves the actual diagnostic/response size before publication.
Consent does not become automatic; statuses, publication and SDK behavior retain
their contracts. Other error categories keep their diagnostics.

Focused extraction/inspection checks passed 38 tests in three files. After the
maintained build, a fresh Node subprocess imported the built public engine and
received original input through explicit stdin with a memfs destination. It
returned 3, null data, empty locations and unchanged volume, naming the transaction,
`--allow-partial-output` and `docx help images extract` in both streams.

The [prior receipt](office-cli-execution-20260915.md) records original red/green
evidence for commits `5de4bd53c`, `d2d99dbf0`, `ddf6791db`, `adb633b6a` and
`f11606f11`. Their actual diffs and current original tests were inspected; built
legacy, stale, ambiguous, scope, root-help and extraction-envelope outputs were
rechecked. Historical raw red logs were not recreated or counted as fresh passes.
Its linked usability procedure is absent from the current tree; the committed
historical procedure was inspected with Git, without restoring removed work.

## Contracts, drift and remaining coverage

Both complete inventories were parsed: 920 API research records, 262 enum values,
11 enum aliases, 23 documentation resolutions, 1,609 unit variants and 650 BDD
identities. The current API map contains **1,338** rows, including 417 inherited
rows and the later Paragraph.element obligation; older 1,337-row receipts are
historical. Current discovery similarly has **1,518**, rather than historical
1,517, declarations. Input/map hashes and current accounting are in the receipt.
No public underscore-prefixed return/type, collection, helper, enum or untested
public behavior is excluded. The current map explicitly has
`whole_api_accepted: false`; NumberingPart.new remains unsupported, and complete
per-row behavior is open. Passing neighboring tests does not close that gap.

The [exact mapping table](office-cli-qa-review.md#exact-js-and-security-mappings)
and current API map remain authoritative for member-specific details: neutral
snake_case model names and positional order; typed source-spelled trailing options;
always-async admission/save versus synchronous admitted access; checked zero-based
SDK sequences and keyed lookup versus one-based scoped CLI selectors; distinct
omission/null/false/zero/empty values; safe EMUs at 914400/in, 360000/cm, 36000/mm,
12700/pt and 635/twip with one half-away rounding; copied UTC whole-second Dates
and owned byte/chunk copies; owner invalidation and bounded XML/package views;
per-axis missing DPI fallback 72; compatibility SHA-1 versus evidence SHA-256.
No arbitrary evaluation, XPath, relationship dereference, host resources or model
alias layer is introduced. Utility timestamp strings remain distinct from model
Dates. Plural resources, preserving text replace, camelCase operation JSON and
mechanical flags, common envelopes and 0/1/2/3/4/130 statuses remain in force;
diff uses 0 equal, 1 different, 2 trouble and 130 cancellation.

Historical pending implementation statements are superseded only by their exact
later scoped evidence. Erroneous comment id/date aliases, table direction aliases,
style spellings and nullable setter inference remain rejected research drift.
This verification adds no whole-model implementation claim.

## Maintained checks, screenshots and gaps

- `npm test --workspace=docx`: baseline and final runs passed 5,198 tests in 254
  files, with no failed/skipped cases. Final duration: 239.66 seconds.
- `npm run lint --workspace=docx`: passed before/after, with one existing
  type-only unused-variable warning at operation-types.test.ts:20.
- `npm run build:workspaces -- --workspace=docx`: selected five-build closure
  passed before/after, using the shared machine cache and portable safe-fs build.
- Focused tests, owned Markdown/JSON formatting, evidence consistency and owned
  Git whitespace checks passed. No root/full-repository check is claimed.

Inspected maintained terminal-png captures of root introduction, nested image/cell
help, successful edit, schema error, stale/ambiguous errors and extraction before/
after. `screenshot-poe-code` targets the root CLI and its broad predev build, not
this virtual command; this invocation used the plan's maintained-renderer fallback,
without rerunning that historical failed route. Captured streams remain separate
in the receipt; screenshot labels/exits are annotations. Long tokens/JSON widen
captures. The screenshot font lacks the wave emoji glyph; independent byte/model
checks preserve the value, so this is a renderer limitation, not a validated DOCX
code defect. Screenshots establish no Office application or font/layout fidelity.

All agent PPTX counterparts, independent rendering, publisher/corpus/large inputs,
repeated/ambiguous template expansion, header/hyperlink scope isolation, injected
source/sink/publication/cancellation failures, collision/transaction recovery,
second-path identity aliases, and exhaustive SDK/per-operation behavioral acceptance
remain not run here. Maintained cross-format unit cases are separate evidence,
not counterpart agent QA. Original source fingerprints remain in envelopes; final
snapshot hashes are identified as final-state observations, not a pre-run freeze.
QA setup mistakes and their corrected observations are retained explicitly.

Only owned evidence/procedure and the reduced diagnostic correction are staged.
Unrelated work/index entries are preserved. No README, ignored input, downloaded
wording/image, cloned binary, push, remote-main delivery or release is included.
Invocation-owned disposable captures/logs are removed after retaining their hashes.
