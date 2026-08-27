# Closing release-claim review

August27,2026 UTC. Release wording only; no new benchmark or authenticity gate.

## Historical claim and support

**The historical ledger does contain dated “latest” claims.** At both author
revisions8e09db9 and d484f98, `docs/PROJECT_LEDGER.md:1222` states:

> Primary npm registry queried2026-08-27T01:21:05Z reports latest just-bash3.4.2,

At8e09db9 line1255 and d484f98 line1253 it also states:

> Registry recheck2026-08-27T01:39:51Z still reports latest just-bash3.4.2, matching

The continuation identifies the installed baseline and retained `release.json`.
These claims are inherited ledger text at those revisions; the inspected report
additions and README comparison prose use the pinned version, not an unqualified
latest claim. This distinction corrects the earlier audit's omission without
inventing an author claim or changing historical prose.

`benchmarks/reports/expanded-20260827/release.json`, read once from8e09db9, records
an official registry query at **2026-08-27T01:39:51.037Z**, with `tags.latest`,
`latest` and `installed` all **3.4.2**, published2026-08-22T03:28:27.717Z. Its Git
blob is identical at both reviewed revisions; the file's sole recorded introduction
in the inspected history is3462e3e. Thus it supports the **01:39:51 recheck claim**.

The **01:21:05 query time is not separately verified** by that later capture; no
separate01:21 capture appears in the inspected release-file history. Furthermore,
the retained file summarizes the historical response and records its SHA256 but
does not contain the full original registry body. Its original response digest
cannot be recomputed from the summary alone. Support is retained time-stamped
primary metadata, not authentication of the historical HTTP exchange.

## Fresh observation, kept separate

A read-only GET to official `https://registry.npmjs.org/-/package/just-bash/dist-tags`
returned HTTP200 at **2026-08-27T05:03:24.354Z**. The49-byte body reports
`latest: "3.4.2"`; SHA256:
`11c14dbe82620f7402a4a668a543737fd55c025b981b468e34c0b62988c48077`.

This confirms the tag at that new observation time only. It does not prove the
earlier01:21 response, replace the retained01:39 capture or guarantee future tags.
`release-claim-review.json` retains exact claim locations, historical artifact/blob
hashes and the complete small fresh dist-tag body with timestamps/hash.

## Unchanged limits

No old raw provenance/report is overwritten. No tarball download, install,
dependency change, product execution, stage or commit occurred. **Uncached
published-tarball authenticity remains unverified.** The separate baseline-only
table judgment is unchanged;136 outcomes are not136 recipes. Mandatory
current-score/lifecycle qualification remains pending the different-leaf verifier;
this closing release-wording review does not approve those gates.
