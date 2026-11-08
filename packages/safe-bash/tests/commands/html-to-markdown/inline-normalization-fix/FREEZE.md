# Inline normalization author freeze

These deterministic cases are frozen before editing product source. The first
ten inputs and semantic runs reproduce NEIGHBORS.json exactly (seven failures,
three controls); exact Markdown is an additional author assertion. Additional
cases cover aliases, split numeral/text boundaries, inactive destinations,
meaningful atoms, raw code whitespace, and nested formatting. No old input,
oracle, test or captured result is edited. The original 22 semantic assertions
and 154 author tests remain separate cohorts.

Reference: CommonMark 0.31.2 sections 5.2 and 6.1–6.4, with the already pinned
Pandoc 3.10.1 commonmark+strikeout reader as the executable dev-only oracle.
Strikeout is an extension; this reader does not promise arbitrary Markdown
dialects or HTML5 equivalence. Empty destination attributes retain the existing
inactive-label policy; an active destination with an empty label remains an
atom. The historical Pandoc HTML conversion comparison remains 5/16 exact and
11 different; this patch does not rebaseline it. F05 v2 explicit EFBIG is not
the old undersized-token success expectation.

Source ownership was explicitly transferred to this leaf from Curie. Meitner
reviews only after closed handoff. No public export/default integration, global
gate, independent acceptance or 72-hour completion is claimed.

## Supplemental invariant freeze

After the first source pass and its 49 passing new checks, source reasoning
identified that joining two normalized style containers must also join equal
styles at their child boundary. NESTED.json freezes three additional cases
before that refinement, without modifying CASES.json. Its original-source and
first-pass failures are recorded separately; it is not a pre-first-patch freeze.
