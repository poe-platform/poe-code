# Adapter snapshots

Snapshots retain candidate DOM nodes in a browser-side capsule. Only bounded
status, count and rendered text cross the transport; actions unwrap the retained
node for a ref, not a fresh name-based locator. Renaming or duplicate names do not
change ref identity. A failed capture publishes no partial snapshot or refs.

Unrelated iframe navigation preserves refs to unchanged documents. Main-frame
navigation, tab selection, snapshot replacement and cold restoration invalidate
the snapshot. Refs to disconnected nodes or navigated child documents fail on
resolution; they never select a replacement node by its name. Adapters without
frame navigation metadata conservatively invalidate the whole snapshot.

Names use a bounded accessibility-oriented subset. Roles such as navigation,
search, group, region and img do not infer names from descendants. Roles that
prohibit naming ignore author labels as well. Links, buttons and supported
name-from-content roles can use descendant text. Valid `aria-labelledby`
references take precedence over `aria-label`, native form labels and fallbacks;
even a valid empty reference suppresses fallback. Missing IDs are skipped and
repeated IDs are read once. Native control values remain separate from names.

Content naming walks text nodes rather than reading an element's aggregate
`textContent` or substituting `innerText`. It ignores script, style, template and
noscript subtrees and hidden descendants, uses descendant author names and image
alt text, and separates block content. Explicitly referenced hidden labels can
contribute text; visible labels still exclude their hidden descendants. Reference
traversal does not recursively follow further `aria-labelledby` relationships.

The existing UTF-8 output and candidate-ref budgets still apply. Name strings and
ID attributes are admitted before processing against `maxSnapshotBytes`. A
separate work allowance of `maxSnapshotBytes` bounds name traversal steps,
ancestor checks and label-reference visits per frame render, including empty
subtrees. Exhaustion returns the fixed byte-limit status with no partial text.
Traversal is iterative and does not transport descendant nodes or source text.

This is not a complete browser accessibility tree or a full accessible-name
implementation. It does not implement CSS-generated content, shadow/slot
traversal, all embedded-control naming rules, or ARIA role-token fallback and
presentational-role conflict resolution. The existing candidate selector and
readable body `innerText` extraction are unchanged: readable text is a separate
section, not an accessible name, and can include visually present `aria-hidden`
text. Browser-native DOM queries/layout are not preempted by the traversal budget.
