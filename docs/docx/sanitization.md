# Bounded selective sanitization

`sanitizeDocument` and `docx sanitize` share the package engine. Select a nonempty
unique `remove` array (CLI comma-separated list) from properties, comments,
revisions, links and objects. Processing uses that fixed order. Revisions require
explicit accept/reject policy; providing policy without revisions is a usage error.

The [task record](../plans/docx-explicit-sanitization.md) enumerates each supported
action, preflight rules, exact JS/security mappings and retained gaps. The utility
removes supported writable properties, supported comments and markers, explicitly
decides supported revisions, unwraps external hyperlinks preserving labels, and
removes admitted direct inert object carriers plus unused bindings/leaf targets.
Unsupported affected structures reject before caller publication.

The bounded result contains `changed`, `actions`, `retained`, `gaps`,
`removedParts`, `removedRelationships`, `dryRun` and `output`. Each action contains
category, exact action token, affected logical-record count and record identifiers.
Properties use qualified utility names; comments use stored ID strings; review,
link and object records use fingerprinted owner tokens from the corresponding
staged input. They are evidence, not reusable final-output selectors.
Removed relationships contain owner and ID only, avoiding external target leakage.
Output is null on dry-run; published output carries the existing path/bytes/SHA-256
receipt. JSON schema and F46 capabilities expose only this bounded direct edit.

Unselected categories, cached/opaque metadata, internal anchors, non-hyperlink
external bindings, inactive/unknown markup, shared/outgoing embedded graphs and
unrelated content may remain. Empty property/comment parts and unrelated resources
can remain. This is not comprehensive privacy or recoverability removal.
Live model coverage, generic utility batches and later tasks remain pending.
