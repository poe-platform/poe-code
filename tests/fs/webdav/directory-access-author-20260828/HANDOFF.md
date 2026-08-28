# Author candidate for Locke: directory X_OK only

Candidate source/tests/docs commit:
`ca1d33424b94a21ae0f40a36412fd8191611e2df`.
Different precode freeze:
`c65c121e0756390869cddcf78ceb49d0de9cdd2b`.
Root decisions remain exactly `6bd3a0d9` / `0a7e0628`.
No independent case or product/runtime file outside the assigned provider
scope was changed. **Independent source acceptance is pending.**

## Executed composition

Fixed accepted base `5137a74ec855a32d8a8860eb66b62eb44d11e290` plus exactly:

| Candidate input | SHA256 |
| --- | --- |
| `src/fs/webdav/webdav.ts` | `cf65b82429bd92ca52b73490e1d6c1070545b5912fbddaba7037e01c57cc21f5` |
| `src/fs/webdav/README.md` | `b931ac0545c709d3be2bd7d8e328fe9b1137cdb6514dfd8e9975c64c1fecb7bd` |

All other production files/config/root exports are from5137, **not** the moving
whole candidate HEAD. The complete selected archive is recoverable in
`candidate-02.json.gz.base64`; decoded tar SHA256
`46c16c7ae49341cbafc4b66d079e5625b1844332c0c7e15fa8b7b27695a7642e`.
The two overlays and each author executable input are included as exact bytes.

Existing selected tests come from5137 except the unchanged Stage2 runtime
regression file explicitly supplied from
`43af14a520160fad4e144a6b60c30ca123bd9ab9`. Its bytes/hash/commit are recorded;
it is a fixture overlay, never a production/runtime overlay. The source base is
the accepted coherent77+Stage2 composition; no pending product changes enter.

## Actual author results, candidate02

| Cohort | Observed result |
| --- | --- |
| Focused new directory access | 61/61 |
| Existing25 WebDAV provider files | 680/680 |
| Shared selection | 61/61:50 WebDAV, two provenance, nine other source-named cases |
| Existing cd/state/getopts/invoke/cancellation selection | 108/108 |
| Strict scoped source/test types | exit0 |
| Complete selected source build | exit0 |
| Full packed public consumer, installed | 9/9 |
| Same consumer, physically moved | 9/9 |
| Strict public types, installed and moved | exit0 each; four expected type-negative directives |

No skips, cancellations or TODOs in these executed test cohorts. No full-gate,
full-shell505, native Bash rescore, independent102 or real-service claim is made.
The shared test filter deliberately remains as actually run: `webdav|source`
also matches nine source-named cases in other adapters. They are not silently
counted as WebDAV tests. Existing real-service-named tests replay captured grant
responses or use mocks, not a freshly provisioned Apache/WsgiDAV server.

Full package SHA256:
`2f6d9f142165802f4e8a033c317f5c4f034f535508d3a434688e547b654c85b0`.
All846 package entries authenticated before/after;207 distinct actual packed
modules loaded in each runtime layout, including the candidate WebDAV module.
Loader rejects outside-consumer file loads and hashes each loaded product source.
The original installed location is absent before the moved run. Public root and
WebDAV subpath import the same class; no source fallback or undeclared new API.
The full package bytes, complete inventory and load records are recoverable.

Node22.22.2, Darwin/arm64. Final capture August28,2026
03:49:36–03:50:04 UTC. Tool hashes, exact commands/environment, stdout/stderr,
statuses and final source/inventory checks accompany the data. No dependencies
were installed; existing development tooling was exposed only to the snapshot.
Npm HOME/config/cache/TMPDIR were task-owned. Package runtime dependencies and
public exports were not changed.

## Preserved failures and exact harness correction

1. `admission-00`: initial git archive rejected the Stage2 test path absent from
   synthetic5137, before a temp root or product run. Original runner bytes and
   error metadata remain in the compressed record. `admission-00.stderr.txt`
   is a transcription of the displayed tool stderr; this initial exception
   occurred before the automated raw-output capture boundary. It is not a
   product failure or a perfectly auto-captured run. Corrected by binding that
   unchanged later fixture to its actual accepted commit.
2. `baseline-01`:61 author tests on original provider:13 pass,48 fail. Full raw
   TAP retained; no expectations changed. This does not rewrite the earlier30
   protocol observations, cd28 or directory-stack0/34 history.
3. `candidate-01`:focused61, shared61, shell108, build and installed/moved public
   consumers passed. Provider selection showed562 pass/six file-admission
   failures (568 entries), and scoped types emitted11 related diagnostics.
   Missing inputs were the existing `property-fixture.ts` and historical
   `real-service/evidence/apache-final/raw.json`, both from5137.
4. `candidate-02`:add exactly those two baseline dependencies to the archive.
   No provider source or test assertion changed. All680 actual provider tests
   now admitted and passed; scoped types passed. Package hash is identical
   between candidate01 and02. Keep both records, not a rewritten initial run.

## Resource and policy limits

The provider only permits virtual logical-cwd navigation based on fresh bound
collection metadata, with permissions:false. Mode5 separately requires listing;
files/write modes remain unsupported, readonly write rejection unchanged. Raw
65,536-byte/256-component caps are private and apply only to1/5. Typed cancellation
and existing per-request limits remain; no global deadline or host-work preemption.
Unknown/denied/invalid metadata and network confinement are not relaxed. The
mixed malformed/oversized and malformed-signal runtime exclusions remain unscored.

All28 recorded validation subprocesses across baseline01/candidate01/candidate02
exited without timeout or termination signal; this excludes synchronous Git
plumbing from the count. All three task-owned roots are removed. Existing test
loopback servers are within the exiting validation processes, not persistent
new services. No author child, listener or test session is left running; no
private checkout, real remote credential or external bucket was accessed.

Run `node tests/fs/webdav/directory-access-author-20260828/verify-evidence.mjs`
to authenticate stored evidence and candidate/base blobs **without replaying**
provider tests. Compressed decoded SHA256 seals:

| Record | SHA256 |
| --- | --- |
| admission00 | `bfc78b5c150d727904043f6ed309b94e90b98e238466637c532fb7f9a46a1b7f` |
| baseline01 | `37ca547d69799612d60affe0814b2e282fcb49bf9009510b21c6f788f0acc981` |
| candidate01 | `f70a03e38713c3814f83cfa0831e05506dbe603ad4ce513d6a095963344e716a` |
| candidate02 | `6263789ad5cc090bd373c7b7b2a458f2315bcb87f236eac63286dd0ec6ef4f71` |

Stop here for Locke's different review. **cd/runtime and directory-stack remain
held**; this author candidate is not authorization or proof for those next steps.
