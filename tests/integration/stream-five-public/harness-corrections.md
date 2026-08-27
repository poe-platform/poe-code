# Preserved harness failures

## Attempt 1: documentation mistaken for algorithm changes

Source b7ae676a57adec1193b51fe08a91b17eac6f5884; helper 7b549da.
The unchanged-algorithm check accidentally compared entire family directories,
including README.md. Its actual diff contains only the two approved availability
documentation updates. This failed before compiler/build/pack/product/native
execution. The correction records the full changed-path list separately and
requires zero TypeScript diff across both complete family trees. No fixture,
expected byte, classifier or product source is changed.

Raw original report remains under
`/tmp/safe-bash-stream-five-public-verifier.29433-packed-1/report.json` and is
preserved as `evidence/packed-attempt-1/report.json` in this owned subtree.
