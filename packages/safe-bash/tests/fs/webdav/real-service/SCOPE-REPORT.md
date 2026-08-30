# Contradictory LOCK scope: source-author handoff to Curie

August 27, 2026. **Author checkpoint, not final independent acceptance.**

## Source fix

`69672fe210fbf8a23cc980828bb46d073b078425` adds exactly one product condition:
reject a direct recognized DAV:shared child while validating an exclusive grant.
It does not change protected write validation, unknown extension handling,
legacy absent-only lockroot, timestamp postconditions or direct entry authority.
No contracts, exports, other filesystems, runtime dependencies or global config
were edited. Source and evidence commits use explicit owned paths with --only.

`SCOPE-RULE.md` records the first red repro and reasoning. Fresh official RFC4918
14.13/14.15/17 and RFC2518 12.7/12.8 hashes/excerpts are in
`evidence/scope-primary/sources.json`. Recognized exclusive/shared alternatives
cannot coexist in one scope; unfamiliar extension children are not competing
recognized types. DAV:read alongside DAV:write remains accepted. Duplicate
recognized fields were already rejected by the namespace-aware unique-child
helper, so no broader XML rewrite or child whitelist is justified.

## Immutable before/after

The actual independent runner, consumer and public-import guard from Curie
`6e0ff0b` are unchanged and remain read-only. `scope-replay.mjs` verifies their
hashes, runs that original runner with a full committed source revision and fresh
outside output, and copies evidence back into this author's subtree. It changes
none of the independent assertions or injected responses. The runner itself
retains original/executed hashes for its documented author-fixture relocation.

| Cohort | Frozen product source | Apache independent P/F | WsgiDAV independent P/F |
| --- | --- | ---: | ---: |
| Requested baseline | `9c85c63d2797e8c8686037ccc8c1a2802bfe32d7` | 28/3 | 29/2 |
| Matched immediate parent | `f73ff3aacd8889fbc2c1e835e2d237f572879ab7` | 28/3 | 29/2 |
| Committed fix | `69672fe210fbf8a23cc980828bb46d073b078425` | 31/0 | 29/2 |

Every batch has 31 cases and zero skips. The first baseline WebDAV bytes match
Curie's `e8acecc3a843642ca83127d43d8c65ea46c2c0e4`. Because concurrent root commits
changed unrelated command source, the matched parent/fix replay additionally
verifies that **only src/fs/webdav/webdav.ts differs in the full archived product
input map**. No moving worktree source is compiled by the real-service runner.

All three original Apache failures reproduce before the fix: both scope orderings
permit COPY 204 and replace OLD; mixed-scope MOVE 204 also removes source. These
are controlled mutations of real acquired responses with genuine token/status/URL
and corrected Content-Length, not malformed XML emitted by Apache or proof that
the server actually granted a shared lock.

Afterward each original row records typed ENOTSUP, no COPY/MOVE request, intact
nine-byte source and OLD target, adapter UNLOCK 204 and empty lockdiscovery. The
unchanged harness's subsequent cleanup-only second UNLOCK returns 400; that is
separate from the adapter's successful release and is retained, not normalized.
The valid unchanged-body and DAV:write+DAV:read controls still transfer correctly.

## Original matrices remain unchanged

These results hold in all three fresh cohorts; they are not pooled with the31.
Cells are pass/fail. Refusal passes are not positive interoperability support.

| Provider / surface | Positive P/F | Guard P/F | Refusal P/F |
| --- | ---: | ---: | ---: |
| Apache raw | 9/0 | 7/0 | 0/0 |
| Apache public consumer | 16/1 | 14/0 | 2/0 |
| Apache direct controls | 2/0 | 15/0 | 0/0 |
| WsgiDAV raw | 3/6 | 3/4 | 0/0 |
| WsgiDAV public consumer | 10/5 | 13/0 | 4/0 |
| WsgiDAV direct controls | 0/2 | 13/2 | 0/0 |

Apache's first directory timestamp update still fails truthfully with EAGAIN.
WsgiDAV's two independent failures remain default binary COPY/MOVE rejected on
its invalid token header. Its deeper injected XML controls are **masked by that
earlier rejection**, not evidence of WsgiDAV scope-parser validation. Existing
unquoted DAV validators, unsafe raw conditional transfers, alias-lock bypass and
late-grant cleanup gaps remain as previously recorded. No response repair or
provider guarantee is invented. All native raw rows retain after-failure byte,
absence and lock observations. Earlier source-author and Curie failures remain
immutable rather than being retrospectively reclassified.

## Focused and unchanged validation

The new `lock-scope.test.ts` has 28 cases: before 25 pass/3 fail; candidate and
committed source 28 pass/0 fail. Its same frozen input tests the exact three mixed
scope failures plus neighboring duplicate/multiple grants, scope/type/write/
depth/token/href/timeout fields, absent recognized write, and unknown namespace/
DAV child controls. Rejected valid-token grants must release exactly once and
preserve bytes/names without publication. Source/input/real grant fixture hashes,
full TAP and strict typecheck logs are retained separately for each cohort.

Every full independent replay passes the unchanged 564 existing WebDAV, 23 legacy
LOCK, 23 direct-authority, five timestamp, 49 historical alias and separately
repeated 14 constructor cases. Candidate validation also passes all of those.
Scoped strict types and isolated full ESM/declaration build pass. The historical
49 fixture/helper hashes remain unchanged; its Dirac-owned writing runner was
not invoked. There was no all-repository suite or unrelated test correction.

Both actual services use the strictly typed packed root `virtual-bash` and
`virtual-bash/fs/webdav` consumers. Absolute resolution URLs and public package
maps are captured, with the independent source/private-fallback import guard.
The complete configured `example.mts`, HTTPS transport and truthful backing
resolver are unchanged; no undefined host callback or private Mock replaces them.

## Exact hashes and replay

Before WebDAV source SHA256:
`8c280010a9de5f915ebb72be504d79f2a149e95064752c3a4b4a07cd425efd54`.
Fixed WebDAV source SHA256:
`d61d6d36eeea65f0c7e6eb5ecbe118e353ffe5a87131e4e26c1a3d772ee71acf`.
Matched-parent source archive SHA256:
`08fc938bc31459454d0b766f19e2b5fc5bf754eff3b15104f73a5e0bf2f31d11`.
Fixed source archive SHA256:
`6415f4081746015a0b42060e93622869e3d3b2fcf3a7b6ed4c5fd5d4ec585c7e`.
Matched-parent packed tar SHA256:
`023945c0b8e819d558217275a8461e6ceceb0868ca23d7a6278f693fd1abd37c`.
Fixed packed tar SHA256 (identical on both providers):
`dd1efd2f90061c52bc0c40aee73ba8156e91c6da69e4e22022d1a0e74492a1f0`.
New 28-case fixture SHA256:
`2bce00c07c95b81ff8be2a7e8c42ac96e890bfc478c5c13677985f19fd95ac63`.

The preinstalled Apache 2.4.66 binary/module hashes and complete task-owned config
are in each apache-profile.json. WsgiDAV 4.3.5/cheroot 11.1.2 and all eleven
official PyPI wheel artifacts/hashes are in each dependencies.json. They are the
unchanged pinned profiles, not a service upgrade. `SCOPE-CHECKPOINT.json` collects
exact per-cohort source/package/provider hashes, original and independent counts,
fixture hashes, public resolution, and cleanup. `SCOPE-SHA256SUMS` seals the tree.

Use fresh evidence labels; existing output directories refuse overwrite:

```sh
node tests/fs/webdav/real-service/scope-seal.mjs --check
node tests/fs/webdav/real-service/scope-unit.mjs scope-recheck 69672fe210fbf8a23cc980828bb46d073b078425
node tests/fs/webdav/real-service/scope-replay.mjs scope-curie-recheck 69672fe210fbf8a23cc980828bb46d073b078425
```

Curie can instead invoke its own unchanged `real-service-independent/run.mjs`
with a fresh `/tmp/` output and that same full revision. Outer capture exit0 is
not an all-provider behavioral pass; original service runners still exit2 for
their retained failures. Reproduction adds new evidence and therefore requires a
separate new seal rather than overwriting this immutable checkpoint.

## Cleanup and acceptance boundary

All three author invocations use synthetic credentials, explicit loopback HTTPS,
task-owned roots/config/CA/venv/downloads and isolated HOME/TMPDIR. The original
bounded server/command limits and finally cleanup are unchanged. Native byte
witnesses access only those server roots. No global config/dependency/private
credentials or external WebDAV writes are used. Captures are copied into this
owned subtree before the outside output parent is removed. Each internal runner
also removes its own service/tool workspace; the seal verifies absence and the
recorded server exit status. Original author and independent files are verified
unchanged. No source outside the single WebDAV condition is included in the fix.

Safe rmdir, atomic rename, transactional identity and directory timestamp
interoperability remain outside this fix. Curie still owns final independent
acceptance of the committed source; these author replays do not replace it.
