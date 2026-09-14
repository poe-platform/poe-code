# Image replacement accounting and QA

Scope: occurrence-local clone/rebind and explicitly shared replacement only. The
parent implementation owns `packages/pptx`; this research work owns this plan,
`docs/pptx/image-replacement-evidence.md` and the companion case ledger. No README,
corpus binary, product source or existing ledger is edited by this research work.
Do not execute the whole pipeline, push or release.

## Authorities and bounded accounting

Read root `AGENTS.md`, `docs/specs/pptx.md` F32 and image/publication requirements,
`docs/specs/office-cli.md`, `docs/specs/office-sdk.md`, both upstream audits and
inventories, image inventory/API/insertion ledgers, API language mappings and the
corpus manifest. There is no scoped `AGENTS.md` under docs or packages/pptx.

Retain exact IDs, source pointers and expanded parameters from all 121 image
insertion-ledger rows, plus four adjacent picture-placeholder unit rows that the
insertion ledger omitted. A replacement operation is a new task requirement,
not an upstream method. Report crop-property setters, placeholder insertion,
movie behavior and unsupported-format insertion as separate obligations. A
preserve/reset option cannot prove arbitrary crop-property setter parity.

## Original regression and review procedure

1. Before implementation, demonstrate that replacement is unavailable or fails
   the expected clone/rebind behavior with an original failing TypeScript test.
2. Author a tiny package whose two same-owner occurrences and occurrences in a
   slide, master and notes share one image. Independently inspect written package
   XML, relationships, bytes and content types, rather than only round-tripping
   through the operation's inventory method.
3. Assert default changes exactly the selected occurrence; shared replacement
   reports every affected structural occurrence, including different owners and
   same-source-part references. Keep unaffected XML and media unchanged.
4. Assert crop, transform/geometry and alt text preserved by default and changed
   only under explicit options. Include absent metadata, negative/greater-than-one
   existing crop metadata and escaped Unicode alt text. Preserve unknown XML.
5. Assert MIME changes leave neither stale content-type overrides nor unreferenced
   superseded relationships. Preserve relations still consumed by another object.
6. Assert stale/ambiguous selectors, explicit master/notes scope, unsupported
   linked/vector edits and rejected input fail before publication. Cancel while
   admission/publication is pending and verify existing destination bytes remain.
7. Exercise paired SDK and CLI results, JSON shape, schema/capabilities, common
   selectors/output/dry-run flags and exit statuses with memfs. Run maintained
   focused workspace checks and any visual CLI screenshot checks needed.

## Disposable corpus procedure

Use manifest entry `.cache/pptx-corpus/CERN-job-opp-250925.pptx` if useful. The
manifest records two picture occurrences sharing one media part; all fourteen
listed fixture paths were present during research. Verify its SHA-256 against
`85cc7b338a11b9d1a9dfcaaaa504bf21ab643e4c30004a478152f390ee9f5f1d`
before use. Inventory first; confirm actual ownership rather than assuming the
census demonstrates slide/master/notes sharing. Run one occurrence-local and one
shared replacement on disposable copies, verify reports and independently inspect
resource graphs. Record outcomes in the evidence receipt. Keep outputs ignored;
never download in unit tests or commit fixture bytes. Reduce any meaningful
finding into a small original memfs case before claiming it resolved. The executed corpus receipt is now recorded in
`docs/pptx/image-replacement-evidence.md`: local/shared SDK edits passed with
independent member checks and semantic graph validation; no output was persisted.

## Delivery

After actual test names and check receipts are available, attach exact evidence
without upgrading unimplemented public-model rows. Root reviews and commits
explicitly named owned files with the atomic feature. Report local commit hashes
separately; no push or release is authorized.


## Execution receipt

The selected manifest hash was verified before/after use. Actual owners are a
slide and layout (inherited by three further slides). Default replacement affected
one occurrence/slide; shared replacement affected two occurrences/four slides.
Original and both outputs passed the ten-rule semantic validator. No new product
finding arose. The first validation call required adding explicit `maxEntries` to
the QA limits; the successful rerun used the complete limit contract. No download,
fixture change, persisted QA script or binary output occurred. Original test
source references and exact hashes are in the evidence receipt. Root retains
ownership of maintained test/lint/build verification and atomic commit.

Root independently verified all 125 ledger identities against their exact source
inventory locations. Final package tests, package lint/build, adapter tests and
screenshots passed. Root guarded lint remained incomplete at its fixed 12,000
subject cap (exit 2); commit is blocked by the requested successful-check condition.
See the implementation plan for exact counters and preserved guard policy.
