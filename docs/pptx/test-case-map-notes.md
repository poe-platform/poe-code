# Presentation case accounting

Status: Research accounting complete for the collected presentation inventory;
semantic adaptation partial; no product implementation or passing target tests.

[The case ledger](test-case-map.json) preserves one row for each of the 2,700
collected unit variants and 973 expanded BDD examples. It pins the input inventory,
audits, contracts, API map, command register and corpus manifest by SHA-256.
The [agent procedure](../plans/pptx-test-case-accounting.md) records verification.

## What changed

The earlier API map supplies class/workflow candidates, not reviewed per-case
mappings. Comparing every collected identity against those candidates reveals
875 unit cases and 307 BDD examples with no candidate. The new ledger retains
those cases as obligations rather than treating a missing link as an exclusion.
Candidate presence also does not prove that a member's behavior is covered.

Each row has its full source identity, source commit, file hash, inventory pointer,
source location, neutral reserved case ID and implementation-task destination.
BDD rows additionally retain the actual scenario heading, example values and
expanded steps, checked against the collected step count. The original inventory's
`template_line` sometimes points to the example row rather than the outline;
`source.scenario_line` in this ledger identifies the actual heading without
rewriting the historical collection. Source steps and identities are research
material covered by [the standalone notice](test-case-map-notice.txt). They are
not product test names or fixture content.

A reserved case ID with `original_case: null` means **semantic review required**.
It is not a TypeScript test, a specified assertion or a completed adaptation.
None of the 3,673 obligations has been implemented or executed. No many-to-one
merger or architecture-only exclusion is approved by this ledger.

## Original regression designs

Seventy source rows now have original arrange/action/expected-result designs:

- Twelve image metadata cases retain each of six formats independently for media
  type and canonical extension, including WMF characterization. They require
  authored bytes or an explicit bounded characterization capability.
- Five density cases distinguish valid, fractional, absent, out-of-range and
  malformed input. The malformed text is original; meaningful numeric boundaries
  and expected fallback values remain explicit.
- Four sizing cases replace a private helper and disk image with observable
  inserted-picture dimensions: native size, width-only, height-only and both
  dimensions. The square geometry and each parameter variant remain separate.
- Forty-nine navigation examples use an original five-slide deck. They distinguish
  action classification, the returned hyperlink interface, slide destinations and
  destination assignment/removal. File/program/macro actions remain metadata and
  must never trigger execution or I/O.

These are proposed original TypeScript regressions, not QA failures reproduced
against a product. They preserve behavior while replacing source wording/assets
and private mock identities. The remaining 3,603 presentation rows require
semantic review before their original assertions can be specified. Completing
that review remains part of `map-every-upstream-case`; this accounting receipt
does not mark that pipeline task done or run its dependent implementation tasks.

## Shared package behavior and public API

The full counterpart inventory was also parsed. The ledger retains 391 additional
unit obligations from `tests/opc/**`, `tests/image/**` and the shared XML
simple-type/descriptor/namespace test files that exist in that inventory. Other
counterpart document behaviors and its BDD workflows are outside this shared
package subset; all remain in their original inventory. No equivalence between
formats is inferred from matching test names or shared ancestry.

All 2,424 target API rows remain visible, including the 2,407 reconciled source
records and 17 bounded-view additions. Each points to its independently planned
original API acceptance IDs. Of these rows, 1,072 have no prior unit or BDD
candidate. That count mixes types, enum symbols, inherited members, helpers and
other record kinds; it is not a percentage of untested callable APIs. Leading
underscores and absence of source tests never remove a public obligation.

The shared [SDK](../specs/office-sdk.md) and [CLI](../specs/office-cli.md) govern
language/security mappings and commands. The target API map defines signatures;
the later command register resolves its recorded route corrections. Neutral
model spellings remain primary, while command JSON uses camelCase. Common routes
retain `images`, `tables`, `properties`, `text replace`, `schema` and
`capabilities`. Original source-case adaptation must obey these contracts even
where it deliberately differs from the reference's host or language behavior.

## Evidence reused and limits

All six retained artifacts for each reference run matched their recorded hashes:
unit log, BDD log, both failure logs, coverage JSON and JUnit XML. Both checkouts
matched their pinned commits with no tracked changes under source, tests,
features or docs. All 101 presentation source and 54 documentation hashes matched
the API inventory. No Python/reference runtime or native renderer was executed.
The original dependency resolution and failed attempts remain intact.

Unit statement coverage remains 11,246/11,508 and branch coverage 1,327/1,466 for
the historical presentation implementation. The separate 973 BDD passes are not
part of those percentages. Neither measure establishes format coverage, visual
fidelity, security conformance or target TypeScript coverage. This task adds no
product pass, failure, screenshot or playback evidence.

The [corpus manifest](corpus-manifest.json) remains the source of disposable QA
inputs. No downloaded deck, cloned binary or corpus byte was copied, mutated,
shipped or deleted. The current work uses metadata only. Meaningful future QA
findings need small independent original regressions before cleanup; unit tests
must run with downloads absent. No README or product file changed.
