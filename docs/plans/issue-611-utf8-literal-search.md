# Issue 611: bounded UTF-8 literal search

Extend the production portable provider's fixed-string profile to valid,
non-NUL UTF-8. Preserve exact original bytes and offsets, grep byte-string versus
rg Unicode-string transports, and existing unsupported regex/case/word modes.
Reject invalid encodings and lone rg surrogates even for empty request rows.

The implementation uses budgeted, cooperative byte-level KMP matching with
pre-admitted encoded storage and failure tables. Existing awaited cancellation
and endpoint retirement remain required. No normalization or native regex fallback.

Implementation, independent review, and real-workerd acceptance have separate
owners. TDD reproduced the ASCII rejection before implementation. Provider tests
passed 20 cases; focused provider/executor/portable tests passed 50. Independent
review checked 712 byte spans, 144,784 encoding admissions, and four retirement
paths without blocking findings.

The new installed-package workerd fixture is separate from the retained #609
ASCII-baseline fixture and defines 117 cases. Qualify the candidate and exact
published scoped package in real workerd, with native test success as well as
the fixture marker. Verify root publication separately before closing #611.

Clean committed-tree candidate acceptance passed all 117 new cases and all 63
original cases in workerd. Corrected the fixture to encode grep's byte-string
transport explicitly and to preserve rg's normal binary detection: text mode
forwards NUL to the rejecting provider, while default binary mode remains intact.
