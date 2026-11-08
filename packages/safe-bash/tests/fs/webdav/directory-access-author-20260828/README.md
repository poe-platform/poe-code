# Directory access author candidate

Root approved `6bd3a0d9`/`0a7e0628` and released implementation only after Locke's
different precode freeze `c65c121e0756390869cddcf78ceb49d0de9cdd2b`. The frozen
DECLARED-CONTRACT.md was read before the provider patch. Independent cases are
not edited or executed by this author, and this directory is not their review.

## Source scope and semantics

Only `src/fs/webdav/webdav.ts` and its scoped README change. The provider adds a
private incremental raw UTF8/component scan and adjusts access admission and
post-await checks. Directory modes1/5 use fresh existing stat;5 additionally
requires the existing listing. Files retain X_OK ENOTSUP, writes retain ENOTSUP,
and readonly retains its local EROFS precedence. No new capabilities/options,
parser/streaming/request/authority changes, contracts, exports or shell edits.

The result is **virtual logical navigation only**, with permissions:false. It
does not prove POSIX search/execute, remote ACL grants, listing/child/content or
future permission. Modes1/5 alone have65,536 raw UTF8-byte/256 nonempty input-
component bounds. Dot components count before normalization; repeated slashes
count bytes, not components. Caller mode validation precedes valid preabort.
Existing typed active cancellation, deadline and cleanup behavior is retained.
Mixed malformed/oversized precedence and malformed runtime signals are excluded,
not assigned new conformance outcomes. Public type negatives remain type-only.

## Fixed composition, not moving HEAD

`validate.mjs` extracts accepted5137 source/configuration and exact selected
existing fixtures, then overlays **only those two provider source/doc files**
and the author test. The Stage2 runtime regression fixture is separately bound
to accepted author evidence43af14a520160fad4e144a6b60c30ca123bd9ab9 because that
test is not present in synthetic5137. It is copied unchanged, never a runtime
overlay. Exact archives, supplemental test bytes, source and fixture hashes,
commands, raw outputs and closure inventories are retained in compressed data.

The initial archive admission failure is preserved separately: the runner first
assumed that later Stage2 fixture belonged to5137. No product execution occurred.
The first candidate run then omitted two existing fixture dependencies:
`property-fixture.ts` and the historical `real-service/evidence/apache-final/raw.json`.
Six provider files failed admission and scoped types reported11 related errors.
Candidate02 adds exactly those existing baseline dependencies; no source or test
expectation changed, and candidate01's raw failures remain intact.

## Author observations, separate cohorts

- Isolated original provider with the new author tests:13/61 pass,48 fail.
- Same61 author tests on candidate:61/61, no skip/cancel/TODO.
- Existing25 provider test files, including captured-lock/timestamp/authority,
  streaming/cancellation and atomic-extension regressions:680/680.
- Shared selection:61/61 =50 WebDAV cases, two provenance checks and nine other
  adapter cases whose names also contain `source`. The filter's extra matches
  are disclosed, not mislabeled as61 WebDAV cases.
- Existing shell cd/state/getopts/invoke/cancellation selection:108/108.
- Strict scoped types and complete source build pass in the isolated composition.
- Full packed root/subpath consumer:9/9 installed and9/9 physically moved;
  strict public types in both layouts, including four expected type errors.
  Each runtime layout authenticates207 distinct loaded packed modules; all846
  package entries remain unchanged. No live source/dist fallback is permitted.

The new public consumer uses an injected protocol responder, not a deployed
WebDAV service. Some unchanged regressions run task-owned loopback mock servers
or replay previously captured Apache grant bytes; none establishes fresh
Apache/WsgiDAV service compatibility for X_OK. No new native oracle is run.

Explicit reproduction (choose a fresh numeric capture version):

```
node tests/fs/webdav/directory-access-author-20260828/validate.mjs baseline 02
node tests/fs/webdav/directory-access-author-20260828/validate.mjs candidate 03
```

The one-shot runner refuses overwrites, isolates npm HOME/config/cache, installs
no dependencies, and removes only its own temporary root. Existing development
tools are used via a snapshot-local symlink; runtime consumers use the full local
package and a hash-checking loader that rejects outside-consumer file loads.
Prior30 baseline protocol observations and cd28/directory-stack0/34 histories
are untouched. These are author results, not different-review acceptance, a
whole gate, universal remote permissions or authorization to resume cd/runtime.
