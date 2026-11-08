# Directory X_OK: design-only protocol review

Production is read-only. This review does not implement access, cd, stack state,
ACL discovery, capability flags, authentication negotiation or new network access.
The existing cd prerequisite observation remains in `d0b2557e`; no replay/rescore.

Freeze 30 targeted **existing-provider** protocol cases before execution. Expected
outcomes are baseline assertions, not proposed-feature acceptance. Calls are to
the real WebDavFileSystem, readonly wrapper and Shell in accepted5137's complete
authenticated package. A newly declared deterministic injected transport returns
specific HTTP/DAV responses and records method/depth/credential/redirect/signal
policy. This is not MockDav modification, native OS permission evidence or a new
Apache/WsgiDAV service run. P02/P03 explicitly distinguish successful self
metadata from separately denied listing/child operations. No prototype X_OK
implementation is called, and no new provider behavior is credited.

Capture preaborted/current access refusal, active cancellation, body cancellation,
late response after timeout, malformed/unknown/denied metadata, scope, redirects,
resource caps, readonly, unsupported combinations and existing successful cd.
All response streams and scheduled fixture work are accounted for; all Shell
instances are disposed. Synthetic credential text goes only to an injected
transport, never a network. The package is extracted to an owned temporary root
and authenticated before/after; no live production fallback or private checkout.

Primary source retrieval precedes the provider freeze. `primary.json` retains
the initial RFC3744 section-selection failure (nonexistent3.1.1). Its corrected
`primary-v2.json` uses actual section headings and retains response hash/sections.
No native shell rerun is needed to decide this provider-owned virtual policy.
Prior real-service auth observations are historical corroboration only, not new
current provider acceptance; all service profiles/failures remain unchanged.

Explicit one-shot reproduction:

```
node tests/fs/webdav/directory-access-review-20260828/run.mjs --seal
git add tests/fs/webdav/directory-access-review-20260828
git commit --only -m 'test(webdav): freeze directory access protocol review' -- tests/fs/webdav/directory-access-review-20260828
node tests/fs/webdav/directory-access-review-20260828/run.mjs --capture
```

Use an unused output version for any separately approved rerun. Never overwrite
the freeze, raw observations or previously recorded failed expectation.
