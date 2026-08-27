# Holdouts attempt 001 fixture failure

Attempt 001 used the first authored `harness/consumer.mjs` and exited before
holdout scoring. Its `hostile` environment object contained an own function-valued
`hasOwnProperty`. The installed `Shell` correctly enforces the public string-only
environment contract and rejected that entry with `TypeError: Invalid environment
entry`. This is a verifier fixture error, not a product failure.

The raw stderr is retained at `execution/holdouts-001.stderr`; the stdout JSON is
an empty retained file. The pre-correction consumer fixture SHA-256 was
`c0a5d5200706d69290ee6c5a688aed657e64a9c7e0ca422f4fc13ad1ed6cdb00`.
`consumer-v1-to-v2.patch-data` plus the committed v2 fixture reconstructs the
single-line v1 difference. V2 uses a string-valued but non-callable own
`hasOwnProperty`, preserving the intended defense against invoking that property
while conforming to the string environment contract.
