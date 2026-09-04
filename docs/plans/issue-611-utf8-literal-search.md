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
ASCII-baseline fixture and defines 116 cases. Qualify the candidate and exact
published scoped package in real workerd, with native test success as well as
the fixture marker. Verify root publication separately before closing #611.
