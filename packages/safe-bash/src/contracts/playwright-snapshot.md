# Adapter snapshots

Hosts can pass `onSnapshot` to `createPlaywrightController` or `createPlaywrightCli`
to process snapshots before output. The hook receives the command, actual capture
format (`yaml` or `json`), context, page, initial snapshot, command cancellation
signal, and any retained main-frame navigation URL, status and response headers.
`getPlaywrightMainFrameNavigation(context, page)` also exposes that metadata through
the `/playwright` entrypoint in O(1), without browser I/O. Metadata is absent before
observation or after request history is cleared, evicted, or disposed; status and
headers are absent until a response is observed. Request headers are not returned.

The hook returns the snapshot to publish. Its `recapture()` uses the same format,
capture options and cancellation signal without calling the hook again. Page URL
and title and console events are read after the hook, so resolving an interstitial
also refreshes page metadata and console artifacts. Targeted snapshots resolve
the selector again for each recapture. JSON snapshot output retains its existing snapshot-only shape. Hooks run
inside the session command queue: use `recapture()`, never await another queued
controller command. Await recaptures inside the hook. Admitted recaptures are
serialized and drained before the command settles, including when the hook throws;
recapture calls after the hook completes are rejected. Honor the signal in host work; hook errors fail the command.

Snapshots retain candidate DOM nodes in a browser-side capsule. Only
status, count, node identities and rendered text cross the transport; actions unwrap the retained
node for a ref, not a fresh name-based locator. Renaming or duplicate names do not
change ref identity. A failed capture publishes no partial snapshot or refs.

Controller snapshots use a 30-second native capture deadline by default, including
snapshots returned after actions. Set `timeouts.snapshot` in the JSON or INI browser
configuration to choose a separate snapshot deadline; `0` disables that deadline.
Without this override, an explicitly configured `timeouts.action` or SDK
`limits.actionTimeoutMs` remains the snapshot deadline. `config-print` reports the
effective snapshot timeout. Caller cancellation still applies, including when the
deadline is disabled. Optional reference limits are independent of this timeout.
Snapshots have no byte limit; legacy `maxSnapshotBytes` values are ignored.

A timeout does not mean the browser or agent loop has stopped. Inspect the session
and page before retrying; a warm retry alone does not verify cold-capture behavior.
For repeatable slow captures, reopen with an appropriate snapshot timeout rather
than disabling cancellation or increasing unrelated code-execution deadlines.

Unrelated iframe navigation preserves refs to unchanged documents. Main-frame
navigation, tab selection and cold restoration invalidate the snapshot. Repeated
snapshots, find operations and action-result snapshots preserve refs for unchanged
nodes in the current capture. Native snapshots preserve refs while the provider
keeps the same native identity; a provider-issued replacement ref gets a new
controller ref. Removed nodes lose their refs, and refreshed capsules
replace and dispose previous capsules without accumulating retained snapshots. Refs to disconnected nodes or navigated child documents fail on
resolution; they never select a replacement node by its name. Adapters without
frame navigation metadata conservatively invalidate the whole snapshot.

Names use an accessibility-oriented subset. Roles such as navigation,
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

Text, names, attributes and aggregate frame output are captured without byte
budgets or byte-derived traversal limits. The optional candidate-ref budget
still applies. Traversal is iterative and does not transport descendant nodes
or source text.

This is not a complete browser accessibility tree or a full accessible-name
implementation. It does not implement CSS-generated content, shadow/slot
traversal, all embedded-control naming rules, or ARIA role-token fallback and
presentational-role conflict resolution. The existing candidate selector and
readable body `innerText` extraction are unchanged: readable text is a separate
section, not an accessible name, and can include visually present `aria-hidden`
text. Browser-native DOM queries/layout are not preempted by caller cancellation.
