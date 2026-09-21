# Current-source corpus structure qualification

Executed the [agent QA plan](../plans/docx-corpus-structure-qa.md). Exact pins,
profiles, measured structures, statuses, output/untouched-part hashes and checks
are in the [compact receipt](corpus-structure-qa-20260921.json).

Of 23 manifest sources, 14 downloads matched size and SHA-256. Seven responses
failed their existing pins and two returned HTTP 403; these nine are unrun.
Pins were not replaced, and no changed download was admitted.

Eleven sources passed inspect, text, unchanged round trip and a selected real
`properties.set` edit of their independently measured existing core title.
Nine passed the default profile; two required the explicit large profile.
Every successful output independently passed ZIP CRC, XML well-formedness,
content-type and internal relationship checks, identical member-set checks and
untouched member byte/SHA-256 comparison. Round trips changed no member bytes;
edits changed only the title, preserving every other metadata subtree. Every
pinned input retained its original source hash.

| Dense source           | Paragraphs | Tables | Sections | Expanded bytes | Default           | Large round trip/edit |
| ---------------------- | ---------: | -----: | -------: | -------------: | ----------------- | --------------------- |
| circular-economy       |       2655 |     56 |       30 |       13664151 | Work-limit reject | Pass/pass             |
| housing-supply-interim |       2213 |     96 |       24 |        9201080 | Work-limit reject | Pass/pass             |

Two packages containing undeclared bracketed auxiliary trash parts were rejected.
Another dense source admitted and inspected under large limits but text,
serialization and edit refused a cross-kind next-style relationship with
`style-next-type`. This is a declared semantic rejection, not editing success or
proof that every publisher document is invalid. No repair was attempted.

All meaningful product findings have small original in-memory unit regressions,
individually identified in the receipt. They cover exhausted work,
source/publication retention, bracketed/untyped parts, exact mixed-structure
preservation, admission versus later limits, next-style kinds and lower-only
caller limits. A new original regression extends the existing next-style validation case to
prove post-admission text/serialization/metadata refusal with zero sink writes.
It passes against current implementation; no product fix or artificial red run
was needed.
Downloaded documents and full campaign reports are not canonical unit tests.

Independent validation uses Python standard-library ZIP/XML implementations,
separate from the product package reader/parser. It proves bounded package
structure and preservation, not complete OOXML schema validity, layout,
rendering, external resource validity, signatures or whole public API coverage.
The shared schema/capabilities discovery operations passed through the current
public command engine with version-1 JSON and status 0.

Historical manifest acquisition/retirement fields and the older structure receipt
remain dated evidence. This receipt records current availability and execution;
it does not rewrite their pins or promote any historical public-model inventory
entry. Exact JS/security mappings and inventory boundaries are recorded in the
plan. Product implementation, README files and later tasks remain unchanged. Local-only
commit delivery; no push or release is authorized.

Verification: maintained DOCX unit run passed **5,191 tests in 252 files**;
final DOCX lint passed with one warning. Two initial five-second timeouts passed
on the complete single-worker rerun without increased timeouts. The optional
native schema suite exited during setup because `DOCX_SCHEMA_ROOT` is absent;
its ten cases remain unrun and are excluded from all pass counts.

All 14 downloaded inputs, 22 output packages, temporary helpers and full logs
were removed after extracting compact evidence.
