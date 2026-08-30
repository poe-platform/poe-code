# Retained finish audit failure, no test rescore

All bounded executable controls, source/moved types, three moved cohorts and four
counterfactuals completed naturally in evidence-v2. The first finish phase then
failed its overly broad full-index equality assertion. It is retained verbatim
in the exact `evidence-v2/finish-error-*.json` member listed in the seal.
Its driver bytes and every preceding subprocess output are retained separately.

Before HEAD: `c812e818a87c58dcd1c6b4616b41ac8ae2c9daeb`, 37,647 foreign tracked entries.
After HEAD: `0902f3c541c8e9a79771f55cb5c9b78c6b6eb09b`, 37,659 foreign tracked entries.
Both had empty foreign staged diffs. Other owners committed during this review,
so the complete index naturally changed with HEAD. That does not establish a
reviewer edit to foreign staging, nor does it veto the committed candidate.

The appended `seal-after-index-error` phase reconstructs each captured full
foreign index from that snapshot's own committed HEAD, verifies exact hashes and
entry counts, records the concurrent committed path delta, and verifies staged
foreign diffs remain empty. It inventories all reserved live paths and historical
fixtures again, captures moved artifact bytes, durably inventories scratch, and
removes only the enumerated owned scratch. No test is rerun or assertion weakened.
The final report does NOT claim the full raw index was unchanged.

The first reconciliation phase also failed before any writes to its result files:
the full-tree parser used a dot expression that did not accept newline-containing
foreign fixture paths in NUL-delimited Git output. The retained
`seal-after-index-error-error-*.json` contains its TypeError and exact driver.
The parser now accepts all characters after the metadata tab without interpreting
path contents. This audit-parser correction executes no helper or tests.
