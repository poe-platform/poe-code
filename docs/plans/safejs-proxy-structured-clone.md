# Proxy rejection in structured cloning

## Validated defect

Eleven regressions failed before the repair. Non-callable Proxies were silently
copied as ordinary carriers, including when nested in arrays, maps, sets, or
getter results. Transfer buffers could consequently be detached for values that
native structuredClone rejects. Callable Proxies already failed the closure
check.

## Repair

Reject private-branded Proxies with DataCloneError before traversal, in both the
resumable guest graph copier and the context-free structured clone path. Do not
unwrap a Proxy or invoke any of its traps. Normal graph checkpoint serialization
is a different operation and remains supported.

## Verification

Twelve regressions cover active/revoked/nested Proxies, callable Proxies, collection
entries, getter results, transfer preservation, and trap/later-getter suppression.
The structured-clone selection passed 133 tests across nine files. Package
TypeScript and scoped lint are separate checks. No full-package gate is claimed.
Unrelated weak-collection edits in values.ts are excluded from this commit.

Host import/export copying still needs its own policy and implementation audit.
README updated. No push or release while the release hold is active.
