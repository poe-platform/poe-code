# Owned browser session restoration (#754)

## Reproduction

The released controller stores sessions and selected pages only in its own Map.
A second controller therefore rejects snapshot/goto even when a host still owns
the live provider context. Reconnecting a browser and creating another context
does not restore cookies, tabs or the selected page.

## Host lifecycle seam

Add public controller/CLI lifecycle methods for restoring an authenticated host's
existing lease, context and selected page, and inspecting live session state for
host-owned checkpointing. Guest aliases remain the existing -s/environment names;
provider identifiers, authorization and credentials never enter command arguments.
The host owns its persistent mappings and exclusive ownership across controllers.

Restoration joins the existing per-name queue and resource admission. It registers
lease/context/page events, reuses the exact context and selected page, and does
not create a page. Ref state is never restored; restored sessions allocate fresh
reference namespaces and old refs fail with the existing snapshot-again diagnostic.
Disposed controllers reject restoration and drain admitted acquisitions. Expired
records and invalid page/context selections fail before accepting the session.

The lifecycle API supports bootstrap restoration before running guest commands.
Once accepted, restored sessions participate in normal list, close, close-all,
capacity and disposal handling. The host must enumerate only its authenticated
owner's persisted records, connect valid provider IDs, and remove stale mappings.
Transport loss is not evidence of remote browser termination.

## Verification and delivery

First reproduce a cold-controller failure with retained context/pages. Test public
CLI restoration, selected-page persistence, cookies/tabs through the same context,
stale refs, invalid/expired records, concurrent same-name restore/open, cancellation
and exactly-once lease retirement. Check public types and existing controller tests.
Inspect CLI help/snapshot screenshots. Qualify the public packaged API with a real
browser, then commit independently and monitor remote publication.

## Verified behavior

- Cold-controller regression reproduced before the public lifecycle seam existed.
- Fifty controller/restoration/fault tests pass, including late cancellation,
  disposed/capacity-limited admission, expired cleanup barriers, malformed leases,
  stale refs, selected-page races and retirement when listener cleanup fails.
- Real installed public tarballs pass Miniflare/Chromium transport reconnection:
  three tabs, selected tab index two, page content and owner cookie survive.
  Snapshot/list/close-all use the restored session and old refs fail explicitly.
  The test deletes its owned provider session and verifies absence.
- The first real reconnect reproduced loss of ordinary newContext state because
  of dispose-on-detach. The passing host configuration uses the public persistent
  connection URL and its existing default context; this is documented explicitly.
- The test container supplies compatible libc/Chromium libraries, an explicit
  EVAL binding and trusted-page CI browser launch. This is not a security-profile
  qualification or evidence of a deployed Cloudflare service.
