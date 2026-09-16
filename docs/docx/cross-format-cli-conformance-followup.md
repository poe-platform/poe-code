# Cross-format CLI conformance follow-up

Executed only `cross-format-cli-conformance` on 2026-09-15. The bounded common
acceptance suite passes against both available public adapters: **58 cases,
zero skips**. Later tasks remain pending. This supersedes the earlier record's
four skipped cases and transport gaps; historical receipts remain available.
Whole-command, whole-public-API and renderer conformance are not established.

[The JSON receipt](cross-format-cli-conformance-followup.json) records current
source hashes and all 26 common operation schema comparisons from both built
public adapters. [The owned plan](../plans/docx-cross-format-cli-conformance.md)
contains the agent QA procedure, ownership and failing-first observations.

Original small memfs/in-memory documents and presentations exercise identical
common paths, names, JSON envelopes and ordinary 0/1/2/3/4/130 statuses. Diff
uses 0/equal, 1/different with ok true, 2/trouble and 130/cancel. Singular image
and table, metadata and top-level replace are rejected before input acquisition,
with help-labelled JSON failures. Repeated, unknown and inapplicable tested
flags reject rather than being silently ignored. Actual publication sinks
verify dry-run produces no writes. Original tiny image bytes exercise replacement
and extraction; extracted bytes are checked rather than inferred from counts.

The reproduced corrections implement DOCX default comparison scopes, SDK-backed
table listing with batch/schema parity, ordinary cancellation and rejected-path
JSON transport. Parts/XML default to package; text/structure default to body;
explicit incompatible scope pairs still fail. Table records share the existing
logical cell reader and retain owner/select/stale-token behavior. Cancellation
includes pre-abort, source acquisition, discovery and fulfilled output/diagnostic
sinks. Typed receipt-bearing image/archive extraction exceptions remain intact.
PPTX now uses its existing package/semantic SDK validation, declares validation
and discovery schemas/capabilities, admits supported lowered inspect ceilings,
and reports successful image/package extraction as zero affected read effects.
Output counts and bytes remain in manifests; partial failures retain receipts.
Every production correction followed a reproduced red test; maintained original
regressions remain covered. An obsolete ordinary diagnostic cancellation test
was reconciled with the shared 130 status contract.

Package extraction compares common argv and envelopes **with admitted format
output directories**. PPTX's existing output-root prerequisite and generated
flat filenames differ from DOCX's absent/new-tree destination and member tree.
An absent PPTX root returned I/O status 3. Shared CLI section 6 and PPTX section
6.7 do not promise creation of that root, so no adapter change was justified.
Common output-directory lifecycle equality remains unclaimed. Format-only
selectors and flags remain explicit in the schema comparison; common image
replacement additionally supplies PPTX's declared slide owner. These qualified
cases do not claim identical format models or all optional flags.

The pinned inventories were read without changing historical dispositions:
920 API records, 23 documentation decisions, 1,609 unit variants and 650 BDD
cases. Inherited members, enums, collections, helpers, guide-only members and
public underscore-prefixed types remain visible obligations. The exact model
mapping remains in [the API reconciliation](upstream-api-reconciliation.md#language-and-security-decisions).
Neutral model spellings including add_paragraph, core_properties, comment_id
and table_direction remain primary documented names. No blanket alias layer or
metadata command alias is introduced. The 23 source/guide decisions remain
unchanged, including comment_id/timestamp versus erroneous id/date examples.
The only format wording drift resolved here is optional/default diff scope,
in accordance with the shared command authority.

Utility factories, archive/image admission and publication are asynchronous,
with injected bytes, VFS capabilities, streams, sinks, trusted lowered budgets
and AbortSignal. Admitted model access stays synchronous. Model collections use
zero-based lookup, length, Symbol.iterator and explicit at/slice where supported;
CLI selectors use one-based scoped positions and fingerprinted locations.
Null represents explicit absence/inheritance, distinct from false/zero/empty.
JSON option names remain camelCase mapped to CLI kebab-case. Units use checked
integer EMUs: 914400/in, 360000/cm, 36000/mm, 12700/pt, 635/twip, nearest rounding
with halves away from zero. Model dates are explicit UTC Date values with
whole-second XML precision. No ambient clock, identity, fonts, host filesystem,
native runtime or implicit network authority was added. No source/runtime cases
are counted as new passes, and no model coverage is promoted by utility tests.

Maintained final checks are recorded in the JSON receipt. Both selected builds
and scoped lint checks passed. The focused paired/cancellation run passed 68
cases in 23.82 seconds, including all 58 paired cases and 10 cancellation cases.
PPTX's complete suite passed 6,896 tests across 270 files in 59.20 seconds.
DOCX's complete suite passed 4,930 tests across 218 files in 176.48 seconds.

The maintained screenshot route captured the built public diff help, a real
2-by-2 table list, truthful concise PPTX validation help and rejected aliases.
The PNG was visually inspected: wrapping and human output are readable; JSON
stdout and diagnostics remain separate streams (the combined screenshot can
show buffered stderr after the next heading). The first capture rejected an
incorrect authored table input; corrected typed cell blocks produced the final
capture. Screenshots stay disposable and uncommitted. No downloaded assets,
cloned binaries or unrelated QA output were removed. PPTX targeted text
replacement help still prints its full overview and remains a documented limit.

Only owned changes and relevant plan updates are committed locally on main.
Unrelated OMML/pipeline/discovery work is preserved. No push or release occurred.
