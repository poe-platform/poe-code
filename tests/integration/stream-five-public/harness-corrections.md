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

## Attempt 2: lexical regex was not an import parser

The isolated actual npm build and offline pack passed. Before product runtime,
the closure scanner matched ordinary command option text containing `from` as
an import, then falsely reported an external dependency. The scanner now uses
the already copied and hashed development TypeScript parser to inspect import,
export, import-type and require/import call nodes, rejecting nonliteral calls.
It still requires every real product JS/declaration edge to resolve inside the
packed dist or to an inspected builtin. No dependency was installed, no product
or fixture changed, and no runtime check was counted from this failed attempt.
The raw original report is preserved in `evidence/packed-attempt-2/report.json`.

## Outer release attempt 1: Darwin /tmp alias comparison

The exact committed npm command correctly propagated exit78 for the copied
missing chmod asset, before product tests. The verifier then rejected the
reported run directory because Node canonicalized `/tmp` to `/private/tmp`,
while the verifier compared an unresolved spelling. The correction compares
against realpath(authenticated workspace), retaining the strict descendant
requirement. No release script/native pin/product/input change is involved.
Original outer stdout and raw author result are preserved under
`evidence/release-attempt-1/`; the full original verifier report remains in its
immutable temporary attempt directory. This failed attempt is not a positive
qualified-release pass.
