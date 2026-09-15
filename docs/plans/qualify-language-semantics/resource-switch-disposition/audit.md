# Resource switch contexts: pinned-version disposition — 2026-09-13

This corrects the earlier statement that all20 explicit-resource-management failures
were required repairs. The recorded proposal revision38c13295dc20c2273ba0a6ed82555f1fabb37764
explicitly lists CaseBlock among permitted resource declaration scopes. Its early-error
clauses contain no prohibition on direct CaseClause/DefaultClause declarations. The16
later Test262 variants require exactly that additional prohibition. Applying it would
silently change the pinned extension target.

The proposal file was rehashed to3d75576cb856579a5b025e35ea4aab2899c2a156249d27456f19463b2deb8247.
Original receipt and extracted exact clauses are retained. All16 fixture hashes were
reverified against Test262419d3e0a2273ba01a3bfcbec423f2801425b8e93; their latest recorded
raw failures on isolated source3f965448db2dfd5c36e944bcc074a7ba00470416 remain failed,
not passes or rerun claims. The exact Node22.23.2/ICU78.2 report header is saved in rows.json.
No full suite was repeated for this source-version reconciliation.

These16 rows join the49 prior exclusions, making65 explicit excluded raw nonpasses.
After the separately delivered Annex B arguments repair,91 raw nonpasses remain:
65 excluded and26 target failures. The four top-level Script/eval resource cases ARE
required by this same pin and remain open at this observation. Edition16/402edition12,
proposal pin, runtime support and deadlines are unchanged. This disposition does not
claim whole-task acceptance or package publication.
