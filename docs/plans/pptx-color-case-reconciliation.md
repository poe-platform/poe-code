# Presentation color case reconciliation

Scope: documentation/evidence only; preserve main and unrelated work. No product
implementation, reference-suite rerun, full pipeline, README, push or release.

## Agent procedure

1. Compare every color-unit variant with its pinned fixture table, assertions,
   model declarations and current J01–J10 mappings. Read the three color BDD
   scenarios, actual step definitions and initial fixture color structure.
2. Write original owner-based TypeScript case designs for each row, retaining
   exact semantic values and errors. Replace private XML-owner access with bounded
   views and independently authored XML. Preserve inventory IDs and source hashes.
3. Resolve the incorrect claim that hex parsing ignores characters after six:
   pinned syntax parses the entire suffix after position four. Keep the stricter
   target six-ASCII-hex contract and document concrete contrasting examples.
4. Retain notices for derived research; put identities only in provenance.
   Never rename an unsupported public type to private because of its spelling.
5. Verify full unit/BDD inventory correspondence, API obligations, false execution
   flags, source/notice hashes and updated ledger counters. Historical input hashes
   stay historical; current evidence hashes describe current documents.
6. Run maintained scoped Prettier and git diff --check. Commit only the named
   owned documentation paths, reporting the local hash separately.

## Results

Reviewed all 54 color-unit rows and all three color BDD scenarios, including
fixture parameters, all assertions, step implementations and initial unadjusted
sRGB state in the pinned BDD fixture. The fixture SHA-256 is
`85cdcae7f571f6bc40a5eae4219305174b8fef6a77d83723a443a88315318cf6`;
no source assets or XML were reused. All 3,673 source identities remain separate.
There are now 167 reviewed designs, 894 provisional BDD descriptions, 2,611
unit semantic designs still required, and one deferred public behavior.
All 2,424 public API obligations and 391 counterpart obligations remain.

The per-member RGB property setter retains its declared ValueError for non-RGB
values. RGB constructor argument typing uses J08 TypeError for strings; numeric
range errors remain ValueError. Nullable color types, unavailable RGB/theme
reads, non-theme sentinels and luminance-transform order remain explicit.
No public member is omitted because of a leading underscore or missing tests.

The pinned `from_string` implementation parses the entire suffix after offset
four. The earlier first-six-character description was incorrect. Static syntax
and integer arithmetic establish that `12345` yields (18,52,5), `1234000` yields
(18,52,0), and `1234560` fails channel bounds. The target's existing six-ASCII-hex
rule rejects all three. The additional original exact-width design includes
invalid digits and uppercase/zero-padding behavior without importing the source
runtime. This is evidence correction, not a product bug fix.

The initial upstream test audit/inventory remain baseline snapshots: their
unmapped flags describe the acquisition stage. Current adaptation status is in
the linked case ledger. Historical input hashes remain historical; the current
corpus hash now records the separately committed verification update.

Validation: full identity/order and parameter accounting, source-file and span
hashes, API acceptance references, no true execution/implementation flags,
standalone notice identity, maintained scoped Prettier and git diff --check.
The unchanged proposed format spec passes its skill checker. No screenshots or
product test runs apply to these documentation-only changes.
