# Parsed XML child insertion

Implement positional insertion/replacement/removal of direct XML element children
for slide-list and OPC metadata edits. Preserve source encoding/BOM, unrelated
attributes, comments, processing instructions and whitespace. Fragments must be
self-contained XML; reject namespace rebinding and invalid indices. Enforce
fragment and combined XML resource limits before returning a new immutable part.

Ownership: xml_edit implements only xml.ts/xml.test.ts; root reviews, validates
and commits those explicitly named files. No public command change in this step.

TDD evidence: 16 initial failures with missing spliceChildren; implementation
passes all 62 XML cases, including 23 added cases and expanded encoding checks.
Owned ESLint and complete pptx workspace lint pass. Maintained package tests and
selected build closure pass at the integrated checkpoint. No push or release.
