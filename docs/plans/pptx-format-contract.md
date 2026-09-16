# PPTX format contract and evidence

Status: Documentation-only contract revision; product implementation not started.

## Scope and authority

Use root AGENTS.md and the shared Office CLI/SDK specifications. No scoped
AGENTS.md exists under docs. Preserve all unrelated work, including the existing
main implementation plan. This task does not execute the implementation pipeline,
change product code or README, acquire/clean corpus inputs, run reference/native
runtimes, push or release.

The authoritative deliverable is [the format spec](../specs/pptx.md). The matching
[command register](../pptx/command-coverage.json) and its
[research notes](../pptx/command-coverage-notes.md) retain the neutral `pptx` name,
plural resources, common paths/options, and complete public model API obligations.
The implementation marker remains Not applicable: this is a proposed utility.

## Validated documentation findings

The inspected register had no direct result schemas and used unconstrained data
in its envelope. Animation/transition numeric fields lacked units and bounds;
creation defaults, subset constraints and resource cardinalities were often
implicit. `images add` exposed an inapplicable shared-resource flag. The MIME type
for media insertion was optional without a declared inference rule. No product
bug or executed target-test failure is claimed.

The revision adds exhaustive direct grammar and exact SDK/schema bindings,
resource-specific scope/cardinality, explicit empty/null/absent rules, stdin
reservation and publication contracts. It resolves chart/timing/geometry/SVG
subsets before dependent implementation. It preserves documented inherited APIs,
public underscore-prefixed interfaces, corrected return types and neutral method
spellings. Security/language mappings remain explicit and do not waive behavior.

The twenty original `format.*` case designs in the register are regression
obligations with arrange/action/expected assertions. They use original tiny
structures and remain planned/unrun. They supplement, rather than replace, the
source-parameter and BDD ledgers. Any future code fix must first reproduce its
finding through a failing original TypeScript test.

## Research and provenance accounting

Consulted and parsed the complete test/API inventories, their audits, existing
case ledger, target API map and corpus manifest. The source identities remain in
research/provenance; the spec and new case names do not use reference-project
branding. Existing standalone MIT notices remain intact. No copied source code,
case wording, binary templates or corpus assets were introduced.

Every one of 2,700 collected unit variants and 973 expanded BDD examples has one
ledger row with an exact source pointer and a neutral TypeScript case ID. All
2,407 API source IDs occur in the target API and command maps; 17 additional
bounded-view records remain additive. These counts do not establish implemented
coverage or completed semantic adaptation. The ledger explicitly retains 2,665
semantic reviews, 897 provisional designs, 110 reviewed designs and one deferred
public behavior. None is counted as an executed target pass. These outstanding
obligations prevent a whole-public-API parity claim.

The [disposable corpus manifest](../pptx/corpus-manifest.json) contains 12 inputs.
It was read as evidence only; no deck was opened, downloaded, mutated or removed.
Current content hashes and accounting checks are recorded in
[the documentation receipt](../pptx/format-contract-evidence.json). Historical
source passes, acquisition census and published-site observations remain historical.

## Documentation verification procedure

1. Parse all evidence JSON. Verify exact source pointer and identity coverage for
   each parameter variant and expanded BDD example. Verify API source and target
   ID closure, including inherited members and the 17 additive views.
2. Resolve every operation/test reference and local schema reference. Check the
   sixty feature IDs, preservation-only null editing routes, unchanged chart enum
   subset and all target implementation/execution markers.
3. Validate operation argument/result/options/batch schemas and all definitions
   with installed AJV 2020-12. Exercise original positive/negative JSON specimens
   for milliseconds, geometry, crop, nullable formatting, empty replacement,
   chart values, selection shape, obsolete insertion options and property values.
   Cross-field semantic constraints remain separate proposed product obligations.
4. Compare Appendix A against every direct register path, argument flag, input
   arity and SDK ID. Review explicit common flag exceptions, owner scopes,
   no-match/first/all behavior, readonly getters, batch handles and publication.
5. Run the write-spec skill checker and installed scoped Prettier on only owned
   files, then local-link and Git whitespace checks. These are documentation
   checks, not product unit tests or a substitute for later public API tests.
6. Stage only the explicitly owned spec, register, notes, receipt and this plan.
   Review staged paths/diff, commit one atomic Conventional Commit on main, and
   verify the local commit. Do not push or release. Existing unrelated files and
   ignored fixtures must remain outside staging.

## Deferred product QA procedure

Execute only when the product is implemented; do not run this pipeline now.

1. Build original tiny in-memory decks for each `format.*` regression design.
   Use memfs for publication tests and explicit admitted metrics/media. Never make
   unit tests depend on downloads, native rendering, host fonts, clock or network.
2. Prove the exact schema and semantic boundary through both public CLI and SDK.
   Inspect actual help/error screenshots and common workflows; screenshots are
   ad hoc QA, never unit tests. Demonstrate no implicit host I/O or execution.
3. For corpus QA, use only manifest-listed disposable inputs and owned copies.
   Keep acquisition/census separate from edit/validation/rendering outcomes.
   A meaningful failure must be reduced into a small original regression, with
   a failing test before any product fix and passing evidence after the fix.
4. Inspect output using independent QA tools where fidelity matters. Verify
   chart caches/workbook data, timing preservation, geometric tolerance and
   caller-supplied SVG fallback visually. Do not claim rendered fidelity from
   structural validity or cached thumbnails.
5. Retain required standalone legal notices and provenance. Clean only explicitly
   enumerated owned QA files when no active campaign needs them; never ship or
   commit fixtures or put reference identities in product test names/assets.

## Results

Documentation verification passed: all 3,673 source rows and all 2,424 target API
rows accounted for; F01–F60 retained; local schema/operation/test references
resolved; all 5,981 operation schema fragments and 102 definitions valid; twenty
positive/negative schema specimens passed. The receipt records exact counts and
hashes. The first hash check detected an older API-audit receipt in the command
register; the current reviewed audit was repinned and its prior hash retained. Original regression designs remain planned, with no product passes.

The write-spec checker, scoped Prettier, link checks and Git whitespace checks
passed. No runtime build, product unit test, screenshot, native/reference suite,
renderer or whole pipeline was executed. None is appropriate evidence of this
unimplemented documentation-only change. The final response reports the actual
local commit hash separately; remote delivery and release are not performed.
