# Authority completion v1 — schema HOLD, not activation

The independent receipt 04ef22c058ba46eca71c93ceab787fdebf474cbd55296d5573035bf3eee41743 at commit 6f9632cc2e51987f3fdfdb9eae2718e1977dc2d6 is authenticated. ROOT now approves 2100s and the precise A03 bootstrap edges; historical 1800s, C2 and F01 outcomes are unchanged.

AUTHORITY-CLOSURE.json exhaustively binds the four actual supervisor-closure importers (12 builtin edges, five relative edges). Per-case maps remain bound by the unchanged authority and inventory hashes. Materializer/prepare-data reads are excluded from activation authority, not implicitly approved. Unknown edges/aliases/changed importer bytes refuse.

SLOT.json is DATA, not a grant. The frozen validator has ten exact keys and rejects timestamp extras. No latest-start/expiry schema is available in that validator. Requested +20min latest-start/+55min expiry must anchor a fresh grant, not this preparation. ROOT must authorize a narrowly versioned window admission or name its already-bound validator. No timestamp fields, loader changes, grant file, dispatch or deadline extension are silently added.

One sealed PURE DATA helper runs six controls; only the authenticated pure data-support module is imported. No supervisor/owner/Worker/product load occurs. A schema-incompatibility control passing is evidence of HOLD, not window readiness. All60 runtime variants remain UNRUN, with six nonpublic and seven public deferred obligations unchanged.
