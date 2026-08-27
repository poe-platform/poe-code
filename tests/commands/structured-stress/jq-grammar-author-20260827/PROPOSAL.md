# Canonical TEST-ONLY proposal — August 27, 2026

NOT APPLIED. Requires another independent leaf's review and a separate root-authorized TEST-ONLY followup. No canonical tests, old fixtures, accepted reports or old results are edited. Use `planned-test-only-changes-v2.json`: it includes verbatim complete assertion blocks for all 26 names; the retained v1 abbreviated the supplemental four assertions. The first document-generation attempt rejected the uppercase filename after successfully writing v1; this is an author harness setup error, not a source/test failure.

The exact 22-name historical selector remains pinned to final-owned.tap SHA-256 927f32925c0f612e5c1f2f64a74addfb9fea900479c84d84e98cb985d5d28658. All five original files are preserved byte-for-byte in canonical-before.json with commit and SHA-256 evidence. planned-test-only-changes.json contains each original path/name, exact original assertion block and start line, replacement assertion, per-constituent argv/input/files/expected bytes, and native vector/file hashes. It is an explicit machine-readable unapplied change set, not instructions to weaken every stderr assertion.

## Classification

- 19 tests: first-failure policy retirements already matching native at the accepted baseline.
- 2 tests: stale generic UTF-8 regex expectations, but with real native diagnostic gaps at baseline; changing only the regex would not have fixed those gaps.
- 1 resource composite: obsolete rejection assertions AND six actual acceptance gaps plus ten diagnostic gaps at baseline. Preserve its invalid-input, division, precision and surrogate constituents.
- Four additional rejection tests become red when [01], leading BOM, -Infinity and NaN correctly succeed. These are supplemental to, not replacements for, historical22.

Every native constituent is frozen before its source correction. The immutable legacy94 stays 94, including the separate five supplementary controls; the historical baseline remains 45 exact / 49 differences, not a rebaselined green result. The author now observes exact results for the whole legacy94, but only independent source review can authorize the proposed test updates.

| Historical test | Constituents | Baseline exact | Diagnostic gaps | Status/stdout gaps |
| --- | ---: | ---: | ---: | ---: |
| strict UTF-8 rejection remains chunk invariant (not native parity): raw-lone-continuation | 1 | 1/1 | 0 | 0 |
| strict UTF-8 rejection remains chunk invariant (not native parity): raw-truncated | 1 | 1/1 | 0 | 0 |
| strict UTF-8 rejection remains chunk invariant (not native parity): raw-bad-continuation | 1 | 1/1 | 0 | 0 |
| strict UTF-8 rejection remains chunk invariant (not native parity): json-bad-string | 1 | 1/1 | 0 | 0 |
| raw native: record-error-prefix | 1 | 1/1 | 0 | 0 |
| raw native: file-unicode:-Rc | 1 | 1/1 | 0 | 0 |
| raw native: file-unicode:-Rsc | 1 | 1/1 | 0 | 0 |
| raw native: invalid:0:-Rc | 1 | 1/1 | 0 | 0 |
| raw native: invalid:0:-Rsc | 1 | 1/1 | 0 | 0 |
| raw native: invalid:1:-Rc | 1 | 1/1 | 0 | 0 |
| raw native: invalid:1:-Rsc | 1 | 1/1 | 0 | 0 |
| raw native: invalid:2:-Rc | 1 | 1/1 | 0 | 0 |
| raw native: invalid:2:-Rsc | 1 | 1/1 | 0 | 0 |
| raw native: invalid:3:-Rc | 1 | 1/1 | 0 | 0 |
| raw native: invalid:3:-Rsc | 1 | 1/1 | 0 | 0 |
| raw native: invalid:4:-Rc | 1 | 1/1 | 0 | 0 |
| raw native: invalid:4:-Rsc | 1 | 1/1 | 0 | 0 |
| strict malformed JSON 14 across chunk boundaries | 1 | 1/1 | 0 | 0 |
| strict malformed JSON 16 across chunk boundaries | 1 | 1/1 | 0 | 0 |
| invalid UTF-8 never becomes replacement text | 5 | 0/5 | 5 | 0 |
| malformed UTF-8 preserves completed JSON prefix across every chunk split | 36 | 12/36 | 24 | 0 |
| valid large decimals survive while malformed JSON and division by zero fail | 29 | 13/29 | 10 | 6 |

## Required followup

Keep every original chunk loop, empty chunk, file input arrangement, split endpoint, status/output check, cancellation guard and effect check. Replace strict policy overrides and generic diagnostic regexes only for the listed vectors with exact frozen native status/stdout/stderr tuples. Never overwrite raw-input-native.json or any historical fixture. Do not force the source back into the retired rejection behavior. Add an explicit old-to-new test name map if names are clarified. The source author does not approve this proposal; no TEST-ONLY commit is made in this phase.
