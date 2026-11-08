# Source-only publication successor; no execution authority remaining

Original publication-v1 failed while exporting the legitimate
`published/copy.source.json` input: it collided with the sidecar created while
exporting `published/copy`; lookup of `copy.source.json.source.json` then failed
ENOENT. This is a private publication-helper defect, not an npm/product error.
Both authorized helpers retired; no third helper or retry runs.

`publication-v2.mjs` requires an explicit disjoint owned identityRoot. Receipts
use the exact destination pathname's digest under that separate root. Both roots
must be normalized absolute disjoint trees. Source path/dev/ino/size/hash and
exact destination-byte checks remain. Both roots must be accounted by the caller.
Prospective export roots are `scope/evidence-v2/payload` and
`scope/evidence-v2/identities`; original partial evidence stays unchanged.

Two frozen follow-up groups, UNRUN pending separate helper authority:

1. Copy legitimate inputs `copy` and `copy.source.json` into payload. Both keep
   independent bytes/identity receipts; repeating each is verified-existing-copy.
2. Changed source identity/bytes or destination bytes refuse without overwriting.
   Nested/overlapping receipt roots refuse before output-file effects.

The old materializer is not silently redirected or rerun. V2 is source-only, not
part of the executed eight controls and not independently accepted. No new churn,
npm or672 invocation is authorized by this proposal.
